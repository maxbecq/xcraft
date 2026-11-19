import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS } from '../data';
import { FP } from './fixed';
import { createMatch } from './setup';

describe('placement grid', () => {
  it('every tile of a footprint canPlace accepts is lit green, tile by tile', () => {
    for (const [faction, type] of [['humains', 'grenier'], ['z', 'pod'], ['isdaris', 'portail']] as const) {
      const w = createMatch([faction, 'humains']);
      const size = (DEFS[type] as BuildingDef).size;
      let placed = 0;
      for (let ty = 0; ty < w.map.height; ty += 3) {
        for (let tx = 0; tx < w.map.width; tx += 3) {
          if (!w.canPlace(type, tx, ty, 0)) continue;
          placed++;
          for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) expect(w.tileFits(type, x, y, 0), `${type} ${x},${y}`).toBe(true);
        }
      }
      expect(placed, type).toBeGreaterThan(0);
    }
  });

  it('a Pod hemmed in on every side has no room for its add-on', () => {
    const w = createMatch(['z', 'humains']);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'intelligence')!;
    let spot: [number, number] | undefined;
    for (let r = 3; !spot && r < 12; r++) for (let d = -r; d <= r && !spot; d++) {
      const tx = hq.tx + d;
      const ty = hq.ty + r + 4;
      if (w.canPlace('pod', tx, ty, 0) && w.addonSpotAt('plateforme', tx, ty, 2, 0)) spot = [tx, ty];
    }
    expect(spot).toBeTruthy();
    const [tx, ty] = spot!;
    // A wall of minerals round it, one tile out: no side keeps a 3-tile gap.
    for (let y = ty - 1; y <= ty + 2; y++) for (let x = tx - 1; x <= tx + 2; x++) {
      if (x >= tx && x < tx + 2 && y >= ty && y < ty + 2) continue;
      w.spawn('minerai', -1, x * FP + FP / 2, y * FP + FP / 2);
    }
    expect(w.addonSpotAt('plateforme', tx, ty, 2, 0)).toBeUndefined();
  });
});
