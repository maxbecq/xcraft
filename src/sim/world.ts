import { DEFS, type Def } from '../data';
import type { GameMap } from '../map';
import { FP, dist, idiv, isqrt, speedPerTick, tileOf, toFp } from './fixed';
import { Grid } from './grid';

export type Order =
  | { kind: 'move'; x: number; y: number; arrive: number };

export interface Entity {
  id: number;
  owner: number;
  type: string;
  def: Def;
  /** Position (fixed-point), and position at the previous tick for render interpolation. */
  x: number;
  y: number;
  px: number;
  py: number;
  radius: number;
  speed: number;
  hp: number;
  order: Order | null;
  /** Remaining waypoints, as fixed-point [x0, y0, x1, y1, ...]. */
  path: number[];
  blockedTicks: number;
}

export interface Player {
  id: number;
  minerals: number;
  energy: number;
}

export type Command =
  | { player: number; kind: 'move'; ids: number[]; x: number; y: number }
  | { player: number; kind: 'stop'; ids: number[] };

export class World {
  tick = 0;
  readonly entities = new Map<number, Entity>();
  readonly grid: Grid;
  readonly players: Player[];
  private nextId = 1;

  constructor(readonly map: GameMap, playerCount = 2) {
    this.grid = new Grid(map);
    this.players = Array.from({ length: playerCount }, (_, id) => ({ id, minerals: 0, energy: 0 }));
  }

  spawn(type: string, owner: number, x: number, y: number): Entity {
    const def = DEFS[type];
    const unit = def.kind === 'unit' ? def : null;
    const e: Entity = {
      id: this.nextId++, owner, type, def, x, y, px: x, py: y,
      radius: unit ? toFp(unit.radius) : toFp(('size' in def ? def.size : 1) / 2),
      speed: unit ? speedPerTick(unit.speed) : 0,
      hp: 'hp' in def ? def.hp : 0,
      order: null, path: [], blockedTicks: 0,
    };
    this.entities.set(e.id, e);
    return e;
  }

  step(commands: readonly Command[]): void {
    for (const c of commands) this.apply(c);
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
    }
    for (const e of this.entities.values()) this.move(e);
    this.separate();
    this.tick++;
  }

  private ownUnits(c: Command): Entity[] {
    return c.ids
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => !!e && e.owner === c.player && e.def.kind === 'unit');
  }

  private apply(c: Command): void {
    const units = this.ownUnits(c);
    if (c.kind === 'stop') {
      for (const e of units) this.setOrder(e, null);
      return;
    }
    if (units.length === 0) return;
    // A compact group keeps its formation; a spread-out group converges on the point.
    const cx = idiv(units.reduce((s, e) => s + e.x, 0), units.length);
    const cy = idiv(units.reduce((s, e) => s + e.y, 0), units.length);
    const compact = units.every((e) => dist(e.x, e.y, cx, cy) < 4 * FP);
    const arrive = idiv(isqrt(units.length) * FP, 2);
    for (const e of units) {
      const ox = compact ? e.x - cx : 0;
      const oy = compact ? e.y - cy : 0;
      this.setOrder(e, { kind: 'move', x: c.x + ox, y: c.y + oy, arrive: compact ? FP / 4 : arrive });
    }
  }

  private setOrder(e: Entity, order: Order | null): void {
    e.order = order;
    e.path = [];
    e.blockedTicks = 0;
    if (order) this.plan(e, order.x, order.y);
  }

  /** Builds a smoothed waypoint path from the entity to a point. */
  private plan(e: Entity, x: number, y: number): void {
    const g = this.grid;
    let gx = Math.min(g.width - 1, Math.max(0, tileOf(x)));
    let gy = Math.min(g.height - 1, Math.max(0, tileOf(y)));
    const exact = g.open(gx, gy);
    if (!exact) [gx, gy] = g.nearestOpen(gx, gy);
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

  private move(e: Entity): void {
    const o = e.order;
    if (!o || o.kind !== 'move') return;
    if (e.path.length === 0) {
      this.setOrder(e, null);
      return;
    }
    // Stop early when the spot is crowded by friends who already arrived.
    if (dist(e.x, e.y, o.x, o.y) <= o.arrive && this.touchesIdleFriend(e)) {
      this.setOrder(e, null);
      return;
    }
    const tx = e.path[0];
    const ty = e.path[1];
    const d = dist(e.x, e.y, tx, ty);
    const step = Math.min(e.speed, d);
    const nx = d === 0 ? tx : e.x + idiv((tx - e.x) * step, d);
    const ny = d === 0 ? ty : e.y + idiv((ty - e.y) * step, d);
    if (!this.tryMove(e, nx, ny)) {
      if (++e.blockedTicks > 10) this.setOrder(e, o); // replan around the obstacle
      return;
    }
    if (step === d) e.path.splice(0, 2);
  }

  private touchesIdleFriend(e: Entity): boolean {
    for (const f of this.entities.values()) {
      if (f === e || f.owner !== e.owner || f.order || f.def.kind !== 'unit') continue;
      if (dist(e.x, e.y, f.x, f.y) <= e.radius + f.radius + FP / 16) return true;
    }
    return false;
  }

  /** Moves if the step crosses no cliff or obstacle. */
  private tryMove(e: Entity, nx: number, ny: number): boolean {
    const ax = tileOf(e.x);
    const ay = tileOf(e.y);
    const bx = tileOf(nx);
    const by = tileOf(ny);
    if ((ax !== bx || ay !== by) && (Math.abs(bx - ax) > 1 || Math.abs(by - ay) > 1 || !this.grid.canStep(ax, ay, bx, by))) return false;
    e.x = nx;
    e.y = ny;
    return true;
  }

  /** Pushes overlapping ground units apart; moving units shove idle ones. */
  private separate(): void {
    const buckets = new Map<number, Entity[]>();
    const key = (x: number, y: number) => (y >> 1) * 1024 + (x >> 1);
    const units = [...this.entities.values()].filter((e) => e.def.kind === 'unit');
    for (const e of units) {
      const k = key(tileOf(e.x), tileOf(e.y));
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(e);
    }
    for (const e of units) {
      const bx = tileOf(e.x) >> 1;
      const by = tileOf(e.y) >> 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const f of buckets.get((by + dy) * 1024 + bx + dx) ?? []) {
            if (f.id <= e.id) continue;
            this.pushApart(e, f);
          }
        }
      }
    }
  }

  private pushApart(a: Entity, b: Entity): void {
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
    const shareA = a.order && !b.order ? 0 : !a.order && b.order ? 1 : 0.5;
    const pa = Math.round(overlap * shareA);
    const pb = overlap - pa;
    this.tryMove(a, a.x - idiv(dx * pa, d), a.y - idiv(dy * pa, d));
    this.tryMove(b, b.x + idiv(dx * pb, d), b.y + idiv(dy * pb, d));
  }

  /** Hash of the game state, to check that two simulations agree. */
  hash(): number {
    let h = 2166136261;
    const mix = (v: number) => {
      h = Math.imul(h ^ (v | 0), 16777619);
    };
    mix(this.tick);
    for (const e of this.entities.values()) {
      mix(e.id);
      mix(e.x);
      mix(e.y);
      mix(e.hp);
    }
    for (const p of this.players) {
      mix(p.minerals);
      mix(p.energy);
    }
    return h >>> 0;
  }
}
