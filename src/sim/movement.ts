/** Movement: paths, following them, pace, stepping aside, separation. */
import { KIT, type UnitDef } from '../data';
import { FP, GAME_SPEED, TICK_RATE, dist, idiv, isqrt, tileOf } from './fixed';
import { startSite } from './setup';
import { soars, type Entity, type World } from './world';

const REACH = FP / 4;

/** A socle with the Patte ultramécanique (équilibreur 22/11): walks over cliffs, up or down. */
export const climbs = (e: Entity): boolean => !!(e.support & KIT.patte);

/** Distance from a unit's edge to a tile rectangle is within reach, and (on the ground) not across a cliff. */
export function reachRect(this: World, e: Entity, tx: number, ty: number, size: number): boolean {
  const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
  const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
  if (dist(e.x, e.y, nx, ny) > e.radius + REACH) return false;
  return soars(e) || this.grid.canStep(tileOf(e.x), tileOf(e.y), ...rectTile(tx, ty, size, e.x, e.y), true);
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
  // When that tile is blocked (a neighbouring mineral at a corner), across a cliff, or no path reaches it, aim at the
  // nearest tile beside the rectangle that does (doorstep).
  // One unit past the edge on every side (the left or top edge itself lies inside, the right or bottom one outside,
  // so the same point by both rules left a scene and its mirror a unit apart), one unit inside it when aiming inside.
  if (!e.goal) {
    const out = (v: number, lo: number, hi: number) => (v === lo ? v - 1 : v === hi ? v + 1 : v);
    const [ox, oy] = [out(nx, tx * FP, (tx + size) * FP), out(ny, ty * FP, (ty + size) * FP)];
    // ...and only if that tile is at the rectangle's level: below a cliff, the rectangle is reached from the top.
    // A region found shut off from it this tick skips the path that would flood it again (see doorstep).
    const shut = this.shutAt === this.tick && !!this.shut.get((ty * this.grid.width + tx) * 8 + size)?.has(tileOf(e.y) * this.grid.width + tileOf(e.x));
    if (!(!shut && this.grid.open(tileOf(ox), tileOf(oy)) && this.grid.canStep(tileOf(ox), tileOf(oy), ...rectTile(tx, ty, size, ox, oy), true) && this.planned(e, ox, oy))) this.doorstep(e, tx, ty, size, nx, ny);
  }
  if (!this.follow(e)) return;
  // Path done (it ends on the open tile beside the rectangle): step straight at the edge.
  const d = dist(e.x, e.y, nx, ny);
  const s = Math.min(e.speed, d);
  const [x0, y0] = [e.x, e.y];
  // A step that leaves it where it was (held one unit short of a tile edge it may not cross) is blocked too: below a
  // cliff at a field's corner, workers stood there for good, never counted as blocked.
  if (d === 0 || !this.tryMove(e, e.x + idiv((nx - e.x) * s, d), e.y + idiv((ny - e.y) * s, d)) || (e.x === x0 && e.y === y0)) {
    if (++e.blockedTicks > 10) {
      e.goal = null;
      e.stuck++;
    }
  }
}

/** Plans to a point; true if the path gets there (plan ends a path that falls short on a tile's centre instead). */
export function planned(this: World, e: Entity, x: number, y: number): boolean {
  this.plan(e, x, y);
  const n = e.path.length;
  return soars(e) || (n >= 2 && e.path[n - 2] === x && e.path[n - 1] === y);
}

/**
 * Plans to the nearest tile beside a rectangle that steps into it and that a path reaches, on any side. Aiming inside
 * the rectangle, as before, let plan pick the open tile nearest to it at its level: on L'Anneau a lone plateau tile no
 * path reaches, or the unit's own tile whose diagonal step the terrain forbids, and workers stood at a field's corner
 * for good. One breadth-first search finds the doors the fewest steps away; of those, the nearest to the unit, ties
 * broken as Grid.nearestOpen does (a scene and its mirror pick mirrored tiles). A search that reaches none is kept
 * for the tick (World.shut): every unit of that region sent there this tick is spared it. With no door reached, no
 * path: the unit steps straight at the rectangle until held, and goNear counts it stuck.
 */
