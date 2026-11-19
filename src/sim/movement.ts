/** Movement: paths, following them, pace, stepping aside, separation. */
import { type UnitDef } from '../data';
import { FP, GAME_SPEED, TICK_RATE, dist, idiv, isqrt, tileOf } from './fixed';
import { flies, type Entity, type World } from './world';

const REACH = FP / 4;

/** Distance from a unit's edge to a tile rectangle is within reach, and (on the ground) not across a cliff. */
export function reachRect(this: World, e: Entity, tx: number, ty: number, size: number): boolean {
  const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
  const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
  if (dist(e.x, e.y, nx, ny) > e.radius + REACH) return false;
  return flies(e) || this.grid.canStep(tileOf(e.x), tileOf(e.y), ...rectTile(tx, ty, size, e.x, e.y), true);
}

/** The rectangle's tile nearest to a point. */
function rectTile(tx: number, ty: number, size: number, x: number, y: number): [number, number] {
  return [Math.max(tx, Math.min(tileOf(x), tx + size - 1)), Math.max(ty, Math.min(tileOf(y), ty + size - 1))];
}

/** Walks to the point of a tile rectangle closest to the unit (callers stop once in reach). */
export function goNear(this: World, e: Entity, tx: number, ty: number, size: number): void {
  const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
  const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
  // Plan to the tile just outside the edge: a point on the left or top edge belongs to the tile inside the
  // rectangle (tiles are floor(x)), on the right or bottom edge to the one outside; aiming inside from one side
  // only made units coming from the west or north take another path than those from the east or south.
  // When that tile is blocked (a neighbouring mineral at a corner), aim inside: the nearest open tile to the
  // rectangle itself, not to its neighbour, which may be on the far side of it.
  if (!e.goal) {
    const [ox, oy] = [nx === tx * FP ? nx - 1 : nx, ny === ty * FP ? ny - 1 : ny];
    // ...and only if that tile is at the rectangle's level: below a cliff, the rectangle is reached from the top.
    if (this.grid.open(tileOf(ox), tileOf(oy)) && this.grid.canStep(tileOf(ox), tileOf(oy), ...rectTile(tx, ty, size, ox, oy), true)) this.plan(e, ox, oy);
    else this.plan(e, Math.min(nx, (tx + size) * FP - 1), Math.min(ny, (ty + size) * FP - 1));
  }
  if (!this.follow(e)) return;
  // Path done (it ends on the open tile beside the rectangle): step straight at the edge.
  const d = dist(e.x, e.y, nx, ny);
  const s = Math.min(e.speed, d);
  if (d === 0 || !this.tryMove(e, e.x + idiv((nx - e.x) * s, d), e.y + idiv((ny - e.y) * s, d))) {
    if (++e.blockedTicks > 10) {
      e.goal = null;
      e.stuck++;
    }
  }
}

/** Walks to a point; true once arrived. */
export function goTo(this: World, e: Entity, x: number, y: number): boolean {
  if (!e.goal || e.goal.x !== x || e.goal.y !== y) this.plan(e, x, y);
  return this.follow(e);
}

/** Builds a smoothed waypoint path from the entity to a point. */
export function plan(this: World, e: Entity, x: number, y: number): void {
  const g = this.grid;
  e.goal = { x, y };
  e.blockedTicks = 0;
  if (flies(e)) {
    e.path = [Math.max(0, Math.min(g.width * FP - 1, x)), Math.max(0, Math.min(g.height * FP - 1, y))];
    return;
  }
  let gx = Math.min(g.width - 1, Math.max(0, tileOf(x)));
  let gy = Math.min(g.height - 1, Math.max(0, tileOf(y)));
  const exact = g.open(gx, gy);
  if (!exact) [gx, gy] = g.nearestOpen(gx, gy, g.level(gx, gy));
  const tiles = g.findPath(tileOf(e.x), tileOf(e.y), gx, gy);
  const pts: number[] = [];
  for (const t of tiles) pts.push((t % g.width) * FP + FP / 2, Math.floor(t / g.width) * FP + FP / 2);
  const end = tiles.length ? tiles[tiles.length - 1] : tileOf(e.y) * g.width + tileOf(e.x);
  if (exact && end === gy * g.width + gx) {
    pts.splice(-2, 2, x, y); // on an empty path too: it then holds just the point
  }
  // String-pulling: skip waypoints that can be reached in a straight line.
  const smooth: number[] = [];
  let ax = e.x;
  let ay = e.y;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 2;
    while (j > i && !g.lineWalkable(ax, ay, pts[j], pts[j + 1])) j -= 2;
    smooth.push(pts[j], pts[j + 1]);
    ax = pts[j];
    ay = pts[j + 1];
    i = j + 2;
  }
  e.path = smooth;
}

