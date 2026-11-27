import { describe, expect, it } from 'vitest';
import { FP, ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command, Entity, World } from '../sim/world';
import { DEFS, FACTIONS } from '../data';
import { AI, DIFFICULTY, teamFocus } from './ai';
import { STRATEGIES } from './strategy';

/** Plays until someone wins or the time runs out; returns the winner and the game time in minutes. */
function play(world: World, ais: AI[], minutes: number): { winner: number | null; minutes: number } {
  const limit = ticks(minutes * 60);
  while (world.winner === null && world.tick < limit) world.step(ais.flatMap((ai) => ai.think()));
  return { winner: world.winner, minutes: Math.round((world.tick / ticks(60)) * 10) / 10 };
}

describe('AI', () => {
  it('never orders a building where its workers cannot get (L\'Anneau: low ground at the foot of the main\'s cliff)', () => {
    const w = createMatch(['humains', 'isdaris'], undefined, 'l-anneau');
    w.players.forEach((p) => (p.handicap = 130));
    const ais = [new AI(w, 0, undefined, 'hard'), new AI(w, 1, undefined, 'hard')];
    let failed = 0;
    while (w.winner === null && w.tick < ticks(14 * 60)) {
      w.step(ais.flatMap((ai) => ai.think()));
      failed += w.events.filter((e) => e.text === 'Emplacement inaccessible.').length;
    }
    expect(failed).toBe(0);
  }, 60_000);

  it('spreads its attacks in a four-player free-for-all: two opponents never pick the same first target', () => {
    // Carrefour: four corners, each at the same distance from its two neighbours.
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], undefined, 'carrefour');
    const ais = [0, 1, 2, 3].map((i) => new AI(w, i));
    const focus = teamFocus(w);
    while (focus.size < 4 && w.tick < ticks(15 * 60)) w.step(ais.flatMap((ai) => ai.think()));
    const victims = [...focus.values()].map((id) => w.entities.get(id)!.owner);
    expect(victims).toHaveLength(4);
    expect(new Set(victims).size, `targets ${victims}`).toBe(4);
  }, 60_000);

  it('in a free-for-all, a second enemy known at the far corner does not hold back a wave strong enough for the first', () => {
    const goes = (both: boolean) => {
      const w = createMatch(['isdaris', 'isdaris', 'isdaris', 'isdaris'], undefined, 'carrefour');
      const hqs = [0, 1, 2, 3].map((p) => [...w.entities.values()].find((e) => e.owner === p && e.type === FACTIONS.isdaris.hq)!);
      const ours = Array.from({ length: 12 }, (_, i) => w.spawn('archer', 0, hqs[0].x + (6 + (i % 4)) * FP, hqs[0].y + (6 + Math.floor(i / 4)) * FP));
      // Each enemy side's eight Archers, seen by a Voyageur of ours by them.
      for (const p of both ? [1, 2] : [1]) {
        for (let i = 0; i < 8; i++) w.spawn('archer', p, hqs[p].x + (i % 4) * FP, hqs[p].y + 6 * FP + Math.floor(i / 4) * FP);
        w.spawn('voyageur', 0, hqs[p].x, hqs[p].y + 9 * FP);
      }
      w.step([]);
      w.tick = ticks(12 * 60) - (ticks(12 * 60) % 10);
      const ai = new AI(w, 0, undefined, 'normal', { strategy: STRATEGIES.isdaris[0].id });
      const sent = new Set<number>();
      for (let i = 0; i < 40; i++) {
        for (const c of ai.think()) if (c.kind === 'attack') for (const id of c.ids) sent.add(id);
        w.tick += 10;
      }
      return ours.filter((u) => sent.has(u.id)).length;
    };
    expect(goes(false)).toBeGreaterThan(0);
    expect(goes(true)).toBeGreaterThan(0);
  });

  it('beats an idle opponent', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 1)], 20);
    expect(r.winner).toBe(1);
  }, 60_000);

  it('wins more often with a better difficulty, from either side', () => {
    for (const [weak, strong] of [['easy', 'normal'], ['normal', 'hard']]) {
      for (const side of [0, 1]) {
        // On three maps, most games: one mirror game alone turned on a coin (normal against hard on Origine, the
        // stronger side lost at 16:24 once the AI read the enemy; it wins on the two other maps).
        const wins = ['origine', 'carrefour', 'le-col'].filter((map) => {
          const w = createMatch(undefined, undefined, map);
          w.players[side].handicap = DIFFICULTY[strong];
          w.players[1 - side].handicap = DIFFICULTY[weak];
          return play(w, [new AI(w, 0), new AI(w, 1)], 35).winner === side;
        }).length;
        expect(wins).toBeGreaterThanOrEqual(2);
      }
    }
  }, 180_000);

  it('scans only where an undetected invisible unit hits, not at shooters out of sight', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ai = new AI(w, 0);
    w.spawn('forge', 0, 20 * FP, 22 * FP);
    w.players[0].energy = 200;
    w.players[0].upgrades.observation = 1; // the telescope is a research: without it the order is refused
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const scansAfter = (attacker: Entity) => {
      while (w.tick % 10 !== 0 || w.tick < 4) w.step([]);
      serf.lastHit = w.tick;
      serf.lastAttacker = attacker.id;
      return ai.think().filter((c) => c.kind === 'ability');
    };
    const sniper = w.spawn('druide', 1, serf.x + 7 * FP, serf.y + 7 * FP); // visible or not, it is no invisible unit
    expect(scansAfter(sniper)).toHaveLength(0);
    const sin = w.spawn('assassin', 1, serf.x + FP, serf.y);
    expect(scansAfter(sin)).toEqual([expect.objectContaining({ x: serf.x, y: serf.y })]);
    sin.x += 6 * FP; // an assassin far from the victim: not the culprit
    expect(scansAfter(sin)).toHaveLength(0);
  }, 60_000);

  it('defends its base against a raid, its wave included, and pulls workers when it has no army', () => {
    const w = createMatch();
    const ai = new AI(w, 0);
    play(w, [ai], 6);
    // The idle opponent may be dead by now: keep it in the game with a building out of the way.
    w.winner = null;
    w.spawn('grenier', 1, 90 * FP, 4 * FP);
    const council = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const army = () => [...w.entities.values()].filter((e) => e.owner === 0 && e.def.kind === 'unit' && !(e.def as { worker?: boolean }).worker);
    expect(army().length).toBeGreaterThan(3);
    // Everyone away, as if a wave had left: a raid on the council must bring them back.
    w.step([{ player: 0, kind: 'smart', ids: army().map((u) => u.id), x: 80 * FP, y: 80 * FP }]);
    (ai as unknown as { wave: Set<number> }).wave = new Set(army().map((u) => u.id));
    const raid = [0, 1, 2, 3, 4, 5].map((i) => w.spawn('legionnaire', 1, council.x + (4 + (i % 3)) * FP, council.y + (4 + Math.floor(i / 3)) * FP));
    const step = () => w.step([...ai.think(), ...raid.filter((r) => !r.order && r.hp > 0).map((r) => ({ player: 1, kind: 'attack' as const, ids: [r.id], x: council.x, y: council.y, target: council.id }))]);
    for (let i = 0; i < ticks(60) && raid.some((r) => r.hp > 0); i++) step();
    expect(raid.every((r) => r.hp <= 0)).toBe(true);
    expect(council.hp).toBeGreaterThan(0);

    // No army at all: the serfs fight two raiders.
    const w2 = createMatch();
    const ai2 = new AI(w2, 0);
    const hq = [...w2.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const two = [0, 1].map((i) => w2.spawn('auxiliaire', 1, hq.x + (5 + i) * FP, hq.y + 5 * FP));
    for (let i = 0; i < ticks(40) && two.some((r) => r.hp > 0); i++) {
      w2.step([...ai2.think(), ...two.filter((r) => !r.order && r.hp > 0).map((r) => ({ player: 1, kind: 'attack' as const, ids: [r.id], x: hq.x, y: hq.y, target: hq.id }))]);
    }
    expect(two.every((r) => r.hp <= 0)).toBe(true);
  }, 60_000);

  it('a wave called back to a raid too strong for it is sent to the rally point, not left on its way to the enemy', () => {
    const w = createMatch(['isdaris', 'humains']);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === FACTIONS.isdaris.hq)!;
    const far = w.spawn('creature', 0, hq.x + 30 * FP, hq.y + 30 * FP);
    const goal = { x: hq.x + 60 * FP, y: hq.y + 60 * FP };
    w.step([{ player: 0, kind: 'attack', ids: [far.id], x: goal.x, y: goal.y }]);
    const ai = new AI(w, 0);
    (ai as unknown as { wave: Set<number> }).wave = new Set([far.id]);
    for (let i = 0; i < 6; i++) w.spawn('legionnaire', 1, hq.x + (4 + (i % 3)) * FP, hq.y + (4 + Math.floor(i / 3)) * FP);
    while (w.tick % 10 !== 0) w.step([]);
    w.step(ai.think());
    expect((ai as unknown as { wave: Set<number> }).wave.has(far.id)).toBe(false);
    // The order the simulation now carries out: no longer the attack on the enemy's side.
    const o = far.order as { kind: string; x?: number; y?: number } | null;
    expect(o && o.x === goal.x && o.y === goal.y).toBeFalsy();
  });

  it('pulls a wave group back from a fight it cannot win, not from one it can', () => {
    const w = createMatch();
    const ai = new AI(w, 0);
    const wave = [0, 1, 2, 3].map((i) => w.spawn('auxiliaire', 0, (48 + i) * FP, 48 * FP));
    (ai as unknown as { wave: Set<number> }).wave = new Set(wave.map((u) => u.id));
    const retreat = () => {
      do w.step([]);
      while (w.tick % 10 !== 0);
      return ai.think().find((c) => c.kind === 'smart' && c.ids.includes(wave[0].id));
    };
    w.spawn('auxiliaire', 1, 48 * FP, 54 * FP);
    expect(retreat()).toBeUndefined();
    for (let i = 0; i < 10; i++) w.spawn('legionnaire', 1, (46 + (i % 5)) * FP, (54 + Math.floor(i / 5)) * FP);
    expect(retreat()).toBeDefined();
  }, 60_000);

  it('Isdaris fall back into the recharge zone of a Réserve psy', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ais = [new AI(w, 0), new AI(w, 1)];
    play(w, ais, 8);
    const ai = ais[1] as unknown as { wave: Set<number> };
    // No Human army raiding the Isdaris base, or the group would go and defend it instead.
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.def.kind === 'unit' && !e.def.worker) w.entities.delete(e.id);
    // A small group facing a big army far away runs back to a Réserve psy.
    const group = [0, 1, 2].map((i) => w.spawn('archer', 1, (40 + i) * FP, 48 * FP));
    for (let i = 0; i < 12; i++) w.spawn('legionnaire', 0, (38 + (i % 6)) * FP, (52 + Math.floor(i / 6)) * FP);
    ai.wave = new Set(group.map((u) => u.id));
    let order: { x: number; y: number } | undefined;
    for (let i = 0; i < 40 && !order; i++) {
      w.step([]);
      const c = ais[1].think().find((c) => c.kind === 'smart' && c.ids.includes(group[0].id));
      if (c?.kind === 'smart') order = c;
    }
    const reserves = [...w.entities.values()].filter((e) => e.owner === 1 && e.type === 'reservepsy');
    expect(reserves.some((r) => order && r.x === order.x && r.y === order.y)).toBe(true);
  }, 60_000);

  it('finishes an AI-versus-AI game', () => {
    const w = createMatch();
    // A strict mirror can mine the map out even and end in a draw: one side gathers a little less.
    w.players[1].handicap = 95;
    const r = play(w, [new AI(w, 0), new AI(w, 1)], 45); // the mirror match ends near minute 40
    console.log('AI vs AI:', r, 'units', [...w.entities.values()].filter((e) => e.def.kind === 'unit').length);
    expect(r.winner).not.toBeNull();
  }, 60_000);
  it('Z: trains socles while saving for its tech, before the tech can even be built', () => {
    // From minute 6 the Z AI keeps the energy of its Intelligence suprême; it used to keep it before the Centre
    // d'armement and the Centre de recherche it needs stood, and a socle that costs no energy waited for those 400
    // energy too: the Z army never grew past 5 to 8 units (measure of the 0.9.48).
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 20 * FP, 30 * FP);
    const plat = w.spawn('plateforme', 0, 22 * FP, 30 * FP);
    plat.host = pod.id;
    w.tick = ticks(7 * 60);
    w.players[0].minerals = 600;
    w.players[0].energy = 100;
    const ai = new AI(w, 0);
    let trained = false;
    for (let i = 0; i < 40 && !trained; i++) {
      const cmds = ai.think();
      trained = cmds.some((c) => c.kind === 'train' && c.ids.includes(plat.id));
      w.step(cmds);
    }
    expect(w.lacks(0, 'supreme')).not.toBe('');
    expect(trained).toBe(true);
  });
  it('Z: raises an add-on on a Pod with room, never retrying a Pod that has none or is full', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'intelligence');
    const boxed = w.spawn('pod', 0, ic.x + 10 * FP, ic.y);
    const full = w.spawn('pod', 0, ic.x + 4 * FP, ic.y - 10 * FP);
    for (let i = 0; i < 3; i++) w.spawn('tourelle', 0, (50 + 4 * i) * FP, 50 * FP).host = full.id;
    const open = w.spawn('pod', 0, ic.x + 4 * FP, ic.y + 10 * FP);
    for (let i = 0; i < ticks(30); i++) w.step([]); // creep
    // Wall the first Pod in: towers of its own on every side left free.
    for (let spot; (spot = w.addonSpot(boxed, 'tourelle') ?? w.addonSpot(boxed, 'plateforme')); ) w.spawn('tourelle', 0, (spot[0] + 1) * FP, (spot[1] + 1) * FP);
    expect(w.addonSpot(boxed, 'plateforme')).toBeUndefined();
    w.players[0].minerals = 3000;
    w.players[0].energy = 1000;
    const ai = new AI(w, 0);
    const hosts: number[] = [];
    for (let i = 0; i < 40; i++) {
      const cmds = ai.think();
      for (const c of cmds) if (c.kind === 'train' && c.type && ['plateforme', 'tourelle'].includes(c.type)) hosts.push(...c.ids);
      w.step(cmds);
    }
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((id) => id === open.id)).toBe(true);
  });
});

