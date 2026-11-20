import { describe, expect, it } from 'vitest';
import { buildMap, MAPS } from './maps';
import { FP } from './sim/fixed';
import { createMatch } from './sim/setup';
import type { World } from './sim/world';

const DEF = MAPS.asteroides;
const hqOf = (w: World, p: number) => [...w.entities.values()].find((e) => e.owner === p && e.def.kind === 'building')!;

/** Sends `count` units of one type from beside player p's HQ to the enemy's: how many got there (within 8 tiles), and unit-ticks spent over the void. */
function cross(type: string, count: number, p: number): { arrived: number; overVoid: number } {
  const w = createMatch(['z', 'z'], undefined, 'asteroides', 'asteroides');
  const [mine, foe] = [hqOf(w, p), hqOf(w, 1 - p)];
  for (const e of [...w.entities.values()]) if (e.def.kind === 'unit') w.entities.delete(e.id);
  const dir = p === 0 ? 1 : -1;
  const ids = Array.from({ length: count }, (_, i) => w.spawn(type, p, mine.x + dir * (5 + (i % 4)) * FP, mine.y + dir * (5 + Math.floor(i / 4)) * FP).id);
  w.step([{ player: p, kind: 'move', ids, x: foe.x, y: foe.y } as never]);
  let overVoid = 0;
  for (let t = 0; t < 6000; t++) {
    w.step([]);
    for (const id of ids) {
      const e = w.entities.get(id)!;
      if (w.map.chasm![Math.floor(e.y / FP) * w.map.width + Math.floor(e.x / FP)]) overVoid++;
    }
    if (ids.every((id) => !w.entities.get(id)!.order)) break;
  }
  const near = (id: number) => {
    const e = w.entities.get(id)!;
    return Math.hypot(e.x - foe.x, e.y - foe.y) / FP < 8;
  };
  return { arrived: ids.filter(near).length, overVoid };
}

describe('Astéroïdes', () => {
  it('is the same for both players (half turn) and takes only its own planet', () => {
    const m = buildMap(DEF, 2, 'asteroides');
    const n = m.width;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) expect(m.chasm![y * n + x]).toBe(m.chasm![(n - 1 - y) * n + n - 1 - x]);
    expect(DEF.biomes).toEqual(['asteroides']);
    expect(DEF.biomesOnly).toBe(true);
  });

  it('has natural arches (drawn as such, walked like any ground)', () => {
    const m = buildMap(DEF, 2, 'asteroides');
    expect(m.arch!.some((a) => a)).toBe(true);
  });

  // The biggest ground units: a Z socle (Octopode, radius 0.9) in a crowd, a god (Gaïa, radius 2) alone.
  for (const [type, count] of [['octopode', 12], ['gaia', 1], ['minotaure', 6]] as const) {
    it(`lets ${count} ${type} cross the arches to the enemy base, from both sides, never standing over the void`, () => {
      for (const p of [0, 1]) {
        const { arrived, overVoid } = cross(type, count, p);
        expect(arrived).toBe(count);
        expect(overVoid).toBe(0);
      }
    }, 120_000);
  }
});
