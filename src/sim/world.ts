import { type BuildingDef, DEFS, type Def, HARVEST, type UnitDef } from '../data';
import type { GameMap } from '../map';
import { FP, dist, idiv, isqrt, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { Grid } from './grid';
import { Vision } from './vision';

export type Order =
  | { kind: 'move'; x: number; y: number; arrive: number }
  | { kind: 'gather'; target: number; phase: 'go' | 'mine' | 'return'; timer: number }
  | { kind: 'build'; type: string; tx: number; ty: number }
  | { kind: 'construct'; target: number }
  /** `auto`: picked by the unit itself; it gives up beyond its leash point (lx, ly). */
  | { kind: 'attack'; target: number; auto: boolean; lx: number; ly: number }
  | { kind: 'attackMove'; x: number; y: number; target: number }
  | { kind: 'heal'; target: number };

export interface Entity {
  id: number;
  owner: number;
  type: string;
  def: Def;
  /** Centre (fixed-point), and centre at the previous tick for render interpolation. */
  x: number;
  y: number;
  px: number;
  py: number;
  radius: number;
  speed: number;
  hp: number;
  maxHp: number;
  order: Order | null;
  /** Point the current path leads to, and remaining waypoints as [x0, y0, x1, y1, ...]. */
  goal: { x: number; y: number } | null;
  path: number[];
  blockedTicks: number;
  /** Buildings: top-left tile, ticks of construction left (0 = complete), training queue. */
  tx: number;
  ty: number;
  buildLeft: number;
  queue: string[];
  trainLeft: number;
  rally: { x: number; y: number } | null;
  /** Rally on a mineral field: new workers start mining it. */
  rallyTarget: number;
  /** Workers: minerals carried. */
  carry: number;
  /** Resources: amount left, and the worker currently mining. */
  amount: number;
  miner: number;
  timer: number;
  /** Ticks before the next attack or heal. */
  cooldown: number;
}

export interface Player {
  id: number;
  minerals: number;
  energy: number;
  /** Percentage of harvested minerals actually banked (AI difficulty). */
  handicap: number;
}

export type Command =
  | { player: number; kind: 'move'; ids: number[]; x: number; y: number }
  /** Right-click: move, gather, construct, return cargo or set a rally point, depending on the target. */
  | { player: number; kind: 'smart'; ids: number[]; x: number; y: number; target?: number }
  | { player: number; kind: 'stop'; ids: number[] }
  | { player: number; kind: 'build'; ids: number[]; type: string; tx: number; ty: number }
  | { player: number; kind: 'train'; ids: number[]; type: string }
  | { player: number; kind: 'cancel'; ids: number[] }
  /** Attack a target, or attack-move to a point when there is none. */
  | { player: number; kind: 'attack'; ids: number[]; x: number; y: number; target?: number };

export interface Shot {
  /** Shooter and target centres (fixed-point). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'ranged' | 'melee' | 'heal';
}

export interface Death {
  x: number;
  y: number;
  type: string;
  owner: number;
}

export interface GameEvent {
  player: number;
  text: string;
  kind: 'error' | 'done' | 'alert';
}

const REACH = FP / 4;

export class World {
  tick = 0;
  readonly entities = new Map<number, Entity>();
  readonly grid: Grid;
  readonly players: Player[];
  /** Messages for the players, cleared at each tick. */
  events: GameEvent[] = [];
  /** Attacks and deaths of the last tick, for visual effects. */
  shots: Shot[] = [];
  deaths: Death[] = [];
  readonly vision: Vision[];
  /** Winning player once the game is over. */
  winner: number | null = null;
  private nextId = 1;
  private readonly lastAlert: Record<number, number> = {};

  constructor(readonly map: GameMap, playerCount = 2) {
    this.grid = new Grid(map);
    this.players = Array.from({ length: playerCount }, (_, id) => ({ id, minerals: 0, energy: 0, handicap: 100 }));
    this.vision = this.players.map(() => new Vision(this.grid));
  }

  /** Units spawn centred on (x, y); buildings and resources at top-left tile (tx, ty). */
  spawn(type: string, owner: number, x: number, y: number): Entity {
    const def = DEFS[type];
    const size = def.kind === 'unit' ? 0 : def.size;
    const e: Entity = {
      id: this.nextId++, owner, type, def, x, y, px: x, py: y,
      radius: def.kind === 'unit' ? toFp(def.radius) : (size * FP) / 2,
      speed: def.kind === 'unit' ? speedPerTick(def.speed) : 0,
      hp: 'hp' in def ? def.hp : 0, maxHp: 'hp' in def ? def.hp : 0,
      order: null, goal: null, path: [], blockedTicks: 0,
      tx: 0, ty: 0, buildLeft: 0, queue: [], trainLeft: 0, rally: null, rallyTarget: 0,
      carry: 0, amount: def.kind === 'resource' ? def.amount : 0, miner: 0, timer: 0, cooldown: 0,
    };
    if (size) {
      e.tx = tileOf(x);
      e.ty = tileOf(y);
      e.x = e.px = e.tx * FP + (size * FP) / 2;
      e.y = e.py = e.ty * FP + (size * FP) / 2;
      this.block(e, 1);
    }
    this.entities.set(e.id, e);
    return e;
  }

  remove(e: Entity): void {
    if (e.def.kind !== 'unit') this.block(e, -1);
    this.entities.delete(e.id);
  }

  private block(e: Entity, delta: number): void {
    const size = (e.def as BuildingDef).size;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) this.grid.blocked[y * this.grid.width + x] += delta;
  }

  step(commands: readonly Command[]): void {
    this.events = [];
    this.shots = [];
    this.deaths = [];
    if (this.tick % 4 === 0) this.see();
    for (const c of commands) this.apply(c);
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
      if (e.cooldown > 0) e.cooldown--;
    }
    for (const e of [...this.entities.values()]) {
      if (e.hp <= 0 && e.def.kind !== 'resource') continue;
      if (e.def.kind === 'unit') this.think(e);
      else if (e.def.kind === 'building') this.operate(e);
    }
    this.bury();
    this.separate();
    if (this.tick % 20 === 0) this.judge();
    this.tick++;
  }

  // ---------------------------------------------------------------- vision, death, victory

  private see(): void {
    for (const v of this.vision) v.begin();
    for (const e of this.entities.values()) {
      if (e.owner < 0 || !('sight' in e.def)) continue;
      const r = e.def.kind === 'building' && e.buildLeft > 0 ? 3 : e.def.sight;
      this.vision[e.owner].reveal(tileOf(e.x), tileOf(e.y), r);
    }
  }

  /** Can this player currently see the entity? */
  sees(player: number, e: Entity): boolean {
    if (e.owner === player) return true;
    if (e.def.kind === 'unit') return this.vision[player].visible(tileOf(e.x), tileOf(e.y));
    const size = (e.def as BuildingDef).size ?? 1;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) if (this.vision[player].visible(x, y)) return true;
    return false;
  }

  private bury(): void {
    for (const e of [...this.entities.values()]) {
      if (e.hp > 0 || e.def.kind === 'resource') continue;
      this.deaths.push({ x: e.x, y: e.y, type: e.type, owner: e.owner });
      if (e.order?.kind === 'gather') this.release(e, e.order.target);
      this.remove(e);
    }
  }

  /** A player with no building left is defeated. */
  private judge(): void {
    if (this.winner !== null) return;
    const alive = this.players.filter((p) => [...this.entities.values()].some((e) => e.owner === p.id && e.def.kind === 'building'));
    if (alive.length === 1) this.winner = alive[0].id;
    else if (alive.length === 0) this.winner = -1;
  }

  // ---------------------------------------------------------------- players

  supply(player: number): { used: number; max: number } {
    let used = 0;
    let max = 0;
    for (const e of this.entities.values()) {
      if (e.owner !== player) continue;
      if (e.def.kind === 'unit') used += e.def.supply;
      else if (e.def.kind === 'building') {
        if (e.def.supply < 0) used -= e.def.supply;
        else if (e.buildLeft === 0) max += e.def.supply;
        for (const t of e.queue) used += (DEFS[t] as UnitDef).supply;
      }
    }
    return { used, max: Math.min(200, max) };
  }

  private pay(player: number, def: UnitDef | BuildingDef): boolean {
    const p = this.players[player];
    if (p.minerals < def.cost.minerals) return this.say(player, 'Pas assez de minerai.');
    if (p.energy < def.cost.energy) return this.say(player, "Pas assez d'énergie.");
    p.minerals -= def.cost.minerals;
    p.energy -= def.cost.energy;
    return true;
  }

  private refund(player: number, def: UnitDef | BuildingDef): void {
    this.players[player].minerals += def.cost.minerals;
    this.players[player].energy += def.cost.energy;
  }

  private say(player: number, text: string, kind: GameEvent['kind'] = 'error'): false {
    this.events.push({ player, text, kind });
    return false;
  }

  // ---------------------------------------------------------------- commands

  private owned(c: Command): Entity[] {
    return c.ids.map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.owner === c.player);
  }

  private apply(c: Command): void {
    const mine = this.owned(c);
    const units = mine.filter((e) => e.def.kind === 'unit');
    const buildings = mine.filter((e) => e.def.kind === 'building' && e.buildLeft === 0);
    switch (c.kind) {
      case 'stop':
        units.forEach((e) => this.setOrder(e, null));
        return;
      case 'move':
        this.moveGroup(units, c.x, c.y);
        return;
      case 'smart':
        this.smart(c, units, buildings);
        return;
      case 'attack': {
        const t = c.target !== undefined ? this.entities.get(c.target) : undefined;
        const fighters = units.filter((e) => 'attack' in e.def && e.def.attack);
        if (t && t.owner >= 0 && t.owner !== c.player) {
          for (const e of fighters) this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
        } else {
          for (const e of fighters) this.setOrder(e, { kind: 'attackMove', x: c.x, y: c.y, target: 0 });
        }
        return;
      }
      case 'build': {
        const worker = units.find((e) => (e.def as UnitDef).worker);
        if (!worker || DEFS[c.type]?.kind !== 'building') return;
        if (!this.canPlace(c.type, c.tx, c.ty)) return void this.say(c.player, 'Emplacement invalide.');
        this.setOrder(worker, { kind: 'build', type: c.type, tx: c.tx, ty: c.ty });
        return;
      }
      case 'train':
        for (const b of buildings) {
          const def = b.def as BuildingDef;
          if (!def.trains?.includes(c.type)) continue;
          if (b.queue.length >= 5) return void this.say(c.player, "File d'attente pleine.");
          const unit = DEFS[c.type] as UnitDef;
          const s = this.supply(c.player);
          if (s.used + unit.supply > s.max) return void this.say(c.player, 'Logistique insuffisante : construisez des greniers.');
          if (!this.pay(c.player, unit)) return;
          b.queue.push(c.type);
          if (b.queue.length === 1) b.trainLeft = ticks(unit.buildTime);
          return; // one building per command, like SC
        }
        return;
      case 'cancel':
        for (const b of mine) {
          if (b.def.kind !== 'building') continue;
          if (b.buildLeft > 0) {
            this.refund(c.player, b.def);
            this.remove(b);
          } else if (b.queue.length) {
            this.refund(c.player, DEFS[b.queue.pop()!] as UnitDef);
            if (b.queue.length) b.trainLeft = Math.max(b.trainLeft, 1);
          }
        }
        return;
    }
  }

  private smart(c: Extract<Command, { kind: 'smart' }>, units: Entity[], buildings: Entity[]): void {
    const t = c.target !== undefined ? this.entities.get(c.target) : undefined;
    for (const b of buildings) {
      if (!(b.def as BuildingDef).trains) continue;
      b.rally = { x: c.x, y: c.y };
      b.rallyTarget = t?.type === 'minerai' ? t.id : 0;
    }
    const movers: Entity[] = [];
    for (const e of units) {
      const worker = (e.def as UnitDef).worker;
      if (t && t.owner >= 0 && t.owner !== e.owner && (e.def as UnitDef).attack) {
        this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
      } else if (!worker && t && t.owner === e.owner && t.def.kind === 'unit' && (e.def as UnitDef).heal && t.hp < t.maxHp) {
        this.setOrder(e, { kind: 'heal', target: t.id });
      } else if (worker && t?.def.kind === 'resource' && t.type === 'minerai') {
        this.setOrder(e, { kind: 'gather', target: t.id, phase: 'go', timer: 0 });
      } else if (worker && t && t.owner === e.owner && t.def.kind === 'building' && t.buildLeft > 0) {
        this.setOrder(e, { kind: 'construct', target: t.id });
      } else if (worker && t && t.owner === e.owner && (t.def as BuildingDef).dropoff && e.carry > 0) {
        this.setOrder(e, { kind: 'gather', target: this.nearestField(e)?.id ?? 0, phase: 'return', timer: 0 });
      } else {
        movers.push(e);
      }
    }
    this.moveGroup(movers, c.x, c.y);
  }

  private moveGroup(units: Entity[], x: number, y: number): void {
    if (units.length === 0) return;
    // A compact group keeps its formation; a spread-out group converges on the point.
    const cx = idiv(units.reduce((s, e) => s + e.x, 0), units.length);
    const cy = idiv(units.reduce((s, e) => s + e.y, 0), units.length);
    const compact = units.every((e) => dist(e.x, e.y, cx, cy) < 4 * FP);
    const arrive = idiv(isqrt(units.length) * FP, 2);
    for (const e of units) {
      const ox = compact ? e.x - cx : 0;
      const oy = compact ? e.y - cy : 0;
      this.setOrder(e, { kind: 'move', x: x + ox, y: y + oy, arrive: compact ? FP / 4 : arrive });
    }
  }

  private setOrder(e: Entity, order: Order | null): void {
    const old = e.order;
    if (old?.kind === 'gather') this.release(e, old.target);
    e.order = order;
    e.goal = null;
    e.path = [];
    e.blockedTicks = 0;
  }

  // ---------------------------------------------------------------- placement

  canPlace(type: string, tx: number, ty: number): boolean {
    const def = DEFS[type] as BuildingDef;
    const g = this.grid;
    if (def.energyRate) {
      // Mines go exactly on a free energy well.
      for (const w of this.entities.values()) {
        if (w.type === 'puits' && w.tx === tx && w.ty === ty) {
          return ![...this.entities.values()].some((m) => m.type === 'mine' && m.tx === tx && m.ty === ty);
        }
      }
      return false;
    }
    let level = -2;
    for (let y = ty; y < ty + def.size; y++) {
      for (let x = tx; x < tx + def.size; x++) {
        if (!g.open(x, y)) return false;
        const l = g.flatLevel(x, y);
        if (l < 0 || (level !== -2 && l !== level)) return false;
        level = l;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- unit behaviour

  private think(e: Entity): void {
    const o = e.order;
    if (!o) {
      if ((this.tick + e.id) % 4 === 0) this.acquire(e);
      if (!e.order) this.evict(e);
      return;
    }
    switch (o.kind) {
      case 'attack':
      case 'attackMove':
      case 'heal':
        return this.fight(e, o);
      case 'move':
        if (dist(e.x, e.y, o.x, o.y) <= o.arrive && this.touchesIdleFriend(e)) return this.setOrder(e, null);
        if (this.goTo(e, o.x, o.y)) this.setOrder(e, null);
        return;
      case 'build': {
        const def = DEFS[o.type] as BuildingDef;
        if (!this.reachRect(e, o.tx, o.ty, def.size)) {
          this.goNear(e, o.tx, o.ty, def.size);
          return;
        }
        if (!this.canPlace(o.type, o.tx, o.ty)) {
          this.say(e.owner, 'Emplacement invalide.');
          return this.setOrder(e, null);
        }
        if (!this.pay(e.owner, def)) return this.setOrder(e, null);
        const b = this.spawn(o.type, e.owner, o.tx * FP, o.ty * FP);
        b.buildLeft = ticks(def.buildTime);
        b.hp = Math.max(1, idiv(b.maxHp, 10));
        this.setOrder(e, { kind: 'construct', target: b.id });
        return;
      }
      case 'construct': {
        const b = this.entities.get(o.target);
        if (!b || b.buildLeft === 0) return this.setOrder(e, null);
        if (!this.reachRect(e, b.tx, b.ty, (b.def as BuildingDef).size)) {
          this.goNear(e, b.tx, b.ty, (b.def as BuildingDef).size);
          return;
        }
        // Each worker on site adds one tick of progress: groups build faster.
        const total = ticks((b.def as BuildingDef).buildTime);
        b.buildLeft--;
        b.hp = Math.min(b.maxHp, b.hp + Math.max(1, idiv(b.maxHp * 9, total * 10)));
        if (b.buildLeft === 0) this.say(b.owner, `Construction terminée : ${b.def.name}.`, 'done');
        return;
      }
      case 'gather':
        return this.gather(e, o);
    }
  }

  private gather(e: Entity, o: Extract<Order, { kind: 'gather' }>): void {
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
      const other = this.nearestField(e, field, !!field && field.amount > 0);
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
      if (!this.reachRect(e, field.tx, field.ty, 1)) return void this.goNear(e, field.tx, field.ty, 1);
      if (field.miner && field.miner !== e.id) return; // wait for the field
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
      if (field.amount <= 0) this.remove(field);
    }
  }

  private release(e: Entity, target: number): void {
    const f = this.entities.get(target);
    if (f?.miner === e.id) f.miner = 0;
  }

  private near(e: Entity, f: Entity, tiles: number): boolean {
    return dist(e.x, e.y, f.x, f.y) <= tiles * FP;
  }

  /** Closest mineral field; with `freeOnly`, only fields nobody is mining. */
  private nearestField(e: Entity, except?: Entity, freeOnly = false): Entity | undefined {
    let best: Entity | undefined;
    let bestD = 12 * FP;
    for (const f of this.entities.values()) {
      if (f.type !== 'minerai' || f === except || f.amount <= 0 || (freeOnly && f.miner)) continue;
      const d = dist(e.x, e.y, f.x, f.y) + (f.miner ? 3 * FP : 0);
      if (d < bestD) [best, bestD] = [f, d];
    }
    return best;
  }

  private nearestDropoff(e: Entity): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const b of this.entities.values()) {
      if (b.owner !== e.owner || b.buildLeft > 0 || !(b.def as BuildingDef).dropoff) continue;
      const d = dist(e.x, e.y, b.x, b.y);
      if (d < bestD) [best, bestD] = [b, d];
    }
    return best;
  }

  // ---------------------------------------------------------------- combat

  /** Idle units pick a fight (or a patient) in sight. Workers only fight when told to. */
  private acquire(e: Entity): void {
    const def = e.def as UnitDef;
    if (def.worker) return;
    const patient = def.heal ? this.patient(e) : undefined;
    if (patient) return this.setOrder(e, { kind: 'heal', target: patient.id });
    if (!def.attack) return;
    const t = this.enemyNear(e, def.sight * FP);
    if (t) this.setOrder(e, { kind: 'attack', target: t.id, auto: true, lx: e.x, ly: e.y });
  }

  private fight(e: Entity, o: Extract<Order, { kind: 'attack' | 'attackMove' | 'heal' }>): void {
    const def = e.def as UnitDef;
    if (o.kind === 'heal') {
      const t = this.entities.get(o.target);
      if (!t || t.hp <= 0 || t.hp >= t.maxHp || !def.heal) return this.setOrder(e, null);
      if (this.gap(e, t) > 2 * FP) return this.chase(e, t);
      e.goal = null;
      if (e.cooldown === 0) {
        t.hp = Math.min(t.maxHp, t.hp + 1);
        e.cooldown = ticks(1 / def.heal);
        if ((this.tick + e.id) % 8 === 0) this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: 'heal' });
      }
      return;
    }
    if (o.kind === 'attackMove') {
      // Heal on the way if needed, otherwise engage what comes into sight, then carry on.
      if (def.heal && (this.tick + e.id) % 4 === 0) {
        const p = this.patient(e);
        if (p) {
          if (this.gap(e, p) > 2 * FP) return this.chase(e, p);
          if (e.cooldown === 0) {
            p.hp = Math.min(p.maxHp, p.hp + 1);
            e.cooldown = ticks(1 / def.heal);
          }
          return;
        }
      }
      let t = this.entities.get(o.target);
      if (!t || t.hp <= 0 || !this.sees(e.owner, t) || this.gap(e, t) > (def.sight + 2) * FP) {
        t = (this.tick + e.id) % 4 === 0 ? this.enemyNear(e, def.sight * FP) : undefined;
        o.target = t?.id ?? 0;
        if (!t && this.goTo(e, o.x, o.y)) this.setOrder(e, null);
        if (!t) return;
        e.goal = null;
      }
      return this.strike(e, t);
    }
    const t = this.entities.get(o.target);
    if (!t || t.hp <= 0 || (!this.sees(e.owner, t) && o.auto)) return this.setOrder(e, null);
    if (o.auto && dist(e.x, e.y, o.lx, o.ly) > (def.sight + 3) * FP) {
      // Chased too far: walk back.
      return this.setOrder(e, { kind: 'move', x: o.lx, y: o.ly, arrive: FP });
    }
    this.strike(e, t);
  }

  /** Attacks if in range, otherwise closes in. */
  private strike(e: Entity, t: Entity): void {
    const a = (e.def as UnitDef).attack;
    if (!a) return;
    if (this.gap(e, t) > toFp(a.range) + FP / 8) return this.chase(e, t);
    e.goal = null;
    e.path = [];
    if (e.cooldown > 0) return;
    e.cooldown = ticks(a.cooldown);
    const armor = 'armor' in t.def ? t.def.armor : 0;
    const bonus = t.def.kind === 'building' ? (a.vsMechanical ?? 0) : 0;
    t.hp -= Math.max(1, a.damage + bonus - armor);
    if (this.tick - (this.lastAlert[t.owner] ?? -Infinity) > ticks(15)) {
      this.lastAlert[t.owner] = this.tick;
      this.say(t.owner, t.def.kind === 'building' ? 'Votre base est attaquée !' : 'Vos troupes sont attaquées !', 'alert');
    }
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: a.range < 1 ? 'melee' : 'ranged' });
    // Idle soldiers hit from afar fight back.
    const td = t.def as UnitDef;
    if (!t.order && t.def.kind === 'unit' && td.attack && !td.worker) {
      this.setOrder(t, { kind: 'attack', target: e.id, auto: true, lx: t.x, ly: t.y });
    }
  }

  private chase(e: Entity, t: Entity): void {
    if (t.def.kind === 'building') return this.goNear(e, t.tx, t.ty, (t.def as BuildingDef).size);
    if (!e.goal || dist(e.goal.x, e.goal.y, t.x, t.y) > FP) this.plan(e, t.x, t.y);
    this.follow(e);
  }

  /** Edge-to-edge distance. */
  private gap(e: Entity, t: Entity): number {
    if (t.def.kind === 'unit') return dist(e.x, e.y, t.x, t.y) - e.radius - t.radius;
    const size = (t.def as BuildingDef).size;
    const nx = Math.max(t.tx * FP, Math.min(e.x, (t.tx + size) * FP));
    const ny = Math.max(t.ty * FP, Math.min(e.y, (t.ty + size) * FP));
    return dist(e.x, e.y, nx, ny) - e.radius;
  }

  /** Most threatening visible enemy within range: armed units first, then others, then buildings. */
  private enemyNear(e: Entity, range: number): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Infinity;
    for (const t of this.entities.values()) {
      if (t.owner < 0 || t.owner === e.owner || t.def.kind === 'resource') continue;
      const d = this.gap(e, t);
      if (d > range || !this.sees(e.owner, t)) continue;
      const armed = t.def.kind === 'unit' && !!(t.def as UnitDef).attack && !(t.def as UnitDef).worker;
      const score = d + (t.def.kind === 'building' ? 8 * FP : armed ? 0 : 3 * FP);
      if (score < bestScore) [best, bestScore] = [t, score];
    }
    return best;
  }

  /** Most wounded friendly unit in sight. */
  private patient(e: Entity): Entity | undefined {
    let best: Entity | undefined;
    let worst = 1;
    const range = (e.def as UnitDef).sight * FP;
    for (const t of this.entities.values()) {
      if (t === e || t.owner !== e.owner || t.def.kind !== 'unit' || t.hp >= t.maxHp) continue;
      if (dist(e.x, e.y, t.x, t.y) > range) continue;
      const f = t.hp / t.maxHp;
      if (f < worst) [best, worst] = [t, f];
    }
    return best;
  }

  // ---------------------------------------------------------------- buildings

  private operate(b: Entity): void {
    if (b.buildLeft > 0) return;
    const def = b.def as BuildingDef;
    if (def.energyRate && ++b.timer >= ticks(1 / def.energyRate)) {
      b.timer = 0;
      this.players[b.owner].energy++;
    }
    if (b.queue.length && --b.trainLeft <= 0) {
      const type = b.queue.shift()!;
      const u = this.spawnBeside(type, b);
      const field = (u.def as UnitDef).worker && (!b.rally || b.rallyTarget) ? (this.entities.get(b.rallyTarget) ?? this.nearestField(u)) : undefined;
      // Workers go mining by default (or on the rallied field); others walk to the rally point.
      if (field) this.setOrder(u, { kind: 'gather', target: field.id, phase: 'go', timer: 0 });
      else if (b.rally) this.setOrder(u, { kind: 'move', x: b.rally.x, y: b.rally.y, arrive: FP / 2 });
      if (b.queue.length) b.trainLeft = ticks((DEFS[b.queue[0]] as UnitDef).buildTime);
    }
  }

  /** Spawns a unit on the open tile next to a building, on the side of its rally point. */
  private spawnBeside(type: string, b: Entity): Entity {
    const size = (b.def as BuildingDef).size;
    const toward = b.rally ?? { x: b.x + FP, y: b.y + FP };
    let best: [number, number] = [b.tx + size, b.ty + size];
    let bestD = Infinity;
    for (let y = b.ty - 1; y <= b.ty + size; y++) {
      for (let x = b.tx - 1; x <= b.tx + size; x++) {
        if (!this.grid.open(x, y)) continue;
        const d = dist(x * FP + FP / 2, y * FP + FP / 2, toward.x, toward.y);
        if (d < bestD) [best, bestD] = [[x, y], d];
      }
    }
    return this.spawn(type, b.owner, best[0] * FP + FP / 2, best[1] * FP + FP / 2);
  }

  // ---------------------------------------------------------------- movement

  /** Distance from a unit's edge to a tile rectangle is within reach. */
  private reachRect(e: Entity, tx: number, ty: number, size: number): boolean {
    const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
    const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
    return dist(e.x, e.y, nx, ny) <= e.radius + REACH;
  }

  /** Walks to the point of a tile rectangle closest to the unit (callers stop once in reach). */
  private goNear(e: Entity, tx: number, ty: number, size: number): void {
    const nx = Math.max(tx * FP, Math.min(e.x, (tx + size) * FP));
    const ny = Math.max(ty * FP, Math.min(e.y, (ty + size) * FP));
    if (!e.goal) this.plan(e, nx, ny);
    if (!this.follow(e)) return;
    // Path done (it ends on the open tile beside the rectangle): step straight at the edge.
    const d = dist(e.x, e.y, nx, ny);
    const s = Math.min(e.speed, d);
    if (d === 0 || !this.tryMove(e, e.x + idiv((nx - e.x) * s, d), e.y + idiv((ny - e.y) * s, d))) {
      if (++e.blockedTicks > 10) e.goal = null;
    }
  }

  /** Walks to a point; true once arrived. */
  private goTo(e: Entity, x: number, y: number): boolean {
    if (!e.goal || e.goal.x !== x || e.goal.y !== y) this.plan(e, x, y);
    return this.follow(e);
  }

  /** Builds a smoothed waypoint path from the entity to a point. */
  private plan(e: Entity, x: number, y: number): void {
    const g = this.grid;
    e.goal = { x, y };
    e.blockedTicks = 0;
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
  private follow(e: Entity): boolean {
    if (e.path.length === 0) return true;
    const tx = e.path[0];
    const ty = e.path[1];
    const d = dist(e.x, e.y, tx, ty);
    const step = Math.min(e.speed, d);
    const nx = d === 0 ? tx : e.x + idiv((tx - e.x) * step, d);
    const ny = d === 0 ? ty : e.y + idiv((ty - e.y) * step, d);
    if (!this.tryMove(e, nx, ny)) {
      if (++e.blockedTicks > 10 && e.goal) this.plan(e, e.goal.x, e.goal.y); // replan around the obstacle
      return false;
    }
    if (step === d) e.path.splice(0, 2);
    return e.path.length === 0;
  }

  /** Idle units standing on a blocked tile walk off it. */
  private evict(e: Entity): void {
    const x = tileOf(e.x);
    const y = tileOf(e.y);
    if (this.grid.open(x, y)) return;
    const [ox, oy] = this.grid.nearestOpen(x, y);
    const d = dist(e.x, e.y, ox * FP + FP / 2, oy * FP + FP / 2);
    const s = Math.min(e.speed, d);
    if (d > 0) {
      e.x += idiv((ox * FP + FP / 2 - e.x) * s, d);
      e.y += idiv((oy * FP + FP / 2 - e.y) * s, d);
    }
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

  /** Pushes overlapping ground units apart; moving units shove idle ones. Harvesters pass through each other. */
  private separate(): void {
    const buckets = new Map<number, Entity[]>();
    const key = (x: number, y: number) => y * 1024 + x;
    const units = [...this.entities.values()].filter((e) => e.def.kind === 'unit' && e.order?.kind !== 'gather');
    for (const e of units) {
      const k = key(tileOf(e.x) >> 1, tileOf(e.y) >> 1);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(e);
    }
    for (const e of units) {
      const bx = tileOf(e.x) >> 1;
      const by = tileOf(e.y) >> 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const f of buckets.get(key(bx + dx, by + dy)) ?? []) if (f.id > e.id) this.pushApart(e, f);
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
    const pa = a.order && !b.order ? 0 : !a.order && b.order ? overlap : idiv(overlap, 2);
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