describe('AI resignation', () => {
  /** Player 1 left with its buildings only: no unit, no mineral. */
  const ruined = (minerals: number) => {
    const w = createMatch();
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'unit') w.entities.delete(e.id);
    w.players[1].minerals = minerals;
    w.players[1].energy = 0;
    return w;
  };

  it('gives up 20 seconds after the game is lost, and the other side wins', () => {
    const w = ruined(0);
    const ai = new AI(w, 1);
    let warned = false;
    while (w.winner === null && w.tick < ticks(90)) {
      w.step(ai.think());
      warned ||= w.events.some((e) => e.player === 0 && e.text === "L'adversaire abandonne.");
    }
    expect(w.players[1].resigned).toBe(true);
    expect(w.winner).toBe(0);
    expect(warned).toBe(true);
    expect(w.tick).toBeGreaterThanOrEqual(ticks(20));
  }, 60_000);

  it('never gives up while it can still pay for a worker', () => {
    const w = ruined(100);
    const ai = new AI(w, 1);
    while (w.winner === null && w.tick < ticks(120)) w.step(ai.think());
    expect(w.players[1].resigned).toBeFalsy();
    expect(w.winner).toBe(null);
  }, 60_000);

  it('is refused in a match with one player (Bac à sable)', () => {
    const w = createMatch(['humains']);
    w.step([{ player: 0, kind: 'resign', ids: [] }]);
    expect(w.players[0].resigned).toBeFalsy();
  });
});

