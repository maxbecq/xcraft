import { CLIFF_FOOT, type GameMap, SUB, cornerLevels, cutCorner } from '../map';
import { FP, idiv, isqrt, tileOf } from './fixed';

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

  /** Open, and a ground unit's body fits there: not between two cliff feet (narrow), which no step enters. */
  stands(x: number, y: number): boolean {
    return this.open(x, y) && !this.narrow(x, y);
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
   * corner across the diagonal; on a diagonal cliff's tile and beside it, off its cut corner (offCut). Only the centre
   * is tested against the terrain when moving. `r` counts up to just under half a tile (gods included), so a pass three
   * tiles wide stays open to every unit. Buildings are not counted.
   * Returns the same array at every call (it runs at every step of every unit): read it before calling again.
   */
  keepOff(x: number, y: number, r: number): [number, number] {
    if (x % FP !== 0 && y % FP !== 0) return this.keep(x, y, r);
    // On a tile's edge (a building of even size turned into a unit stands on a corner): the point is of no tile more
    // than another, and taking the one after it (floor) kept a scene and its mirror off different cliffs. As a point
    // a unit inside each tile it touches: the one moved least; none, where two are moved as little to different
    // places.
    const [ox, oy] = [x, y];
    let best = -1;
    let tie = false;
    let [bx, by] = [x, y];
    for (const qx of x % FP === 0 ? [x - 1, x + 1] : [x]) {
      for (const qy of y % FP === 0 ? [y - 1, y + 1] : [y]) {
        const [kx, ky] = this.keep(qx, qy, r);
        const d = (kx - ox) * (kx - ox) + (ky - oy) * (ky - oy);
        if (best < 0 || d < best) [best, tie, bx, by] = [d, false, kx, ky];
        else if (d === best && (kx !== bx || ky !== by)) tie = true;
      }
    }
    const out = this.kept;
    // Moved by the one unit into a tile only: where it was.
    [out[0], out[1]] = tie || best <= 2 ? [ox, oy] : [bx, by];
    return out;
  }

  private keep(x: number, y: number, r: number, again = false): [number, number] {
    const out = this.kept;
    out[0] = x;
    out[1] = y;
    const tx = tileOf(x);
    const ty = tileOf(y);
    if (r <= 0 || !this.inside(tx, ty)) return out;
    const c = Math.min(r, KEEP_OFF);
    const i = ty * this.width + tx;
    const x0 = tx * FP;
    const y0 = ty * FP;
    if (this.cut[i]) {
      this.offCut(tx, ty, c, x0, y0);
      return out;
    }
    const s = this.sides[i];
    const f = this.feet[i];
    // Open ground (most tiles): every side and diagonal step free, no foot, so nothing to keep off.
    if (s === 15 && f === 0 && this.steps[i] === 255) return out;
    const oN = f & 1 ? FOOT + c : s & 1 ? 0 : c;
    const oE = f & 2 ? FOOT + c : s & 2 ? 0 : c;
    const oS = f & 4 ? FOOT + c : s & 4 ? 0 : c;
    const oW = f & 8 ? FOOT + c : s & 8 ? 0 : c;
    // Each limit in turn, again until none moves the point: one may bring it back within another's reach, and such a
    // point given as a waypoint was one no step reached, its order never done (Codex, 2026-11-26). A point already
    // where it may stand takes one round; where a tile leaves no room at all, the last round stands.
    for (let round = 0; round < ROUNDS; round++) {
      const px = x;
      const py = y;
      // Beside a diagonal cliff's tile, on its plateau's side: off the same diagonal, so the limit runs on from one
      // tile into the next and a body entering the cut tile is already where it may stand (no leap at its edge).
      out[0] = x;
      out[1] = y;
      for (let d = 0; d < 4; d++) {
        const nx = tx + DX[d];
        const ny = ty + DY[d];
        const k = this.inside(nx, ny) ? this.cut[ny * this.width + nx] : 0;
        if (k && (DX[d] !== 0 ? CORNERS[k - 1][0] === DX[d] : CORNERS[k - 1][1] === DY[d])) this.offCut(nx, ny, c, x0, y0);
      }
      x = axis(out[0], x0, oW, oE, (f & 8) !== 0, (f & 2) !== 0);
      y = axis(out[1], y0, oN, oS, (f & 1) !== 0, (f & 4) !== 0);
      // Corners, once off the sides: under a plateau (its foot's band), or a plateau's corner across the diagonal
      // (both own sides open, the diagonal step not): pushed straight away from it, then kept off the sides again. The
      // one reached deepest first, not in the corners' fixed order: two pushes do not commute, and the map turned
      // round must give the turned point (a scene and its mirror).
      let pushes: [number, number, number, number][] | null = null;
      for (let k = 0; k < 4; k++) {
        const m = this.corner(i, k, c);
        if (!m) continue;
        const cx = CORNERS[k][0] < 0 ? x0 : x0 + FP;
        const cy = CORNERS[k][1] < 0 ? y0 : y0 + FP;
        const d = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d < m) (pushes ??= []).push([m - d, k, cx, cy]);
      }
      if (pushes) {
        pushes.sort((p, q) => q[0] - p[0] || p[1] - q[1]);
        for (const [, k, cx, cy] of pushes) {
          const m = this.corner(i, k, c);
          const d = isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
          if (d >= m) continue;
          if (d === 0) [x, y] = [cx - CORNERS[k][0] * m, cy - CORNERS[k][1] * m];
          else [x, y] = [cx + idiv((x - cx) * m, d), cy + idiv((y - cy) * m, d)];
        }
        x = axis(x, x0, oW, oE, (f & 8) !== 0, (f & 2) !== 0);
        y = axis(y, y0, oN, oS, (f & 1) !== 0, (f & 4) !== 0);
        // A side holds the point within a corner's reach still (pushed straight away from the corner, the side
        // brings it back): along that side then, as far as the corner asks, where the tile has the room.
        for (const [, k, cx, cy] of pushes) {
          // (A unit or two short is the division's rounding: left as it is.)
          const m = this.corner(i, k, c);
          if (isqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) >= m - 2) continue;
          const sx = cx - CORNERS[k][0] * (isqrt(Math.max(0, m * m - (y - cy) * (y - cy))) + 1);
          const sy = cy - CORNERS[k][1] * (isqrt(Math.max(0, m * m - (x - cx) * (x - cx))) + 1);
          const okX = axis(sx, x0, oW, oE, (f & 8) !== 0, (f & 2) !== 0) === sx;
          const okY = axis(sy, y0, oN, oS, (f & 1) !== 0, (f & 4) !== 0) === sy;
          if (okX && (!okY || Math.abs(sx - x) <= Math.abs(sy - y))) x = sx;
          else if (okY) y = sy;
        }
      }
      if (Math.abs(x - px) + Math.abs(y - py) <= 2) break;
      // Never settled (two corners handing the point to each other): from the tile's middle instead, which the
      // pushes take towards the tile's open part.
      if (round === ROUNDS - 1 && !again) return this.keep(x0 + FP / 2, y0 + FP / 2, r, true);
    }
    out[0] = x;
    out[1] = y;
    return out;
  }

  /** How far keepOff holds a body of clearance `c` from corner `k` of tile `i` (see keepOff), 0 if not at all. */
  private corner(i: number, k: number, c: number): number {
    const dx = CORNERS[k][0];
    const dy = CORNERS[k][1];
    if (this.feet[i] & (16 << k)) return FOOT + c;
    const s = this.sides[i];
    return !(s & (dx < 0 ? 8 : 2)) || !(s & (dy < 0 ? 1 : 4)) || this.steps[i] & (1 << DIR[(dy + 1) * 3 + dx + 1]) ? 0 : c;
  }
  private readonly kept: [number, number] = [0, 0];

  /**
   * keepOff's point (in `kept`, of the tile at x0, y0) kept `c` off the diagonal of the cut tile (tx, ty), on the
   * plateau's side. A diagonal cliff's cut corner is drawn as low ground, at the cliff's foot, though it is the
   * plateau's tile (the user, 2026-11-24: a unit walked down there and stood stuck, with no way on but back up): the
   * body keeps to the plateau's side, as off any cliff's top. Measured from the cut corner along each axis (a, b): the
   * diagonal is a + b = FP, and c off it is c * sqrt(2) more. Only beside the diagonal itself: past its ends, in the
   * tiles next to it, the corner's own push holds the body (keepOff), and the two limits meet.
   */
  private offCut(tx: number, ty: number, c: number, x0: number, y0: number): void {
    const out = this.kept;
    const dx = CORNERS[this.cut[ty * this.width + tx] - 1][0];
    const dy = CORNERS[this.cut[ty * this.width + tx] - 1][1];
    const a = dx < 0 ? out[0] - tx * FP : (tx + 1) * FP - out[0];
    const b = dy < 0 ? out[1] - ty * FP : (ty + 1) * FP - out[1];
    const t = FP + idiv(c * SQRT2, 1024) - a - b;
    if (t <= 0 || a - b < -FP || b - a < -FP) return;
    // Straight away from the diagonal, within the body's own tile: what one axis cannot take at the tile's edge goes
    // to the other, so the point ends off the diagonal all the same (held short, it was a waypoint no step reached).
    const h = (t + 1) >> 1;
    const nx = out[0] + (dx < 0 ? h : -h);
    const ny = out[1] + (dy < 0 ? h : -h);
    const cx = Math.min(Math.max(nx, x0 + 1), x0 + FP - 1);
    const cy = Math.min(Math.max(ny, y0 + 1), y0 + FP - 1);
    out[0] = Math.min(Math.max(cx + (dx < 0 ? 1 : -1) * Math.abs(ny - cy), x0 + 1), x0 + FP - 1);
    out[1] = Math.min(Math.max(cy + (dy < 0 ? 1 : -1) * Math.abs(nx - cx), y0 + 1), y0 + FP - 1);
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

  /** Nearest open tile a body fits on (stands) to (x, y), searching outward in rings; prefers tiles at `level` (so a target on a cliff is approached from the top). */
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
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || !this.stands(x + dx, y + dy)) continue;
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
/** keepOff's rounds of corner pushes at most. */
const ROUNDS = 8;
/** sqrt(2) in 1/1024: how far along each axis a point lies from a tile's diagonal, for its distance to it. */
const SQRT2 = 1449;
/**
 * keepOff along one axis, between its low side's clearance `lo` and its high side's `hi`. Where both do not fit: off
 * the foot if only one side is one (the other a cliff's top, a chasm or the map's edge: the body overhangs that, the
 * rock is not walked into), the middle between two feet (a tile no path takes, see narrow).
 */
function axis(v: number, v0: number, lo: number, hi: number, footLo: boolean, footHi: boolean): number {
  if (lo + hi < FP) return Math.min(Math.max(v, v0 + lo), v0 + FP - hi);
  return footLo === footHi ? v0 + FP / 2 : footLo ? v0 + lo : v0 + FP - hi;
}
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