export function doorstep(this: World, e: Entity, tx: number, ty: number, size: number, nx: number, ny: number): void {
  const g = this.grid;
  const w = g.width;
  const start = tileOf(e.y) * w + tileOf(e.x);
  if (this.shutAt !== this.tick) [this.shut, this.shutAt] = [new Map(), this.tick];
  const key = (ty * w + tx) * 8 + size;
  let doors: number[] = [];
  const opens = (x: number, y: number) => g.open(x, y) && g.canStep(x, y, ...rectTile(tx, ty, size, x * FP + FP / 2, y * FP + FP / 2), true);
  const ring = (x: number, y: number) => x >= tx - 1 && x <= tx + size && y >= ty - 1 && y <= ty + size && !(x >= tx && x < tx + size && y >= ty && y < ty + size);
  // No door at all (every tile round it blocked, or across a cliff): nothing to search for, the region left unflooded.
  let any = false;
  for (let y = ty - 1; y <= ty + size && !any; y++) for (let x = tx - 1; x <= tx + size && !any; x++) any = ring(x, y) && opens(x, y);
  if (any && !this.shut.get(key)?.has(start)) {
    const flood: number[] = [];
    doors = g.nearestDoors(tileOf(e.x), tileOf(e.y), (i) => ring(i % w, Math.floor(i / w)) && opens(i % w, Math.floor(i / w)), flood);
    // Regions never meet: each one found shut off is added, so units of two regions sent there in turn are all spared.
    if (!doors.length) {
      const shut = this.shut.get(key) ?? new Set<number>();
      for (const t of flood) shut.add(t);
      this.shut.set(key, shut);
    }
  }
  if (!doors.length) {
    e.goal = { x: nx, y: ny };
    e.path = [];
    e.blockedTicks = 0;
    return;
  }
  const lx = (tx * 2 + size) * (FP / 2) - e.x;
  const ly = (ty * 2 + size) * (FP / 2) - e.y;
  const keyOf = (i: number) => {
    const [rx, ry] = [(i % w) * FP + FP / 2 - e.x, Math.floor(i / w) * FP + FP / 2 - e.y];
    const cross = lx * ry - ly * rx;
    return [rx * rx + ry * ry, cross < 0 ? 1 : 0, -(lx * rx + ly * ry), Math.abs(cross)];
  };
  let best = doors[0];
  let bestKey = keyOf(best);
  for (const d of doors.slice(1)) {
    const k = keyOf(d);
    const i = k.findIndex((v, n) => v !== bestKey[n]);
    if (i >= 0 && k[i] < bestKey[i]) [best, bestKey] = [d, k];
  }
  this.plan(e, (best % w) * FP + FP / 2, Math.floor(best / w) * FP + FP / 2);
}

/** Walks to a point; true once arrived. */
export function goTo(this: World, e: Entity, x: number, y: number): boolean {
  if (!e.goal || e.goal.x !== x || e.goal.y !== y) this.plan(e, x, y);
  return this.follow(e);
}

/** Long paths searched this tick, for the units given the same far order with them (see pathFor). */
const SHARED_MIN = 16;
/** Ticks without getting nearer its waypoint before a unit replans (follow). */
const STILL = TICK_RATE;

/**
 * Tiles from a unit to a goal tile, as Grid.findPath gives them. A group sent far in one order made as many searches
 * in one tick as it has units (18 of them on le-col held a tick 27 to 37 ms): a unit standing within 2 tiles of where
 * a long path searched this tick starts, headed within 3 tiles of where it ends, takes that path instead, when it can
 * walk straight onto its first tile and from its last to its own goal (cliffs and buildings checked as for any step).
 */
export function pathFor(this: World, e: Entity, gx: number, gy: number): number[] {
  const g = this.grid;
  const w = g.width;
  const sx = tileOf(e.x);
  const sy = tileOf(e.y);
  // A climber (Patte ultramécanique) takes its own road over the cliffs, neither lent nor borrowed.
  if (climbs(e)) return g.findPath(sx, sy, gx, gy, true);
  if (this.searchedAt !== this.tick) [this.searched, this.searchedAt] = [[], this.tick];
  const centre = (t: number) => [(t % w) * FP + FP / 2, Math.floor(t / w) * FP + FP / 2] as const;
  for (const s of this.searched) {
    if (Math.abs(s.sx - sx) > 2 || Math.abs(s.sy - sy) > 2 || Math.abs(s.gx - gx) > 3 || Math.abs(s.gy - gy) > 3) continue;
    const last = s.tiles[s.tiles.length - 1];
    if (!g.lineWalkable(e.x, e.y, ...centre(s.tiles[0]))) continue;
    const goal = gy * w + gx;
    if (goal === last) return s.tiles.slice();
    if (!g.lineWalkable(...centre(last), ...centre(goal))) continue;
    return [...s.tiles, goal];
  }
  const tiles = g.findPath(sx, sy, gx, gy);
  // Only a path that reached its goal is lent: one that fell short ended on the nearest tile it could.
  if (tiles.length >= SHARED_MIN && tiles[tiles.length - 1] === gy * w + gx) this.searched.push({ sx, sy, gx, gy, tiles });
  return tiles;
}

