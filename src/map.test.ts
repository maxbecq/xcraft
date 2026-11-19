import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP, buildMap, mapFile } from './maps';
import { type GameMap, LEVEL_HEIGHT, RAMP_LENGTH, STEP, SUB, cornerHeights, cornerLevels, createMap, cutCorner, cutLevel, heightAt, inCut, reliefAt, setRelief, tileAt } from './map';

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

describe('heightAt', () => {
  // The height worked out from the tiles each time, as before the per-map cache.
  const reference = (m: GameMap, x: number, y: number, withRelief: boolean) => {
    const tx = Math.min(m.width - 1, Math.max(0, Math.floor(x)));
    const ty = Math.min(m.height - 1, Math.max(0, Math.floor(y)));
    const u = Math.min(1, Math.max(0, x - tx));
    const v = Math.min(1, Math.max(0, y - ty));
    const cut = cutCorner(m, tx, ty);
    if (cut >= 0 && inCut(cut, u, v)) return cutLevel(m, tx, ty, cut) * LEVEL_HEIGHT;
    const [nw, ne, se, sw] = cornerHeights(m, tx, ty);
    const r = withRelief ? [reliefAt(m, tx, ty), reliefAt(m, tx + 1, ty), reliefAt(m, tx + 1, ty + 1), reliefAt(m, tx, ty + 1)] : [0, 0, 0, 0];
    return ((nw + r[0]) * (1 - u) + (ne + r[1]) * u) * (1 - v) + ((sw + r[3]) * (1 - u) + (se + r[2]) * u) * v;
  };

  it('gives the same heights from its cache, cliffs, ramps and relief included', () => {
    const m = buildMap(mapFile(DEFAULT_MAP));
    for (const f of [null, (vx: number, vz: number) => Math.sin(vx * 0.7) * Math.cos(vz * 0.4) * 0.3]) {
      setRelief(f);
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 20000; k++) {
        const x = rand() * (m.width + 2) - 1;
        const y = rand() * (m.height + 2) - 1;
        expect(heightAt(m, x, y)).toBe(reference(m, x, y, !!f));
      }
    }
    setRelief(null);
  });
});
