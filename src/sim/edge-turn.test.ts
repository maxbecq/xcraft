import { describe, expect, it, vi } from 'vitest';
import { DEFS, type BuildingDef } from '../data';
import { CORNERS } from '../maps';
import { type Dir, type GameMap, rotateFootprint } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

/**
 * Scenes on a tile's edge, played from the four quarter turns of a small map (point 122). Each turn is the last one
 * turned a quarter round: tile (x, y) goes to (N - 1 - y, x), a point (x, y) to (S - y, x). Played back in the first
 * frame, every turn must end the same.
 */
const N = 16;
const turnPoint = (x: number, y: number, q: number, n = N): [number, number] => {
  for (let k = 0; k < q; k++) [x, y] = [n * FP - y, x];
  return [x, y];
};
const turnTile = (x: number, y: number, q: number, n = N): [number, number] => {
  for (let k = 0; k < q; k++) [x, y] = [n - 1 - y, x];
  return [x, y];
};
/** A flat map `n` tiles wide, with tiles set to level 1 (`high`), turned `q` quarters. */
function turnedMap(q: number, high: (x: number, y: number) => boolean, n = N): GameMap {
  const level = new Uint8Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (high(x, y)) {
        const [tx, ty] = turnTile(x, y, q, n);
        level[ty * n + tx] = 1;
      }
  return { width: n, height: n, level, ramp: new Array<Dir | null>(n * n).fill(null), rampStep: new Uint8Array(n * n) };
}
/** A Serf sent from `from` to `to` (points in tiles) from each quarter turn: its positions every half second, turned back. */
function moveTurned(n: number, high: (x: number, y: number) => boolean, from: [number, number], to: [number, number], seconds: number): [number, number][][] {
  return [0, 1, 2, 3].map((q) => {
    const w = new World(turnedMap(q, high, n), 2);
    const u = w.spawn('serf', 0, ...turnPoint(Math.round(from[0] * FP), Math.round(from[1] * FP), q, n));
    const [gx, gy] = turnPoint(Math.round(to[0] * FP), Math.round(to[1] * FP), q, n);
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: gx, y: gy }]);
    const track: [number, number][] = [];
    while (w.tick < ticks(seconds)) {
      w.step([]);
      if (w.tick % ticks(0.5) === 0) track.push(turnPoint(u.x, u.y, (4 - q) % 4, n));
    }
    return track;
  });
}

