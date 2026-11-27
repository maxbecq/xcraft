import { describe, expect, it } from 'vitest';
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
const S = N * FP;
const turnPoint = (x: number, y: number, q: number): [number, number] => {
  for (let k = 0; k < q; k++) [x, y] = [S - y, x];
  return [x, y];
};
const turnTile = (x: number, y: number, q: number): [number, number] => {
  for (let k = 0; k < q; k++) [x, y] = [N - 1 - y, x];
  return [x, y];
};
/** A flat map, with tiles set to level 1 (`high`), turned `q` quarters. */
function turnedMap(q: number, high: (x: number, y: number) => boolean): GameMap {
  const level = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++)
      if (high(x, y)) {
        const [tx, ty] = turnTile(x, y, q);
        level[ty * N + tx] = 1;
      }
  return { width: N, height: N, level, ramp: new Array<Dir | null>(N * N).fill(null), rampStep: new Uint8Array(N * N) };
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
