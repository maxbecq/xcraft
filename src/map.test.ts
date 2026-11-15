import { describe, expect, it } from 'vitest';
import { STEP, createMap, tileAt } from './map';

const map = createMap();

describe('createMap', () => {
  it('is symmetric for both players', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(tileAt(map, x, y)!.level).toBe(tileAt(map, map.width - 1 - x, map.height - 1 - y)!.level);
      }
    }
  });

  it('has ramps that connect two adjacent levels', () => {
    let ramps = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = tileAt(map, x, y)!;
        if (!t.ramp) continue;
        ramps++;
        const [sx, sy] = STEP[t.ramp];
        const up = tileAt(map, x + sx, y + sy)!;
        const down = tileAt(map, x - sx, y - sy)!;
        expect(up).toEqual({ level: t.level + 1, ramp: null });
        expect(down.level).toBe(t.level);
      }
    }
    expect(ramps).toBe(26);
  });

  it('puts each main base on high ground', () => {
    expect(tileAt(map, 14, 14)!.level).toBe(2);
    expect(tileAt(map, 81, 81)!.level).toBe(2);
  });
});