/** Advances along the path; true once it is exhausted. */
export function follow(this: World, e: Entity): boolean {
  if (e.path.length === 0) return true;
  // Intermediate waypoints count as reached within half a tile, so a crowd never circles one point.
  // Only skip when the next waypoint is in straight reach, so corners around cliffs are still respected.
  if (e.path.length > 2 && dist(e.x, e.y, e.path[0], e.path[1]) <= FP / 2 && this.grid.lineWalkable(e.x, e.y, e.path[2], e.path[3])) e.path.splice(0, 2);
  const tx = e.path[0];
  const ty = e.path[1];
  const d = dist(e.x, e.y, tx, ty);
  const step = Math.min(this.pace(e), d);
  const nx = d === 0 ? tx : e.x + idiv((tx - e.x) * step, d);
  const ny = d === 0 ? ty : e.y + idiv((ty - e.y) * step, d);
  if (!this.tryMove(e, nx, ny)) {
    e.vel = 0;
    if (++e.blockedTicks > 10 && e.goal) this.plan(e, e.goal.x, e.goal.y); // replan around the obstacle
    return false;
  }
  if (step === d) e.path.splice(0, 2);
  return e.path.length === 0;
}

/**
 * Step length this tick. Units with inertia (UnitDef.accel) speed up from a standstill and brake so as to
 * stop on the last waypoint; the others walk at full speed at once.
 */
export function pace(this: World, e: Entity): number {
  const accel = (e.def as UnitDef).accel;
  if (!accel) return e.speed;
  const a = Math.max(1, Math.round((accel * GAME_SPEED * GAME_SPEED * FP) / (TICK_RATE * TICK_RATE)));
  if (e.movedTick !== this.tick - 1) e.vel = 0;
  let left = 0;
  for (let i = 0, x = e.x, y = e.y; i < e.path.length; x = e.path[i], y = e.path[i + 1], i += 2) left += dist(x, y, e.path[i], e.path[i + 1]);
  e.vel = Math.min(e.speed, e.vel + a, Math.max(a, isqrt(2 * a * left)));
  e.movedTick = this.tick;
  return e.vel;
}

/** Idle units standing on a blocked tile walk off it. */
export function evict(this: World, e: Entity): void {
  const x = tileOf(e.x);
  const y = tileOf(e.y);
  if (this.grid.open(x, y)) return;
  const [ox, oy] = this.grid.nearestOpen(x, y, this.grid.level(x, y));
  const d = dist(e.x, e.y, ox * FP + FP / 2, oy * FP + FP / 2);
  const s = Math.min(e.speed, d);
  if (d > 0) this.tryMove(e, e.x + idiv((ox * FP + FP / 2 - e.x) * s, d), e.y + idiv((oy * FP + FP / 2 - e.y) * s, d), true);
}

export function touchesIdleFriend(this: World, e: Entity): boolean {
  for (const f of this.entities.values()) {
    if (f === e || f.owner !== e.owner || f.order || f.def.kind !== 'unit') continue;
    if (dist(e.x, e.y, f.x, f.y) <= e.radius + f.radius + FP / 16) return true;
  }
  return false;
}

/** Moves if the step crosses no cliff or obstacle (`throughBuildings`: cliffs only). */
export function tryMove(this: World, e: Entity, nx: number, ny: number, throughBuildings = false): boolean {
  if (flies(e)) {
    if (nx < 0 || ny < 0 || nx >= this.grid.width * FP || ny >= this.grid.height * FP) return false;
    e.x = nx;
    e.y = ny;
    return true;
  }
  const ax = tileOf(e.x);
  const ay = tileOf(e.y);
  const bx = tileOf(nx);
  const by = tileOf(ny);
  if ((ax !== bx || ay !== by) && (Math.abs(bx - ax) > 1 || Math.abs(by - ay) > 1 || !this.grid.canStep(ax, ay, bx, by, throughBuildings))) return false;
  e.x = nx;
  e.y = ny;
  return true;
}