describe('AI Z blind spots', () => {
  const thinkTick = (min: number) => ticks(min * 60) - (ticks(min * 60) % 10);
  const hqOf = (w: World, p = 0) => [...w.entities.values()].find((e) => e.owner === p && e.type === 'intelligence')!;

  it('an unarmed enemy flyer seen once does not turn the AI to anti-air', () => {
    const w = createMatch(['z', 'isdaris']);
    const ic = hqOf(w);
    const scout = w.spawn('voyageur', 1, ic.x + 3 * FP, ic.y + 3 * FP);
    w.step([]);
    expect(w.sees(0, scout)).toBe(true);
    w.tick = thinkTick(5);
    const ai = new AI(w, 0);
    ai.think();
    expect((ai as unknown as { enemyAir: number }).enemyAir).toBe(0);
    w.spawn('dragon', 1, ic.x - 3 * FP, ic.y + 3 * FP);
    w.step([]);
    w.tick = thinkTick(6);
    ai.think();
    expect((ai as unknown as { enemyAir: number }).enemyAir).toBe(1);
  });

  it('unarmed enemy scouts seen, then gone, leave the army\'s shares as they were', () => {
    const shares = (spies: number) => {
      const w = createMatch(['isdaris', 'isdaris']);
      const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === FACTIONS.isdaris.hq)!;
      const seen = Array.from({ length: spies }, (_, i) => w.spawn('espion', 1, hq.x + (3 + i) * FP, hq.y + 3 * FP));
      w.step([]);
      w.tick = thinkTick(6);
      const ai = new AI(w, 0);
      const list = () => JSON.stringify((ai as unknown as { armyList: [string, number][] }).armyList);
      for (let i = 0; i < 200; i++, w.tick += 10) ai.think();
      const during = list();
      for (const s of seen) w.remove(s);
      for (let i = 0; i < 200; i++, w.tick += 10) ai.think();
      return [during, list()];
    };
    const [usual] = shares(0);
    expect(shares(3)).toEqual([usual, usual]);
  });

  it('never picks a drone sheltered in a building as a builder', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    const d = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'drone')!;
    const ai = new AI(w, 0) as unknown as { builder(s: Entity[], spot: [number, number], size: number): Entity | undefined };
    expect(ai.builder([d], [ic.tx, ic.ty + 8], 2)).toBe(d);
    d.inside = ic.id;
    expect(ai.builder([d], [ic.tx, ic.ty + 8], 2)).toBeUndefined();
  });

  it('gives a worker one build order a turn at most', () => {
    for (const [factions, map] of [[['z', 'humains'], 'origine'], [['humains', 'isdaris'], 'le-col']] as const) {
      const w = createMatch([...factions], undefined, map);
      const ais = [new AI(w, 0), new AI(w, 1)];
      while (w.tick < ticks(10 * 60)) {
        const cmds = ais.flatMap((ai) => ai.think());
        const ids = cmds.filter((c) => c.kind === 'build' && !c.queue).flatMap((c) => c.ids);
        expect(new Set(ids).size).toBe(ids.length);
        w.step(cmds);
      }
    }
  }, 120_000);

  it('Z: with few drones and its minerals short, the Intelligence trains a drone instead of waiting for the suprême', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'drone') w.entities.delete(e.id);
    w.spawn('drone', 0, ic.x, ic.y + 4 * FP);
    for (const [t, dx, up] of [['armement', -9, 'laser'], ['centrerecherche', 9, 'rquadripode']] as const) w.spawn(t, 0, ic.x + dx * FP, ic.y + 6 * FP).queue.push(up);
    w.tick = thinkTick(7);
    w.players[0].minerals = 200;
    w.players[0].energy = 500;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [ic.id], type: 'drone' }));
  });

  it('Z: an Assimilateur never takes the mineral line below half the planned drones', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    const well = [...w.entities.values()].filter((e) => e.type === 'puits').sort((a, b) => Math.hypot(a.x - ic.x, a.y - ic.y) - Math.hypot(b.x - ic.x, b.y - ic.y))[0];
    const acc = w.spawn('assimilateur', 0, well.x, well.y);
    const drones = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'drone');
    w.tick = thinkTick(3);
    const field = [...w.entities.values()].find((e) => e.type === 'minerai')!;
    for (const d of drones) d.order = { kind: 'gather', target: field.id, phase: 'go', timer: 0 };
    const into = (cmds: Command[]) => cmds.filter((c) => c.kind === 'smart' && c.target === acc.id).flatMap((c) => c.ids).length;
    // Three gathering: none goes in.
    for (const d of drones.slice(3)) w.entities.delete(d.id);
    expect(into(new AI(w, 0).think())).toBe(0);
  });

  it('Z: a heavy socle whose minerals are not there does not hold the Plate-forme', () => {
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 20 * FP, 30 * FP);
    const plat = w.spawn('plateforme', 0, 22 * FP, 30 * FP);
    plat.host = pod.id;
    w.spawn('centresocles', 0, 30 * FP, 30 * FP);
    for (const up of ['rquadripode', 'rhexapode', 'roctopode']) w.players[0].upgrades[up] = 1;
    w.tick = thinkTick(12);
    w.players[0].minerals = 330;
    w.players[0].energy = 900;
    const cmds = new AI(w, 0).think();
    const t = cmds.find((c) => c.kind === 'train' && c.ids.includes(plat.id)) as { type: string } | undefined;
    expect(t?.type).toBeDefined();
    expect(t?.type).not.toBe('octopode');
  });

  it('Z: a weapon it cannot pay for moves the rotation on instead of holding the Plate-formes', () => {
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 20 * FP, 30 * FP);
    const plat = w.spawn('plateforme', 0, 22 * FP, 30 * FP);
    plat.host = pod.id;
    w.spawn('centresocles', 0, 30 * FP, 30 * FP);
    for (const up of ['rquadripode', 'raccumulateur', 'rreparateur', 'rarc']) w.players[0].upgrades[up] = 1;
    w.tick = thinkTick(12);
    const ai = new AI(w, 0);
    let trained = false;
    for (let i = 0; i < 30 && !trained; i++) {
      w.players[0].minerals = 2000;
      w.players[0].energy = 60;
      const cmds = ai.think();
      trained = cmds.some((c) => c.kind === 'train' && c.ids.includes(plat.id));
      w.tick += 10;
    }
    expect(trained).toBe(true);
  });

  it('Z: an unarmed Espion in the wave follows the armed front', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    const foe = [...w.entities.values()].find((e) => e.owner === 1 && e.type === 'conseil')!;
    const front = [0, 1, 2].map((i) => w.spawn('quadripode', 0, (foe.x + ic.x) / 2 + i * FP, (foe.y + ic.y) / 2));
    const spy = w.spawn('zespion', 0, ic.x, ic.y + 3 * FP);
    w.tick = thinkTick(10);
    const ai = new AI(w, 0);
    const state = ai as unknown as { wave: Set<number>; waves: number };
    for (const u of [...front, spy]) state.wave.add(u.id);
    state.waves = 1;
    const cmds = ai.think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'move', ids: [spy.id] }));
    expect(cmds.some((c) => c.kind === 'attack' && c.ids.includes(spy.id))).toBe(false);
  });

  it('Z: its last Intelligence lost, a drone raises one again when the bank allows', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    w.spawn('pod', 0, ic.x + 8 * FP, ic.y);
    w.remove(ic);
    // Late (a worker's price kept from minute 10), every drone carrying minerals it has nowhere to bring.
    for (const d of [...w.entities.values()]) if (d.owner === 0 && d.type === 'drone') d.carry = 5;
    w.tick = thinkTick(11);
    w.players[0].minerals = 800;
    w.players[0].energy = 200;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'build', type: 'intelligence' }));
    // The Pod's add-ons wait: their price would leave the Intelligence short.
    expect(cmds.some((c) => c.kind === 'train')).toBe(false);
    // Without the price: a last stand, as before.
    w.players[0].minerals = 50;
    w.tick += 10;
    expect(new AI(w, 0).think().some((c) => c.kind === 'build')).toBe(false);
  });
  it('Z: its mineral line raided away with no drone price left, the Assimilateur crew comes out', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    const well = [...w.entities.values()].filter((e) => e.type === 'puits').sort((a, b) => Math.hypot(a.x - ic.x, a.y - ic.y) - Math.hypot(b.x - ic.x, b.y - ic.y))[0];
    const acc = w.spawn('assimilateur', 0, well.x, well.y);
    const drones = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'drone');
    for (const d of drones.slice(0, 3)) d.inside = acc.id;
    for (const d of drones.slice(3)) w.remove(d);
    w.tick = thinkTick(9);
    w.players[0].minerals = 60;
    expect(new AI(w, 0).think()).toContainEqual(expect.objectContaining({ kind: 'unload', ids: [acc.id] }));
  });

  it('Z: with no drone left, the suprême never takes the price of the next one', () => {
    const w = createMatch(['z', 'humains']);
    const ic = hqOf(w);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'drone') w.remove(e);
    for (const [t, dx, up] of [['armement', -9, 'laser'], ['centrerecherche', 9, 'rquadripode']] as const) w.spawn(t, 0, ic.x + dx * FP, ic.y + 6 * FP).queue.push(up);
    w.tick = thinkTick(7);
    w.players[0].minerals = 300;
    w.players[0].energy = 400;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [ic.id], type: 'drone' }));
    expect(cmds.some((c) => c.kind === 'train' && c.type === 'supreme')).toBe(false);
  });

  it('Z: energy piling up, the heaviest socle is one its weapon can come with', () => {
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 20 * FP, 30 * FP);
    const plat = w.spawn('plateforme', 0, 22 * FP, 30 * FP);
    plat.host = pod.id;
    w.spawn('centresocles', 0, 30 * FP, 30 * FP);
    for (const up of ['rquadripode', 'rhexapode', 'laser']) w.players[0].upgrades[up] = 1;
    w.tick = thinkTick(12);
    w.players[0].minerals = 330;
    w.players[0].energy = 900;
    const t = new AI(w, 0).think().find((c) => c.kind === 'train' && c.ids.includes(plat.id)) as { type: string } | undefined;
    expect(t?.type).toBeDefined();
    expect(t?.type).not.toBe('hexapode');
  });
  it('no income left: a lone soldier waits for the units the bank still pays, then goes with the last of them', () => {
    const w = createMatch(['humains', 'isdaris']);
    for (const e of [...w.entities.values()]) if (e.type === 'minerai') w.remove(e);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const u = w.spawn('auxiliaire', 0, hq.x, hq.y + 5 * FP);
    w.spawn('caserne', 0, hq.x + 8 * FP, hq.y + 8 * FP);
    w.tick = thinkTick(20);
    w.players[0].minerals = 1000;
    const goes = (cmds: Command[]) => cmds.some((c) => c.kind === 'attack' && c.ids.includes(u.id));
    expect(goes(new AI(w, 0).think())).toBe(false);
    w.players[0].minerals = 0;
    w.players[0].energy = 0;
    w.tick += 10;
    expect(goes(new AI(w, 0).think())).toBe(true);
  });
  it('an unarmed enemy flyer by our buildings is no threat to stay home for', () => {
    const w = createMatch(['humains', 'isdaris']);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    w.spawn('voyageur', 1, hq.x + 4 * FP, hq.y);
    w.step([]);
    const ai = new AI(w, 0) as unknown as { threat(b: Entity[]): unknown };
    expect(ai.threat([hq])).toBeUndefined();
  });

  it('no income and nothing left to train them: the last soldiers go', () => {
    const w = createMatch(['humains', 'isdaris']);
    for (const e of [...w.entities.values()]) if (e.type === 'minerai') w.remove(e);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const u = w.spawn('auxiliaire', 0, hq.x, hq.y + 5 * FP);
    w.tick = thinkTick(20);
    w.players[0].minerals = 1000;
    expect(new AI(w, 0).think().some((c) => c.kind === 'attack' && c.ids.includes(u.id))).toBe(true);
  });
  it('Z: no income, its strategy\'s socles out of reach: a Plate-forme trains the drone de combat the bank pays, then the last soldiers go', () => {
    const w = createMatch(['z', 'humains']);
    for (const e of [...w.entities.values()]) if (e.type === 'minerai') w.remove(e);
    const ic = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'intelligence')!;
    const pod = w.spawn('pod', 0, ic.x + 8 * FP, ic.y);
    const plat = w.spawn('plateforme', 0, ic.x + 10 * FP, ic.y);
    plat.host = pod.id;
    w.spawn('centresocles', 0, ic.x - 8 * FP, ic.y);
    for (const up of ['rquadripode', 'rhexapode']) w.players[0].upgrades[up] = 1;
    const u = w.spawn('dronecombat', 0, ic.x, ic.y + 5 * FP);
    // Its drones all there (none to train), before minute 10 (no drone's price kept against a raid).
    for (let i = 0; i < 10; i++) w.spawn('drone', 0, ic.x - 3 * FP, ic.y + 3 * FP);
    w.tick = thinkTick(8);
    w.players[0].minerals = 130;
    w.players[0].energy = 0;
    const ai = new AI(w, 0, undefined, 'normal', { strategy: 'artillerie' });
    let trained = false;
    let goes = false;
    for (let i = 0; i < 3000 && !goes; i++) {
      const cmds = ai.think();
      trained ||= cmds.some((c) => c.kind === 'train' && c.ids.includes(plat.id) && c.type === 'dronecombat');
      goes = cmds.some((c) => c.kind === 'attack' && c.ids.includes(u.id));
      w.step(cmds);
    }
    expect(trained).toBe(true);
    expect(goes).toBe(true);
  });

  it('Z: no Intelligence nor its price, a Plate-forme still trains what the bank pays', () => {
    const w = createMatch(['z', 'humains']);
    const ic = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'intelligence')!;
    const pod = w.spawn('pod', 0, ic.x + 8 * FP, ic.y);
    const plat = w.spawn('plateforme', 0, ic.x + 10 * FP, ic.y);
    plat.host = pod.id;
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'drone') w.remove(e);
    w.remove(ic);
    w.tick = thinkTick(12);
    w.players[0].minerals = 500;
    expect(new AI(w, 0).think()).toContainEqual(expect.objectContaining({ kind: 'train', ids: [plat.id] }));
  });
  it('a headquarters site with no worker left to raise it holds back no unit', () => {
    const w = createMatch(['humains', 'isdaris']);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const site = w.spawn('conseil', 0, hq.x + 14 * FP, hq.y);
    site.buildLeft = 100;
    const cas = w.spawn('caserne', 0, hq.x, hq.y + 8 * FP);
    w.spawn('grenier', 0, hq.x - 8 * FP, hq.y + 8 * FP);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'serf') w.remove(e);
    w.remove(hq);
    w.tick = thinkTick(12);
    w.players[0].minerals = 1000;
    expect(new AI(w, 0).think()).toContainEqual(expect.objectContaining({ kind: 'train', ids: [cas.id] }));
  });
});