/** Builds a smoothed waypoint path from the entity to a point. */
export function plan(this: World, e: Entity, x: number, y: number): void {
  const g = this.grid;
  e.goal = { x, y };
  e.blockedTicks = 0;
  if (soars(e)) {
    e.path = [Math.max(0, Math.min(g.width * FP - 1, x)), Math.max(0, Math.min(g.height * FP - 1, y))];
    return;
  }
  // A goal right on a tile's edge (an even-sized building's middle) is in the tile on the unit's side of it: always the
  // one after it (floor) gave a scene and its mirror goal tiles a tile apart.
  const goalTile = (v: number, from: number) => (v % FP === 0 && from < v ? v / FP - 1 : tileOf(v));
  let gx = Math.min(g.width - 1, Math.max(0, goalTile(x, e.x)));
  let gy = Math.min(g.height - 1, Math.max(0, goalTile(y, e.y)));
  const exact = g.open(gx, gy);
  if (!exact) [gx, gy] = g.nearestOpen(gx, gy, g.level(gx, gy), [tileOf(e.x), tileOf(e.y)]);
  const tiles = this.pathFor(e, gx, gy);
  const pts: number[] = [];
  for (const t of tiles) pts.push((t % g.width) * FP + FP / 2, Math.floor(t / g.width) * FP + FP / 2);
  const end = tiles.length ? tiles[tiles.length - 1] : tileOf(e.y) * g.width + tileOf(e.x);
  if (exact && end === gy * g.width + gx) {
    pts.splice(-2, 2, x, y); // on an empty path too: it then holds just the point
  }
  // Every waypoint, the goal too, where the body may stand: out of a cliff's foot (Grid.keepOff).
  if (!climbs(e)) {
    for (let k = 0; k < pts.length; k += 2) {
      // The goal itself on a tile's edge: kept off as a point of its own tile (gx, gy), a unit inside it. As a point
      // of the tile beyond (floor), it was pushed further into that one, at times across a cliff: a waypoint no step
      // reached, and the unit pressed at the wall with its order never done.
      const goal = exact && k === pts.length - 2 && end === gy * g.width + gx;
      // On either edge (Codex, 2026-11-26: the low one alone was a point of two tiles, so the same move turned a
      // quarter round was kept off differently).
      const inside = (v: number, t: number) => (v === (t + 1) * FP ? v - 1 : v === t * FP ? v + 1 : v);
      const qx = goal ? inside(pts[k], gx) : pts[k];
      const qy = goal ? inside(pts[k + 1], gy) : pts[k + 1];
      const [kx, ky] = g.keepOff(qx, qy, e.radius);
      if (kx !== qx || ky !== qy) [pts[k], pts[k + 1]] = [kx, ky];
    }
  }
  // Nowhere to walk (the goal out of reach and its own tile the nearest to it), yet standing where no body may (an
  // old replay, set there by a trigger): out of there.
  if (!pts.length && !climbs(e)) {
    const [kx, ky] = g.keepOff(e.x, e.y, e.radius);
    if (kx !== e.x || ky !== e.y) pts.push(kx, ky);
  }
  // String-pulling: skip waypoints that can be reached in a straight line.
  const smooth: number[] = [];
  let ax = e.x;
  let ay = e.y;
  let i = 0;
  while (i < pts.length) {
    let j = pts.length - 2;
    while (j > i && !g.lineWalkable(ax, ay, pts[j], pts[j + 1], climbs(e))) j -= 2;
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
  // Two units heading for the same waypoint from either side of it (a group following one path, QA B1): tryMove never
  // fails, separate pushes them back as far as they step, so blockedTicks never rose and they stood there for good. A
  // second without getting nearer its waypoint, or reaching one, and it replans.
  // Only on a move: in a fight (a chase, an attack-move pressing on, a crowd round a building) getting no nearer for
  // a while is the fight itself, and replanning there kept armies from ever finishing a base.
  // An attack-move with nothing to fight yet is a walk too (point 115: three Légionnaires sent at a headquarters on
  // ville-nuit stood for good at one waypoint they pushed each other off).
  const o = e.order;
  const walk = o?.kind === 'move' || (o?.kind === 'attackMove' && !o.target);
  const near = walk ? dist(e.x, e.y, e.path[0], e.path[1]) : 0;
  if (!walk || e.path.length !== e.wn || near < e.wd) {
    e.wn = e.path.length;
    e.wd = near;
    e.still = 0;
  } else if (++e.still > STILL && e.goal) {
    e.still = 0;
    this.plan(e, e.goal.x, e.goal.y);
    if (e.path.length === 0) return true;
  }
  // Intermediate waypoints count as reached within half a tile, so a crowd never circles one point.
  // Only skip when the next waypoint is in straight reach, so corners around cliffs are still respected.
  if (e.path.length > 2 && dist(e.x, e.y, e.path[0], e.path[1]) <= FP / 2 && this.grid.lineWalkable(e.x, e.y, e.path[2], e.path[3], climbs(e))) e.path.splice(0, 2);
  const tx = e.path[0];
  const ty = e.path[1];
  const d = dist(e.x, e.y, tx, ty);
  const step = Math.min(this.pace(e), d);
  const nx = d === 0 ? tx : e.x + idiv((tx - e.x) * step, d);
  const ny = d === 0 ? ty : e.y + idiv((ty - e.y) * step, d);
  if (!this.tryMove(e, nx, ny)) {
    e.vel = 0;
    if (++e.blockedTicks > 10 && e.goal) {
      const [wx, wy] = [e.path[0], e.path[1]];
      this.plan(e, e.goal.x, e.goal.y); // replan around the obstacle
      // The same way again, held back by a cliff's limit (not by a step the terrain or a building refuses, which a
      // crowd's pushes may yet undo): no body gets there (a ledge a cliff's foot closes, which the
      // path, found tile by tile, takes for open). As near as it goes: the path is done, not pressed at for good.
      if (this.heldOff && e.path[0] === wx && e.path[1] === wy) {
        e.path = [];
        return true;
      }
    }
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

/**
 * The tiles a point stands on: one, or the two or four it touches on a tile's edge or corner (a building of even size
 * turned into a unit stands on its footprint's middle, a corner). Floor alone took the tile after it, so a scene and
 * its mirror started from different tiles.
 */
export function standsOn(x: number, y: number): [number, number][] {
  const xs = x % FP === 0 ? [x / FP - 1, x / FP] : [tileOf(x)];
  const ys = y % FP === 0 ? [y / FP - 1, y / FP] : [tileOf(y)];
  return xs.flatMap((tx) => ys.map((ty): [number, number] => [tx, ty]));
}

/** On no open tile: caught under a building (or on closed ground). A point on an edge is free if a tile it touches is. */
export function caught(this: World, e: Entity): boolean {
  return !standsOn(e.x, e.y).some(([x, y]) => this.grid.open(x, y));
}

/** Idle units standing on a blocked tile walk off it. */
export function evict(this: World, e: Entity): void {
  if (!this.caught(e)) return;
  const g = this.grid;
  // Ties toward the map's centre: no other direction is known here, and the scan's order did not turn with the map.
  const from: [number, number] = [(g.width - 1) / 2, (g.height - 1) / 2];
  // On an edge, from each tile it touches: the open tile whose middle is nearest the body, then nearest the map's
  // centre, then on the same turning side of it (all unchanged by the map turned round).
  // At the map's very middle all of these tie (Codex, 2026-11-26): then nearest its owner's start, which turns too.
  const C = (g.width * FP) / 2;
  const home = startSite(this, e.owner);
  const [hx, hy] = home ? [home[0] * FP + 2 * FP, home[1] * FP + 2 * FP] : [C, C];
  const key = ([tx, ty]: [number, number]) => {
    const [px, py] = [tx * FP + FP / 2, ty * FP + FP / 2];
    const cross = (e.x - C) * (py - C) - (e.y - C) * (px - C);
    // Last, of two as near the start (one either side of the line from the centre to it), the one on its left: the
    // body on the centre leaves `cross` nothing to tell (Codex, 2026-11-27).
    const side = (hx - C) * (py - C) - (hy - C) * (px - C);
    return [(px - e.x) ** 2 + (py - e.y) ** 2, (px - C) ** 2 + (py - C) ** 2, (px - hx) ** 2 + (py - hy) ** 2, Math.sign(cross), side < 0 ? 0 : 1];
  };
  let best: [number, number] | null = null;
  let bk: number[] = [];
  // The owner's start breaks ties inside the search too: at the map's middle a whole ring ties there, and the scan's
  // order had already picked north before the start was asked (Codex, point 122).
  const tie: [number, number] = [hx / FP - 0.5, hy / FP - 0.5];
  for (const [x, y] of standsOn(e.x, e.y)) {
    if (!g.inside(x, y)) continue;
    const t = g.nearestOpen(x, y, g.level(x, y), from, tie);
    const k = key(t);
    const i = k.findIndex((v, j) => v !== bk[j]);
    if (!best || (i >= 0 && k[i] < bk[i])) [best, bk] = [t, k];
  }
  if (!best) return;
  const [ox, oy] = best;
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
/** Along one axis, from `from` to `to` (fixed point): the (tile before, tile after) pairs to check (see tryMove). */
function sides(from: number, to: number): [number, number][] {
  const edge = (v: number) => v % FP === 0;
  if (to === from) return edge(from) ? [[from / FP - 1, from / FP - 1], [from / FP, from / FP]] : [[tileOf(from), tileOf(from)]];
  const up = to > from;
  // An edge point belongs to the tile on the side the unit comes from.
  const a = edge(from) ? (up ? from / FP : from / FP - 1) : tileOf(from);
  const b = edge(to) ? (up ? to / FP - 1 : to / FP) : tileOf(to);
  return [[a, b]];
}

export function tryMove(this: World, e: Entity, nx: number, ny: number, throughBuildings = false): boolean {
  this.heldOff = false;
  if (soars(e)) {
    if (nx < 0 || ny < 0 || nx >= this.grid.width * FP || ny >= this.grid.height * FP) return false;
    e.x = nx;
    e.y = ny;
    return true;
  }
  // Never stopping on a tile edge (one unit short of it, on the side it comes from), and a point on one counting in the
  // tile it comes from, or in both when not moving along that axis: floor alone put it in the tile beyond on one side
  // of the map and short of it on the other, so a scene and its mirror were let through a cliff's corner differently.
  if (nx !== e.x && nx % FP === 0) nx -= Math.sign(nx - e.x);
  if (ny !== e.y && ny % FP === 0) ny -= Math.sign(ny - e.y);
  const xs = sides(e.x, nx);
  const ys = sides(e.y, ny);
  for (const [ax, bx] of xs) {
    for (const [ay, by] of ys) {
      if ((ax !== bx || ay !== by) && (Math.abs(bx - ax) > 1 || Math.abs(by - ay) > 1 || !this.grid.canStep(ax, ay, bx, by, throughBuildings, climbs(e)))) return false;
    }
  }
  // The body, not only its centre, kept off the cliffs and out of their foot (équilibreur 22/11). A climber walks
  // over them.
  if (!climbs(e)) {
    let [kx, ky] = this.grid.keepOff(nx, ny, e.radius);
    if (kx !== nx || ky !== ny) {
      // Moved back no further than the step itself and a tick's walk: a step from free ground is undone in full, and
      // a body already where none may stand (out of a building against the cliff, called back, set there by a
      // trigger, an old replay) walks out at its own pace instead of leaping up to a tile in one tick.
      const most = dist(e.x, e.y, nx, ny) + e.speed;
      const far = dist(nx, ny, kx, ky);
      if (far > most) [kx, ky] = [nx + idiv((kx - nx) * most, far), ny + idiv((ky - ny) * most, far)];
      // Held back to no headway at all (heading straight into the wall): a blocked step, so a walker stuck there
      // replans (blockedTicks) instead of pressing on in place for good. Along the wall or round a corner, it slides.
      if ((kx - e.x) * (nx - e.x) + (ky - e.y) * (ny - e.y) <= 0) {
        // ...unless it stands where no body may itself: then it walks straight out, whatever its heading (held in a
        // band its path runs along or into, it stood there for good).
        [kx, ky] = this.grid.keepOff(e.x, e.y, e.radius);
        const out = dist(e.x, e.y, kx, ky);
        this.heldOff = out <= FP / 64;
        // A corner's push rounds by a unit or two: only a body well inside counts, or one on the limit crept for good.
        if (out <= FP / 64) return false;
        if (out > e.speed) [kx, ky] = [e.x + idiv((kx - e.x) * e.speed, out), e.y + idiv((ky - e.y) * e.speed, out)];
      }
      [nx, ny] = [kx, ky];
    }
  }
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
  const units: Entity[] = [];
  for (const e of this.entities.values()) if (e.def.kind === 'unit' && e.order?.kind !== 'gather' && !e.inside) units.push(e);
  const n = units.length;
  const x0 = new Int32Array(n);
  const y0 = new Int32Array(n);
  const home = new Int32Array(n);
  const air = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const e = units[i];
    x0[i] = e.x;
    y0[i] = e.y;
    air[i] = soars(e) ? 1 : 0;
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
  /** Margin for e's own moves while its pairs are pushed: past it, the buckets are looked at again. */
  const SLACK = FP / 4;
  // Buckets two tiles wide: look far enough that the two widest bodies (gods, 1.3 tiles) still meet.
  const reach = idiv(2 * units.reduce((m, e) => Math.max(m, e.radius), 0) + SLACK + 2 * FP - 1, 2 * FP);
  // Pairs (i, j) in id order whatever the buckets they lie in: bucket by bucket, the order turned with the map, and a
  // scene and its mirror pushed their units apart in different orders, so not to mirror positions.
  const near: number[] = [];
  // The bodies after `after` (indices) that may touch e, in id order.
  const gather = (e: Entity, i: number, after: number) => {
    const bx = tileOf(e.x) >> 1;
    const by = tileOf(e.y) >> 1;
    near.length = 0;
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const b = index.get(key(bx + dx, by + dy));
        if (b === undefined) continue;
        // Every body of the bucket, even moved by the pushes so far, too far to touch e: none of its pairs would push,
        // so skipping it changes nothing (the same pushes, in the same order).
        const gx = dx > 0 ? 2 * (bx + dx) * FP - e.x : dx < 0 ? e.x - 2 * (bx + dx + 1) * FP : 0;
        const gy = dy > 0 ? 2 * (by + dy) * FP - e.y : dy < 0 ? e.y - 2 * (by + dy + 1) * FP : 0;
        if (Math.max(gx, gy) - drift[b] - SLACK >= e.radius + widest[b]) continue;
        // Units come in id order (entities are kept in spawn order): start past `after`.
        const m = members[b];
        let q = 0;
        for (let hi = m.length; q < hi; ) {
          const mid = (q + hi) >> 1;
          if (m[mid] <= after) q = mid + 1;
          else hi = mid;
        }
        for (; q < m.length; q++) if (air[m[q]] === air[i]) near.push(m[q]);
      }
    }
    if (near.length > 1) near.sort((p, q) => p - q);
  };
  for (let i = 0; i < n; i++) {
    const e = units[i];
    gather(e, i, i);
    // e itself is pushed by its pairs: once it has moved past the margin, a bucket skipped from where it stood may
    // now be in reach (a scene and its mirror, their buckets cut differently, then pushed different pairs).
    let [ex, ey] = [e.x, e.y];
    for (let k = 0; k < near.length; k++) {
      const j = near[k];
      this.pushApart(e, units[j]);
      moved(i);
      moved(j);
      if (Math.max(Math.abs(e.x - ex), Math.abs(e.y - ey)) > SLACK && k < near.length - 1) {
        gather(e, i, j);
        [ex, ey] = [e.x, e.y];
        k = -1;
      }
    }
  }
}

const fixedInPlace = (e: Entity) => e.burrowed || (!!(e.def as UnitDef).levels && e.queue.length > 0);

export function pushApart(this: World, a: Entity, b: Entity): void {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = isqrt(dx * dx + dy * dy);
  const overlap = a.radius + b.radius - d;
  if (overlap <= 0) return;
  if (d === 0) {
    // Same spot: split along the line from the map's middle, b outward, which turns with the map (a direction from the
    // ids pushed the same way whatever the corner); right in the middle, along one from the ids.
    dx = a.x - idiv(this.map.width * FP, 2);
    dy = a.y - idiv(this.map.height * FP, 2);
    if (!dx && !dy) {
      dx = ((a.id * 7 + b.id * 13) % 17) - 8 || 1;
      dy = ((a.id * 11 + b.id * 5) % 17) - 8;
    }
    d = isqrt(dx * dx + dy * dy);
  }
  // A burrowed Créature, a god summoning or rising a level, is not pushed (équilibreur 24/11).
  const fa = fixedInPlace(a);
  const fb = fixedInPlace(b);
  if (fa && fb) return;
  const pa = fa ? 0 : fb ? overlap : a.order && !b.order ? 0 : !a.order && b.order ? overlap : idiv(overlap, 2);
  const pb = overlap - pa;
  this.tryMove(a, a.x - idiv(dx * pa, d), a.y - idiv(dy * pa, d));
  this.tryMove(b, b.x + idiv(dx * pb, d), b.y + idiv(dy * pb, d));
}
