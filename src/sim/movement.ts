/** Movement: paths, following them, pace, stepping aside, separation. */
import { type UnitDef } from '../data';
import { FP, GAME_SPEED, TICK_RATE, dist, idiv, isqrt, tileOf } from './fixed';
import { flies, type Entity, type World } from './world';

const REACH = FP / 4;

/** Distance from a unit's edge to a tile rectangle is within reach. */
export function reachRect(this: World, e: Entity, tx: number, ty: number, size: number): boolean {
  const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
  const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
  return dist(e.x, e.y, nx, ny) <= e.radius + REACH;
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
    if (this.grid.open(tileOf(ox), tileOf(oy))) this.plan(e, ox, oy);
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
    pts.splice(-2, 2, x, y);
    if (pts.length === 0) pts.push(x, y);
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
  const buckets = new Map<number, Entity[]>();
  const key = (x: number, y: number) => y * 1024 + x;
  const units = [...this.entities.values()].filter((e) => e.def.kind === 'unit' && e.order?.kind !== 'gather' && !e.inside);
  for (const e of units) {
    const k = key(tileOf(e.x) >> 1, tileOf(e.y) >> 1);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(e);
  }
  // Buckets two tiles wide: look far enough that the two widest bodies (gods, 1.3 tiles) still meet.
  const reach = idiv(2 * units.reduce((m, e) => Math.max(m, e.radius), 0) + 2 * FP - 1, 2 * FP);
  for (const e of units) {
    const bx = tileOf(e.x) >> 1;
    const by = tileOf(e.y) >> 1;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (const f of buckets.get(key(bx + dx, by + dy)) ?? []) if (f.id > e.id && flies(f) === flies(e)) this.pushApart(e, f);
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
