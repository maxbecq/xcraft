import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { heightAt } from '../src/map';
import { MAPS, buildMap } from '../src/maps';
// The night city's ground for the painter (tools/villenuit/blockout.py): each tile's four corner heights (nw, ne, se,
// sw), and what it is (0 ground, 1 block of buildings, 2 open chasm).
// Run: VILLENUIT_GRID=1 npx vitest run scripts/villenuit-grid.test.ts
it.skipIf(!process.env.VILLENUIT_GRID)('ville-nuit grid', () => {
  const map = buildMap(MAPS['ville-nuit'], 2, 'villenuit');
  const e = 1e-3;
  const corners: number[] = [];
  const kind: number[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      for (const [u, v] of [[e, e], [1 - e, e], [1 - e, 1 - e], [e, 1 - e]]) corners.push(Math.round(heightAt(map, x + u, y + v) * 100) / 100);
      kind.push(map.block?.[i] ? 1 : map.chasm?.[i] ? 2 : 0);
    }
  }
  writeFileSync('tools/villenuit/grid.json', JSON.stringify({ size: map.width, corners, kind, sites: map.sites }));
});