describe('a move whose goal shares a tile edge with its start', () => {
  it('ends the same from the four quarter turns (Codex: one turn stopped seven tiles short)', () => {
    // A plateau with no ramp on x 8..13, y 6..12: the goal (8, 12.5) is on its west edge, the start (8, 4) on the same line.
    const ends = [0, 1, 2, 3].map((q) => {
      const w = new World(turnedMap(q, (x, y) => x >= 8 && x <= 13 && y >= 6 && y <= 12), 2);
      const u = w.spawn('serf', 0, ...turnPoint(8 * FP, 4 * FP, q));
      const [gx, gy] = turnPoint(8 * FP, 12 * FP + FP / 2, q);
      w.step([{ player: 0, kind: 'move', ids: [u.id], x: gx, y: gy }]);
      while (w.tick < ticks(20)) w.step([]);
      return turnPoint(u.x, u.y, (4 - q) % 4);
    });
    for (const [x, y] of ends) expect(Math.hypot(x - 8 * FP, y - (12 * FP + FP / 2))).toBeLessThan(FP);
    for (const e of ends.slice(1)) expect(e).toEqual(ends[0]);
  });

  // Codex, 2026-11-27: start and goal in the same tile of the side kept, the path empty; its end taken by floor was the
  // other side's tile, so the order was done on the spot at 180° and 270°.
  it('makes a short move along the edge from the four quarter turns', () => {
    const tracks = moveTurned(N, () => false, [8, 4.25], [8, 4.75], 2);
    for (const t of tracks) expect(Math.hypot(t[t.length - 1][0] - 8 * FP, t[t.length - 1][1] - 4.75 * FP)).toBeLessThan(FP / 8);
    for (const t of tracks.slice(1)) expect(t).toEqual(tracks[0]);
  });

  // Codex, 2026-11-27: the first side tried lent its path to the second, one tile longer then: the way round a block
  // across the edge went left or right with the turn.
  it('goes round a block across the edge on the same side from the four quarter turns', () => {
    const tracks = moveTurned(40, (x, y) => x >= 19 && x <= 20 && y >= 12 && y <= 20, [20, 4.5], [20, 32.5], 20);
    for (const t of tracks.slice(1)) expect(t).toEqual(tracks[0]);
  });

  it('searches once when both sides fall on the map edge column (Codex, 2026-11-27)', () => {
    const w = new World(turnedMap(0, () => false), 2);
    const u = w.spawn('serf', 0, 0, 4 * FP + FP / 2);
    const find = vi.spyOn(w.grid, 'findPath');
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: 0, y: 10 * FP + FP / 2 }]);
    expect(find).toHaveBeenCalledTimes(1);
  });

  // Codex final, 2026-11-27: a group on an edge kept searching both sides, each unit apart: 24 searches for 12 Serfs.
  it('lets a group on one edge share its road: 12 Serfs, two searches', () => {
    const w = new World(turnedMap(0, () => false, 80), 2);
    const ids = Array.from({ length: 12 }, (_, k) => w.spawn('serf', 0, 20 * FP, (4 + k) * FP + FP / 2).id);
    const find = vi.spyOn(w.grid, 'findPath');
    w.step([{ player: 0, kind: 'move', ids, x: 20 * FP, y: 70 * FP + FP / 2 }]);
    expect(find.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('a move starting on a tile edge, its goal elsewhere', () => {
  // Codex final, 2026-11-27: on a cliff's edge, floor put the Serf on top at 0° and 90° (stopped at the far edge), at
  // the foot at 180° and 270° (went round).
  it('ends the same from the four quarter turns, beside a plateau', () => {
    const tracks = moveTurned(N, (x, y) => x >= 8 && x <= 10 && y >= 3 && y <= 6, [8, 4.5], [12.5, 4.5], 20);
    for (const t of tracks.slice(1)) expect(t[t.length - 1]).toEqual(tracks[0][t.length - 1]);
    const [x, y] = tracks[0][tracks[0].length - 1];
    expect(Math.hypot(x - 12.5 * FP, y - 4.5 * FP)).toBeLessThan(FP);
  });
});

describe('the Couloir temporel on a tile edge', () => {
  it('lets a walker out on the same side from the four quarter turns (Codex: x 20.5, turned round 19.5)', () => {
    const M = 64;
    const T = M * FP;
    const turn = (x: number, y: number, q: number): [number, number] => {
      for (let k = 0; k < q; k++) [x, y] = [T - y, x];
      return [x, y];
    };
    const outs = [0, 1, 2, 3].map((q) => {
      const w = new World({ width: M, height: M, level: new Uint8Array(M * M), ramp: new Array<Dir | null>(M * M).fill(null), rampStep: new Uint8Array(M * M) }, 2);
      w.players[0].faction = 'isdaris';
      w.players[0].upgrades.couloir = 1;
      const a = Object.assign(w.spawn('espion', 0, ...turn(20 * FP, 20 * FP, q)), { mana: 1 << 30 });
      const b = w.spawn('espion', 0, ...turn(20 * FP, 40 * FP, q));
      w.castAt(a, 'couloir', b.x, b.y);
      const u = w.spawn('discobole', 0, ...turn(22 * FP, 18 * FP, q));
      w.step([{ player: 0, kind: 'smart', ids: [u.id], x: a.x, y: a.y, target: a.id }]);
      while (w.tick < ticks(4) && w.tunnelOf(a)?.crossed !== 1) w.step([]);
      expect(w.tunnelOf(a)?.crossed).toBe(1);
      return turn(u.x, u.y, (4 - q) % 4);
    });
    for (const o of outs.slice(1)) expect(o).toEqual(outs[0]);
  });
});

describe('the Couloir temporel between two Espions on one point', () => {
  // Codex final, 2026-11-27: no way from one Espion to the other, the walker came out south, in the scene's own frame.
  it('lets a walker out on the same side from the four quarter turns', () => {
    const M = 64;
    const outs = [0, 1, 2, 3].map((q) => {
      const w = new World(turnedMap(q, () => false, M), 2);
      w.players[0].faction = 'isdaris';
      w.players[0].upgrades.couloir = 1;
      const a = Object.assign(w.spawn('espion', 0, ...turnPoint(30 * FP, 30 * FP + FP / 2, q, M)), { mana: 1 << 30 });
      const b = w.spawn('espion', 0, a.x, a.y);
      w.tunnels.push({ owner: 0, a: a.id, b: b.id, left: 1000, crossed: 0, supply: 0 });
      const u = w.spawn('discobole', 0, ...turnPoint(31 * FP, 29 * FP + FP / 2, q, M));
      w.step([{ player: 0, kind: 'smart', ids: [u.id], x: a.x, y: a.y, target: a.id }]);
      while (w.tick < ticks(4) && w.tunnelOf(a)?.crossed !== 1) w.step([]);
      expect(w.tunnelOf(a)?.crossed).toBe(1);
      return turnPoint(u.x, u.y, (4 - q) % 4, M);
    });
    for (const o of outs.slice(1)) expect(o).toEqual(outs[0]);
  });
});

describe('a worker caught at the very middle of an odd map', () => {
  it("walks off toward its own start, turned with each owner's corner (Codex: north for every owner)", () => {
    const M = 65;
    const C = (M * FP) / 2;
    const size = (DEFS.conseil as BuildingDef).size;
    const sites = [0, 1, 2, 3].map((turn) => ({ hq: rotateFootprint(M, 4, 4, size, turn), turn, start: true }));
    const w = new World({ width: M, height: M, level: new Uint8Array(M * M), ramp: new Array<Dir | null>(M * M).fill(null), rampStep: new Uint8Array(M * M), sites }, 4);
    // Owner p plays the corner CORNERS[p] quarter turns from the first.
    const exits = [0, 1, 2, 3].map((owner) => {
      for (const e of [...w.entities.values()]) w.entities.delete(e.id);
      // Spawned by its top-left tile: centred on the map's middle tile.
      const half = ((DEFS.forge as BuildingDef).size - 1) / 2;
      const forge = w.spawn('forge', owner, (32 - half) * FP, (32 - half) * FP);
      expect([forge.x, forge.y]).toEqual([C, C]);
      const serf = w.spawn('serf', owner, C, C);
      while (w.tick < ticks(2) + owner * ticks(2) && w.caught(serf)) w.step([]);
      expect(w.caught(serf)).toBe(false);
      return turnPoint65(serf.x, serf.y, (4 - CORNERS[owner]) % 4);
    });
    for (const x of exits.slice(1)) expect(x).toEqual(exits[0]);
    function turnPoint65(x: number, y: number, q: number): [number, number] {
      for (let k = 0; k < q; k++) [x, y] = [M * FP - y, x];
      return [x, y];
    }
  });
});

describe('a worker caught at the middle of an even map', () => {
  // Codex, 2026-11-27: the serf at the corner (8, 8) of four blocked tiles, (7, 6) blocked too, its start centred on
  // (4, 4): two ways out stayed as near that start, and the first step went north-east or south-west with the turn.
  it('walks off the same way from the four quarter turns', () => {
    const size = (DEFS.conseil as BuildingDef).size;
    const steps = [0, 1, 2, 3].map((q) => {
      const map = turnedMap(q, () => false);
      map.sites = [{ hq: rotateFootprint(N, 4 - size / 2, 4 - size / 2, size, q), turn: 0, start: true }];
      const w = new World(map, 2);
      for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8], [7, 6]]) {
        const [tx, ty] = turnTile(x, y, q);
        w.grid.blocked[ty * N + tx] = 1;
      }
      const serf = w.spawn('serf', 0, ...turnPoint(8 * FP, 8 * FP, q));
      const track: [number, number][] = [];
      for (let k = 0; k < 10; k++) {
        w.step([]);
        track.push(turnPoint(serf.x, serf.y, (4 - q) % 4));
      }
      return track;
    });
    expect(steps[0][9]).not.toEqual([8 * FP, 8 * FP]);
    for (const s of steps.slice(1)) expect(s).toEqual(steps[0]);
  });
});

