import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { FACTIONS } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

describe('three and four players', () => {
  it('puts every player in its own corner, with the same layout turned', () => {
    const w = createMatch(['humains', 'isdaris', 'humains', 'isdaris']);
    const hqs = w.players.map((p) => [...w.entities.values()].find((e) => e.owner === p.id && e.type === FACTIONS[p.faction].hq)!);
    const centre = 48 * FP;
    const d = hqs.map((h) => Math.round(Math.hypot(h.x - centre, h.y - centre) / FP));
    expect(new Set(d).size).toBe(1);
    expect(new Set(hqs.map((h) => `${h.x > centre},${h.y > centre}`)).size).toBe(4);
    expect([...w.entities.values()].filter((e) => e.type === 'minerai')).toHaveLength(60);
  });

  it('allies share their sight and never fight; the last team standing wins', () => {
    const w = createMatch(['humains', 'humains', 'humains', 'humains'], [0, 1, 0, 1]);
    const a = w.spawn('auxiliaire', 0, 48 * FP, 48 * FP);
    const ally = w.spawn('auxiliaire', 2, 49 * FP, 48 * FP);
    for (let i = 0; i < ticks(3); i++) w.step([]);
    expect(a.order).toBeNull();
    expect(ally.hp).toBe(ally.maxHp);
    expect(w.sees(0, ally)).toBe(true);
    const foe = w.spawn('auxiliaire', 1, 51 * FP, 48 * FP);
    for (let i = 0; i < ticks(1); i++) w.step([]);
    expect(w.sees(2, foe)).toBe(true); // seen by player 0's soldier, shared with player 2
  });

  it('plays four AIs to the end, free-for-all and two against two', () => {
    for (const teams of [undefined, [0, 1, 0, 1]]) {
      const w = createMatch(['humains', 'isdaris', 'isdaris', 'humains'], teams);
      const ais = w.players.map((p) => new AI(w, p.id));
      while (w.winner === null && w.tick < ticks(50 * 60)) w.step(ais.flatMap((ai) => ai.think()));
      expect(w.winner).not.toBeNull();
      if (teams) for (const p of w.players) if (p.team !== w.players[w.winner!].team) expect([...w.entities.values()].some((e) => e.owner === p.id && e.def.kind === 'building')).toBe(false);
    }
  }, 300_000);
});
