import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP, dist, isqrt, tileOf } from './fixed';
import { Grid } from './grid';
import { type Command, World } from './world';

const map = createMap();
const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

describe('isqrt', () => {
  it('is exact around perfect squares', () => {
    for (const n of [0, 1, 2, 3, 4, 99, 100, 101, 2 ** 40 - 1, 2 ** 40]) {
      const r = isqrt(n);
      expect(r * r <= n && (r + 1) * (r + 1) > n).toBe(true);
    }
  });
});

describe('Grid', () => {
  const grid = new Grid(map);

  it('blocks walking straight off a cliff', () => {
    // Main plateau (level 2) east edge is x=24; x=25 at y=10 is level 1 without ramp.
    expect(grid.canStep(24, 10, 25, 10)).toBe(false);
  });

  it('lets units use a ramp', () => {
    expect(grid.canStep(24, 14, 25, 14)).toBe(true);
    expect(grid.canStep(25, 14, 26, 14)).toBe(true);
  });

  it('finds a path from the main base down to the centre, through every step legal', () => {
    const path = grid.findPath(14, 14, 47, 47);
    expect(path.length).toBeGreaterThan(30);
    let [x, y] = [14, 14];
    for (const t of path) {
      const nx = t % grid.width;
      const ny = Math.floor(t / grid.width);
      expect(grid.canStep(x, y, nx, ny)).toBe(true);
      [x, y] = [nx, ny];
    }
    expect([x, y]).toEqual([47, 47]);
  });

  it('goes to the closest reachable tile when the goal is blocked', () => {
    const g = new Grid(map);
    for (let y = 46; y <= 48; y++) for (let x = 46; x <= 48; x++) g.blocked[y * g.width + x] = 1;
    const path = g.findPath(14, 14, 47, 47);
    const end = path[path.length - 1];
    expect(Math.max(Math.abs((end % g.width) - 47), Math.abs(Math.floor(end / g.width) - 47))).toBe(2);
  });
});

function squad(world: World, owner: number, tx: number, ty: number, n: number) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = at(tx + (i % 3), ty + Math.floor(i / 3));
    ids.push(world.spawn('auxiliaire', owner, x, y).id);
  }
  return ids;
}

describe('World', () => {
  it('walks a unit from the main base to the centre', () => {
    const w = new World(map);
    const [id] = squad(w, 0, 14, 14, 1);
    const [x, y] = at(47, 47);
    w.step([{ player: 0, kind: 'move', ids: [id], x, y }]);
    for (let i = 0; i < 2000 && w.entities.get(id)!.order; i++) w.step([]);
    const e = w.entities.get(id)!;
    expect(e.order).toBeNull();
    expect(dist(e.x, e.y, x, y)).toBeLessThan(FP / 4);
  });

  it('never leaves a unit on a cliff it could not have climbed', () => {
    const w = new World(map);
    const ids = squad(w, 0, 12, 12, 9);
    const [x, y] = at(70, 30);
    w.step([{ player: 0, kind: 'move', ids, x, y }]);
    const prev = new Map(ids.map((id) => [id, [tileOf(w.entities.get(id)!.x), tileOf(w.entities.get(id)!.y)]]));
    for (let i = 0; i < 1500; i++) {
      w.step([]);
      for (const id of ids) {
        const e = w.entities.get(id)!;
        const [px, py] = prev.get(id)!;
        const [tx, ty] = [tileOf(e.x), tileOf(e.y)];
        // A tick can chain a move and a push: allow a legal two-step detour through an orthogonal neighbour.
        const g = w.grid;
        const legal = g.canStep(px, py, tx, ty) || (g.canStep(px, py, tx, py) && g.canStep(tx, py, tx, ty)) || (g.canStep(px, py, px, ty) && g.canStep(px, ty, tx, ty));
        if (tx !== px || ty !== py) expect(legal).toBe(true);
        prev.set(id, [tx, ty]);
      }
    }
    for (const id of ids) expect(w.entities.get(id)!.order).toBeNull();
  });

  it('separates units stacked on one spot', () => {
    const w = new World(map);
    const [x, y] = at(40, 60);
    const a = w.spawn('auxiliaire', 0, x, y);
    const b = w.spawn('auxiliaire', 0, x, y);
    for (let i = 0; i < 20; i++) w.step([]);
    expect(dist(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(a.radius + b.radius - 2);
  });

  it('ignores orders for units the player does not own', () => {
    const w = new World(map);
    const [id] = squad(w, 1, 40, 60, 1);
    const before = w.entities.get(id)!.x;
    w.step([{ player: 0, kind: 'move', ids: [id], ...xy(at(50, 60)) }]);
    for (let i = 0; i < 20; i++) w.step([]);
    expect(w.entities.get(id)!.x).toBe(before);
  });

  it('is deterministic', () => {
    const run = () => {
      const w = new World(map);
      const a = squad(w, 0, 12, 12, 12);
      const b = squad(w, 1, 80, 80, 12);
      const script: Record<number, Command[]> = {
        0: [{ player: 0, kind: 'move', ids: a, ...xy(at(48, 48)) }, { player: 1, kind: 'move', ids: b, ...xy(at(48, 48)) }],
        300: [{ player: 0, kind: 'move', ids: a.slice(0, 6), ...xy(at(30, 70)) }],
      };
      for (let t = 0; t < 800; t++) w.step(script[t] ?? []);
      return w.hash();
    };
    expect(run()).toBe(run());
  });
});

function xy([x, y]: readonly [number, number]) {
  return { x, y };
}
