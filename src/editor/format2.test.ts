import { describe, expect, it } from 'vitest';
import { buildMap, MAPS, turnsOf } from '../maps';
import { blankMap, fromFormat1, parseMap, rampTiles, toGameMap, turnRamp } from './format2';
import { previewWorld } from './world';

describe('format 2', () => {
  // Every map file read through format 2 gives the game's own map, tile for tile.
  for (const def of Object.values(MAPS)) {
    it(`${def.id} : format 1 → format 2 → carte du jeu identique`, () => {
      const biome = def.biomes?.[0] ?? '';
      const players = Math.max(...def.players);
      const f = fromFormat1(def, biome, players);
      const a = buildMap(def, players, biome);
      const b = toGameMap(parseMap(JSON.parse(JSON.stringify(f))));
      expect([...b.level]).toEqual([...a.level]);
      expect(b.ramp).toEqual(a.ramp);
      expect([...b.rampStep]).toEqual([...a.rampStep]);
      expect([...(b.chasm ?? new Uint8Array(a.level.length))]).toEqual([...(a.chasm ?? new Uint8Array(a.level.length))]);
      expect(b.sites!.filter((s) => s.start).length).toBe(players);
      expect(f.players.length + f.bases.length).toBe(a.sites!.length);
      expect(f.symmetry).toBe(turnsOf(def, players).length === 4 ? 'rot90' : 'rot180');
    });
  }

  it('un monde d\'aperçu : QG, ouvriers, ressources et unités posées', () => {
    const f = blankMap(64);
    f.minerals.push([20, 20]);
    f.wells.push([30, 30]);
    f.units.push({ type: 'caserne', owner: 0, at: [20, 10] }, { type: 'auxiliaire', owner: -1, at: [40, 40] }, { type: 'inconnu', owner: 0, at: [1, 1] });
    f.players[1].race = 'z';
    const { world, skipped } = previewWorld(f, toGameMap(f));
    const types = [...world.entities.values()].map((e) => e.type);
    expect(types).toContain('conseil');
    expect(types).toContain('intelligence');
    expect(types).toContain('caserne');
    expect(types).toContain('puits');
    expect(skipped).toEqual(['inconnu']);
  });

  it('une rampe tournée garde ses tuiles tournées', () => {
    const r = { at: [10, 20] as [number, number], up: 'N' as const, width: 3, level: 0 };
    for (const q of [1, 2, 3]) {
      const t = turnRamp(64, r, q);
      const turned = new Set(rampTiles(r).map(([x, y]) => {
        for (let k = 0; k < q; k++) [x, y] = [63 - y, x];
        return `${x},${y}`;
      }));
      expect(new Set(rampTiles(t).map(([x, y]) => `${x},${y}`))).toEqual(turned);
    }
  });

  it('refuse un fichier mal formé', () => {
    expect(() => parseMap({ format: 3 })).toThrow();
    expect(() => parseMap({ ...blankMap(32), tiles: ['0'] })).toThrow();
    expect(() => parseMap({ ...blankMap(32), size: 100000 })).toThrow();
    expect(() => parseMap({ ...blankMap(32), players: [] })).toThrow();
    expect(parseMap(JSON.parse(JSON.stringify(blankMap(32)))).size).toBe(32);
  });
});
