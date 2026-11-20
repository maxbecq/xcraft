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
  /**
   * Per tile, the eight steps (bit d: DX[d], DY[d]) that terrain alone allows (canStep through buildings): findPath
   * then only checks the tiles a step crosses for buildings, the very test canStep makes.
   */
  private readonly steps: Uint8Array;
  /** Each tile's lowest corner level (level(), on the map), worked out once: vision asks it for every tile it reveals. */
  readonly lowest: Int8Array;

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
    this.lowest = new Int8Array(map.width * map.height);
    for (let i = 0; i < this.lowest.length; i++) this.lowest[i] = Math.min(this.corners[i * 4], this.corners[i * 4 + 1], this.corners[i * 4 + 2], this.corners[i * 4 + 3]);
    this.sides = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (const [bit, dx, dy] of SIDES) if (this.terrainStep(x, y, x + dx, y + dy, true)) this.sides[y * map.width + x] |= bit;
    this.steps = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (let d = 0; d < 8; d++) if (this.canStep(x, y, x + DX[d], y + DY[d], true)) this.steps[y * map.width + x] |= 1 << d;
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
  private readonly heap = new Heap();

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
    const heap = this.heap;
    heap.clear();
    const { steps, blocked } = this;
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
      const open = steps[cur];
      for (let d = 0; d < 8; d++) {
        if (!(open & (1 << d))) continue;
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        const ni = ny * w + nx;
        // canStep's buildings: the tile stepped onto, and for a diagonal the two it passes between.
        if (blocked[ni] !== 0 || (d >= 4 && (blocked[cy * w + nx] !== 0 || blocked[ny * w + cx] !== 0))) continue;
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

/**
 * Min-heap of (priority, value); ties pop in insertion order, so results are deterministic. In typed arrays kept from
 * one search to the next (an array per entry made garbage at every push); the same order as ever.
 */
class Heap {
  private pri = new Int32Array(1024);
  private ord = new Int32Array(1024);
  private val = new Int32Array(1024);
  size = 0;
  private seq = 0;

  /** Empty again, insertion order counted from 0, as a new heap. */
  clear(): void {
    this.size = this.seq = 0;
  }

  private less(i: number, j: number): boolean {
    return this.pri[i] < this.pri[j] || (this.pri[i] === this.pri[j] && this.ord[i] < this.ord[j]);
  }

  private move(from: number, to: number): void {
    this.pri[to] = this.pri[from];
    this.ord[to] = this.ord[from];
    this.val[to] = this.val[from];
  }

  push(priority: number, value: number): void {
    if (this.size === this.pri.length) {
      const grow = (a: Int32Array) => {
        const b = new Int32Array(a.length * 2);
        b.set(a);
        return b;
      };
      [this.pri, this.ord, this.val] = [grow(this.pri), grow(this.ord), grow(this.val)];
    }
    // Sift up with a hole: the new entry is written once, where it lands.
    const { pri, ord } = this;
    const o = this.seq++;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!(priority < pri[p] || (priority === pri[p] && o < ord[p]))) break;
      this.move(p, i);
      i = p;
    }
    pri[i] = priority;
    ord[i] = o;
    this.val[i] = value;
  }

  pop(): number {
    const top = this.val[0];
    const last = --this.size;
    if (last > 0) {
      // Sift the last entry down from the root, with a hole.
      const { pri, ord, val } = this;
      const [lp, lo, lv] = [pri[last], ord[last], val[last]];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= last) break;
        const r = l + 1;
        const m = r < last && this.less(r, l) ? r : l;
        if (!(pri[m] < lp || (pri[m] === lp && ord[m] < lo))) break;
        this.move(m, i);
        i = m;
      }
      pri[i] = lp;
      ord[i] = lo;
      val[i] = lv;
    }
    return top;
  }
}
