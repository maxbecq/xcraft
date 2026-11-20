import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS, type Faction, FACTIONS } from '../data';
import { MAPS } from '../maps';
import { createMatch } from '../sim/setup';
import { AI } from './ai';

/**
 * Where the AI puts a building round its base: the base in the opposite corner, of the same faction, gets the mirror
 * of the spot, and every spot lies on the base's own plateau. Before, an even-sized building stood one tile off
 * between the corners, and once the plateau was full a spot on the low ground outside the base passed.
 */
describe('AI building spots', () => {
  for (const faction of ['humains', 'isdaris', 'z', 'dieux'] as Faction[]) {
    it(`mirror between the corners, on the base's plateau, for ${faction}`, () => {
      for (const map of Object.keys(MAPS)) {
        const w = createMatch([faction, faction], undefined, map);
        const W = w.map.width;
        const hq = [0, 1].map((p) => [...w.entities.values()].find((e) => e.owner === p && e.type === FACTIONS[faction].hq)!);
        const level = w.grid.level(Math.floor(hq[0].x / 1024), Math.floor(hq[0].y / 1024));
        for (const type of FACTIONS[faction].buildable) {
          const def = DEFS[type] as BuildingDef;
          if (type === FACTIONS[faction].hq || def.energyRate || def.morphOnly || def.addon) continue;
          const [a, b] = [0, 1].map((p) => (new AI(w, p) as unknown as { spot: (t: string, h: unknown) => [number, number] | null }).spot(type, hq[p]));
          expect([map, type, b], 'mirrored').toEqual([map, type, a && [W - a[0] - def.size, W - a[1] - def.size]]);
          // An outpost goes to an expansion site, off the base by design.
          if (a && type !== FACTIONS[faction].outpost) for (let y = a[1]; y < a[1] + def.size; y++) for (let x = a[0]; x < a[0] + def.size; x++) expect([map, type, x, y, w.grid.level(x, y)]).toEqual([map, type, x, y, level]);
        }
      }
    });
  }
});
