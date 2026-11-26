import { describe, expect, it } from 'vitest';
import { DEFS } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

describe('neutral units and buildings (a map\'s, a trigger\'s)', () => {
  it('every unit and building type, neutral, lives through a minute without breaking the match', () => {
    const w = createMatch(['humains', 'z'], undefined, 'carrefour');
    const types = Object.entries(DEFS).filter(([, d]) => (d.kind === 'unit' || d.kind === 'building') && 'faction' in d).map(([id]) => id);
    // Each on the first free ground in reading order (a building: its whole footprint), one tile apart.
    const free = (tx: number, ty: number, n: number) => {
      for (let y = ty - 1; y <= ty + n; y++) for (let x = tx - 1; x <= tx + n; x++) if (!w.grid.open(x, y)) return false;
      return true;
    };
    for (const type of types) {
      const d = DEFS[type];
      const n = d.kind === 'building' ? d.size : 1;
      search: for (let ty = 2; ty < w.map.height - n - 2; ty++) {
        for (let tx = 2; tx < w.map.width - n - 2; tx++) {
          if (!free(tx, ty, n) || [...w.entities.values()].some((e) => e.def.kind === 'unit' && Math.abs(e.x / FP - tx) < 2 && Math.abs(e.y / FP - ty) < 2)) continue;
          if (d.kind === 'unit') w.spawn(type, -1, tx * FP + FP / 2, ty * FP + FP / 2);
          else w.spawn(type, -1, tx * FP, ty * FP);
          break search;
        }
      }
    }
    expect([...w.entities.values()].filter((e) => e.owner === -1 && e.def.kind !== 'resource').length).toBe(types.length);
    while (w.tick < ticks(60)) w.step([]);
  }, 120_000);

  it('a neutral Récepteur makes no energy for anyone', () => {
    const w = createMatch(['isdaris', 'humains'], undefined, 'carrefour');
    w.spawn('recepteur', -1, 40 * FP, 40 * FP);
    const before = w.players.map((p) => p.energy);
    expect(() => {
      while (w.tick < ticks(20)) w.step([]);
    }).not.toThrow();
    expect(w.players[1].energy).toBe(before[1]);
  });
});

describe('what a map forbids, an ability does not make either', () => {
  const of = (w: ReturnType<typeof createMatch>, owner: number, type: string) => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
  it('no Golem by Fusion, no form by Mutation, when forbidden', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].forbid = ['golem', 'elemterre'];
    const fire = w.spawn('elementaire', 0, 50 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [fire.id], name: 'formeterre' }]);
    expect(fire.type).toBe('elementaire');
    w.spawn('elemeau', 0, 51 * FP, 30 * FP);
    fire.abilityCd = 0;
    w.step([{ player: 0, kind: 'ability', ids: [fire.id], name: 'fusion' }]);
    expect(of(w, 0, 'golem')).toHaveLength(0);
    expect(of(w, 0, 'elementaire')).toHaveLength(1);
    expect(of(w, 0, 'elemeau')).toHaveLength(1);
    expect(w.events.some((e) => e.player === 0 && e.text === 'Interdit sur cette carte.')).toBe(true);
    // Allowed again: the Fusion goes through.
    w.players[0].forbid = undefined;
    fire.abilityCd = 0;
    w.step([{ player: 0, kind: 'ability', ids: [fire.id], name: 'fusion' }]);
    expect(of(w, 0, 'golem')).toHaveLength(1);
  });
});