describe('AI Isdaris blind spots', () => {
  const thinkTick = (min: number) => ticks(min * 60) - (ticks(min * 60) % 10);
  const turn = (ai: AI, w: World) => {
    const a = ai as unknown as { survey(m: Entity[], h: Entity): object; need(s: object): object; budget(n: object): { gatewaysKeep: number } };
    const mine = [...w.entities.values()].filter((e) => e.owner === 0);
    const s = a.survey(mine, mine.find((e) => e.type === 'obelisque')!);
    const n = { ...s, ...a.need(s) } as { saving: boolean; wants: string[] };
    return { n, b: a.budget(n) };
  };

  it('three Portails always busy: the least busy one takes the research behind its units', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    const portails = [-8, 0, 8].map((dx) => w.spawn('portail', 0, ob.x + dx * FP, ob.y + 8 * FP));
    portails.forEach((p, i) => p.queue.push(...(i === 1 ? ['creature'] : ['creature', 'creature'])));
    w.tick = thinkTick(10);
    w.players[0].minerals = 600;
    w.players[0].energy = 600;
    const cmds = new AI(w, 0).think();
    // Which extension first is the AI's choice (archers need the Miniportail since the équilibreur's 24/11 mail).
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [portails[1].id], type: expect.stringMatching(/^(miniportail|laboratoire)$/) }));
  });

  it('from minute 6 the Portails keep the price of the Laboratoire', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    w.spawn('portail', 0, ob.x + 8 * FP, ob.y + 8 * FP);
    w.tick = thinkTick(5);
    expect(turn(new AI(w, 0), w).b.gatewaysKeep).toBe(0);
    w.tick = thinkTick(7);
    const ai = new AI(w, 0);
    (ai as unknown as { lastIncome: number }).lastIncome = w.tick; // minerals coming in
    expect(turn(ai, w).b.gatewaysKeep).toBeGreaterThanOrEqual(200);
  });

  it('an expansion is saved for up to what a robot pays for it (1330, not 1000)', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    for (let i = 0; i < 12; i++) w.spawn('moissonneur', 0, ob.x + (i - 6) * FP, ob.y + 4 * FP);
    for (let i = 0; i < 8; i++) w.spawn('creature', 0, ob.x + (i - 4) * FP, ob.y - 6 * FP);
    w.tick = thinkTick(11);
    w.players[0].minerals = 1100;
    const ai = new AI(w, 0);
    (ai as unknown as { lastIncome: number }).lastIncome = w.tick;
    const { n } = turn(ai, w);
    expect(n.wants).toContain('obelisque');
    expect(n.saving).toBe(true);
  });
  it('the Couloir temporel sends the reinforcements gathered by the Espion at home through to the one with the wave', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    w.players[0].upgrades.couloir = 1;
    // No robot near the rally point (the corridor would take it too).
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'moissonneur') w.remove(e);
    w.tick = thinkTick(20);
    const ai = new AI(w, 0);
    const rally = (ai as unknown as { rallyPoint(h: Entity): { x: number; y: number } }).rallyPoint(ob);
    const gate = w.spawn('espion', 0, rally.x, rally.y);
    gate.mana = 1e9;
    for (let i = 0; i < 5; i++) w.spawn('creature', 0, rally.x + ((i % 3) - 1) * FP, rally.y + Math.floor(i / 3) * FP);
    const foe = [...w.entities.values()].find((e) => e.owner === 1 && e.type === 'conseil')!;
    const scout = w.spawn('espion', 0, foe.x - 10 * FP, foe.y - 10 * FP);
    const state = ai as unknown as { wave: Set<number>; waves: number };
    state.wave.add(scout.id);
    // The wave's armed front round it.
    for (let i = 0; i < 3; i++) state.wave.add(w.spawn('creature', 0, foe.x - (11 + i) * FP, foe.y - 11 * FP).id);
    state.waves = 1;
    const cmds = ai.think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'ability', ids: [gate.id], name: 'couloir' }));
  });

  it('the Rappel comes from the Obélisque, whatever other building has a power of its own', () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    w.remove(ob);
    w.spawn('orbe', 0, ob.x + 8 * FP, ob.y);
    const ob2 = w.spawn('obelisque', 0, ob.x, ob.y);
    w.players[0].energy = 1000;
    w.tick = thinkTick(15);
    const ai = new AI(w, 0);
    const foe = [...w.entities.values()].find((e) => e.owner === 1 && e.type === 'conseil')!;
    const state = ai as unknown as { wave: Set<number> };
    for (let i = 0; i < 4; i++) state.wave.add(w.spawn('creature', 0, foe.x - (8 + i) * FP, foe.y - 8 * FP).id);
    for (let i = 0; i < 12; i++) w.spawn('legionnaire', 1, foe.x - 9 * FP, foe.y - (6 + i / 4) * FP);
    for (let t = 0; t < 10; t++) w.step([]);
    w.tick = thinkTick(15);
    const cmds = ai.think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'ability', ids: [ob2.id] }));
  });

  it('a Dieux god drops its summons and joins its army fighting by it, then summons again once calm', () => {
    const w = createMatch(['dieux', 'humains']);
    const [cx, cy] = [(w.map.width / 2) * FP, (w.map.height / 2) * FP];
    const thor = w.spawn('thor', 0, cx, cy);
    w.players[0].minerals = 3000;
    for (let i = 0; i < 4; i++) w.spawn('branche', 0, cx - 12 * FP, cy + (i * 3 - 6) * FP);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }]);
    expect(thor.queue.length).toBe(1);
    const nains = Array.from({ length: 4 }, (_, i) => w.spawn('nain', 0, cx + 3 * FP, cy + (i - 2) * FP));
    const foes = Array.from({ length: 3 }, (_, i) => w.spawn('legionnaire', 1, cx + 6 * FP, cy + (i - 1) * FP));
    w.step([{ player: 0, kind: 'attack', ids: nains.map((n) => n.id), x: foes[0].x, y: foes[0].y }]);
    w.tick = thinkTick(10);
    const ai = new AI(w, 0);
    const cmds = ai.think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'cancel', ids: [thor.id] }));
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'attack', ids: [thor.id] }));
    expect(cmds.some((c) => c.kind === 'train' && c.ids.includes(thor.id))).toBe(false);
    // The fight over: summoning again once calm.
    for (const f of foes) w.remove(f);
    let trained = false;
    for (let t = 0; t < ticks(20) && !trained; t++) {
      const out = ai.think();
      trained = out.some((c) => c.kind === 'train' && c.ids.includes(thor.id));
      w.step(out);
    }
    expect(trained).toBe(true);
  });
});


