import { describe, expect, it } from 'vitest';
import { DEFS } from '../data';
import { MAPS } from '../maps';
import { fromFormat1 } from './format2';
import { iconOf, startNumbers } from './state';
// Node's file system, reached at run time (the project carries no Node types), as in render/pivots.test.ts.
const fs = 'node:fs';
const { existsSync } = (await import(/* @vite-ignore */ fs)) as { existsSync(path: string): boolean };

describe('éditeur : numéros des départs', () => {
  it('numérote les départs de haut en bas puis de gauche à droite, un numéro chacun', () => {
    for (const def of Object.values(MAPS)) {
      const f = fromFormat1(def, def.biome, Math.max(...def.players));
      const num = startNumbers(f);
      expect([...num].sort((a, b) => a - b)).toEqual(f.players.map((_, i) => i + 1));
      const at = (k: number) => f.players[num.indexOf(k)].start;
      for (let k = 1; k < num.length; k++) {
        const [a, b] = [at(k), at(k + 1)];
        expect(a[1] < b[1] || (a[1] === b[1] && a[0] <= b[0])).toBe(true);
      }
    }
  });

  it('un échange de départs entre deux joueurs garde les numéros des points', () => {
    const f = fromFormat1(MAPS.carrefour ?? MAPS.origine, undefined, 4);
    const before = startNumbers(f);
    const points = f.players.map((p, i) => [before[i], p.start.join(',')]);
    [f.players[0].start, f.players[2].start] = [f.players[2].start, f.players[0].start];
    const after = startNumbers(f);
    // The same point keeps its number, whoever starts there.
    expect(f.players.map((p, i) => [after[i], p.start.join(',')]).sort()).toEqual(points.sort());
    expect(after[0]).toBe(before[2]);
  });
});

describe('éditeur : icônes', () => {
  it('chaque type des palettes a une icône qui existe (pas de requête en 404)', () => {
    const types = ['minerai', 'puits', ...Object.entries(DEFS).filter(([, d]) => d.kind !== 'upgrade' && 'faction' in d).map(([t]) => t)];
    expect(types.filter((t) => !existsSync(`public/icons/${iconOf(t)}.png`))).toEqual([]);
    expect([iconOf('dirigeable'), iconOf('casernevol'), iconOf('cadavre')]).toEqual(['bourdon', 'casernevolante', 'serf']);
  });
});
