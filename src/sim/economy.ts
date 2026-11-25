/** Economy: workers gathering, fields and drop-offs. */
import { type BuildingDef, HARVEST } from '../data';
import { FP, dist, idiv, ticks } from './fixed';
import { type Order, type Entity, type World } from './world';

/** Seconds the fields a worker gave up on stay out of its choice: the way may have opened since (a building gone). */
const SKIP_SECONDS = 20;

export function gather(this: World, e: Entity, o: Extract<Order, { kind: 'gather' }>): void {
  if (o.skip && this.tick - o.skipped! >= ticks(SKIP_SECONDS)) {
    delete o.skip;
    delete o.skipped;
  }
  if (o.phase === 'return' || e.carry > 0) {
    o.phase = 'return';
    const home = this.nearestDropoff(e);
    if (!home) return this.setOrder(e, null);
    const size = (home.def as BuildingDef).size;
    if (!this.reachRect(e, home.tx, home.ty, size)) return void this.goNear(e, home.tx, home.ty, size);
    const p = this.players[e.owner];
    p.minerals += idiv(e.carry * p.handicap, 100);
    e.carry = 0;
    o.phase = 'go';
    e.goal = null;
  }
  let field = this.entities.get(o.target);
  if (!field || field.amount <= 0 || (field.miner && field.miner !== e.id && this.near(e, field, 3))) {
    // Depleted or busy: switch to the closest free field.
    const other = this.nearestField(e, field, !!field && field.amount > 0, o.skip);
    if (other) {
      if (field) this.release(e, field.id);
      field = other;
      o.target = other.id;
      e.goal = null;
    } else if (!field || field.amount <= 0) {
      return this.setOrder(e, null);
    }
  }
  if (o.phase === 'go') {
    if (!this.reachRect(e, field.tx, field.ty, 1)) {
      // No way into it (cut off, or no path up its cliff): goNear counts each time it got nowhere; then another field,
      // none it gave up on before (two fields out of reach sent it back and forth, a third never tried). Found or not,
      // the count starts again: the next look, through every entity, comes as late.
      if (e.stuck > 2) {
        e.stuck = 0;
        if (!o.skip?.includes(field.id)) {
          o.skipped ??= this.tick;
          (o.skip ??= []).push(field.id);
        }
        const other = this.nearestField(e, field, true, o.skip);
        if (other) {
          this.release(e, field.id);
          field = other;
          o.target = other.id;
          e.goal = null;
        }
      }
      return void this.goNear(e, field.tx, field.ty, 1);
    }
    if (field.miner && field.miner !== e.id) return; // wait for the field
    e.stuck = 0;
    delete o.skip;
    field.miner = e.id;
    o.phase = 'mine';
    o.timer = ticks(HARVEST.seconds);
  }
  if (o.phase === 'mine' && --o.timer <= 0) {
    const n = Math.min(HARVEST.amount, field.amount);
    field.amount -= n;
    e.carry = n;
    field.miner = 0;
    o.phase = 'return';
    e.goal = null; // the way to the field is not the way back (point 109)
    if (field.amount <= 0) this.remove(field);
  }
}

export function release(this: World, e: Entity, target: number): void {
  const f = this.entities.get(target);
  if (f?.miner === e.id) f.miner = 0;
}

export function near(this: World, e: Entity, f: Entity, tiles: number): boolean {
  return dist(e.x, e.y, f.x, f.y) <= tiles * FP;
}

/** Closest mineral field; with `freeOnly`, only fields nobody is mining; never one in `skip`. */
export function nearestField(this: World, e: Entity, except?: Entity, freeOnly = false, skip?: number[]): Entity | undefined {
  let best: Entity | undefined;
  let bestD = 12 * FP;
  for (const f of this.listed().fields) {
    if (f === except || f.amount <= 0 || (freeOnly && f.miner) || skip?.includes(f.id)) continue;
    const d = dist(e.x, e.y, f.x, f.y) + (f.miner ? 3 * FP : 0);
    if (d < bestD) [best, bestD] = [f, d];
  }
  return best;
}

export function nearestDropoff(this: World, e: Entity): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const b of this.listed().dropoffs) {
    if (b.owner !== e.owner || b.buildLeft > 0) continue;
    const d = dist(e.x, e.y, b.x, b.y);
    if (d < bestD) [best, bestD] = [b, d];
  }
  return best;
}
