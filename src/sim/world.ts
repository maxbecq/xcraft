import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, type Cost, DEFS, type Def, type Faction, FACTIONS, HARVEST, OBSERVATION, type UnitDef, type UpgradeDef, type UpgradeLine } from '../data';
import type { GameMap } from '../map';
import { FP, TICK_RATE, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { Grid } from './grid';
import * as commands from './commands';
import * as movement from './movement';
import * as buildings from './buildings';
import * as combat from './combat';
import * as abilities from './abilities';
import { Vision } from './vision';

export type Order =
  | { kind: 'move'; x: number; y: number; arrive: number }
  | { kind: 'gather'; target: number; phase: 'go' | 'mine' | 'return'; timer: number }
  | { kind: 'build'; type: string; tx: number; ty: number }
  | { kind: 'construct'; target: number }
  /** `auto`: picked by the unit itself; it gives up beyond its leash point (lx, ly). */
  | { kind: 'attack'; target: number; auto: boolean; lx: number; ly: number }
  /** `back`: a patrol, which turns round at (x, y) and heads back there, for ever. */
  | { kind: 'attackMove'; x: number; y: number; target: number; back?: [number, number] }
  | { kind: 'heal'; target: number }
  /** Walk into a bunker (Fortin) and take cover there. */
  | { kind: 'enter'; target: number }
  /** Walk within range of (x, y), then use an aimed ability there. */
  | { kind: 'cast'; ability: string; x: number; y: number };

/** Flying units go straight over cliffs and buildings. */
export const flies = (e: Entity): boolean => !!(e.def as UnitDef).flying || e.airborne;

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
  /** Orders given with shift, to carry out one after the other once the current one is done. */
  next: Order[];
  /** Units with inertia (UnitDef.accel): current speed per tick, and the last tick it moved. */
  vel: number;
  movedTick: number;
  hp: number;
  maxHp: number;
  order: Order | null;
  /** Point the current path leads to, and remaining waypoints as [x0, y0, x1, y1, ...]. */
  goal: { x: number; y: number } | null;
  path: number[];
  blockedTicks: number;
  /** The bunker (Fortin) this unit shelters in, or 0. */
  inside: number;
  /** A target found out of reach (under a cliff, say), left alone until `ignoreUntil`. */
  ignore: number;
  ignoreUntil: number;
  /** No new fight picked on the way until this tick (after giving up on an unreachable target). */
  calmUntil: number;
  /** Ticks spent at the end of its path without being able to strike its target. */
  shortTicks: number;
  /** Replans in a row that went nowhere; build orders give up after a few. */
  stuck: number;
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
  /** Psychic shield (Isdaris), absorbed before hp; recharges a while after the last hit. */
  shield: number;
  maxShield: number;
  lastHit: number;
  /** Ticks counting towards the next shield or hp point regained. */
  regenTimer: number;
  /** Ticks left of the unit's own ability effect (stimulant, charge), of a Peau de roc on it, and before its ability is ready. */
  boost: number;
  skin: number;
  abilityCd: number;
  /** Ticks left during which the unit can neither act nor take orders (Rappel). */
  held: number;
  /** Holding position: fights only within reach, does not move to chase. Any move, attack or stop ends it. */
  stand: boolean;
  /** Last entity that hit it (lets the AI tell an invisible attacker from a distant one). */
  lastAttacker: number;
  /** Owner of the last attacker (Pillage pays it when a building falls). */
  lastHitBy: number;
  /** Ticks of poison left (Lames empoisonnées, Explosif toxique). */
  poison: number;
  /** Ticks left: hidden from enemies without detection (Camouflage), unhurt (Régénérant), alive (Cadavre réanimé). */
  camo: number;
  invuln: number;
  ttl: number;
  /** Char Pégase in the air (Décollage). */
  airborne: boolean;
  /** Créature under ground (Enfouissement). */
  burrowed: boolean;
  /** Ticks left: phased out, unhurt and unable to fight (Module déphasant, Porte de déphasage); sending damage back (Sphère de renvoi). */
  phased: number;
  reflect: number;
  /** Z socle: weapon kit fitted (key of WEAPONS), or '' for the light machine gun it came with. */
  kit: string;
  /** Thor's Courroux du marteau: ticks left in which his next blow hits several times as hard. */
  charged: number;
  /** Z building: id of the drone that merged into it (a hint for the renderer, not game state). */
  absorbed?: number;
}

