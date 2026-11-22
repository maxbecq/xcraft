import { describe, expect, it, vi } from 'vitest';
import { newRoom, readRoom, Rematch } from './net';

describe('friend codes', () => {
  it('are read from the code or the whole link, and nothing else', () => {
    const room = newRoom();
    expect(readRoom(room.toLowerCase())).toBe(room);
    expect(readRoom(` https://maxbecq.github.io/xcraft/?ami=${room} `)).toBe(room);
    expect(readRoom(`https://x/?ami=${room}&hote`)).toBe(room);
    expect(readRoom('ABC')).toBeNull();
    expect(readRoom('AB0D')).toBeNull(); // 0 is never in a code: it reads like O
    expect(readRoom('ABCD-HIL')).toBeNull();
  });
});

import { AI } from './ai/ai';
import { commandOk, FORFEIT_MS, greeting, Lockstep, START, type Message, waitVerdict } from './net';
import { fingerprint } from './sim/fingerprint';
import { createMatch } from './sim/setup';
import type { Command, World } from './sim/world';

/** A seeded random number, so a failing case plays the same again. */
const rng = (seed: number) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);

interface Link {
  /** Delay of one message, ms. */
  latency: () => number;
  /** Lost on the way. */
  lost: () => boolean;
  /** Cut between these times (ms): nothing passes, and each side is told of a new connection when it ends. */
  cut?: [number, number];
}

/**
 * Two browsers, each with its own world and an AI playing its side, joined by `link`, on a shared clock: each one
 * draws a frame every 16 ms (a background one every 50 ms) and steps its simulation as the lockstep allows.
 * Returns both worlds and every tick's orders as each side carried them out.
 */
function play(ticks: number, link: Link, orders?: (world: World, player: number) => Command[]) {
  let now = 0;
  const queue: { at: number; to: number; m: Message }[] = [];
  const sides = [0, 1].map((player) => {
    const world = createMatch(['humains', 'isdaris']);
    const lock: Lockstep = new Lockstep(player, (m) => {
      if (link.cut && now >= link.cut[0] && now < link.cut[1]) return;
      // Copied, as the wire would: the other side never shares our objects.
      if (!link.lost()) queue.push({ at: now + link.latency(), to: 1 - player, m: JSON.parse(JSON.stringify(m)) });
    }, () => now);
    return { world, lock, ai: new AI(world, player), log: [] as [number, Command[]][], acc: 0, last: 0, period: player === 0 ? 16 : 50 };
  });
  let reconnected = false;
  while (sides.some((s) => s.world.tick < ticks) && now < ticks * 50 * 20) {
    now += 1;
    if (link.cut && !reconnected && now >= link.cut[1]) {
      reconnected = true;
      for (const s of sides) s.lock.reconnected();
    }
    queue.sort((a, b) => a.at - b.at);
    while (queue.length && queue[0].at <= now) {
      const { to, m } = queue.shift()!;
      sides[to].lock.receive(m);
    }
    for (const s of sides) {
      if (now - s.last < s.period) continue;
      s.acc += now - s.last;
      s.last = now;
      s.lock.poll();
      while (s.acc >= 50 && s.world.tick < ticks && s.lock.ready(s.world.tick)) {
        const cmds = s.lock.step(s.world.tick, orders ? orders(s.world, s.lock.player) : s.ai.think());
        if (s.world.tick % 100 === 0) s.lock.check(s.world.tick, fingerprint(s.world));
        if (cmds.length) s.log.push([s.world.tick, cmds]);
        s.world.step(cmds);
        s.acc -= 50;
      }
      s.acc = Math.min(s.acc, 50);
    }
  }
  return sides;
}

/** The same orders on a world of its own, with no network: what both sides should have reached. */
function replay(log: [number, Command[]][], ticks: number) {
  const world = createMatch(['humains', 'isdaris']);
  const at = new Map(log);
  while (world.tick < ticks) world.step(at.get(world.tick) ?? []);
  return world;
}

