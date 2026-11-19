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
  'origine//1': 4058778289,
  'origine//2': 4058778289,
  'origine//3': 3228138817,
  'origine//4': 3228138817,
  'origine/ville/1': 122875321,
  'origine/ville/2': 122875321,
  'origine/ville/3': 407585797,
  'origine/ville/4': 407585797,
  'carrefour//1': 1506034576,
  'carrefour//2': 1506034576,
  'carrefour//3': 1506034576,
  'carrefour//4': 1506034576,
  'l-anneau//1': 4286366901,
  'l-anneau//2': 4286366901,
  'le-col//1': 370180637,
  'le-col//2': 370180637,
  'les-ponts//1': 3441780809,
  'les-ponts//2': 3441780809,
};

describe('map grids', () => {
  it('are the same tile for tile as frozen, on every map, planet and player count', () => {
    const now: Record<string, number> = {};
    for (const def of Object.values(MAPS)) for (const b of planets(def)) for (let p = 1; p <= Math.max(...def.players); p++) now[`${def.id}/${b}/${p}`] = gridHash(buildMap(def, p, b));
    expect(now).toEqual(FROZEN);
  });
});
