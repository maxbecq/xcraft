import { type GameMap, cornerLevels } from '../map';
import { FP, idiv, isqrt, tileOf } from './fixed';

/** Ground passability: cliffs from the map plus tiles blocked by buildings. */
export class Grid {
  readonly width: number;
  readonly height: number;
  /** Count of blockers per tile (buildings, resources). */
  readonly blocked: Uint8Array;
  private readonly corners: Int8Array;

  constructor(map: GameMap) {
    this.width = map.width;
    this.height = map.height;
    this.blocked = new Uint8Array(map.width * map.height);
    this.corners = new Int8Array(map.width * map.height * 4);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) this.corners.set(cornerLevels(map, x, y), (y * map.width + x) * 4);
    }
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  open(x: number, y: number): boolean {
    return this.inside(x, y) && this.blocked[y * this.width + x] === 0;
  }

  /** Level of a flat tile, or -1 for a ramp. */
  flatLevel(x: number, y: number): number {
    const c = (y * this.width + x) * 4;
    const l = this.corners[c];
    return this.corners[c + 1] === l && this.corners[c + 2] === l && this.corners[c + 3] === l ? l : -1;
  }

  /** Lowest corner level of a tile, for line-of-sight and fog. */
  level(x: number, y: number): number {
    const c = (y * this.width + x) * 4;
    return Math.min(this.corners[c], this.corners[c + 1], this.corners[c + 2], this.corners[c + 3]);
  }

  /** Can a ground unit step between two adjacent tiles (8-neighbourhood, no corner cutting)? */
  canStep(ax: number, ay: number, bx: number, by: number): boolean {
    // Leaving a blocked tile is allowed, so units caught under a new building can walk out.
    if (!this.open(bx, by) || !this.inside(ax, ay)) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx !== 0 && dy !== 0) {
      return this.canStep(ax, ay, bx, ay) && this.canStep(bx, ay, bx, by) && this.canStep(ax, ay, ax, by) && this.canStep(ax, by, bx, by);
    }
    // Tiles connect when the corners along their shared edge are at the same level.
    const a = (ay * this.width + ax) * 4;
    const b = (by * this.width + bx) * 4;
    const c = this.corners;
    if (dy === -1) return c[a] === c[b + 3] && c[a + 1] === c[b + 2];
    if (dy === 1) return c[a + 3] === c[b] && c[a + 2] === c[b + 1];
    if (dx === 1) return c[a + 1] === c[b] && c[a + 2] === c[b + 3];
    if (dx === -1) return c[a] === c[b + 1] && c[a + 3] === c[b + 2];
    return true;
  }

  /** Can a unit walk in a straight line between two fixed-point points? */
  lineWalkable(ax: number, ay: number, bx: number, by: number): boolean {
    const len = isqrt((bx - ax) ** 2 + (by - ay) ** 2);
    const n = Math.max(1, Math.ceil(len / (FP / 4)));
    let tx = tileOf(ax);
    let ty = tileOf(ay);
    for (let i = 1; i <= n; i++) {
      const nx = tileOf(ax + idiv((bx - ax) * i, n));
      const ny = tileOf(ay + idiv((by - ay) * i, n));
      if (nx === tx && ny === ty) continue;
      if (Math.abs(nx - tx) > 1 || Math.abs(ny - ty) > 1 || !this.canStep(tx, ty, nx, ny)) return false;
      tx = nx;
      ty = ny;
    }
    return true;
  }

  /**
   * A* over tiles, from a tile to the reachable tile closest to the goal.
   * Returns tile indices from start (excluded) to the end tile.
   */
  findPath(sx: number, sy: number, gx: number, gy: number): number[] {
    const w = this.width;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    if (start === goal) return [];
    const g = new Int32Array(w * this.height).fill(-1);
    const from = new Int32Array(w * this.height).fill(-1);
    const closed = new Uint8Array(w * this.height);
    const heap = new Heap();
    const h = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(Math.floor(i / w) - gy);
      return 10 * (dx + dy) - 6 * Math.min(dx, dy); // octile, costs 10 and 14
    };
    g[start] = 0;
    heap.push(h(start), start);
    let best = start;
    let bestH = h(start);
    while (heap.size > 0) {
      const cur = heap.pop();
      if (closed[cur]) continue;
      closed[cur] = 1;
      const hc = h(cur);
      if (hc < bestH) {
        best = cur;
        bestH = hc;
      }
      if (cur === goal) break;
      const cx = cur % w;
      const cy = Math.floor(cur / w);
      for (let d = 0; d < 8; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (!this.canStep(cx, cy, nx, ny)) continue;
        const ni = ny * w + nx;
        const ng = g[cur] + (d < 4 ? 10 : 14);
        if (g[ni] !== -1 && ng >= g[ni]) continue;
        g[ni] = ng;
        from[ni] = cur;
        heap.push(ng + h(ni), ni);
      }
    }
    const path: number[] = [];
    for (let i = best; i !== start; i = from[i]) path.push(i);
    return path.reverse();
  }

  /** Nearest open tile to (x, y), searching outward in rings; prefers tiles at `level` (so a target on a cliff is approached from the top). */
  nearestOpen(x: number, y: number, level = -1): [number, number] {
    let fallback: [number, number] | null = null;
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.open(x + dx, y + dy)) continue;
          if (level < 0 || this.level(x + dx, y + dy) === level) return [x + dx, y + dy];
          fallback ??= [x + dx, y + dy];
        }
      }
      if (fallback && r >= 6) return fallback;
    }
    return fallback ?? [x, y];
  }
}

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/** Min-heap of (priority, value); ties pop in insertion order, so results are deterministic. */
class Heap {
  private readonly items: [number, number, number][] = [];
  private seq = 0;
  get size(): number {
    return this.items.length;
  }
  push(priority: number, value: number): void {
    const a = this.items;
    a.push([priority, this.seq++, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): number {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top[2];
  }
}

const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