export interface Player {
  id: number;
  faction: Faction;
  minerals: number;
  energy: number;
  /** Percentage of harvested minerals actually banked (AI difficulty). */
  handicap: number;
  /** Levels researched, by upgrade line (a one-off research is its own line, at level 1). */
  upgrades: Record<UpgradeLine, number>;
  /** Players on the same team share their sight and never fight each other. */
  team: number;
}

export type Command =
  | { player: number; kind: 'move'; ids: number[]; x: number; y: number; queue?: boolean }
  /** Right-click: move, gather, construct, return cargo or set a rally point, depending on the target. */
  | { player: number; kind: 'smart'; ids: number[]; x: number; y: number; target?: number; queue?: boolean }
  | { player: number; kind: 'stop'; ids: number[] }
  /** Hold position: stop, and from then on only shoot what comes within reach, never step out to chase. */
  | { player: number; kind: 'hold'; ids: number[] }
  /** Patrol between where each unit stands and (x, y), fighting what comes into sight on the way. */
  | { player: number; kind: 'patrol'; ids: number[]; x: number; y: number; queue?: boolean }
  | { player: number; kind: 'build'; ids: number[]; type: string; tx: number; ty: number; queue?: boolean }
  | { player: number; kind: 'train'; ids: number[]; type: string }
  | { player: number; kind: 'cancel'; ids: number[] }
  /** Every unit in the given bunkers walks out. */
  | { player: number; kind: 'unload'; ids: number[] }
  /** Each selected unit uses its active ability, if ready; a building's ability (one building per command) aims at (x, y). */
  | { player: number; kind: 'ability'; ids: number[]; x?: number; y?: number; name?: string }
  /** Marché: sells some of one resource for some of the other. */
  | { player: number; kind: 'trade'; ids: number[]; sell: 'minerals' | 'energy' }
  /** Z: fits the weapon kit on each selected socle that takes it (paid per socle). */
  | { player: number; kind: 'equip'; ids: number[]; weapon: string }
  /** Attack a target, or attack-move to a point when there is none. */
  | { player: number; kind: 'attack'; ids: number[]; x: number; y: number; target?: number; queue?: boolean };

export interface Shot {
  /** Shooter and target centres (fixed-point). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'ranged' | 'melee' | 'heal';
  /** Shooter's type, for its sound. */
  type?: string;
  /** Shooter and target fly. */
  air1?: boolean;
  air2?: boolean;
}

/** An ability used this tick (render and sound only). */
export interface Cast {
  kind: string;
  x: number;
  y: number;
}

export interface Death {
  x: number;
  y: number;
  type: string;
  owner: number;
  air?: boolean;
}

/**
 * A Rappel (Isdaris teleport), for effects and sounds: `start` when the channel begins, `end` when the units
 * jump. (x1, y1): the target zone; (x2, y2): the Obélisque. `ids`: the recalled units.
 */
export interface Teleport {
  phase: 'start' | 'end';
  owner: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  ids: number[];
}

export interface GameEvent {
  player: number;
  text: string;
  kind: 'error' | 'done' | 'alert';
}

/** How close (tiles) an Isdaris worker must be to beam a building down. */
const WARP_RANGE = 6;

