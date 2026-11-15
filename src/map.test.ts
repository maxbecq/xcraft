import { describe, expect, it } from 'vitest';
import { RAMP_LENGTH, STEP, SUB, cornerLevels, createMap, tileAt } from './map';

const map = createMap();

describe('createMap', () => {
  it('is symmetric for both players', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        expect(tileAt(map, x, y)!.level).toBe(tileAt(map, map.width - 1 - x, map.height - 1 - y)!.level);
      }
    }
  });

  it('has gentle ramps climbing one level over RAMP_LENGTH tiles', () => {
    let ramps = 0;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const t = tileAt(map, x, y)!;
        if (!t.ramp) continue;
        ramps++;
        const step = map.rampStep[y * map.width + x];
        const [sx, sy] = STEP[t.ramp];
        const up = tileAt(map, x + sx, y + sy)!;
        const down = tileAt(map, x - sx, y - sy)!;
        // Uphill: the next ramp step, or the higher ground at the top.
        if (step === 0) expect(up).toEqual({ level: t.level + 1, ramp: null });
        else expect(map.rampStep[(y + sy) * map.width + x + sx]).toBe(step - 1);
        // Downhill: the next step, or the lower ground at the bottom.
        if (step === RAMP_LENGTH - 1) expect(down).toEqual({ level: t.level, ramp: null });
        else expect(down.ramp).toBe(t.ramp);
      }
    }
    expect(ramps).toBe(26 * RAMP_LENGTH);
    // Each step rises a fraction of a level: no tile is steeper than 1 / RAMP_LENGTH.
    const [nw, , , sw] = cornerLevels(map, 25, 14);
    expect(nw - cornerLevels(map, 25, 14)[1]).toBe(SUB / RAMP_LENGTH);
    expect(nw).toBe(sw);
  });

  it('puts each main base on high ground', () => {
    expect(tileAt(map, 14, 14)!.level).toBe(2);
    expect(tileAt(map, 81, 81)!.level).toBe(2);
  });
});
