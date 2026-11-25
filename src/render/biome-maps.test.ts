import { describe, expect, it } from 'vitest';
import '../terrain'; // terrain first: it and render/biome import each other (as in main.ts)
import { BIOMES, biomeOf, pickBiome } from './biome';
import { buildMap, MAPS } from '../maps';
import { createMatch } from '../sim/setup';

describe('one planet per map', () => {
  it('every map names a planet this build has, as chosen for it', () => {
    for (const m of Object.values(MAPS)) expect(Object.hasOwn(BIOMES, m.biome)).toBe(true);
    const chosen = Object.fromEntries(Object.values(MAPS).map((m) => [m.id, m.biome]));
    expect(chosen).toMatchObject({ origine: 'desert', carrefour: 'lune', 'l-anneau': 'glace', 'le-col': 'volcan', 'les-ponts': 'desert', asteroides: 'asteroides', 'ville-nuit': 'villenuit' });
  });

  it('a new game plays on the map\'s planet', () => {
    for (const m of Object.values(MAPS)) expect(pickBiome(new URLSearchParams(''), m).id).toBe(m.biome);
  });

  it('an older link or replay keeps the planet it names, so it plays again the same', () => {
    expect(pickBiome(new URLSearchParams('biome=glace'), MAPS.origine).id).toBe('glace');
    expect(pickBiome(new URLSearchParams('biome=ville'), MAPS.origine).id).toBe('ville');
    expect(pickBiome(new URLSearchParams('biome=desert'), MAPS.carrefour).id).toBe('desert');
  });

  it('never a special planet off its map, nor another planet on a special map (older builds dropped them too)', () => {
    expect(pickBiome(new URLSearchParams('biome=asteroides'), MAPS.origine).id).toBe('desert');
    expect(pickBiome(new URLSearchParams('biome=villenuit'), MAPS.carrefour).id).toBe('lune');
    expect(pickBiome(new URLSearchParams('biome=desert'), MAPS.asteroides).id).toBe('asteroides');
    expect(pickBiome(new URLSearchParams('biome=ville'), MAPS['ville-nuit']).id).toBe('villenuit');
  });

  it('an unknown planet, in a link or in a map file, gives no error', () => {
    expect(pickBiome(new URLSearchParams('biome=constructor'), MAPS.origine).id).toBe('desert');
    // An imported map: its own planet, whatever the link says (its shapes were checked for that one).
    expect(pickBiome(new URLSearchParams('biome=glace'), { ...MAPS.carrefour, id: 'import-carrefour' }).id).toBe(MAPS.carrefour.biome);
    expect(pickBiome(new URLSearchParams('biome=nulle-part'), MAPS['le-col']).id).toBe('volcan');
    expect(biomeOf({ biome: 'nulle-part' }).id).toBe('desert');
  });

  it('the planet shapes the map only where the file says so (Origine\'s city): the same match on every other planet', () => {
    for (const m of Object.values(MAPS)) {
      const own = createMatch(['humains', 'z'], undefined, m.id, m.biome).hash();
      for (const b of Object.keys(BIOMES)) if (!(m.id === 'origine' && b === 'ville')) expect(createMatch(['humains', 'z'], undefined, m.id, b).hash()).toBe(own);
    }
    expect(buildMap(MAPS.origine, 2, 'ville').chasm).not.toEqual(buildMap(MAPS.origine, 2, 'desert').chasm);
  });
});
