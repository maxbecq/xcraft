import { expect, it } from 'vitest';
import { MAPS, buildMap } from '../maps';
import { Grid } from './grid';
import { Vision } from './vision';

it('reveals the same tiles row by row as tile by tile, cliffs and map edges included', () => {
  for (const def of Object.values(MAPS)) {
    const g = new Grid(buildMap(def));
    const [a, b] = [new Vision(g), new Vision(g)];
    const any = (b as unknown as { revealAny: (cx: number, cy: number, r: number, high: boolean) => void }).revealAny.bind(b);
    let seed = 5;
    const rand = (n: number) => Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * n);
    for (let k = 0; k < 400; k++) {
      const [cx, cy, r, high] = [rand(g.width + 8) - 4, rand(g.height + 8) - 4, rand(14), rand(4) === 0];
      a.reveal(cx, cy, r, high);
      any(cx, cy, r, high);
      if (k % 50 === 49) {
        expect(a.tiles).toEqual(b.tiles);
        a.begin();
        b.begin();
      }
    }
    expect(a.tiles).toEqual(b.tiles);
  }
});