/** Pushes overlapping units apart (flying ones among themselves); moving units shove idle ones. Harvesters pass through each other. */
export function separate(this: World): void {
  const index = new Map<number, number>();
  /** Per bucket: its units (indices into units), its widest body, the most any of them has moved so far. */
  const members: number[][] = [];
  const widest: number[] = [];
  const drift: number[] = [];
  const key = (x: number, y: number) => y * 1024 + x;
  const units = [...this.entities.values()].filter((e) => e.def.kind === 'unit' && e.order?.kind !== 'gather' && !e.inside);
  const n = units.length;
  const x0 = new Int32Array(n);
  const y0 = new Int32Array(n);
  const home = new Int32Array(n);
  const air = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = units[i];
    x0[i] = e.x;
    y0[i] = e.y;
    air[i] = flies(e) ? 1 : 0;
    const k = key(tileOf(e.x) >> 1, tileOf(e.y) >> 1);
    let b = index.get(k);
    if (b === undefined) {
      index.set(k, (b = members.length));
      members.push([]);
      widest.push(0);
      drift.push(0);
    }
    members[b].push(i);
    widest[b] = Math.max(widest[b], e.radius);
    home[i] = b;
  }
  const moved = (i: number) => {
    const u = units[i];
    drift[home[i]] = Math.max(drift[home[i]], Math.abs(u.x - x0[i]), Math.abs(u.y - y0[i]));
  };
  // Buckets two tiles wide: look far enough that the two widest bodies (gods, 1.3 tiles) still meet.
  const reach = idiv(2 * units.reduce((m, e) => Math.max(m, e.radius), 0) + 2 * FP - 1, 2 * FP);
  for (let i = 0; i < n; i++) {
    const e = units[i];
    const bx = tileOf(e.x) >> 1;
    const by = tileOf(e.y) >> 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const b = index.get(key(bx + dx, by + dy));
        if (b === undefined) continue;
        // Every body of the bucket, even moved by the pushes so far, too far to touch e: none of its pairs would push,
        // so skipping it changes nothing (the same pushes, in the same order).
        const gx = dx > 0 ? 2 * (bx + dx) * FP - e.x : dx < 0 ? e.x - 2 * (bx + dx + 1) * FP : 0;
        const gy = dy > 0 ? 2 * (by + dy) * FP - e.y : dy < 0 ? e.y - 2 * (by + dy + 1) * FP : 0;
        if (Math.max(gx, gy) - drift[b] >= e.radius + widest[b]) continue;
        // Units come in id order (entities are kept in spawn order): start past e.
        const m = members[b];
        let q = 0;
        for (let hi = m.length; q < hi; ) {
          const mid = (q + hi) >> 1;
          if (m[mid] <= i) q = mid + 1;
          else hi = mid;
        }
        for (; q < m.length; q++) {
          const j = m[q];
          const f = units[j];
          if (air[j] !== air[i]) continue;
          this.pushApart(e, f);
          moved(i);
          moved(j);
        }
      }
    }
  }
}

export function pushApart(this: World, a: Entity, b: Entity): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = isqrt(dx * dx + dy * dy);
  const overlap = a.radius + b.radius - d;
  if (overlap <= 0) return;
  if (d === 0) {
    // Same spot: split along a direction derived from the ids.
    dx = ((a.id * 7 + b.id * 13) % 17) - 8 || 1;
    dy = ((a.id * 11 + b.id * 5) % 17) - 8;
    d = isqrt(dx * dx + dy * dy);
  }
  const pa = a.order && !b.order ? 0 : !a.order && b.order ? overlap : idiv(overlap, 2);
  const pb = overlap - pa;
  this.tryMove(a, a.x - idiv(dx * pa, d), a.y - idiv(dy * pa, d));
  this.tryMove(b, b.x + idiv(dx * pb, d), b.y + idiv(dy * pb, d));
}