describe('AI Isdaris, the équilibreur rules', () => {
  const thinkTick = (min: number) => ticks(min * 60) - (ticks(min * 60) % 10);
  const base = () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    return { w, ob };
  };

  it('puts a Miniportail on its Portail, and no Archer before it: the Archer needs one', () => {
    const { w, ob } = base();
    const portail = w.spawn('portail', 0, ob.x + 8 * FP, ob.y + 8 * FP);
    w.tick = thinkTick(8);
    const ai = new AI(w, 0);
    const orders: string[] = [];
    for (let i = 0; i < ticks(60) && !portail.exts.includes('miniportail'); i++) {
      w.players[0].minerals = Math.max(w.players[0].minerals, 1000);
      w.players[0].energy = Math.max(w.players[0].energy, 1000);
      const cmds = ai.think();
      for (const c of cmds) if (c.kind === 'train' && c.ids.includes(portail.id)) orders.push(c.type);
      w.step(cmds);
    }
    expect(portail.exts).toContain('miniportail');
    expect(orders.indexOf('archer')).toBe(-1);
  });

  it('an Obélisque puts its Bouclier de plasma on a Portail of the zone under fire', () => {
    const { w, ob } = base();
    const portail = w.spawn('portail', 0, ob.x + 8 * FP, ob.y);
    [portail.hp, portail.shield] = [100, 0];
    w.tick = thinkTick(8);
    portail.lastHit = w.tick;
    expect(new AI(w, 0).think()).toContainEqual(expect.objectContaining({ kind: 'ability', ids: [ob.id], name: 'bouclierplasma', x: portail.x, y: portail.y }));
  });

  it('trains a Drone protecteur for every eight soldiers', () => {
    const { w, ob } = base();
    const pa = w.spawn('nanoassembleur', 0, ob.x + 8 * FP, ob.y);
    for (let i = 0; i < 16; i++) w.spawn('creature', 0, ob.x - 6 * FP, ob.y + (i - 8) * FP / 2);
    w.spawn('droneprotecteur', 0, ob.x - 4 * FP, ob.y);
    for (let i = 0; i < 4; i++) w.spawn('reservepsy', 0, ob.x + (i - 2) * 4 * FP, ob.y - 9 * FP);
    w.tick = thinkTick(14);
    w.players[0].minerals = 3000;
    w.players[0].energy = 3000;
    const cmds = new AI(w, 0).think();
    expect(cmds).toContainEqual(expect.objectContaining({ kind: 'train', ids: [pa.id], type: 'droneprotecteur' }));
  });

  it('an Orbe plasma afloat never goes with a wave', () => {
    const { w, ob } = base();
    const orbe = w.spawn('orbemob', 0, ob.x - 6 * FP, ob.y);
    for (let i = 0; i < 12; i++) w.spawn('creature', 0, ob.x - 6 * FP, ob.y + (i - 6) * FP / 2);
    w.tick = thinkTick(12);
    const ai = new AI(w, 0);
    const cmds = ai.think();
    expect((ai as unknown as { wave: Set<number> }).wave.size).toBeGreaterThan(0);
    expect((ai as unknown as { wave: Set<number> }).wave.has(orbe.id)).toBe(false);
    expect(cmds.some((c) => 'ids' in c && c.ids.includes(orbe.id))).toBe(false);
  });

  it('under a raid stronger than its army, keeps a robot\'s price, at any minute (QA 0.9.177, M2)', () => {
    const { w, ob } = base();
    w.spawn('portail', 0, ob.x + 8 * FP, ob.y + 8 * FP);
    for (let i = 0; i < 8; i++) w.spawn('legionnaire', 1, ob.x + (4 + (i % 4)) * FP, ob.y + (4 + Math.floor(i / 4)) * FP);
    // 19 robots, the opening's full line: not the « fewer than half » case.
    for (let i = 0; i < 13; i++) w.spawn('moissonneur', 0, ob.x - (3 + (i % 4)) * FP, ob.y - (3 + Math.floor(i / 4)) * FP);
    w.spawn('reservepsy', 0, ob.x - 8 * FP, ob.y + 8 * FP);
    w.tick = thinkTick(3);
    w.players[0].minerals = 150;
    w.players[0].energy = 500;
    const ai = new AI(w, 0);
    const robot = (DEFS.moissonneur as { cost: { minerals: number } }).cost.minerals;
    for (let i = 0; i < 40; i++) {
      w.players[0].minerals = 150;
      for (const c of ai.think()) {
        if ((c.kind !== 'train' && c.kind !== 'build') || c.type === 'moissonneur' || c.player !== 0) continue;
        const cost = (DEFS[c.type] as { cost: { minerals: number } }).cost.minerals;
        // The first think sees the raid; from the next, nothing but a robot takes the last robot's price.
        if (i > 0) expect(150 - cost).toBeGreaterThanOrEqual(robot);
      }
      w.step([]);
    }
  });
});
