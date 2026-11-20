import { describe, expect, it } from 'vitest';
import { buildMap, MAPS } from './maps';

/** Every tile of a built map, folded into one number. */
function gridHash(m: ReturnType<typeof buildMap>): number {
  let h = 2166136261;
  const mix = (v: number) => (h = Math.imul(h ^ v, 16777619));
  for (let i = 0; i < m.width * m.height; i++) {
    mix(m.level[i]);
    mix(m.rampStep[i]);
    mix(m.ramp[i] ? m.ramp[i]!.charCodeAt(0) : 0);
    mix(m.chasm?.[i] ?? 0);
  }
  return h >>> 0;
}

/** The planets a map's terrain differs on (it only picks the shapes marked for one), and any other. */
const planets = (def: (typeof MAPS)[string]) => ['', ...new Set(def.terrain.flatMap((s) => (s.biome ? [s.biome] : [])))];

/**
 * Every map's grid, tile by tile, for every player count and every planet its terrain differs on, as built before the
 * map code stopped using Math.atan2, Math.sin and Math.hypot (which browsers need not round alike): it must not change,
 * or two players on different browsers would play on different ground.
 */
const FROZEN: Record<string, number> = {
  'origine//1': 1570736033,
  'origine//2': 1570736033,
  'origine//3': 2172467697,
  'origine//4': 2172467697,
  'origine/ville/1': 998453417,
  'origine/ville/2': 998453417,
  'origine/ville/3': 3790881653,
  'origine/ville/4': 3790881653,
  'carrefour//1': 3491453928,
  'carrefour//2': 3491453928,
  'carrefour//3': 3491453928,
  'carrefour//4': 3491453928,
  'l-anneau//1': 832705917,
  'l-anneau//2': 832705917,
  'le-col//1': 1720841269,
  'le-col//2': 1720841269,
  'les-ponts//1': 647576153,
  'les-ponts//2': 647576153,
};

describe('map grids', () => {
  it('are the same tile for tile as frozen, on every map, planet and player count', () => {
    const now: Record<string, number> = {};
    for (const def of Object.values(MAPS)) for (const b of planets(def)) for (let p = 1; p <= Math.max(...def.players); p++) now[`${def.id}/${b}/${p}`] = gridHash(buildMap(def, p, b));
    expect(now).toEqual(FROZEN);
  });
});
