import { describe, expect, it } from 'vitest';
import '../terrain'; // terrain first: it and render/biome import each other (as in main.ts)
import { BIOMES, biomesFor, fitBiome, pickBiome } from './biome';
import { MAPS } from '../maps';
import { createMatch } from '../sim/setup';

describe('planets per map', () => {
  it('Astéroïdes is special: only its own map takes it, and that map takes nothing else', () => {
    expect(BIOMES.asteroides.special).toBe(true);
    for (const m of Object.values(MAPS)) if (m.id !== 'asteroides') expect(biomesFor(m).map((b) => b.id)).not.toContain('asteroides');
    expect(biomesFor(MAPS.asteroides).map((b) => b.id)).toEqual(['asteroides']);
    expect(fitBiome('desert', MAPS.asteroides).id).toBe('asteroides');
    expect(fitBiome(null, MAPS.asteroides).id).toBe('asteroides');
  });

  it('every map offers every common planet; a map drawn for a special one offers it too', () => {
    const common = Object.values(BIOMES).filter((b) => !b.special).map((b) => b.id);
    for (const m of Object.values(MAPS)) if (!m.biomesOnly) expect(biomesFor(m).map((b) => b.id)).toEqual(common);
    expect(biomesFor({ biomes: ['asteroides'] }).map((b) => b.id)).toContain('asteroides');
    expect(fitBiome('asteroides', { biomes: ['asteroides'] }).id).toBe('asteroides');
  });

  it('a planet the map does not take, or an unknown one, falls back to the desert without error', () => {
    const origine = MAPS.origine;
    expect(fitBiome('asteroides', origine).id).toBe('desert');
    expect(fitBiome('nulle-part', origine).id).toBe('desert');
    expect(fitBiome('constructor', origine).id).toBe('desert');
    expect(fitBiome(null, origine).id).toBe('desert');
    expect(fitBiome('volcan', origine).id).toBe('volcan');
    expect(pickBiome(new URLSearchParams('biome=asteroides'), origine).id).toBe('desert');
    expect(pickBiome(new URLSearchParams('biome=glace'), origine).id).toBe('glace');
  });

  it('the fallback leaves the match as it was: same World.hash on every map (old Astéroïdes replays still play the same)', () => {
    for (const m of Object.values(MAPS)) {
      const before = createMatch(['humains', 'z'], undefined, m.id, 'asteroides').hash();
      expect(createMatch(['humains', 'z'], undefined, m.id, fitBiome('asteroides', m).id).hash()).toBe(before);
    }
  });
});
