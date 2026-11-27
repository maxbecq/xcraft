import { describe, expect, it } from 'vitest';
import { DEFS, type BuildingDef, type UnitDef } from '../data';
import { CORNERS } from '../maps';
import { rotateTile } from '../map';
import { FP } from './fixed';
import { expansion } from './setup';
import { createMatch } from './setup';

/**
 * Point 111 (2026-11-25): on Carrefour, a unit at the Isdaris natural saw the spot in one game and not in the mirror
 * game. The same units, set at the same place from each corner, must see the same tiles once turned back, and the
 * natural's middle tiles (what materialising asks to see) alike.
 */
describe('sight turned with the map', () => {
  it('reveals the same tiles from the four corners of Carrefour, on and off tile edges', () => {
    const N = createMatch(['isdaris', 'isdaris', 'isdaris', 'isdaris'], undefined, 'carrefour').map.width;
    const S = N * FP;
    const turn = (x: number, y: number, q: number): [number, number] => {
      for (let k = 0; k < q; k++) [x, y] = [S - y, x];
      return [x, y];
    };
    const size = (DEFS.obelisque as BuildingDef).size;
    const offsets: [number, number][] = [];
    for (const dx of [-6, -3.5, 0, 0.5, 2, 4.25]) for (const dy of [-5, -2.5, 0, 1.5, 3]) offsets.push([dx, dy]);
    const seen = [0, 1, 2, 3].map((owner) => {
      const w = createMatch(['isdaris', 'isdaris', 'isdaris', 'isdaris'], undefined, 'carrefour');
      const q = CORNERS[owner];
      for (const e of [...w.entities.values()]) if (e.owner >= 0) w.entities.delete(e.id);
      // The natural's spot from the first corner, turned to this owner's.
      const [nx, ny] = expansion(w, 0);
      const [cx, cy] = [nx * FP + (size * FP) / 2, ny * FP + (size * FP) / 2];
      const tiles: number[][] = [];
      for (const kind of ['creature', 'dragon'])
        for (const [dx, dy] of offsets) {
          for (const e of [...w.entities.values()]) if (e.owner >= 0) w.entities.delete(e.id);
          const at = turn(cx + Math.round(dx * FP), cy + Math.round(dy * FP), q);
          w.spawn(kind, owner, ...at);
          w.step([]);
          const v = w.vision[owner];
          const back: number[] = [];
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const [tx, ty] = rotateTile(N, x, y, q);
            if (v.visible(tx, ty)) back.push(y * N + x);
          }
          tiles.push(back);
        }
      return tiles;
    });
    for (const s of seen.slice(1)) expect(s).toEqual(seen[0]);
    // Not empty everywhere (Codex, 2026-11-27): a Créature on the natural's middle sees its middle tiles, and from
    // somewhere about it a Dragon sees a higher tile the cliffs hide from the Créature.
    const w = createMatch(['isdaris', 'isdaris', 'isdaris', 'isdaris'], undefined, 'carrefour');
    const [nx, ny] = expansion(w, 0);
    const [lo, hi] = [(size - 1) >> 1, size >> 1];
    const middle = seen[0][offsets.findIndex(([dx, dy]) => dx === 0 && dy === 0)];
    for (const t of [lo, hi].flatMap((dx) => [lo, hi].map((dy) => (ny + dy) * N + nx + dx))) expect(middle).toContain(t);
    const r = Math.min((DEFS.creature as UnitDef).sight, (DEFS.dragon as UnitDef).sight) - 1;
    const above = offsets.some(([dx, dy], k) => {
      const ground = new Set(seen[0][k]);
      const [ux, uy] = [Math.floor(nx + size / 2 + dx), Math.floor(ny + size / 2 + dy)];
      // Within both sights, higher than where the Créature stands: hidden by the relief, not by reach.
      return seen[0][offsets.length + k].some((t) => {
        const [tx, ty] = [t % N, Math.floor(t / N)];
        return !ground.has(t) && Math.hypot(tx - ux, ty - uy) <= r && w.grid.level(tx, ty) > w.grid.level(ux, uy);
      });
    });
    expect(above).toBe(true);
  });
});
