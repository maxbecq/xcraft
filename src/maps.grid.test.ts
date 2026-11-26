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
  'origine//1': 2766206145,
  'origine//2': 2766206145,
  'origine//3': 4273821937,
  'origine//4': 4273821937,
  'origine/ville/1': 2922050965,
  'origine/ville/2': 2922050965,
  'origine/ville/3': 2509762913,
  'origine/ville/4': 2509762913,
  'carrefour//1': 629283272,
  'carrefour//2': 629283272,
  'carrefour//3': 629283272,
  'carrefour//4': 629283272,
  'l-anneau//1': 2468012645,
  'l-anneau//2': 2468012645,
  'le-col//1': 3389095941,
  'le-col//2': 3389095941,
  'les-ponts//1': 2327463425,
  'les-ponts//2': 2327463425,
  'asteroides//1': 2431351461,
  'asteroides//2': 2431351461,
  'ville-nuit//1': 628767441,
  'ville-nuit//2': 628767441,
};

describe('map grids', () => {
  it('are the same tile for tile as frozen, on every map, planet and player count', () => {
    const now: Record<string, number> = {};
    for (const def of Object.values(MAPS)) for (const b of planets(def)) for (let p = 1; p <= Math.max(...def.players); p++) now[`${def.id}/${b}/${p}`] = gridHash(buildMap(def, p, b));
    expect(now).toEqual(FROZEN);
  });
});
