import { type GameMap, cornerLevels, cutCorner } from '../map';
import { FP, idiv, isqrt, tileOf } from './fixed';

/** Ground passability: cliffs from the map plus tiles blocked by buildings. */
export class Grid {
  readonly width: number;
  readonly height: number;
  /** Count of blockers per tile (buildings, resources). */
  readonly blocked: Uint8Array;
  private readonly corners: Int8Array;
  /** Tiles drawn with a diagonal cliff cut: walkable, but not buildable. */
  private readonly cut: Uint8Array;
  /** Chasms: never walkable nor buildable. */
  private readonly chasm: Uint8Array;
  /**
   * Per tile, the sides a ground unit may cross on terrain alone (bits 1 N, 2 E, 4 S, 8 W): the neighbour is on the
   * map, not a chasm, and their shared edge's corners are level. The terrain never changes in a game, so canStep's
   * terrain test is worked out once here (it was half the cost of a long path's search); buildings stay checked live.
   */
  private readonly sides: Uint8Array;

  constructor(map: GameMap) {
    this.width = map.width;
    this.height = map.height;
    this.blocked = new Uint8Array(map.width * map.height);
    this.corners = new Int8Array(map.width * map.height * 4);
    this.cut = new Uint8Array(map.width * map.height);
    this.chasm = map.chasm ?? new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        this.corners.set(cornerLevels(map, x, y), (y * map.width + x) * 4);
        this.cut[y * map.width + x] = cutCorner(map, x, y) >= 0 ? 1 : 0;
      }
    }
    this.sides = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (const [bit, dx, dy] of SIDES) if (this.terrainStep(x, y, x + dx, y + dy, true)) this.sides[y * map.width + x] |= bit;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  open(x: number, y: number): boolean {
    return this.inside(x, y) && this.blocked[y * this.width + x] === 0 && this.chasm[y * this.width + x] === 0;
  }

  /** Level of a flat, buildable tile, or -1 for a ramp or a cut cliff corner. */
  flatLevel(x: number, y: number): number {
    if (this.cut[y * this.width + x]) return -1;
    const c = (y * this.width + x) * 4;
    const l = this.corners[c];
    return this.corners[c + 1] === l && this.corners[c + 2] === l && this.corners[c + 3] === l ? l : -1;
  }

  /** Highest corner level of a tile: a cliff rising from its neighbour shows there. */
  topLevel(x: number, y: number): number {
    const c = (y * this.width + x) * 4;
    return Math.max(this.corners[c], this.corners[c + 1], this.corners[c + 2], this.corners[c + 3]);
  }

  /** Lowest corner level of a tile, for line-of-sight and fog. */
  level(x: number, y: number): number {
    const c = (y * this.width + x) * 4;
    return Math.min(this.corners[c], this.corners[c + 1], this.corners[c + 2], this.corners[c + 3]);
  }

  /**
   * Can a ground unit step between two adjacent tiles (8-neighbourhood, no corner cutting)?
   * `throughBuildings` ignores buildings (to walk out from under one) but never cliffs.
   */
  canStep(ax: number, ay: number, bx: number, by: number, throughBuildings = false): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    if (dx < -1 || dx > 1 || dy < -1 || dy > 1 || (dx === 0 && dy === 0) || !this.inside(ax, ay)) return this.terrainStep(ax, ay, bx, by, throughBuildings);
    const t = throughBuildings;
    if (dx === 0 || dy === 0) return this.side(ax, ay, dx, dy, t);
    return this.side(ax, ay, dx, 0, t) && this.side(bx, ay, 0, dy, t) && this.side(ax, ay, 0, dy, t) && this.side(ax, by, dx, 0, t);
  }

  /** One orthogonal step from an inside tile: its side open on terrain, and the tile beyond free (or `through`). */
  private side(x: number, y: number, dx: number, dy: number, through: boolean): boolean {
    const bit = dy === -1 ? 1 : dx === 1 ? 2 : dy === 1 ? 4 : 8;
    return (this.sides[y * this.width + x] & bit) !== 0 && (through || this.blocked[(y + dy) * this.width + x + dx] === 0);
  }

  /** canStep worked out from the tiles themselves (what `sides` holds; also any odd pair of tiles). */
  private terrainStep(ax: number, ay: number, bx: number, by: number, throughBuildings = false): boolean {
    // Leaving a blocked tile is allowed, so units caught under a new building can walk out.
    if (!this.inside(ax, ay) || !this.inside(bx, by) || this.chasm[by * this.width + bx] || (!throughBuildings && !this.open(bx, by))) return false;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx !== 0 && dy !== 0) {
      const t = throughBuildings;
      return this.terrainStep(ax, ay, bx, ay, t) && this.terrainStep(bx, ay, bx, by, t) && this.terrainStep(ax, ay, ax, by, t) && this.terrainStep(ax, by, bx, by, t);
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
  private cost = new Int32Array(0);
  private from = new Int32Array(0);
  private seen = new Int32Array(0);
  private done = new Int32Array(0);
  private search = 0;

  findPath(sx: number, sy: number, gx: number, gy: number): number[] {
    const w = this.width;
    const start = sy * w + sx;
    const goal = gy * w + gx;
    if (start === goal) return [];
    // Buffers kept between searches: a tile's cost counts only if it was set in this search (stamp).
    const n = w * this.height;
    if (this.cost.length !== n) [this.cost, this.from, this.seen, this.done] = [new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    const run = ++this.search;
    const { cost: g, from, seen, done } = this;
    const heap = new Heap();
    const h = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(Math.floor(i / w) - gy);
      return 10 * (dx + dy) - 6 * Math.min(dx, dy); // octile, costs 10 and 14
    };
    g[start] = 0;
    seen[start] = run;
    heap.push(h(start), start);
    let best = start;
    let bestH = h(start);
    while (heap.size > 0) {
      const cur = heap.pop();
      if (done[cur] === run) continue;
      done[cur] = run;
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
        if (seen[ni] === run && ng >= g[ni]) continue;
        seen[ni] = run;
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

/** canStep's sides: bit, and the step across it. */
const SIDES: [number, number, number][] = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
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
