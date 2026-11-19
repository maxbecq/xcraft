import { expect, it } from 'vitest';
import { MAPS, buildMap } from '../maps';
import { Grid } from './grid';

it('canStep from its per-tile sides answers as the tiles themselves do, buildings and all', () => {
  for (const def of Object.values(MAPS)) {
    const g = new Grid(buildMap(def));
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < g.blocked.length; i++) if (rand() < 0.15) g.blocked[i] = 1;
    const slow = (g as unknown as { terrainStep: (...a: (number | boolean)[]) => boolean }).terrainStep.bind(g);
    for (let y = -1; y <= g.height; y++)
      for (let x = -1; x <= g.width; x++)
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            for (const t of [false, true]) if (g.canStep(x, y, x + dx, y + dy, t) !== slow(x, y, x + dx, y + dy, t)) expect([def.id, x, y, dx, dy, t]).toBe('the same');
  }
});
