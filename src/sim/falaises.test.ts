import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { CLIFF_FOOT, cutCorner } from '../map';
import { FP, ticks } from './fixed';
import { fingerprint } from './fingerprint';
import { MAPS } from '../maps';
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

  it('a move to a point on the edge between the low ground and a plateau, from below: the order ends, at the cliff\'s foot', () => {
    const N = 16;
    const level = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 8; x < N; x++) level[y * N + x] = 1;
    const w = new World({ width: N, height: N, level, ramp: new Array(N * N).fill(null), rampStep: new Uint8Array(N * N) });
    const a = w.spawn(big, 0, 4 * FP + FP / 2, 8 * FP + FP / 2);
    w.step([{ player: 0, kind: 'move', ids: [a.id], x: 8 * FP, y: 8 * FP + FP / 2 }]);
    for (let i = 0; i < 300 && a.order; i++) w.step([]);
    expect(a.order).toBeNull();
    expect(8 * FP - a.x).toBeGreaterThanOrEqual(BAND + Math.min(a.radius, KEEP));
    expect(8 * FP - a.x).toBeLessThan(BAND + KEEP + FP / 8);
  });

  // Codex, 2026-11-26: a point kept off a limit was at times left within another's reach (on a cut corner, what an
  // axis could not take at the tile's edge was dropped; off a corner, the sides brought it back). Given as a waypoint,
  // no step reached it, and the unit pressed there with its order never done.
  describe('a point kept off the cliffs is one a body may stand at', () => {
    it('on every map, by any cliff: kept again, it stays where it is', () => {
      const at = [1, 100, 256, 512, 768, 924, FP - 1];
      for (const id of Object.keys(MAPS)) {
        const w = createMatch(['humains', 'humains'], undefined, id, MAPS[id].biomesOnly ? MAPS[id].biomes![0] : '');
        const g = w.grid;
        const { steps, narrow } = g as unknown as { steps: Uint8Array; narrow(x: number, y: number): boolean };
        let seen = 0;
        for (let ty = 0; ty < w.map.height; ty++) {
          for (let tx = 0; tx < w.map.width; tx++) {
            // Not open ground (nothing to keep off), nor a tile between two feet (never stepped into).
            if (!g.open(tx, ty) || steps[ty * w.map.width + tx] === 255 || narrow.call(g, tx, ty)) continue;
            seen++;
            for (const r of [FP / 4, (FP * 3) / 8, KEEP, FP]) {
              for (const u of at) {
                for (const v of at) {
                  const [kx, ky] = g.keepOff(tx * FP + u, ty * FP + v, r).slice();
                  const [jx, jy] = g.keepOff(kx, ky, r);
                  // Within the rounding of a corner's push.
                  if (Math.abs(jx - kx) + Math.abs(jy - ky) > 4) expect([jx, jy], `${id} ${tx},${ty} r ${r} from ${u},${v}`).toEqual([kx, ky]);
                }
              }
            }
          }
        }
        if (id !== 'asteroides') expect(seen, id).toBeGreaterThan(0);
      }
    });

    it('a move to a point a unit from the edge of a cut corner\'s tile: the order ends', () => {
      const N = 16;
      for (const type of ['scarabee', 'serf']) {
        for (const [gx, gy] of [[8 * FP + 1, 9 * FP - 1], [8 * FP + 121, 9 * FP - 1], [9 * FP - 1, 8 * FP + 1], [8 * FP + 1, 8 * FP + 1]]) {
          const level = new Uint8Array(N * N);
          for (let y = 8; y < N; y++) for (let x = 8; x < N; x++) level[y * N + x] = 1;
          const w = new World({ width: N, height: N, level, ramp: new Array(N * N).fill(null), rampStep: new Uint8Array(N * N) });
          const a = w.spawn(type, 0, 8 * FP + FP / 2, 10 * FP + FP / 2);
          w.step([{ player: 0, kind: 'move', ids: [a.id], x: gx, y: gy }]);
          for (let i = 0; i < 240 && a.order; i++) w.step([]);
          expect(a.order, `${type} to ${gx - 8 * FP},${gy - 8 * FP}`).toBeNull();
        }
      }
    });

    it('Origine, Le Col, Les Ponts: a move onto the edges and corners of a tile by a cliff, from the tile beside it, ends', () => {
      for (const id of ['origine', 'le-col', 'les-ponts']) {
        const w0 = createMatch(['humains', 'humains'], undefined, id);
        const g0 = w0.grid;
        const { steps, narrow } = g0 as unknown as { steps: Uint8Array; narrow(x: number, y: number): boolean };
        const W = w0.map.width;
        const tiles: [number, number, number, number][] = [];
        for (let ty = 1; ty < w0.map.height - 1; ty++) {
          for (let tx = 1; tx < W - 1; tx++) {
            if (!g0.open(tx, ty) || steps[ty * W + tx] === 255 || narrow.call(g0, tx, ty)) continue;
            const from = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g0.open(tx + dx, ty + dy) && g0.canStep(tx + dx, ty + dy, tx, ty) && !narrow.call(g0, tx + dx, ty + dy));
            if (from) tiles.push([tx, ty, tx + from[0], ty + from[1]]);
          }
        }
        expect(tiles.length, id).toBeGreaterThan(20);
        // A spread of them (every one is a whole game made): cut corners, feet, plateau corners.
        const stride = Math.ceil(tiles.length / 24);
        for (let n = 0; n < tiles.length; n += stride) {
          const [tx, ty, sx, sy] = tiles[n];
          const [u, v] = [[1, FP - 1], [FP - 1, 1], [1, 1], [FP - 1, FP - 1], [FP / 2, 1], [1, FP / 2]][(n / stride) % 6];
          const w = createMatch(['humains', 'humains'], undefined, id);
          const a = w.spawn(n % 2 ? 'scarabee' : 'serf', 0, sx * FP + FP / 2, sy * FP + FP / 2);
          w.step([{ player: 0, kind: 'move', ids: [a.id], x: tx * FP + u, y: ty * FP + v }]);
          for (let i = 0; i < 240 && a.order; i++) w.step([]);
          expect(a.order, `${id} ${a.type} from ${sx},${sy} to ${tx},${ty} + ${u},${v}`).toBeNull();
        }
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

  // The goal of a path is moved out of the band: orders that need the unit at a place must still be carried out.
  describe('orders aimed into the band at a cliff\'s foot', () => {
    it('attack-move: the order ends beside the point', () => {
      const w = createMatch(['humains', 'humains']);
      const [tx, ty] = foot(w);
      const a = w.spawn('legionnaire', 0, (tx + 3) * FP + FP / 2, (ty + 1) * FP + FP / 2);
      const [x, y] = [tx * FP + FP / 2, ty * FP + 50];
      w.step([{ player: 0, kind: 'attack', ids: [a.id], x, y }]);
      for (let i = 0; i < 300 && a.order; i++) w.step([]);
      expect(a.order).toBeNull();
      expect(Math.hypot(a.x - x, a.y - y)).toBeLessThan(FP);
    });

    it('patrol: the unit still walks back and forth', () => {
      const w = createMatch(['humains', 'humains']);
      const [tx, ty] = foot(w);
      const a = w.spawn('legionnaire', 0, (tx + 3) * FP + FP / 2, (ty + 1) * FP + FP / 2);
      w.step([{ player: 0, kind: 'patrol', ids: [a.id], x: tx * FP + FP / 2, y: ty * FP + 50 }]);
      let far = 0;
      let back = 0;
      for (let i = 0; i < ticks(40); i++) {
        w.step([]);
        if (a.x < (tx + 1) * FP) far++;
        if (far && a.x > (tx + 3) * FP) back++;
      }
      expect(far).toBeGreaterThan(0);
      expect(back).toBeGreaterThan(0);
      expect(a.order?.kind).toBe('attackMove');
    });

    it('no building is placed on a tile at a cliff\'s foot, so no site to raise or to take root on lies in the band; one tile off it, a worker raises it', () => {
      const w = createMatch(['humains', 'humains']);
      const g = w.grid;
      const size = (DEFS.grenier as BuildingDef).size;
      const under = (tx: number, ty: number) => {
        for (let i = 0; i < size; i++) if (g.flatLevel(tx + i, ty) < 0 || g.level(tx + i, ty - 1) <= g.level(tx + i, ty)) return false;
        return true;
      };
      let feet = 0;
      let site: [number, number] | null = null;
      for (let ty = 3; ty < w.map.height - size - 3; ty++) {
        for (let tx = 2; tx < w.map.width - size - 2; tx++) {
          if (under(tx, ty)) {
            feet++;
            for (const type of ['grenier', 'branche']) expect(w.canPlace(type, tx, ty, 0), `${type} ${tx},${ty}`).toBe(false);
          }
          if (!site && under(tx, ty - 1) && w.canPlace('grenier', tx, ty, 0) && g.open(tx, ty + size)) site = [tx, ty];
        }
      }
      expect(feet).toBeGreaterThan(0);
      const [tx, ty] = site!;
      // From the strip between the site and the cliff: the side of the building nearest the band.
      const serf = w.spawn('serf', 0, (tx - 2) * FP + FP / 2, (ty - 1) * FP + FP / 2 + 200);
      w.players[0].minerals = 1000;
      w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'grenier', tx, ty }]);
      const raised = () => [...w.entities.values()].find((e) => e.type === 'grenier' && e.tx === tx && e.ty === ty);
      for (let i = 0; i < ticks(90) && !raised() && serf.order; i++) w.step([]);
      expect(raised()).toBeDefined();
    });
  });

  // Between two feet two tiles apart, a wide body has about a tenth of a tile to walk in: single file, and jams.
  // Alcoves in a cliff's edge are that wide here and there; no way a unit must take is.
  it('no map of the game needs a pass two tiles wide between two cliff feet: every field is reached without one', () => {
    for (const id of Object.keys(MAPS)) {
      const w = createMatch(['humains', 'humains'], undefined, id, MAPS[id].biomesOnly ? MAPS[id].biomes![0] : '');
      const g = w.grid;
      const { feet, sides } = g as unknown as { feet: Uint8Array; sides: Uint8Array };
      const W = w.map.width;
      const tight = new Uint8Array(W * w.map.height);
      for (let y = 0; y < w.map.height - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
          const i = y * W + x;
          // West foot here and east foot on the next tile, the side between them open; the same north to south.
          if (feet[i] & 8 && !(feet[i] & 2) && sides[i] & 2 && feet[i + 1] & 2 && !(feet[i + 1] & 8)) tight[i] = tight[i + 1] = 1;
          if (feet[i] & 1 && !(feet[i] & 4) && sides[i] & 4 && feet[i + W] & 4 && !(feet[i + W] & 1)) tight[i] = tight[i + W] = 1;
        }
      }
      // Every tile walked to from the first player's base (through buildings and fields), those passes shut.
      const from = [...w.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'unit')!;
      const seen = new Uint8Array(W * w.map.height);
      const todo = [Math.floor(from.y / FP) * W + Math.floor(from.x / FP)];
      seen[todo[0]] = 1;
      while (todo.length) {
        const t = todo.pop()!;
        const [x, y] = [t % W, Math.floor(t / W)];
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const n = (y + dy) * W + x + dx;
          if (!g.inside(x + dx, y + dy) || seen[n] || tight[n] || !g.canStep(x, y, x + dx, y + dy, true)) continue;
          seen[n] = 1;
          todo.push(n);
        }
      }
      let fields = 0;
      for (const e of w.entities.values()) {
        if (e.owner !== -1) continue;
        fields++;
        expect(seen[Math.floor(e.y / FP) * W + Math.floor(e.x / FP)], `${id}: ${e.type} at ${Math.floor(e.x / FP)},${Math.floor(e.y / FP)}`).toBe(1);
      }
      expect(fields, id).toBeGreaterThan(0);
    }
  });
});