describe('lockstep between two browsers', () => {
  const ticks = 1200; // a minute of play: both AIs build, train and move
  const cases: [string, Link][] = [
    ['a steady link', { latency: () => 30, lost: () => false }],
    ['a slow link that jitters and reorders', (() => { const r = rng(7); return { latency: () => 80 + r() * 250, lost: () => false }; })()],
    ['a link losing a fifth of its messages', (() => { const r = rng(11); return { latency: () => 20 + r() * 60, lost: () => r() < 0.2 }; })()],
    ['a link cut for 8 seconds', { latency: () => 40, lost: () => false, cut: [15_000, 23_000] }],
  ];
  for (const [name, link] of cases)
    it(`keeps both games identical over ${name}`, () => {
      const [a, b] = play(ticks, link);
      expect(a.world.tick).toBe(ticks);
      expect(b.world.tick).toBe(ticks);
      expect(a.log.length).toBeGreaterThan(10); // the AIs did play
      expect(a.log).toEqual(b.log);
      expect(fingerprint(a.world)).toBe(fingerprint(b.world));
      expect(fingerprint(replay(a.log, ticks))).toBe(fingerprint(a.world));
      expect(a.lock.desync).toBeNull();
      expect(b.lock.desync).toBeNull();
    });

  it('never stalls on a batch the other side would refuse: split to its limits, and bad orders dropped on both sides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = (world: World, player: number): Command[] => {
      // Clicks piled up during a wait: far more orders than one tick takes, one with more units than an order carries,
      // and one the other side would refuse (NaN reaches it as null).
      if (player !== 0 || world.tick !== 10) return [];
      const moves = Array.from({ length: 200 }, (_, i) => ({ player, kind: 'move', ids: [i], x: i, y: 2 }) as Command);
      return [...moves, { player, kind: 'move', ids: Array.from({ length: 3000 }, (_, i) => i), x: 1, y: 2 } as Command, { player, kind: 'move', ids: [1], x: NaN, y: 2 } as Command];
    };
    const [a, b] = play(200, { latency: () => 40, lost: () => false }, big);
    expect(a.world.tick).toBe(200);
    expect(b.world.tick).toBe(200);
    expect(b.lock.rejected).toBe(0);
    expect(a.log).toEqual(b.log); // exactly the batch sent, on both sides
    const sent = a.log.flatMap(([, c]) => c);
    expect(sent.length).toBe(200 + 3); // 3000 units in three orders, the NaN one dropped
    expect(sent.reduce((n, c) => n + c.ids.length, 0)).toBe(200 + 3000);
    expect(Math.max(...a.log.map(([, c]) => c.length))).toBeLessThanOrEqual(64);
    warn.mockRestore();
  });

  it('keeps both games identical over 1500 ticks of random orders from both sides, on a lossy jittery link', () => {
    // Each side gives, at random ticks, random orders to random units of its own, and now and then to the other
    // side's units or to nothing: any of the kinds a player can give, at random places.
    const r = rng(23);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const orders = (world: World, player: number): Command[] => {
      if (r() > 0.15) return [];
      const units = [...world.entities.values()].filter((e) => e.def.kind === 'unit' && (r() < 0.9 ? e.owner === player : e.owner >= 0));
      const buildings = [...world.entities.values()].filter((e) => e.def.kind === 'building' && e.owner === player);
      const ids = units.filter(() => r() < 0.5).map((e) => e.id);
      const x = Math.floor(r() * world.map.width * 1024);
      const y = Math.floor(r() * world.map.height * 1024);
      const kind = pick(['move', 'smart', 'attack', 'patrol', 'stop', 'hold', 'train', 'build', 'cancel', 'rally']);
      const queue = r() < 0.3;
      switch (kind) {
        case 'train': return buildings.length ? [{ player, kind, ids: [pick(buildings).id], type: pick(['serf', 'moissonneur', 'caserne', 'auxiliaire']) }] : [];
        case 'build': return ids.length ? [{ player, kind, ids: ids.slice(0, 1), type: pick(['caserne', 'grenier', 'pylone']), tx: Math.floor(x / 1024), ty: Math.floor(y / 1024), queue }] : [];
        case 'cancel': return buildings.length ? [{ player, kind, ids: [pick(buildings).id] }] : [];
        case 'rally': return buildings.length ? [{ player, kind, ids: [pick(buildings).id], x, y }] : [];
        case 'stop': case 'hold': return [{ player, kind, ids }];
        default: return [{ player, kind, ids, x, y, queue } as Command];
      }
    };
    const net = rng(29);
    const [a, b] = play(1500, { latency: () => 30 + net() * 200, lost: () => net() < 0.1 }, orders);
    expect(a.world.tick).toBe(1500);
    expect(b.world.tick).toBe(1500);
    expect(a.log.filter(([, c]) => c.some((x) => x.player === 0)).length).toBeGreaterThan(50);
    expect(a.log.filter(([, c]) => c.some((x) => x.player === 1)).length).toBeGreaterThan(50);
    expect(a.log).toEqual(b.log);
    expect(fingerprint(a.world)).toBe(fingerprint(b.world));
    expect(fingerprint(replay(a.log, 1500))).toBe(fingerprint(a.world));
    expect(a.lock.desync).toBeNull();
    expect(b.lock.desync).toBeNull();
  });

  it('follows the round trip with its input delay, and never runs an order early', () => {
    const [fast] = play(200, { latency: () => 5, lost: () => false });
    const [slow] = play(200, { latency: () => 200, lost: () => false });
    expect(fast.lock.delay).toBe(2);
    expect(slow.lock.delay).toBeGreaterThanOrEqual(9);
    // The delay shrinking: orders wait for the next free tick, none skipped, none run twice.
    const sent: Message[] = [];
    const lock = new Lockstep(0, (m) => sent.push(m), () => 0);
    lock.delay = 8;
    lock.step(0, []);
    lock.delay = 2;
    for (let t = 1; t < 10; t++) lock.step(t, [{ player: 0, kind: 'stop', ids: [t] }]);
    const ticksSent = sent.flatMap((m) => ('t' in m ? [m.t] : []));
    expect(ticksSent).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(ticksSent[0]).toBe(START);
    // Given at ticks 1 to 7, while tick 8 was already taken: all at tick 9, in order.
    const at9 = sent.find((m) => 't' in m && m.t === 9) as { c: Command[] };
    expect(at9.c.map((c) => (c as { ids: number[] }).ids[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('finds two games that differ, whichever fingerprint arrives first', () => {
    const wires: Lockstep[] = [];
    const [a, b] = [0, 1].map((p) => (wires[p] = new Lockstep(p, (m) => wires[1 - p].receive(JSON.parse(JSON.stringify(m))), () => 0)));
    b.check(100, 1); // the other side's arrives before ours is made
    a.check(100, 1);
    expect(a.desync).toBeNull();
    a.check(200, 5);
    b.check(200, 6);
    expect(a.desync).toBe(200);
    expect(b.desync).toBe(200);
  });

  it('takes anything from the other side without breaking, and keeps every store bounded', () => {
    const r = rng(3);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const junk = (): unknown =>
      pick([null, undefined, NaN, Infinity, -1, 0, 1e300, 2 ** 53, 3.5, '', 'x', 'move', true, [], {}, [1, 2], { kind: 'move' }, Object.create(null)]);
    const value = (): unknown => (r() < 0.5 ? junk() : Math.floor(r() * 4000) - 500);
    const order = (): unknown =>
      r() < 0.3 ? junk() : { player: value(), kind: pick(['move', 'stop', 'trade', 'sandbox', 'nope', 'toString', '__proto__']), ids: r() < 0.7 ? [1, 2] : junk(), x: value(), y: value(), sell: pick(['minerals', 'gold', 1]) };
    const message = (): unknown => {
      const key = pick(['t', 'h', 'p', 'q', 'a', 'bye', 'hi', 'zzz']);
      return r() < 0.1 ? junk() : { [key]: value(), c: r() < 0.5 ? Array.from({ length: Math.floor(r() * 4) }, order) : junk(), v: value(), a: value() };
    };
    const sent: Message[] = [];
    let now = 0;
    const lock = new Lockstep(0, (m) => sent.push(m), () => now);
    for (let t = 0; t < 50; t++) lock.step(t, []); // something owed, which a wild acknowledgement must not wipe
    const owed = (lock as unknown as { unacked: Map<number, unknown> }).unacked;
    const before = owed.size;
    // An acknowledgement past what was sent is wild: it frees nothing.
    for (const a of [10 ** 9, 2 ** 53, 55, Infinity]) lock.receive({ p: 1, a } as never);
    expect(owed.size).toBe(before);
    expect(before).toBeGreaterThan(0);
    for (let i = 0; i < 20_000; i++) {
      now += 1;
      expect(() => lock.receive(message())).not.toThrow();
    }
    const stores = lock as unknown as { theirs: Map<number, Command[]>; their: Map<number, number> };
    expect(stores.theirs.size).toBeLessThanOrEqual(8 * 15 + 1);
    expect(stores.their.size).toBeLessThanOrEqual(16);
    expect(lock.delay).toBeGreaterThanOrEqual(2);
    expect(lock.delay).toBeLessThanOrEqual(15);
    for (const cmds of stores.theirs.values()) for (const c of cmds) expect(commandOk(c) && c.player === 1).toBe(true);
  });

  it('keeps what it stores within reach of its own play, and lets only a valid message count', () => {
    let now = 0;
    const lock = new Lockstep(0, () => {}, () => now);
    for (let t = 0; t < 20; t++) lock.step(t, []); // something owed
    const inside = lock as unknown as { theirs: Map<number, Command[]>; unacked: Map<number, unknown>; next: number };
    // A side still loading (or slower) does not step: every tick in a row, sent at once, stops at a bound.
    for (let t = START; t < 10_000; t++) lock.receive({ t, c: [], a: 0 });
    expect(inside.theirs.size).toBeLessThanOrEqual(inside.next + 8 * 15 - START + 1);
    const owed = inside.unacked.size;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    now = 5000;
    // Malformed: neither a sign of life nor an acknowledgement.
    for (const m of [{ t: 'x', c: [], a: inside.next }, { t: START + 500, c: [{ kind: 'nope' }], a: inside.next }, { h: 0.5, v: 1, a: inside.next }, { zzz: 1, a: inside.next }]) lock.receive(m);
    expect(lock.heard).toBe(0);
    expect(inside.unacked.size).toBe(owed);
    lock.receive({ p: 1, a: inside.next });
    expect(lock.heard).toBe(5000);
    expect(inside.unacked.size).toBe(0);
    warn.mockRestore();
  });

  it('logs a refused message, a few times only, and not a resend', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const lock = new Lockstep(0, () => {}, () => 0);
    lock.receive({ t: START, c: [], a: 0 });
    lock.receive({ t: START, c: [], a: 0 }); // the same tick again: a resend, normal
    expect(lock.rejected).toBe(0);
    const bad: unknown[] = [null, 'x', { t: 10 ** 9, c: [] }, { t: START + 1, c: 'x' }, { t: START + 1, c: [{ kind: 'nope' }] }, { h: 1.5, v: 1 }, { h: 10 ** 7, v: 1 }];
    for (const m of [...bad, ...bad]) expect(() => lock.receive(m)).not.toThrow();
    expect(lock.rejected).toBe(bad.length * 2);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it('lets every kind of order a player gives through, and nothing malformed', () => {
    const ok = [
      { player: 0, kind: 'smart', ids: [1, 2], x: 1024, y: 2048, target: 7, queue: true },
      { player: 0, kind: 'rally', ids: [3], x: 10, y: 20 },
      { player: 0, kind: 'build', ids: [4], type: 'caserne', tx: 5, ty: 6 },
      { player: 0, kind: 'train', ids: [4], type: 'marine' },
      { player: 0, kind: 'arm', ids: [4], weapon: 'laser' },
      { player: 0, kind: 'evolve', ids: [4] },
      { player: 0, kind: 'cancel', ids: [4], slot: 2 },
      { player: 0, kind: 'unload', ids: [4], unit: 9 },
      { player: 0, kind: 'ability', ids: [4], name: 'stim' },
      { player: 0, kind: 'trade', ids: [4], sell: 'energy' },
      { player: 0, kind: 'attack', ids: [4], x: 1, y: 2 },
      { player: 0, kind: 'patrol', ids: [4], x: 1, y: 2 },
      { player: 0, kind: 'stop', ids: [] },
      { player: 0, kind: 'hold', ids: [1] },
    ];
    for (const c of ok) expect(commandOk(JSON.parse(JSON.stringify(c))), c.kind).toBe(true);
    const bad = [
      { kind: 'move', ids: [1], x: 'a', y: 2 },
      { kind: 'move', ids: [1.5], x: 1, y: 2 },
      { kind: 'move', ids: 'all', x: 1, y: 2 },
      { kind: 'build', ids: [1], type: '', tx: 1, ty: 1 },
      { kind: 'trade', ids: [1], sell: 'gold' },
      { kind: 'sandbox', ids: [], tool: 'fog', on: true },
      { kind: 'toString', ids: [] },
      { kind: 'move', ids: Array(2000).fill(1), x: 1, y: 2 },
    ];
    for (const c of bad) expect(commandOk(c), JSON.stringify(c).slice(0, 40)).toBe(false);
  });

  it("knows when the other side's match has begun, not merely its page", () => {
    const b = new Lockstep(1, () => {});
    b.receive({ hi: 'x' } as never);
    expect(b.started).toBe(false);
    b.receive({ t: START + 1, c: [], a: START }); // out of order: still a sign of life
    expect(b.started).toBe(true);
  });

  it('hears a deliberate leave', () => {
    const b = new Lockstep(1, () => {});
    b.receive({ bye: 1 });
    expect(b.left).toBe(true);
  });

  it("goes to a rematch only once both asked, on the host's word, and once", () => {
    const host = new Rematch(0);
    const guest = new Rematch(1);
    expect(guest.take('ABCD')).toBe(null); // in the middle of the match: nobody asked
    expect(host.take('ABCD')).toBe(null); // a host never takes a room
    expect(host.theyAsk()).toBe(null);
    expect(guest.theyAsk()).toBe(null); // a guest never names one
    const room = host.ask();
    expect(room && readRoom(room)).toBe(room);
    expect(host.ask()).toBe(null); // once
    guest.ask();
    expect(guest.take('<b>')).toBe(null);
    expect(guest.take(room)).toBe(room);
    expect(guest.take('WXYZ')).toBe(null); // once
  });

  it('starts no rematch once the other side is gone', () => {
    const host = new Rematch(0);
    host.theyAsk();
    host.lost();
    expect(host.ask()).toBe(null);
    const guest = new Rematch(1);
    guest.ask();
    guest.lost();
    expect(guest.take('ABCD')).toBe(null);
  });

  it('never takes a Bac à sable switch from the other side, wherever it stands in the list', () => {
    const lock = new Lockstep(0, () => {}, () => 0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const move = { player: 1, kind: 'move', ids: [1], x: 1, y: 2 };
    lock.receive({ t: START, c: [move, { player: 1, kind: 'sandbox', ids: [], tool: 'fog', on: true }], a: 0 });
    expect(lock.ready(START)).toBe(false);
    expect(lock.rejected).toBe(1);
    warn.mockRestore();
  });

  it('does not wait forever for a friend whose page closed while loading', () => {
    expect(waitVerdict(false, 0, 0, 99_000).say).toBe('loading'); // still loading, linked
    expect(waitVerdict(false, 1000, 0, 1500).say).toBe('nothing'); // a short cut
    expect(waitVerdict(false, 1000, 0, 10_000)).toEqual({ say: 'waiting', left: 51 });
    expect(waitVerdict(false, 1000, 0, 1000 + FORFEIT_MS).say).toBe('cut-over');
    expect(waitVerdict(true, 0, 1000, 1000 + FORFEIT_MS).say).toBe('forfeit');
  });

  it('turns away a page of another version alone, once the other side is known', () => {
    expect(greeting(null, { hi: 'a', v: '1' }, '1')).toBe('ok');
    expect(greeting(null, { hi: 'a', v: '0' }, '1')).toBe('other-version'); // the friend: no match possible
    expect(greeting('a', { hi: 'a', v: '1' }, '1')).toBe('ok'); // back after a cut
    expect(greeting('a', { hi: 'b', v: '0' }, '1')).toBe('stranger'); // the match goes on
    expect(greeting('a', { hi: 'b', v: '1' }, '1')).toBe('stranger');
  });
});
