import { CLIFF_FOOT, type GameMap, SUB, cornerLevels, cutCorner } from '../map';
import { FP, isqrt, tileOf } from './fixed';

/** Ground passability: cliffs from the map plus tiles blocked by buildings. */
export class Grid {
  readonly width: number;
  readonly height: number;
  /** Count of blockers per tile (buildings, resources). */
  readonly blocked: Uint8Array;
  /** How many times `blocked` changed (a building put or gone, an energy wall up or down): what was worked out from
   * the grid (a road found, a tile found open) holds while this stays the same. Counted where `blocked` is written. */
  changes = 0;
  private readonly corners: Int8Array;
  /** Tiles drawn with a diagonal cliff cut: walkable, but not buildable. The corner cut away + 1 (cutCorner), 0 for none. */
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
  /**
   * Per tile, the sides at a cliff's foot (bits 1 N, 2 E, 4 S, 8 W: the ground beyond rises half a level or more) and
   * the corners under a plateau across the diagonal (bits 16 NW, 32 NE, 64 SE, 128 SW): see keepOff.
   */
  private readonly feet: Uint8Array;
  /**
   * The same for a socle with the Patte ultramécanique (équilibreur 22/11), which climbs cliffs up or down like a
   * Colossus: any step onto a tile of the map that is not a chasm, whatever the levels.
   */
  private readonly climbs: Uint8Array;
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
        this.cut[y * map.width + x] = cutCorner(map, x, y) + 1;
      }
    }
    this.lowest = new Int8Array(map.width * map.height);
    for (let i = 0; i < this.lowest.length; i++) this.lowest[i] = Math.min(this.corners[i * 4], this.corners[i * 4 + 1], this.corners[i * 4 + 2], this.corners[i * 4 + 3]);
    this.feet = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) this.feet[y * map.width + x] = this.footOf(x, y);
    this.sides = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (const [bit, dx, dy] of SIDES) if (this.terrainStep(x, y, x + dx, y + dy, true)) this.sides[y * map.width + x] |= bit;
    this.steps = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (let d = 0; d < 8; d++) if (this.canStep(x, y, x + DX[d], y + DY[d], true)) this.steps[y * map.width + x] |= 1 << d;
    this.climbs = new Uint8Array(map.width * map.height);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        for (let d = 0; d < 8; d++) if (this.climbStep(x, y, x + DX[d], y + DY[d], true)) this.climbs[y * map.width + x] |= 1 << d;
  }

  /** A climber's step (Patte ultramécanique): onto a tile of the map, no chasm, free (or `through`); a diagonal too
   * through its two sides, as canStep. */
  private climbStep(ax: number, ay: number, bx: number, by: number, through: boolean): boolean {
    const ok = (x: number, y: number) => this.inside(x, y) && this.chasm[y * this.width + x] === 0 && (through || this.blocked[y * this.width + x] === 0);
    if (!ok(bx, by) || Math.abs(bx - ax) > 1 || Math.abs(by - ay) > 1) return false;
    return ax === bx || ay === by || (ok(bx, ay) && ok(ax, by));
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  open(x: number, y: number): boolean {
    return this.inside(x, y) && this.blocked[y * this.width + x] === 0 && this.chasm[y * this.width + x] === 0;
  }

  /** The cliff feet of a tile (see `feet`): sides and corners where the ground beyond stands higher. */
  private footOf(x: number, y: number): number {
    if (!this.inside(x, y) || this.chasm[y * this.width + x] || this.cut[y * this.width + x]) return 0;
    const c = this.corners;
    const at = (tx: number, ty: number, k: number) => c[(ty * this.width + tx) * 4 + k];
    const beyond = (tx: number, ty: number) => this.inside(tx, ty) && !this.chasm[ty * this.width + tx];
    // A diagonal cliff's cut corner is drawn as low ground, its wall without a band: no foot beside it.
    const cutAt = (tx: number, ty: number, k: number) => this.cut[ty * this.width + tx] === k + 1;
    let f = 0;
    // A side: the two corners beyond it both as high or higher, half a level higher between them.
    for (const [bit, dx, dy, a1, a2, b1, b2] of FOOT_SIDES) {
      const [nx, ny] = [x + dx, y + dy];
      if (!beyond(nx, ny) || cutAt(nx, ny, b1) || cutAt(nx, ny, b2)) continue;
      const [p, q, u, v] = [at(x, y, a1), at(x, y, a2), at(nx, ny, b1), at(nx, ny, b2)];
      if (u >= p && v >= q && u + v - p - q >= SUB) f |= bit;
    }
    // A corner: the diagonal tile's corner there half a level higher than this tile's.
    for (const [bit, dx, dy, a, b] of FOOT_CORNERS) if (beyond(x + dx, y + dy) && !cutAt(x + dx, y + dy, b) && 2 * (at(x + dx, y + dy, b) - at(x, y, a)) >= SUB) f |= bit;
    return f;
  }

  /** A tile between two cliff feet facing each other: no ground unit's body fits there, so no path goes through it. */
  private narrow(x: number, y: number): boolean {
    const f = this.inside(x, y) ? this.feet[y * this.width + x] : 0;
    return (f & 5) === 5 || (f & 10) === 10;
  }

  /**
   * A body of radius `r` (fixed point) at (x, y), moved inside its own tile so it stays clear of the cliffs: at a cliff's
   * foot it keeps out of the band CLIFF_FOOT wide where the rock's slope is drawn (équilibreur 22/11, units sunk in the
   * cliffs), and off any other side no ground unit crosses (a cliff's top, a chasm, the map's edge) and a plateau's
   * corner across the diagonal. Only the centre is tested against the terrain when moving. `r` counts up to just under
   * half a tile (gods included), so a pass three tiles wide stays open to every unit. Buildings are not counted.
   */
  keepOff(x: number, y: number, r: number): [number, number] {
    const tx = tileOf(x);
    const ty = tileOf(y);
    if (r <= 0 || !this.inside(tx, ty) || this.cut[ty * this.width + tx]) return [x, y];
    const c = Math.min(r, KEEP_OFF);
    const i = ty * this.width + tx;
    const s = this.sides[i];
    const f = this.feet[i];
    const x0 = tx * FP;
    const y0 = ty * FP;
    const off = (bit: number) => (f & bit ? FOOT + c : s & bit ? 0 : c);
    // Along one axis, between its low side's clearance `lo` and its high side's `hi`. Where both do not fit: off the
    // foot if only one side is one (the other a cliff's top, a chasm or the map's edge: the body overhangs that, the
    // rock is not walked into), the middle between two feet (a tile no path takes, see narrow).
    const axis = (v: number, v0: number, lo: number, hi: number, footLo: boolean, footHi: boolean) => {
      if (lo + hi < FP) return Math.min(Math.max(v, v0 + lo), v0 + FP - hi);
      return footLo === footHi ? v0 + FP / 2 : footLo ? v0 + lo : v0 + FP - hi;
    };
    const sides = () => {
      x = axis(x, x0, off(8), off(2), (f & 8) !== 0, (f & 2) !== 0);
      y = axis(y, y0, off(1), off(4), (f & 1) !== 0, (f & 4) !== 0);
    };
    sides();
    // Corners, once off the sides: under a plateau (its foot's band), or a plateau's corner across the diagonal (both
    // own sides open, the diagonal step not): pushed straight away from it, then kept off the sides again. The one
    // reached deepest first, not in the corners' fixed order: two pushes do not commute, and the map turned round must
    // give the turned point (a scene and its mirror).
    const pushes: [number, number, number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const [dx, dy] = CORNERS[k];
      const foot = (f & (16 << k)) !== 0;
      if (!foot && (!(s & (dx < 0 ? 8 : 2)) || !(s & (dy < 0 ? 1 : 4)) || this.steps[i] & (1 << DIR[(dy + 1) * 3 + dx + 1]))) continue;
      const m = foot ? FOOT + c : c;
      const cx = dx < 0 ? x0 : x0 + FP;
      const cy = dy < 0 ? y0 : y0 + FP;
      const d = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d < m) pushes.push([m - d, k, cx, cy]);
    }
    pushes.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
    for (const [, k, cx, cy] of pushes) {
      const m = (f & (16 << k)) !== 0 ? FOOT + c : c;
      const d = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d >= m) continue;
      if (d === 0) [x, y] = [cx - CORNERS[k][0] * m, cy - CORNERS[k][1] * m];
      else [x, y] = [cx + Math.trunc(((x - cx) * m) / d), cy + Math.trunc(((y - cy) * m) / d)];
    }
    if (pushes.length) sides();
    return [x, y];
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
  canStep(ax: number, ay: number, bx: number, by: number, throughBuildings = false, climb = false): boolean {
    if (climb) return this.climbStep(ax, ay, bx, by, throughBuildings);
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
    // Between two cliff feet facing each other no body fits (keepOff): never stepped into.
    if (this.narrow(bx, by)) return false;
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
  lineWalkable(ax: number, ay: number, bx: number, by: number, climb = false): boolean {
    // A climber's lines are not kept (few walk so).
    if (climb) return this.line(ax, ay, bx, by, true);
    // Between two tile centres the answer is kept while the grid stays as it was (`changes`): smoothing a path asks
    // for the same lines again and again, from each waypoint to every one after it, and every unit of a group sent
    // along one path asked for them all over (15 ms of a tick for a dozen units). The same answer, only not worked out twice.
    const half = FP / 2;
    // Only inside the map: a centre past its right or bottom edge would share its key with a tile of the next row.
    const [mx, my] = [this.width * FP, this.height * FP];
    if (ax % FP !== half || ay % FP !== half || bx % FP !== half || by % FP !== half || ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= mx || ay >= my || bx >= mx || by >= my) return this.line(ax, ay, bx, by);
    if (this.linesAt !== this.changes || this.lines.size > 400_000) {
      this.linesAt = this.changes;
      this.lines.clear();
    }
    const n = this.width * this.height;
    const key = (Math.floor(ay / FP) * this.width + Math.floor(ax / FP)) * n + Math.floor(by / FP) * this.width + Math.floor(bx / FP);
    let ok = this.lines.get(key);
    if (ok === undefined) this.lines.set(key, (ok = this.line(ax, ay, bx, by)));
    return ok;
  }
  private readonly lines = new Map<number, boolean>();
  private linesAt = -1;

  private line(ax: number, ay: number, bx: number, by: number, climb = false): boolean {
    // A start on a tile edge lies in the tile ahead along that axis, or, not moving along it, in both (both must do).
    const starts = (a: number, b: number) => (a % FP !== 0 ? [tileOf(a)] : b > a ? [a / FP] : b < a ? [a / FP - 1] : [a / FP - 1, a / FP]);
    for (const tx of starts(ax, bx)) for (const ty of starts(ay, by)) if (!this.walkLine(ax, ay, bx, by, tx, ty, climb)) return false;
    return true;
  }

  /**
   * lineWalkable from a start tile. Samples on a tile edge stay in the tile they come from: floor put them beyond it
   * on one side of the map and short of it on the other, and a line and its mirror were judged differently.
   */
  private walkLine(ax: number, ay: number, bx: number, by: number, tx: number, ty: number, climb = false): boolean {
    const len = isqrt((bx - ax) ** 2 + (by - ay) ** 2);
    const n = Math.max(1, Math.ceil(len / (FP / 4)));
    const [ddx, ddy, w] = [bx - ax, by - ay, this.width];
    const mask = climb ? this.climbs : this.steps;
    // tileOf and idiv written out, and each step tested as findPath does (terrain mask, then buildings): this runs
    // four times a tile along every line a path is smoothed with.
    for (let i = 1; i <= n; i++) {
      const sx = ax + Math.trunc((ddx * i) / n);
      const sy = ay + Math.trunc((ddy * i) / n);
      const nx = sx % FP === 0 ? tx : Math.floor(sx / FP);
      const ny = sy % FP === 0 ? ty : Math.floor(sy / FP);
      if (nx === tx && ny === ty) continue;
      const dx = nx - tx;
      const dy = ny - ty;
      if (dx < -1 || dx > 1 || dy < -1 || dy > 1) return false;
      if (tx < 0 || ty < 0 || tx >= w || ty >= this.height) {
        if (!this.canStep(tx, ty, nx, ny, false, climb)) return false;
      } else if (!(mask[ty * w + tx] & (1 << DIR[(dy + 1) * 3 + dx + 1])) || this.blocked[ny * w + nx] !== 0 || (dx !== 0 && dy !== 0 && (this.blocked[ty * w + nx] !== 0 || this.blocked[ny * w + tx] !== 0))) return false;
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

  findPath(sx: number, sy: number, gx: number, gy: number, climb = false): number[] {
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
    const { blocked } = this;
    const steps = climb ? this.climbs : this.steps;
    // Equal costs are settled by the tiles' place relative to the line from start to goal (nearest it, then on its
    // left, then furthest along): the same for a map turned round, where the order of the eight directions was not,
    // and a unit took another road from the mirror of its spot.
    const [lx, ly] = [gx - sx, gy - sy];
    const tie = (i: number) => {
      const rx = (i % w) - sx;
      const ry = Math.floor(i / w) - sy;
      const cross = lx * ry - ly * rx;
      return (Math.abs(cross) * 2 + (cross < 0 ? 1 : 0)) * 2 ** 26 + (2 ** 25 - (lx * rx + ly * ry));
    };
    const h = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(Math.floor(i / w) - gy);
      return 10 * (dx + dy) - 6 * Math.min(dx, dy); // octile, costs 10 and 14
    };
    g[start] = 0;
    seen[start] = run;
    heap.push(h(start), start, tie(start));
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
        heap.push(ng + h(ni), ni, tie(ni));
      }
    }
    const path: number[] = [];
    for (let i = best; i !== start; i = from[i]) path.push(i);
    return path.reverse();
  }

  /**
   * Breadth-first from a tile, over the steps findPath takes: the tiles `door` accepts among those the fewest steps
   * away, or [] when it reaches none; `flood` then holds every tile it reached (the start's whole region). One search
   * whatever the doors: aiming a path at each in turn flooded that region once per door out of reach.
   */
  nearestDoors(sx: number, sy: number, door: (i: number) => boolean, flood?: number[]): number[] {
    const w = this.width;
    const n = w * this.height;
    if (this.seen.length !== n) [this.cost, this.from, this.seen, this.done] = [new Int32Array(n), new Int32Array(n), new Int32Array(n), new Int32Array(n)];
    const run = ++this.search;
    const { seen, steps, blocked } = this;
    let layer = [sy * w + sx];
    seen[layer[0]] = run;
    while (layer.length) {
      const found = layer.filter(door);
      if (found.length) return found;
      if (flood) for (const i of layer) flood.push(i);
      const next: number[] = [];
      for (const cur of layer) {
        const cx = cur % w;
        const cy = Math.floor(cur / w);
        for (let d = 0; d < 8; d++) {
          if (!(steps[cur] & (1 << d))) continue;
          const nx = cx + DX[d];
          const ny = cy + DY[d];
          const ni = ny * w + nx;
          if (seen[ni] === run || blocked[ni] !== 0 || (d >= 4 && (blocked[cy * w + nx] !== 0 || blocked[ny * w + cx] !== 0))) continue;
          seen[ni] = run;
          next.push(ni);
        }
      }
      layer = next;
    }
    return [];
  }

  /** Nearest open tile to (x, y), searching outward in rings; prefers tiles at `level` (so a target on a cliff is approached from the top). */
  /**
   * `from` (a tile, or between tiles): of a ring's tiles, the one nearest it, then on the left of the line from it to
   * (x, y), then furthest along it, rather than the first in the scan's fixed order. A unit and the mirror of its spot
   * then pick mirrored tiles; without `from`, the scan's order as ever.
   */
  nearestOpen(x: number, y: number, level = -1, from?: [number, number]): [number, number] {
    let fallback: [number, number] | null = null;
    let found: [number, number] | null = null;
    const better = (a: [number, number], b: [number, number] | null) => {
      if (!from || !b) return !b;
      const key = ([px, py]: [number, number]) => {
        const [rx, ry, lx, ly] = [px - from[0], py - from[1], x - from[0], y - from[1]];
        const cross = lx * ry - ly * rx;
        return [rx * rx + ry * ry, cross < 0 ? 1 : 0, -(lx * rx + ly * ry), Math.abs(cross)];
      };
      const [ka, kb] = [key(a), key(b)];
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i];
      return false;
    };
    for (let r = 0; r < Math.max(this.width, this.height); r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.open(x + dx, y + dy)) continue;
          const t: [number, number] = [x + dx, y + dy];
          if (level < 0 || this.level(x + dx, y + dy) === level) {
            if (!from) return t;
            if (better(t, found)) found = t;
          } else if (better(t, fallback)) fallback = t;
        }
      }
      if (found) return found;
      if (fallback && r >= 6) return fallback;
    }
    return fallback ?? [x, y];
  }
}

