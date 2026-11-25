import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { CLIFF_FOOT, cutCorner } from '../map';
import { FP, ticks } from './fixed';
import { fingerprint } from './fingerprint';
import { createMatch } from './setup';
import { type Entity, World } from './world';

// Units sunk in the cliffs (équilibreur 22/11): only a unit's centre was tested against the terrain, so its body
// walked half into the rock at a cliff's foot. Now the body keeps out of the band CLIFF_FOOT wide at the foot, where
// the rock's slope is drawn.
describe('cliffs', () => {
  const KEEP = Math.trunc((FP * 45) / 100);
  const BAND = Math.round(CLIFF_FOOT * FP);
  /** Four low tiles in a row, each with a higher plateau north of it and open ground south. */
  const foot = (w: ReturnType<typeof createMatch>): [number, number] => {
    const g = w.grid;
    for (let ty = 2; ty < w.map.height - 3; ty++) {
      for (let tx = 2; tx < w.map.width - 8; tx++) {
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) {
          const l = g.flatLevel(tx + i, ty);
          ok = l >= 0 && g.open(tx + i, ty) && g.open(tx + i, ty + 1) && g.flatLevel(tx + i, ty + 1) === l && g.level(tx + i, ty - 1) > l && !g.canStep(tx + i, ty, tx + i, ty - 1, true);
        }
        if (ok) return [tx, ty];
      }
    }
    throw new Error('no cliff foot');
  };
  const big = Object.keys(DEFS).find((k) => DEFS[k].kind === 'unit' && (DEFS[k] as UnitDef).radius >= 0.6 && !(DEFS[k] as UnitDef).flying && (DEFS[k] as UnitDef).faction === 'humains')!;

  const run = () => {
    const w = createMatch(['humains', 'humains']);
    const [tx, ty] = foot(w);
    const edge = ty * FP;
    const a = w.spawn(big, 0, tx * FP + FP / 2, edge + FP - 30);
    const b = w.spawn(big, 0, (tx + 2) * FP + FP / 2, edge + FP - 30);
    let least = FP;
    // Sent along the foot, hard against the wall, through an idle unit it shoves aside.
    w.step([{ player: 0, kind: 'move', ids: [a.id], x: (tx + 3) * FP + FP / 2, y: edge + 1 }]);
    for (let i = 0; i < 400; i++) {
      w.step([]);
      least = Math.min(least, a.y - edge, b.y - edge);
    }
    return { least, r: BAND + Math.min(a.radius, KEEP), print: fingerprint(w), arrived: a.x > (tx + 3) * FP };
  };

  it('a unit walked along a cliff\'s foot, or shoved against it, keeps its body out of the band at the foot', () => {
    const r = run();
    expect(r.arrived).toBe(true);
    expect(r.least).toBeGreaterThanOrEqual(r.r);
  });

  it('the same game twice: the same fingerprint (lockstep)', () => {
    expect(run().print).toBe(run().print);
  });

  it('a unit already standing in the band (an old replay, a saved game) walks out of it, along the wall or away', () => {
    for (const away of [false, true]) {
      const w = createMatch(['humains', 'humains']);
      const [tx, ty] = foot(w);
      const a = w.spawn(big, 0, tx * FP + FP / 2, ty * FP + 50);
      const [gx, gy] = away ? [tx * FP + FP / 2, (ty + 1) * FP + FP / 2] : [(tx + 3) * FP + FP / 2, ty * FP + 50];
      w.step([{ player: 0, kind: 'move', ids: [a.id], x: gx, y: gy }]);
      for (let i = 0; i < 300 && a.order; i++) w.step([]);
      expect(a.order, `away ${away}`).toBeNull();
      expect(Math.abs(a.x - gx) + (away ? Math.abs(a.y - gy) : 0), `away ${away}`).toBeLessThan(FP);
      expect(a.y - ty * FP).toBeGreaterThanOrEqual(BAND + Math.min(a.radius, KEEP));
    }
  });

  it('Le Col: the widest god walks out of its base, down the ramp from the plateau, to the far side of the map', () => {
    const w = createMatch(['dieux', 'humains'], undefined, 'le-col');
    const god = w.spawn('gaia', 0, 14 * FP, 22 * FP);
    const [gx, gy] = [70 * FP, 52 * FP];
    w.step([{ player: 0, kind: 'move', ids: [god.id], x: gx, y: gy }]);
    for (let i = 0; i < ticks(240) && god.order; i++) w.step([]);
    expect(Math.hypot(god.x - gx, god.y - gy) / FP).toBeLessThan(2);
  });

  /** The grid's per-tile masks, for the checks below (see Grid.feet, sides). */
  const masks = (w: ReturnType<typeof createMatch>) => w.grid as unknown as { feet: Uint8Array; sides: Uint8Array; narrow(x: number, y: number): boolean };

  it('a foot facing a side no unit crosses (a cliff\'s top, a chasm): the body keeps off the foot, not the middle', () => {
    let seen = 0;
    for (const map of ['origine', 'carrefour']) {
      const w = createMatch(['humains', 'humains'], undefined, map);
      const { feet, sides } = masks(w);
      for (let ty = 0; ty < w.map.height; ty++) {
        for (let tx = 0; tx < w.map.width; tx++) {
          const i = ty * w.map.width + tx;
          for (const [foot, other, horizontal] of [[8, 2, true], [2, 8, true], [1, 4, false], [4, 1, false]] as const) {
            if (!(feet[i] & foot) || feet[i] & other || sides[i] & other) continue;
            seen++;
            const [x, y] = w.grid.keepOff(tx * FP + FP / 2, ty * FP + FP / 2, KEEP);
            const v = horizontal ? x - tx * FP : y - ty * FP;
            expect(foot === 8 || foot === 1 ? v : FP - v).toBeGreaterThanOrEqual(BAND + KEEP);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('beside a diagonal cliff\'s cut corner, drawn as low ground with no band, no foot', () => {
    const w = createMatch(['humains', 'humains'], undefined, 'origine');
    const { feet } = masks(w);
    const W = w.map.width;
    let seen = 0;
    for (let ty = 1; ty < w.map.height - 1; ty++) {
      for (let tx = 1; tx < W - 1; tx++) {
        const c = cutCorner(w.map, tx, ty);
        if (c < 0) continue;
        seen++;
        const [dx, dy] = [[-1, -1], [1, -1], [1, 1], [-1, 1]][c];
        // The two tiles beside the cut (their side facing it) and the one across the cut corner (its corner there).
        expect(feet[ty * W + tx + dx] & (dx < 0 ? 2 : 8)).toBe(0);
        expect(feet[(ty + dy) * W + tx] & (dy < 0 ? 4 : 1)).toBe(0);
        expect(feet[(ty + dy) * W + tx + dx] & (16 << ((c + 2) % 4))).toBe(0);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('a move ordered onto a tile between two feet ends beside it, without replanning for good', () => {
    const w = createMatch(['humains', 'humains'], undefined, 'le-col');
    const { narrow } = masks(w);
    const g = w.grid;
    let goal: [number, number] | null = null;
    for (let ty = 0; ty < w.map.height && !goal; ty++) for (let tx = 0; tx < w.map.width && !goal; tx++) if (g.open(tx, ty) && narrow.call(g, tx, ty)) goal = [tx, ty];
    const [gx, gy] = goal!;
    const [sx, sy] = g.nearestOpen(gx + 6, gy, g.level(gx, gy));
    const a = w.spawn(big, 0, sx * FP + FP / 2, sy * FP + FP / 2);
    w.step([{ player: 0, kind: 'move', ids: [a.id], x: gx * FP + FP / 2, y: gy * FP + FP / 2 }]);
    for (let i = 0; i < 300 && a.order; i++) w.step([]);
    expect(a.order).toBeNull();
    expect(Math.hypot(a.x / FP - gx - 0.5, a.y / FP - gy - 0.5)).toBeLessThan(2.5);
  });

  // The user, 2026-11-24: "a unit can go down the cliff, but stays stuck at the bottom". A diagonal cliff's cut corner
  // is drawn as low ground, yet it is part of the plateau's tile: a unit walked onto it stood at the cliff's foot,
  // with no way on but back up.
  describe('a diagonal cliff\'s cut corner, drawn as low ground', () => {
    // A small map made by hand: low ground, and a plateau in a staircase whose corners (8,8) and (9,7) are cut (NW).
    const N = 16;
    const stair = () => {
      const level = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x >= 8 && y >= 8) || (x >= 9 && y === 7)) level[y * N + x] = 1;
      return new World({ width: N, height: N, level, ramp: new Array(N * N).fill(null), rampStep: new Uint8Array(N * N) });
    };
    const [tx, ty] = [8, 8];
    /** How far past the diagonal of (8,8), on the plateau's side (tiles, along the tile's axes). */
    const past = (e: { x: number; y: number }) => e.x / FP - tx + e.y / FP - ty - 1;
    const inTile = (e: { x: number; y: number }) => Math.floor(e.x / FP) === tx && Math.floor(e.y / FP) === ty;
    const corner: [number, number] = [Math.round((tx + 0.2) * FP), Math.round((ty + 0.2) * FP)];
    /** Steps the world `n` ticks; the longest move of `a` in one tick. */
    const walk = (w: World, a: Entity, n: number, each?: () => void) => {
      let most = 0;
      for (let i = 0; i < n; i++) {
        const [x, y] = [a.x, a.y];
        w.step([]);
        most = Math.max(most, Math.hypot(a.x - x, a.y - y));
        each?.();
      }
      return most;
    };

    it('the map has the two cut corners', () => {
      const w = stair();
      expect(cutCorner(w.map, 8, 8)).toBe(0);
      expect(cutCorner(w.map, 9, 7)).toBe(0);
    });

    it('ordered onto it from the plateau, along either side, a unit stops on the plateau, with no leap as it enters the tile', () => {
      for (const [sx, sy] of [[12, 8], [8, 12], [11, 11]]) {
        const w = stair();
        const a = w.spawn(big, 0, sx * FP + FP / 2, sy * FP + FP / 2);
        w.step([{ player: 0, kind: 'move', ids: [a.id], x: corner[0], y: corner[1] }]);
        let entered = false;
        const most = walk(w, a, 300, () => {
          if (!inTile(a)) return;
          entered = true;
          expect(past(a), `from ${sx},${sy}`).toBeGreaterThanOrEqual(0.6);
        });
        expect(entered, `from ${sx},${sy}`).toBe(true);
        expect(a.order, `from ${sx},${sy}`).toBeNull();
        expect(most, `from ${sx},${sy}`).toBeLessThanOrEqual(a.speed + 2);
      }
    });

    it('the limit runs on into the tiles beside it: a point a body may stand at on one side of their shared edge, it may on the other', () => {
      const w = stair();
      const free = (x: number, y: number) => {
        const [kx, ky] = w.grid.keepOff(x, y, KEEP);
        return Math.abs(kx - x) + Math.abs(ky - y) <= 2;
      };
      const edge = FP + Math.trunc((KEEP * 1449) / 1024) - FP; // where the limit crosses the edge, from the diagonal's end
      for (let k = 2; k < FP - 1; k += 7) {
        if (Math.abs(k - edge) < 8) continue;
        expect(free(9 * FP - 1, 8 * FP + k), `east ${k}`).toBe(free(9 * FP + 1, 8 * FP + k));
        expect(free(8 * FP + k, 9 * FP - 1), `south ${k}`).toBe(free(8 * FP + k, 9 * FP + 1));
      }
    });

    it('standing on it (an old replay, a saved game), a unit walks out at its own pace, to the plateau or towards the low ground', () => {
      for (const [gx, gy] of [[11, 11], [5, 5]]) {
        const w = stair();
        const a = w.spawn(big, 0, ...corner);
        w.step([{ player: 0, kind: 'move', ids: [a.id], x: gx * FP + FP / 2, y: gy * FP + FP / 2 }]);
        const most = walk(w, a, 100);
        expect(!inTile(a) || past(a) >= 0.6, `to ${gx},${gy}`).toBe(true);
        expect(most, `to ${gx},${gy}`).toBeLessThanOrEqual(3 * a.speed + 2);
      }
    });
  });

  it('a unit standing in the band walks out of it at its own pace, not in one leap', () => {
    const w = createMatch(['humains', 'humains']);
    const [tx, ty] = foot(w);
    const a = w.spawn(big, 0, tx * FP + FP / 2, ty * FP + 50);
    w.step([{ player: 0, kind: 'move', ids: [a.id], x: (tx + 3) * FP + FP / 2, y: ty * FP + 50 }]);
    let most = 0;
    for (let i = 0; i < 300 && a.order; i++) {
      const [x, y] = [a.x, a.y];
      w.step([]);
      most = Math.max(most, Math.hypot(a.x - x, a.y - y));
    }
    expect(most).toBeLessThanOrEqual(3 * a.speed + 2);
    expect(a.y - ty * FP).toBeGreaterThanOrEqual(BAND + Math.min(a.radius, KEEP));
  });
});
