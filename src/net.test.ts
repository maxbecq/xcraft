import { describe, expect, it } from 'vitest';
import { newRoom, readRoom } from './net';

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
import { Lockstep, START, stateHash, type Message } from './net';
import { createMatch } from './sim/setup';
import type { Command } from './sim/world';

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
function play(ticks: number, link: Link) {
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
        const cmds = s.lock.step(s.world.tick, s.ai.think());
        if (s.world.tick % 100 === 0) s.lock.check(s.world.tick, stateHash(s.world));
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
      expect(stateHash(a.world)).toBe(stateHash(b.world));
      expect(stateHash(replay(a.log, ticks))).toBe(stateHash(a.world));
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

  it("knows when the other side's match has begun, not merely its page", () => {
    const b = new Lockstep(1, () => {});
    b.receive({ hi: 'x' } as never);
    expect(b.started).toBe(false);
    b.receive({ t: START + 1, c: [], a: START }); // out of order: still a sign of life
    expect(b.started).toBe(true);
  });

  it('fingerprints shields, research and orders too, cheaply', () => {
    const [a] = play(600, { latency: () => 30, lost: () => false });
    const other = replay(a.log, 600);
    expect(stateHash(other)).toBe(stateHash(a.world));
    const unit = [...other.entities.values()].find((e) => e.def.kind === 'unit' && e.owner === 1)!;
    const was = { shield: unit.shield, order: unit.order };
    unit.shield += 1;
    expect(stateHash(other)).not.toBe(stateHash(a.world));
    unit.shield = was.shield;
    unit.order = { kind: 'move', x: unit.x + 1000, y: unit.y, arrive: 0 } as typeof unit.order;
    expect(stateHash(other)).not.toBe(stateHash(a.world));
    unit.order = was.order;
    other.players[1].upgrades = { ...other.players[1].upgrades, test: 1 };
    expect(stateHash(other)).not.toBe(stateHash(a.world));
    // Every 100 ticks (5 s): it must stay far below a frame.
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) stateHash(a.world);
    const each = (performance.now() - t0) / 200;
    expect(each).toBeLessThan(2);
  });

  it('hears a deliberate leave', () => {
    const b = new Lockstep(1, () => {});
    b.receive({ bye: 1 });
    expect(b.left).toBe(true);
  });
});
