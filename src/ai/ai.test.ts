import { describe, expect, it } from 'vitest';
import { FP, ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Entity, World } from '../sim/world';
import { AI, DIFFICULTY } from './ai';

/** Plays until someone wins or the time runs out; returns the winner and the game time in minutes. */
function play(world: World, ais: AI[], minutes: number): { winner: number | null; minutes: number } {
  const limit = ticks(minutes * 60);
  while (world.winner === null && world.tick < limit) world.step(ais.flatMap((ai) => ai.think()));
  return { winner: world.winner, minutes: Math.round((world.tick / ticks(60)) * 10) / 10 };
}

describe('AI', () => {
  it('beats an idle opponent', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 1)], 20);
    expect(r.winner).toBe(1);
  });

  it('wins more often with a better difficulty, from either side', () => {
    for (const [weak, strong] of [['easy', 'normal'], ['normal', 'hard']]) {
      for (const side of [0, 1]) {
        const w = createMatch();
        w.players[side].handicap = DIFFICULTY[strong];
        w.players[1 - side].handicap = DIFFICULTY[weak];
        expect(play(w, [new AI(w, 0), new AI(w, 1)], 35).winner).toBe(side);
      }
    }
  }, 60_000);

  it('scans only where an undetected invisible unit hits, not at shooters out of sight', () => {
    const w = createMatch(['humains', 'isdaris']);
    const ai = new AI(w, 0);
    w.spawn('forge', 0, 20 * FP, 22 * FP);
    w.players[0].energy = 200;
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
  });

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
  });

  it('finishes an AI-versus-AI game', () => {
    const w = createMatch();
    const r = play(w, [new AI(w, 0), new AI(w, 1)], 30);
    console.log('AI vs AI:', r, 'units', [...w.entities.values()].filter((e) => e.def.kind === 'unit').length);
    expect(r.winner).not.toBeNull();
  });
});
