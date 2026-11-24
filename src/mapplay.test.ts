import { describe, expect, it } from 'vitest';
import { checkMap } from './mapcheck';
import { unplayable } from './mapplay';
import { MAPS, type MapFile } from './maps';

/** A small open map: one start in a corner, minerals and a well beside it, a free base further on. */
const open = (): MapFile =>
  checkMap({
    format: 1,
    id: 'essai',
    name: 'Essai',
    size: 64,
    players: [2],
    symmetry: 'rot180',
    biome: 'desert',
    terrain: [],
    bases: [
      { start: true, hq: [10, 10], minerals: [[6, 6], [7, 6], [8, 6]], wells: [[16, 6]] },
      { hq: [24, 24], minerals: [[22, 30], [23, 30]], wells: [] },
    ],
  }) as MapFile;
const withBase = (i: number, b: Partial<MapFile['bases'][number]>): MapFile => {
  const m = open();
  m.bases[i] = { ...m.bases[i], ...b };
  return m;
};

describe('whether an imported map can be played', () => {
  it('takes every map of the game, and a small open one', () => {
    for (const m of Object.values(MAPS)) expect(unplayable(m), m.id).toBeNull();
    expect(unplayable(open())).toBeNull();
  });

  it('refuses a base cut off from the starts', () => {
    const m = open();
    m.terrain = [{ shape: 'rect', from: [18, 18], to: [36, 36], chasm: true }, { shape: 'rect', from: [21, 21], to: [33, 33], fill: true }];
    expect(unplayable(m)).toMatch(/base en \(24, 24\) n'est pas reliée/);
  });

  it('refuses a start with no room for its headquarters, or shut in', () => {
    const m = open();
    m.terrain = [{ shape: 'rect', from: [9, 9], to: [16, 16], chasm: true }];
    expect(unplayable(m)).toMatch(/gouffre|enfermé|QG/);
  });

  it('refuses a free base with no room for a headquarters', () => {
    const m = open();
    m.terrain = [{ shape: 'rect', from: [24, 24], to: [25, 25], level: 2 }]; // a mound in a corner of the spot, its middle still walked to
    expect(unplayable(m)).toMatch(/pas la place pour un QG à la base en \(24, 24\)/);
  });

  it('refuses a mineral far from any base, over the void or on another thing', () => {
    expect(unplayable(withBase(0, { minerals: [[6, 6], [40, 6]] }))).toMatch(/minerai en \(40, 6\) est trop loin/);
    expect(unplayable(withBase(0, { minerals: [[11, 11]] }))).toMatch(/chevauche/);
    expect(unplayable(withBase(0, { minerals: [[6, 6], [6, 6]] }))).toBeNull(); // the same tile twice is one field (as on the game's maps)
    const pit = open();
    pit.terrain = [{ shape: 'rect', from: [5, 5], to: [8, 7], chasm: true }];
    expect(unplayable(pit)).toMatch(/minerai en \(\d+, \d+\) est au-dessus d'un gouffre/);
  });

  it('refuses a mineral nobody can walk up to', () => {
    const m = open();
    // A ring of high ground round one field: no ramp up.
    m.bases[0].minerals = [[20, 6]];
    m.terrain = [{ shape: 'rect', from: [18, 4], to: [22, 8], level: 2 }];
    expect(unplayable(m)).toMatch(/minerai en \(20, 6\) ne s'atteint pas|n'est pas sur un sol plat/);
  });

  it('refuses a well that overlaps a mineral', () => {
    expect(unplayable(withBase(0, { wells: [[6, 5]] }))).toMatch(/chevauche/);
  });

  it('checks every player count the map offers', () => {
    const m = { ...open(), players: [2, 4], symmetry: 'auto' as const };
    expect(unplayable(m)).toBeNull();
    m.bases = [m.bases[0], { hq: [50, 10], minerals: [[48, 6]], wells: [] }];
    expect(unplayable(m)).toMatch(/^À 4 joueurs : /);
  });
});