/** Most a body is kept off a cliff (keepOff), just under half a tile. */
const KEEP_OFF = Math.trunc((FP * 45) / 100);
/** The band at a cliff's foot (CLIFF_FOOT), in fixed point. */
const FOOT = Math.round(CLIFF_FOOT * FP);
/** Corners NW, NE, SE, SW (keepOff's bits 16 << k). */
const CORNERS: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/** A side's bit, the step across, this tile's two corners on it and the neighbour's matching ones. */
const FOOT_SIDES: [number, number, number, number, number, number, number][] = [[1, 0, -1, 0, 1, 3, 2], [2, 1, 0, 1, 2, 0, 3], [4, 0, 1, 3, 2, 0, 1], [8, -1, 0, 0, 3, 1, 2]];
/** A corner's bit, the diagonal step to the tile across it, this tile's corner there and that tile's. */
const FOOT_CORNERS: [number, number, number, number, number][] = [[16, -1, -1, 0, 2], [32, 1, -1, 1, 3], [64, 1, 1, 2, 0], [128, -1, 1, 3, 1]];
/** canStep's sides: bit, and the step across it. */
const SIDES: [number, number, number][] = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]];
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
/** The step index d (DX, DY) of a move by (dx, dy), at (dy + 1) * 3 + dx + 1. */
const DIR = [7, 0, 4, 3, -1, 1, 6, 2, 5];
const DY = [-1, 0, 1, 0, -1, 1, 1, -1];

/**
 * Min-heap of (priority, value); ties pop in insertion order, so results are deterministic. In typed arrays kept from
 * one search to the next (an array per entry made garbage at every push); the same order as ever.
 */
class Heap {
  private pri = new Int32Array(1024);
  private ord = new Float64Array(1024);
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

  /** `tie` orders entries of equal priority (lowest first); without it, the order they came in. */
  push(priority: number, value: number, tie = this.seq): void {
    if (this.size === this.pri.length) {
      const grow = <T extends Int32Array | Float64Array>(a: T, make: (n: number) => T) => {
        const b = make(a.length * 2);
        b.set(a);
        return b;
      };
      [this.pri, this.ord, this.val] = [grow(this.pri, (n) => new Int32Array(n)), grow(this.ord, (n) => new Float64Array(n)), grow(this.val, (n) => new Int32Array(n))];
    }
    // Sift up with a hole: the new entry is written once, where it lands.
    const { pri, ord } = this;
    const o = tie;
    this.seq++;
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