describe('a Jörmungand called at the very centre of an even map', () => {
  // Codex, 2026-11-27: spawned on the point and placed there, no way to weigh the four tiles by: north-west whatever
  // the turn. The way from Thor to the point now turns with the scene.
  it('comes out on the same tile from the four quarter turns', () => {
    const M = 32;
    const outs = [0, 1, 2, 3].map((q) => {
      const w = new World(turnedMap(q, () => false, M), 2);
      w.players[0].faction = 'dieux';
      w.players[0].ultimates = { scandinave: 1 << 30 } as never;
      const thor = Object.assign(w.spawn('thor', 0, ...turnPoint(10 * FP + FP / 2, 13 * FP + FP / 2, q, M)), { mana: 1 << 30 });
      const [cx, cy] = turnPoint(16 * FP, 16 * FP, q, M);
      w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'jormungand', x: cx, y: cy }]);
      const j = [...w.entities.values()].find((e) => e.type === 'jormungandr');
      expect(j).toBeDefined();
      return turnPoint(j!.x, j!.y, (4 - q) % 4, M);
    });
    for (const o of outs.slice(1)) expect(o).toEqual(outs[0]);
  });
});

describe('a Jörmungand called on a Forge at the very centre of an odd map', () => {
  // Codex final, 2026-11-27: the point's tile blocked, nearestOpen took the first of its ring in scan order before
  // the cast's way could count: north, west, south, east with the turn.
  it('comes out on the same tile from the four quarter turns', () => {
    const M = 65;
    const half = ((DEFS.forge as BuildingDef).size - 1) / 2;
    const outs = [0, 1, 2, 3].map((q) => {
      const w = new World(turnedMap(q, () => false, M), 2);
      w.players[0].faction = 'dieux';
      w.players[0].ultimates = { scandinave: 1 << 30 } as never;
      w.spawn('forge', 1, (32 - half) * FP, (32 - half) * FP);
      const thor = Object.assign(w.spawn('thor', 0, ...turnPoint(27 * FP + FP / 2, 30 * FP + FP / 2, q, M)), { mana: 1 << 30 });
      const [cx, cy] = turnPoint(32 * FP + FP / 2, 32 * FP + FP / 2, q, M);
      w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'jormungand', x: cx, y: cy }]);
      const j = [...w.entities.values()].find((e) => e.type === 'jormungandr');
      expect(j).toBeDefined();
      return turnPoint(j!.x, j!.y, (4 - q) % 4, M);
    });
    for (const o of outs.slice(1)) expect(o).toEqual(outs[0]);
  });
});
