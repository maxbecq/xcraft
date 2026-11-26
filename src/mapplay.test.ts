import { describe, expect, it } from 'vitest';
import { checkMap } from './mapcheck';
import { unplayable } from './mapplay';
import { MAPS, type MapFile } from './maps';
import { FP } from './sim/fixed';
import { createMatch } from './sim/setup';

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

  // Codex, 2026-11-26 (final review): only the Humains' starts were built, so a start whose workers stood at the map's
  // east edge passed, and Gaïa (a Dieux start) came out past it.
  it('refuses a start any camp\'s first units would stand off the map at', () => {
    expect(unplayable(withBase(0, { workers: [61, 32] }))).toMatch(/hors de la carte|enfermé|pas la place/);
  });

  // Codex, 2026-11-26 (second final review): Gaïa on a one-tile rise with no ramp, her start open, passed.
  it('refuses a start whose first walkers cannot reach their headquarters on foot', () => {
    const w = createMatch(['dieux', 'dieux'], undefined, open(), 'desert');
    const gaia = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'gaia')!;
    const [x, y] = [Math.floor(gaia.x / FP), Math.floor(gaia.y / FP)];
    const m = open();
    m.terrain = [{ shape: 'rect', from: [x, y], to: [x, y], level: 1 }];
    expect(unplayable(m)).toMatch(/ne rejoint pas son QG/);
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

describe('whether an imported map can be played: what stands on it, its units', () => {
  it('refuses a bridge stopped by a well (headquarters and resources are walked round, not through)', () => {
    const m = withBase(1, { wells: [[40, 30]] });
    m.terrain = [{ shape: 'rect', from: [0, 30], to: [63, 33], chasm: true }, { shape: 'rect', from: [40, 30], to: [42, 33], fill: true }];
    expect(unplayable(m)).toMatch(/ne rejoint pas les autres à pied/);
    // The same bridge, clear: fine.
    const clear = open();
    clear.terrain = m.terrain;
    expect(unplayable(clear)).toBeNull();
  });

  it('refuses workers off the map or on ground cut off from the rest', () => {
    expect(unplayable(withBase(0, { workers: [63, 63] }))).toMatch(/hors de la carte|ne rejoint pas/);
    const m = withBase(0, { workers: [40, 12] });
    m.terrain = [{ shape: 'rect', from: [37, 9], to: [44, 15], level: 2 }];
    expect(unplayable(m)).toMatch(/ne rejoint pas les autres à pied/);
  });

  it('refuses a ramp that runs off the map, never painting another tile', () => {
    const m = open() as unknown as Record<string, unknown>;
    m.terrain = [{ shape: 'ramp', at: [63, 10], up: 'N', width: 2, level: 0 }];
    expect(checkMap(m)).toMatch(/sort de la carte/);
  });
});

