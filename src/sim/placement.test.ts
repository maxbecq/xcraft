import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS, FACTIONS } from '../data';
import { createMatch, expansions } from './setup';
import type { World } from './world';

/** Every tile of a size×size footprint open and flat at one level (the rule before the cliff margin). */
function flatFree(w: World, tx: number, ty: number, size: number): number {
  let level = -2;
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) {
      if (!w.grid.open(x, y)) return -1;
      const l = w.grid.flatLevel(x, y);
      if (l < 0 || (level !== -2 && l !== level)) return -1;
      level = l;
    }
  }
  return level;
}

/** Highest and lowest corner of the ring of tiles round the footprint. */
function ring(w: World, tx: number, ty: number, size: number): [number, number] {
  let hi = -99;
  let lo = 99;
  for (let y = ty - 1; y <= ty + size; y++) {
    for (let x = tx - 1; x <= tx + size; x++) {
      if ((x >= tx && x < tx + size && y >= ty && y < ty + size) || !w.grid.inside(x, y)) continue;
      hi = Math.max(hi, w.grid.topLevel(x, y));
      lo = Math.min(lo, w.grid.level(x, y));
    }
  }
  return [hi, lo];
}

describe('building placement by cliffs', () => {
  it('wants a tile of its own level between a building and a cliff rising beside it, not by one falling away', () => {
    const w = createMatch(['humains', 'humains']);
    const size = (DEFS.caserne as BuildingDef).size;
    let under = 0;
    let edge = 0;
    for (let ty = 1; ty < w.map.height - size - 1; ty++) {
      for (let tx = 1; tx < w.map.width - size - 1; tx++) {
        const level = flatFree(w, tx, ty, size);
        if (level < 0) continue;
        const [hi, lo] = ring(w, tx, ty, size);
        if (hi > level) {
          expect(w.canPlace('caserne', tx, ty)).toBe(false);
          under++;
        } else if (lo < level) {
          expect(w.canPlace('caserne', tx, ty)).toBe(true);
          edge++;
        }
      }
    }
    expect(under).toBeGreaterThan(0);
    expect(edge).toBeGreaterThan(0);
  });

  it('leaves every start and expansion headquarters spot of every map valid, for every faction', () => {
    for (const id of ['origine', 'carrefour', 'le-col', 'les-ponts', 'l-anneau']) {
      const w = createMatch(['humains', 'humains'], undefined, id);
      for (const s of w.map.sites ?? []) {
        for (const f of Object.values(FACTIONS)) {
          const size = (DEFS[f.hq] as BuildingDef).size;
          const level = w.grid.flatLevel(s.hq[0], s.hq[1]);
          expect(ring(w, s.hq[0], s.hq[1], size)[0] > level, `${id} ${s.hq}`).toBe(false);
        }
      }
      expect(expansions(w, 0).length).toBeGreaterThan(0);
    }
  });
});
