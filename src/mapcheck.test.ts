import { describe, expect, it } from 'vitest';
import './terrain'; // terrain first: it and render/biome import each other (as in main.ts)
import { BIOMES } from './render/biome';
import { checkMap, MAP_MAX_CHARS, mapPrint, parseMap, PLANETS } from './mapcheck';
import { addMap, buildMap, MAPS, removeMap } from './maps';

const small = () => ({
  format: 1,
  id: 'ma-carte',
  name: 'Ma carte',
  size: 64,
  players: [2],
  symmetry: 'rot180',
  biome: 'lune',
  terrain: [{ shape: 'octagon', at: [12, 12], half: 9, cut: 4, level: 1 }, { shape: 'ramp', at: [20, 10], up: 'W', width: 3, level: 0 }],
  bases: [{ name: 'départ', start: true, hq: [8, 8], minerals: [[5, 5], [6, 5]], wells: [[14, 4]] }],
});
const refused = (v: unknown) => {
  const r = checkMap(v);
  expect(typeof r).toBe('string');
  return r as string;
};

describe('a map from outside the game', () => {
  it('knows every planet of the game', () => {
    expect([...PLANETS].sort()).toEqual(Object.keys(BIOMES).sort());
  });

  it('takes every map of the game as it is (the format covers them all)', () => {
    for (const m of Object.values(MAPS)) expect(checkMap(JSON.parse(JSON.stringify(m)), false)).toEqual(m);
  });

  it('takes a small map, under an imported id, and builds it', () => {
    const m = checkMap(small());
    if (typeof m === 'string') throw new Error(m);
    expect(m.id).toBe('import-ma-carte');
    expect(buildMap(m, 2, m.biome).width).toBe(64);
    expect(checkMap({ ...small(), id: 'import-ma-carte' })).toEqual(m); // already imported: not prefixed twice
  });

  it('copies only what the format knows', () => {
    const m = checkMap({ ...small(), bases: [{ ...small().bases[0], start: false }, { ...small().bases[0], hq: [40, 40] }].map((b, i) => ({ ...b, start: i === 0 })) });
    expect(typeof m).not.toBe('string');
    expect(JSON.stringify(m)).not.toContain('false');
  });

  it('refuses what is not a map, with a reason', () => {
    expect(parseMap('{')).toMatch(/JSON/);
    expect(parseMap('x'.repeat(MAP_MAX_CHARS + 1))).toMatch(/trop gros/);
    expect(refused([])).toMatch(/objet/);
    expect(refused({ ...small(), format: 2 })).toMatch(/format/i);
    expect(refused({ ...small(), extra: 1 })).toMatch(/champ inconnu « extra »/);
    expect(refused({ ...small(), id: '../x' })).toMatch(/id/);
    expect(refused({ ...small(), name: '<img src=x onerror=alert(1)>' })).toMatch(/name/);
    expect(refused({ ...small(), name: '' })).toMatch(/vide/);
    expect(refused({ ...small(), description: 'a" onmouseover="alert(1)' })).toMatch(/description/);
  });

  it('refuses a size, a player count or a planet out of bounds', () => {
    expect(refused({ ...small(), size: 1000 })).toMatch(/size/);
    expect(refused({ ...small(), size: 64.5 })).toMatch(/size/);
    expect(refused({ ...small(), players: [2, 9] })).toMatch(/players/);
    expect(refused({ ...small(), players: [2, 2] })).toMatch(/players/);
    expect(refused({ ...small(), symmetry: 'miroir' })).toMatch(/symmetry/);
    expect(refused({ ...small(), biome: 'constructor' })).toMatch(/planète inconnue/);
  });

  it('wants exactly one start', () => {
    const b = small().bases[0];
    expect(refused({ ...small(), bases: [{ ...b, start: false }] })).toMatch(/exactement une base de départ/);
    expect(refused({ ...small(), bases: [b, { ...b, hq: [40, 40] }] })).toMatch(/exactement une base de départ/);
    expect(refused({ ...small(), bases: [] })).toMatch(/bases/);
  });

  it('keeps every coordinate on the map', () => {
    const b = small().bases[0];
    expect(refused({ ...small(), bases: [{ ...b, hq: [60, 8] }] })).toMatch(/hq \(x\)/); // a 5x5 headquarters from 60 leaves a 64-tile map
    expect(refused({ ...small(), bases: [{ ...b, minerals: [[-1, 5]] }] })).toMatch(/minerai 1/);
    expect(refused({ ...small(), bases: [{ ...b, wells: [[62, 4]] }] })).toMatch(/puits 1/);
    expect(refused({ ...small(), terrain: [{ shape: 'rect', from: [0, 0], to: [64, 3], level: 1 }] })).toMatch(/to \(x\)/);
    expect(refused({ ...small(), terrain: [{ shape: 'polygon', points: [[0, 0], [10, 0], [NaN, 5]], fill: true }] })).toMatch(/point 3/);
    expect(refused({ ...small(), terrain: [{ shape: 'circle', at: [1e9, 2], r: 3, chasm: true }] })).toMatch(/at \(x\)/);
  });

  it('caps the number of things', () => {
    expect(refused({ ...small(), terrain: Array(301).fill({ shape: 'circle', at: [5, 5], r: 2, level: 1 }) })).toMatch(/terrain/);
    expect(refused({ ...small(), terrain: [{ shape: 'polygon', points: Array(257).fill([1, 1]), fill: true }] })).toMatch(/points/);
    expect(refused({ ...small(), bases: [{ ...small().bases[0], minerals: Array(33).fill([5, 5]) }] })).toMatch(/minerals/);
  });

  it('wants a shape to do exactly one thing', () => {
    expect(refused({ ...small(), terrain: [{ shape: 'circle', at: [5, 5], r: 2 }] })).toMatch(/exactement un/);
    expect(refused({ ...small(), terrain: [{ shape: 'circle', at: [5, 5], r: 2, level: 1, chasm: true }] })).toMatch(/exactement un/);
    expect(refused({ ...small(), terrain: [{ shape: 'blob', at: [5, 5], level: 1 }] })).toMatch(/forme inconnue/);
    expect(refused({ ...small(), terrain: [{ shape: 'ramp', at: [5, 5], up: 'X', width: 3, level: 0 }] })).toMatch(/up/);
  });

  it('prints the same map the same, and two maps apart', () => {
    const a = checkMap(small()) as never;
    expect(mapPrint(a)).toBe(mapPrint(checkMap(small()) as never));
    expect(mapPrint(a)).toMatch(/^[0-9a-f]{8}$/);
    expect(mapPrint(a)).not.toBe(mapPrint(checkMap({ ...small(), size: 65 }) as never));
  });

  it('keeps an imported map in this browser, and forgets it', () => {
    const store = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: { setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), getItem: (k: string) => store.get(k) ?? null },
    });
    try {
      const m = checkMap(small()) as never as { id: string };
      expect(addMap(m as never, true)).toBe(true);
      expect(MAPS['import-ma-carte']).toBe(m);
      expect(parseMap(store.get('xcraft.carte:import-ma-carte')!)).toEqual(m);
      removeMap('import-ma-carte');
      expect(MAPS['import-ma-carte']).toBeUndefined();
      expect(store.size).toBe(0);
      removeMap('origine'); // never one of the game's own
      expect(MAPS.origine).toBeDefined();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