/** World's methods kept in other files (commands.ts…), called as its own. */
type Methods<M> = { [K in keyof M]: OmitThisParameter<M[K]> };
export interface World extends Methods<typeof commands>, Methods<typeof abilities>, Methods<typeof combat>, Methods<typeof buildings>, Methods<typeof movement> {}

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
  /** Rappels that began or ended this tick. */
  teleports: Teleport[] = [];
  casts: Cast[] = [];
  /** Rappels channelling, with ticks left. */
  recalls: { owner: number; from: number; x: number; y: number; ids: number[]; left: number }[] = [];
  readonly vision: Vision[];
  /** For each player, the ids of its team (itself included); set with setTeams. */
  private team: number[][];
  /** Invisible enemy units each player currently detects (updated with vision). */
  readonly detected: Set<number>[];
  /** Zones revealed by a Forge's Observation céleste, with ticks left. */
  scans: { owner: number; x: number; y: number; left: number; radius?: number }[] = [];
  /** Murs d'énergie (Concentrateur): tiles no unit nor shot crosses, with ticks left. */
  walls: { owner: number; tiles: number[]; left: number }[] = [];
  /** Silence des ions: zones where no ability can be used, until a tick. */
  silences: { x: number; y: number; r: number; until: number }[] = [];
  /** Tempêtes de sable (Seth): zones where the owner's enemies cannot shoot, until a tick. */
  storms: { owner: number; x: number; y: number; r: number; until: number }[] = [];
  /** Units coming back by themselves at their side's headquarters (Gaïa), at a tick. */
  private respawns: { owner: number; type: string; at: number }[] = [];
  /** Gods fallen lately, by "player:type": tick from which they can be summoned again. */
  private mourning = new Map<string, number>();
  /** Units hidden this tick by a Déflecteur's aura. */
  shrouded = new Set<number>();
  /** Winning player once the game is over. */
  winner: number | null = null;
  private nextId = 1;
  readonly lastAlert: Record<number, number> = {};

  constructor(readonly map: GameMap, playerCount = 2) {
    this.grid = new Grid(map);
    this.players = Array.from({ length: playerCount }, (_, id) => ({ id, faction: 'humains' as Faction, minerals: 0, energy: 0, handicap: 100, upgrades: { melee: 0, ranged: 0, armor: 0 }, team: id }));
    this.vision = this.players.map(() => new Vision(this.grid));
    this.team = this.players.map((p) => [p.id]);
    this.detected = this.players.map(() => new Set());
  }

  /** Units spawn centred on (x, y); buildings and resources at top-left tile (tx, ty). */
  spawn(type: string, owner: number, x: number, y: number): Entity {
    const def = DEFS[type];
    if (def.kind === 'upgrade') throw new Error(`not an entity: ${type}`);
    const size = def.kind === 'unit' ? 0 : def.size;
    const e: Entity = {
      id: this.nextId++, owner, type, def, x, y, px: x, py: y,
      radius: def.kind === 'unit' ? toFp(def.radius) : (size * FP) / 2,
      speed: def.kind === 'unit' ? speedPerTick(def.speed) : 0, vel: 0, movedTick: -1, next: [],
      hp: 'hp' in def ? def.hp : 0, maxHp: 'hp' in def ? def.hp : 0,
      order: null, goal: null, path: [], blockedTicks: 0, inside: 0, ignore: 0, ignoreUntil: 0, calmUntil: 0, shortTicks: 0, stuck: 0,
      tx: 0, ty: 0, buildLeft: 0, queue: [], trainLeft: 0, rally: null, rallyTarget: 0,
      carry: 0, amount: def.kind === 'resource' ? def.amount : 0, miner: 0, timer: 0, cooldown: 0,
      shield: 'shield' in def ? (def.shield ?? 0) : 0, maxShield: 'shield' in def ? (def.shield ?? 0) : 0, lastHit: -1e9, regenTimer: 0, boost: 0, skin: 0, abilityCd: 0, held: 0, stand: false, lastAttacker: 0, lastHitBy: -1, poison: 0, camo: 0, invuln: 0, airborne: false, burrowed: false, phased: 0, reflect: 0, kit: '', charged: 0, ttl: 'lifetime' in def && def.lifetime ? ticks(def.lifetime) : 0,
    };
    if (size) {
      e.tx = tileOf(x);
      e.ty = tileOf(y);
      e.x = e.px = e.tx * FP + (size * FP) / 2;
      e.y = e.py = e.ty * FP + (size * FP) / 2;
      this.block(e, 1);
    }
    this.entities.set(e.id, e);
    if (this.cells) this.file(e);
    if (owner >= 0 && this.grows(e) && this.level(owner, 'croissance')) this.fortify(e);
    if (owner >= 0) for (const line of ['cercle1', 'cercle2', 'boostgenetique']) if (this.level(owner, line.replace(/\d$/, '')) >= (DEFS[line] as UpgradeDef).level) this.empower(e, line);
    return e;
  }

  remove(e: Entity): void {
    if (e.def.kind !== 'unit') this.block(e, -1);
    this.entities.delete(e.id);
  }

  block(e: Entity, delta: number): void {
    const size = (e.def as BuildingDef).size;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) this.grid.blocked[y * this.grid.width + x] += delta;
  }

  step(commands: readonly Command[]): void {
    this.events = [];
    this.shots = [];
    this.deaths = [];
    this.teleports = [];
    this.casts = [];
    this.scans = this.scans.filter((s) => --s.left > 0);
    for (const m of this.walls) if (--m.left === 0) for (const i of m.tiles) this.grid.blocked[i]--;
    this.walls = this.walls.filter((m) => m.left > 0);
    for (const r of this.recalls) if (--r.left === 0) this.land(r);
    this.recalls = this.recalls.filter((r) => r.left > 0);
    if (this.tick % 4 === 0) this.see();
    for (const c of commands) {
      // Shift: orders go after what the units are already doing; otherwise they replace it all.
      this.queueing = 'queue' in c && !!c.queue;
      if (!this.queueing && 'ids' in c && Array.isArray(c.ids)) for (const id of c.ids) this.entities.get(id)?.next.splice(0);
      this.apply(c);
      this.queueing = false;
    }
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
      if (e.cooldown > 0) e.cooldown--;
      if (e.abilityCd > 0) e.abilityCd--;
      if (e.held > 0) e.held--;
      if (e.camo > 0) e.camo--;
      if (e.phased > 0) e.phased--;
      if (e.reflect > 0) e.reflect--;
      // Régénérant wears off: the toxins turn on their host.
      if (e.invuln > 0 && --e.invuln === 0) e.hp = Math.min(e.hp, 1);
      if (e.ttl > 0 && --e.ttl === 0) e.hp = 0;
      if (e.skin > 0) e.skin--;
      if (e.charged > 0) e.charged--;
      if (e.boost > 0 && --e.boost === 0) e.speed = speedPerTick((e.def as UnitDef).speed);
      this.regenerate(e);
    }
    this.revive();
    this.storms = this.storms.filter((z) => z.until > this.tick);
    this.index();
    for (const e of [...this.entities.values()]) {
      if (e.hp <= 0 && e.def.kind !== 'resource') continue;
      if (e.def.kind === 'unit') this.think(e);
      else if (e.def.kind === 'building') this.operate(e);
    }
    this.cells = null;
    if (this.tick % TICK_RATE === 0) this.repairOnCreep();
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
      const r = e.def.kind === 'building' && e.buildLeft > 0 ? 3 : e.def.sight + (e.type === 'espion' && this.level(e.owner, 'omniscience') ? BALANCE.rules.upgrades.omniscience : 0);
      for (const a of this.team[e.owner]) this.vision[a].reveal(tileOf(e.x), tileOf(e.y), r, flies(e));
    }
    for (const s of this.scans) for (const a of this.team[s.owner]) this.vision[a].reveal(tileOf(s.x), tileOf(s.y), s.radius ?? OBSERVATION.radius);
    for (const d of this.detected) d.clear();
    // Déflecteurs hide the allied ground units round them.
    this.shrouded.clear();
    for (const d of this.entities.values()) {
      const r = (d.def as BuildingDef).cloakAura;
      if (!r || d.buildLeft > 0) continue;
      for (const u of this.entities.values()) if (u.owner === d.owner && u.def.kind === 'unit' && !flies(u) && dist(u.x, u.y, d.x, d.y) <= toFp(r)) this.shrouded.add(u.id);
    }
    for (const e of this.entities.values()) {
      if (!this.hidden(e)) continue;
      for (const s of this.scans) if (this.hostile(s.owner, e.owner) && dist(s.x, s.y, e.x, e.y) <= toFp(s.radius ?? OBSERVATION.radius)) for (const a of this.team[s.owner]) this.detected[a].add(e.id);
      for (const s of this.entities.values()) {
        const r = (s.def as UnitDef | BuildingDef).detector ?? (s.type === 'plesiosaure' && this.level(s.owner, 'oeilpercant') ? BALANCE.rules.upgrades.oeilpercant : 0);
        if (r && this.hostile(s.owner, e.owner) && s.buildLeft === 0 && dist(s.x, s.y, e.x, e.y) <= r * FP) for (const a of this.team[s.owner]) this.detected[a].add(e.id);
      }
    }
  }

  /** Can this player currently see the entity? */
  sees(player: number, e: Entity): boolean {
    if (e.owner === player || (e.owner >= 0 && !this.hostile(e.owner, player))) return true;
    if (e.inside) return false;
    if (e.def.kind === 'unit') return this.vision[player].visible(tileOf(e.x), tileOf(e.y)) && (!this.hidden(e) || this.detected[player].has(e.id));
    const size = (e.def as BuildingDef).size ?? 1;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) if (this.vision[player].visible(x, y)) return true;
    return false;
  }

  /** Recent bodies (Réanimation), dropped after 20 s. */
  corpses: { x: number; y: number; tick: number }[] = [];

  private bury(): void {
    this.corpses = this.corpses.filter((c) => this.tick - c.tick < ticks(20));
    for (const e of [...this.entities.values()]) {
      if (e.hp > 0 || e.def.kind === 'resource') continue;
      this.deaths.push({ x: e.x, y: e.y, type: e.type, owner: e.owner, air: flies(e) });
      // Living units leave a body an Alchimiste can raise for a while.
      if (e.def.kind === 'unit' && !e.def.mechanical && !flies(e) && e.type !== 'cadavre') this.corpses.push({ x: e.x, y: e.y, tick: this.tick });
      // Pillage: the player who brings an enemy building down takes a share of what it cost.
      if (e.def.kind === 'building' && e.lastHitBy >= 0 && this.hostile(e.lastHitBy, e.owner) && this.level(e.lastHitBy, 'pillage')) {
        const share = BALANCE.rules.upgrades.pillageShare;
        this.players[e.lastHitBy].minerals += idiv(e.def.cost.minerals * share, 100);
        this.players[e.lastHitBy].energy += idiv(e.def.cost.energy * share, 100);
      }
      if (e.order?.kind === 'gather') this.release(e, e.order.target);
      if (e.def.kind === 'unit' && e.def.respawn) this.respawns.push({ owner: e.owner, type: e.type, at: this.tick + ticks(e.def.respawn) });
      else if (e.def.kind === 'unit' && e.def.unique) this.mourning.set(`${e.owner}:${e.type}`, this.tick + ticks(BALANCE.rules.upgrades.mourning));
      this.remove(e);
    }
  }

  /** Gaïa comes back by her side's headquarters once her time is up (later, if it has none standing). */
  private revive(): void {
    for (const r of this.respawns) {
      if (this.tick < r.at) continue;
      const hq = [...this.entities.values()].find((b) => b.owner === r.owner && b.type === FACTIONS[this.players[r.owner].faction].hq && b.buildLeft === 0);
      if (!hq) continue;
      this.spawnBeside(r.type, hq);
      this.say(r.owner, `${DEFS[r.type].name} est de retour.`, 'done');
      r.at = -1;
    }
    this.respawns = this.respawns.filter((r) => r.at >= 0);
  }

  /** Two players (owners) at war: neither neutral, and on different teams. */
  hostile(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && this.players[a].team !== this.players[b].team;
  }

  /** Puts players in teams (by default each plays alone): `teams[i]` is player i's team. */
  setTeams(teams: number[]): void {
    this.players.forEach((p, i) => (p.team = teams[i] ?? i));
    this.team = this.players.map((p) => this.players.filter((q) => q.team === p.team).map((q) => q.id));
  }

  /** The players sharing `player`'s team, itself included. */
  allies(player: number): Player[] {
    return this.players.filter((p) => p.team === this.players[player].team);
  }

  /** A player with no building left is defeated; the last team standing wins (`winner` is one of its players). */
  private judge(): void {
    if (this.winner !== null) return;
    const alive = this.players.filter((p) => [...this.entities.values()].some((e) => e.owner === p.id && e.def.kind === 'building'));
    if (alive.length === 0) this.winner = -1;
    else if (alive.every((p) => p.team === alive[0].team)) this.winner = alive[0].id;
  }

  // ---------------------------------------------------------------- players

  supply(player: number): { used: number; max: number } {
    let used = 0;
    let max = 0;
    for (const e of this.entities.values()) {
      if (e.owner !== player) continue;
      if (e.def.kind === 'unit') {
        used += e.def.supply;
        for (const t of e.queue) used += (DEFS[t] as UnitDef).supply;
      } else if (e.def.kind === 'building') {
        if (e.def.supply < 0) used -= e.def.supply;
        else if (e.buildLeft === 0) max += e.def.supply;
        for (const t of e.queue) if (DEFS[t].kind === 'unit') used += (DEFS[t] as UnitDef).supply;
      }
    }
    return { used, max: Math.min(200, max) };
  }

  pay(player: number, def: { cost: Cost }): boolean {
    const p = this.players[player];
    if (p.minerals < def.cost.minerals) return this.say(player, 'Pas assez de minerai.');
    if (p.energy < def.cost.energy) return this.say(player, "Pas assez d'énergie.");
    p.minerals -= def.cost.minerals;
    p.energy -= def.cost.energy;
    return true;
  }

  refund(player: number, def: { cost: Cost }): void {
    this.players[player].minerals += def.cost.minerals;
    this.players[player].energy += def.cost.energy;
  }

  say(player: number, text: string, kind: GameEvent['kind'] = 'error'): false {
    this.events.push({ player, text, kind });
    return false;
  }

  // ---------------------------------------------------------------- commands

  /** Is this upgrade the next level of its line, counting the levels already queued? */
  researchable(player: number, type: string): boolean {
    const up = DEFS[type];
    if (up?.kind !== 'upgrade' || up.faction !== this.players[player].faction) return false;
    let level = this.level(player, up.line);
    for (const b of this.entities.values()) {
      if (b.owner === player) for (const t of b.queue) if ((DEFS[t] as UpgradeDef).line === up.line) level++;
    }
    return up.level === level + 1;
  }

  /** Why this upgrade cannot be researched yet (missing buildings), or '' if it can. */
  /** Level researched in an upgrade line (0: none). */
  level(player: number, line: UpgradeLine): number {
    return this.players[player].upgrades[line] ?? 0;
  }

  lacks(player: number, type: string): string {
    if ((DEFS[type] as BuildingDef | UnitDef).unique && [...this.entities.values()].some((b) => b.owner === player && (b.type === type || b.queue.includes(type)))) return 'Un seul par joueur.';
    const mourn = this.mourning.get(`${player}:${type}`) ?? 0;
    if (mourn > this.tick) return `En deuil : réinvocation dans ${Math.ceil((mourn - this.tick) / ticks(1))} s.`;
    const any = (DEFS[type] as BuildingDef).requiresAny;
    if (any && [...this.entities.values()].filter((b) => b.owner === player && any.of.includes(b.type) && b.buildLeft === 0).length < any.count) {
      return `Requiert : ${any.count} parmi ${any.of.map((t) => DEFS[t].name).join(', ')}`;
    }
    const req = (DEFS[type] as UpgradeDef | UnitDef | BuildingDef).requires ?? {};
    const missing = Object.entries(req)
      .filter(([t, n]) =>
        DEFS[t].kind === 'upgrade'
          ? this.level(player, (DEFS[t] as UpgradeDef).line) < (DEFS[t] as UpgradeDef).level
          : [...this.entities.values()].filter((b) => b.owner === player && b.type === t && b.buildLeft === 0).length < n,
      )
      .map(([t, n]) => (n > 1 ? `${n} × ${DEFS[t].name}` : DEFS[t].name));
    return missing.length ? `Requiert : ${missing.join(', ')}` : '';
  }

  /** While applying a shift-command: new orders go to the end of each unit's list. */
  queueing = false;

  // ---------------------------------------------------------------- placement

  // ---------------------------------------------------------------- unit behaviour

  private think(e: Entity): void {
    if (e.inside) return this.shelter(e);
    // A god summons only while it stands still (even pushed onto a blocked tile, which it steps off without a goal).
    if (e.queue.length && !e.goal && e.held === 0) this.produce(e);
    // Caught under a new building (with or without orders): walk out first.
    if (!flies(e) && !this.grid.open(tileOf(e.x), tileOf(e.y))) return this.evict(e);
    if (e.held > 0) return;
    // Célérité naine: a Nain leaps at the enemy it goes for.
    if (e.type === 'nain' && e.order?.kind === 'attack' && e.abilityCd === 0 && e.boost === 0 && this.level(e.owner, 'celerite')) {
      const C = BALANCE.rules.upgrades.celerite;
      const t = this.entities.get(e.order.target);
      if (t && this.gap(e, t) > FP && this.gap(e, t) <= toFp(C.range)) {
        e.boost = ticks(C.seconds);
        e.speed = speedPerTick((e.def as UnitDef).speed * C.speed);
        e.abilityCd = ticks(C.cooldown);
      }
    }
    if (e.burrowed) {
      // Under ground it waits, and bursts out when an enemy walker comes near.
      e.order = null;
      const r = toFp(ABILITIES.enfouissement.radius!);
      for (const t of this.entities.values()) {
        if (t.def.kind === 'unit' && !flies(t) && this.hostile(t.owner, e.owner) && t.hp > 0 && dist(t.x, t.y, e.x, e.y) <= r && this.sees(e.owner, t)) {
          e.burrowed = false;
          return this.setOrder(e, { kind: 'attack', target: t.id, auto: true, lx: e.x, ly: e.y });
        }
      }
      return;
    }
    const o = e.order;
    if (!o) {
      if ((this.tick + e.id) % 4 === 0) this.acquire(e);
      if (!e.order && !flies(e)) this.evict(e);
      return;
    }
    switch (o.kind) {
      case 'cast': {
        const ab = ABILITIES[o.ability];
        if (e.abilityCd > 0) return this.setOrder(e, null);
        if (dist(e.x, e.y, o.x, o.y) > toFp(ab.range ?? 0)) {
          if (this.goTo(e, o.x, o.y)) this.setOrder(e, null);
          return;
        }
        if (!this.castAt(e, o.ability, o.x, o.y)) this.say(e.owner, `${ab.name} : rien à viser ici.`);
        return this.setOrder(e, null);
      }
      case 'attack':
      case 'attackMove':
      case 'heal':
        return this.fight(e, o);
      case 'enter': {
        const b = this.entities.get(o.target);
        const room = b && this.room(b);
        if (!b || !room || b.hp <= 0 || b.owner !== e.owner) return this.setOrder(e, null);
        if (b.def.kind === 'unit') {
          // A carrier (Scarabée, Bourdon): walk up to it, wherever it goes.
          if (this.gap(e, b) > FP / 2) return this.chase(e, b);
        } else if (!this.reachRect(e, b.tx, b.ty, (b.def as BuildingDef).size)) return void this.goNear(e, b.tx, b.ty, (b.def as BuildingDef).size);
        if ([...this.entities.values()].filter((u) => u.inside === b.id).length >= room) {
          this.say(e.owner, `${b.def.name} : plein.`);
          return this.setOrder(e, null);
        }
        this.setOrder(e, null);
        e.inside = b.id;
        e.x = e.px = b.x;
        e.y = e.py = b.y;
        e.path = [];
        e.goal = null;
        return;
      }
      case 'move':
        if (dist(e.x, e.y, o.x, o.y) <= o.arrive && this.touchesIdleFriend(e)) return this.setOrder(e, null);
        if (this.goTo(e, o.x, o.y)) this.setOrder(e, null);
        return;
      case 'build': {
        const def = DEFS[o.type] as BuildingDef;
        if (e.stuck > 5) {
          this.say(e.owner, 'Emplacement inaccessible.');
          return this.setOrder(e, null);
        }
        // Isdaris workers only need to see the site: the building is beamed down from orbit.
        const cx = o.tx * FP + (def.size * FP) / 2;
        const cy = o.ty * FP + (def.size * FP) / 2;
        const there = def.warp ? dist(e.x, e.y, cx, cy) <= WARP_RANGE * FP : this.reachRect(e, o.tx, o.ty, def.size);
        if (!there) {
          if (def.warp) {
            if (this.goTo(e, cx, cy)) this.setOrder(e, null);
          } else this.goNear(e, o.tx, o.ty, def.size);
          return;
        }
        if (!this.canPlace(o.type, o.tx, o.ty, e.owner)) {
          this.say(e.owner, this.misplaced(def, o.tx, o.ty, e.owner));
          return this.setOrder(e, null);
        }
        if (!this.pay(e.owner, def)) return this.setOrder(e, null);
        const b = this.spawn(o.type, e.owner, o.tx * FP, o.ty * FP);
        b.buildLeft = ticks(def.buildTime);
        b.hp = Math.max(1, idiv(b.maxHp, 10));
        b.shield = 0;
        if (def.absorbs) {
          // The drone becomes part of the structure, which then assembles itself.
          b.absorbed = e.id;
          this.setOrder(e, null);
          this.remove(e);
          return;
        }
        this.setOrder(e, def.warp ? null : { kind: 'construct', target: b.id });
        return;
      }
      case 'construct': {
        const b = this.entities.get(o.target);
        if (!b || b.buildLeft === 0 || e.stuck > 5) return this.setOrder(e, null);
        if (!this.reachRect(e, b.tx, b.ty, (b.def as BuildingDef).size)) {
          this.goNear(e, b.tx, b.ty, (b.def as BuildingDef).size);
          return;
        }
        // Each worker on site adds one tick of progress: groups build faster.
        const total = ticks((b.def as BuildingDef).buildTime);
        b.buildLeft--;
        this.grow(b, total);
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

  release(e: Entity, target: number): void {
    const f = this.entities.get(target);
    if (f?.miner === e.id) f.miner = 0;
  }

  private near(e: Entity, f: Entity, tiles: number): boolean {
    return dist(e.x, e.y, f.x, f.y) <= tiles * FP;
  }

  /** Closest mineral field; with `freeOnly`, only fields nobody is mining. */
  nearestField(e: Entity, except?: Entity, freeOnly = false): Entity | undefined {
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

  /**
   * Entities filed by 8×8-tile cell while units and buildings act (null otherwise: then every entity is scanned).
   * Positions move a little during the tick, hence the margin when reading it.
   */
  cells: Map<number, Entity[]> | null = null;

  // ---------------------------------------------------------------- buildings

  // ---------------------------------------------------------------- movement

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
      mix(e.shield);
    }
    for (const p of this.players) {
      mix(p.minerals);
      mix(p.energy);
      for (const line of Object.keys(p.upgrades).sort()) mix(p.upgrades[line] * (line.length + 1));
    }
    return h >>> 0;
  }
}

// Installed like the class's own methods: on the prototype, not enumerable.
for (const m of [commands, abilities, combat, buildings, movement]) for (const [k, f] of Object.entries(m)) Object.defineProperty(World.prototype, k, { value: f, writable: true, configurable: true });
