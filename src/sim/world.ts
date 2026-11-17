import BALANCE from '../balance.json';
import { ABILITIES, abilitiesOf, type Attack, type BuildingDef, type Cost, DEFS, type Def, type Faction, FACTIONS, HARVEST, OBSERVATION, RAPPEL, reaches, SKIN_RANGE, SKIN_REDUCTION, STIM_HP, type UnitDef, type UpgradeDef, type UpgradeLine, WEAPONS } from '../data';
import type { GameMap } from '../map';
import { FP, GAME_SPEED, TICK_RATE, dist, idiv, isqrt, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { Grid } from './grid';
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
/** Reach of the cell index beyond a search range, in tiles: the widest building's half plus a tick's walk. */
const CELL_MARGIN = 4;

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

const REACH = FP / 4;
/** The supply building of each faction, for the "not enough supply" message. */
const SUPPLY_NAMES: Record<Faction, string> = { humains: 'greniers', isdaris: 'réserves psy', z: 'pods', dieux: "branches d'Yggdrasill" };

/** How close (tiles) an Isdaris worker must be to beam a building down. */
const WARP_RANGE = 6;

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
  private shrouded = new Set<number>();
  /** Winning player once the game is over. */
  winner: number | null = null;
  private nextId = 1;
  private readonly lastAlert: Record<number, number> = {};

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

  private block(e: Entity, delta: number): void {
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
  private corpses: { x: number; y: number; tick: number }[] = [];

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

  private pay(player: number, def: { cost: Cost }): boolean {
    const p = this.players[player];
    if (p.minerals < def.cost.minerals) return this.say(player, 'Pas assez de minerai.');
    if (p.energy < def.cost.energy) return this.say(player, "Pas assez d'énergie.");
    p.minerals -= def.cost.minerals;
    p.energy -= def.cost.energy;
    return true;
  }

  private refund(player: number, def: { cost: Cost }): void {
    this.players[player].minerals += def.cost.minerals;
    this.players[player].energy += def.cost.energy;
  }

  private say(player: number, text: string, kind: GameEvent['kind'] = 'error'): false {
    this.events.push({ player, text, kind });
    return false;
  }

  // ---------------------------------------------------------------- commands

  /** The player's own entities named by a command, each once. */
  private owned(c: Command): Entity[] {
    return [...new Set(c.ids)].map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.owner === c.player);
  }

  private apply(c: Command): void {
    // Commands will come from other machines one day: reject malformed numbers.
    if (!Array.isArray(c.ids) || ('x' in c && !(Number.isSafeInteger(c.x) && Number.isSafeInteger(c.y)))) return;
    if ('tx' in c && !(Number.isSafeInteger(c.tx) && Number.isSafeInteger(c.ty))) return;
    const mine = this.owned(c);
    const units = mine.filter((e) => e.def.kind === 'unit' && e.held === 0 && !e.inside);
    const buildings = mine.filter((e) => e.def.kind === 'building' && e.buildLeft === 0);
    if (c.kind === 'move' || c.kind === 'smart' || c.kind === 'attack' || c.kind === 'patrol' || c.kind === 'stop' || c.kind === 'build' || c.kind === 'hold') {
      for (const e of units) e.stand = c.kind === 'hold';
    }
    switch (c.kind) {
      case 'stop':
      case 'hold':
        units.forEach((e) => {
          e.next = [];
          this.setOrder(e, null);
        });
        return;
      case 'patrol': {
        const fighters = units.filter((e) => this.weapon(e) || (e.def as UnitDef).heal);
        const [ox, oy] = this.formation(fighters);
        for (const [i, e] of fighters.entries()) this.setOrder(e, { kind: 'attackMove', x: c.x + ox[i], y: c.y + oy[i], target: 0, back: [e.x, e.y] });
        return;
      }
      case 'unload':
        for (const b of [...buildings, ...units]) for (const u of [...this.entities.values()]) if (u.inside === b.id) this.leave(u);
        return;
      case 'move':
        this.moveGroup(units, c.x, c.y);
        return;
      case 'smart':
        this.smart(c, units, buildings);
        return;
      case 'attack': {
        const t = this.target(c);
        const fighters = units.filter((e) => this.weapon(e));
        if (t && this.hostile(t.owner, c.player)) {
          // Those that cannot hit it (a flyer, for melee) attack-move to where it is.
          for (const e of fighters) {
            if (reaches(this.weapon(e)!, t.def.kind === 'unit' && flies(t))) this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
            else this.setOrder(e, { kind: 'attackMove', x: t.x, y: t.y, target: 0 });
          }
        } else {
          // A compact group keeps its formation, as with a plain move.
          const [ox, oy] = this.formation(fighters);
          for (const [i, e] of fighters.entries()) this.setOrder(e, { kind: 'attackMove', x: c.x + ox[i], y: c.y + oy[i], target: 0 });
        }
        return;
      }
      case 'build': {
        const worker = units.find((e) => (e.def as UnitDef).builder ?? (e.def as UnitDef).worker);
        const bdef = DEFS[c.type];
        if (!worker || bdef?.kind !== 'building' || bdef.faction !== this.players[c.player].faction) return;
        const lack = this.lacks(c.player, c.type);
        if (lack) return void this.say(c.player, lack);
        if (!this.canPlace(c.type, c.tx, c.ty, c.player)) return void this.say(c.player, this.misplaced(bdef, c.tx, c.ty, c.player));
        this.setOrder(worker, { kind: 'build', type: c.type, tx: c.tx, ty: c.ty });
        return;
      }
      case 'train': {
        // Gods summon too (Dieux). The least busy producer takes it: shortest queue, then the one whose current item
        // ends first, then the lowest id (deterministic); full ones are skipped.
        const producers = [...buildings, ...units.filter((u) => (u.def as UnitDef).trains)].sort((a, b) => a.queue.length - b.queue.length || a.trainLeft - b.trainLeft || a.id - b.id);
        let full = false;
        for (const b of producers) {
          const def = b.def as BuildingDef;
          if (def.researches?.includes(c.type)) {
            if (!this.researchable(c.player, c.type)) return;
            const lack = this.lacks(c.player, c.type);
            if (lack) return void this.say(c.player, lack);
            if (b.queue.length >= 5) {
              full = true;
              continue;
            }
            const up = DEFS[c.type] as UpgradeDef;
            if (!this.pay(c.player, up)) return;
            b.queue.push(c.type);
            if (b.queue.length === 1) b.trainLeft = ticks(up.buildTime);
            return;
          }
          if (def.morphs?.includes(c.type)) {
            // Turning into another building (Isdaris): one at a time, nothing else queued.
            if (b.queue.length) continue;
            const lack = this.lacks(c.player, c.type);
            if (lack) return void this.say(c.player, lack);
            const into = DEFS[c.type] as BuildingDef;
            if (!this.pay(c.player, into)) return;
            b.queue.push(c.type);
            b.trainLeft = ticks(into.buildTime);
            return;
          }
          if (!def.trains?.includes(c.type)) continue;
          const missing = this.lacks(c.player, c.type);
          if (missing) return void this.say(c.player, missing);
          if (b.queue.length >= 5) {
            full = true;
            continue;
          }
          const unit = DEFS[c.type] as UnitDef;
          const s = this.supply(c.player);
          if (s.used + unit.supply > s.max) return void this.say(c.player, `Logistique insuffisante : construisez des ${SUPPLY_NAMES[this.players[c.player].faction]}.`);
          if (!this.pay(c.player, unit)) return;
          b.queue.push(c.type);
          if (b.queue.length === 1) b.trainLeft = this.trainTime(b, c.type);
          return; // one building per command, like SC
        }
        if (full) this.say(c.player, "File d'attente pleine.");
        return;
      }
      case 'cancel':
        for (const b of mine) {
          if (b.def.kind !== 'building' && !(b.def as UnitDef).trains) continue;
          if (b.def.kind === 'building' && b.buildLeft > 0) {
            this.refund(c.player, b.def);
            this.remove(b);
          } else if (b.queue.length) {
            this.refund(c.player, DEFS[b.queue.pop()!] as UnitDef | UpgradeDef);
            if (b.queue.length) b.trainLeft = Math.max(b.trainLeft, 1);
          }
        }
        return;
      case 'trade': {
        const market = buildings.find((b) => b.type === 'marche' && b.buildLeft === 0);
        const p = this.players[c.player];
        const { give, get } = BALANCE.rules.trade;
        if (!market) return;
        if (p[c.sell] < give) return void this.say(c.player, c.sell === 'minerals' ? 'Pas assez de minerai.' : "Pas assez d'énergie.");
        p[c.sell] -= give;
        p[c.sell === 'minerals' ? 'energy' : 'minerals'] += get;
        return;
      }
      case 'equip': {
        const kit = WEAPONS[c.weapon];
        if (!kit) return;
        if (kit.research && !this.level(c.player, kit.research)) return void this.say(c.player, `Requiert : ${DEFS[kit.research].name}`);
        if (![...this.entities.values()].some((b) => b.owner === c.player && b.type === 'plateforme' && b.buildLeft === 0)) return void this.say(c.player, `Requiert : ${DEFS.plateforme.name}`);
        // The socle stops a moment while the kit is mounted.
        for (const e of units) {
          if (!(e.def as UnitDef).weapons?.includes(c.weapon) || e.kit === c.weapon) continue;
          if (!this.pay(c.player, kit)) return;
          e.kit = c.weapon;
          e.cooldown = 0;
          e.held = ticks(BALANCE.rules.equipSeconds);
          this.setOrder(e, null);
        }
        return;
      }
      case 'ability': {
        const named = c.name && buildings.find((b) => abilitiesOf(b.def as BuildingDef).includes(c.name!) && b.abilityCd === 0);
        if (c.name && !named) {
          // A named unit ability: aimed ones by the ready caster nearest the point, the others by every ready caster.
          const ab = ABILITIES[c.name];
          if (!ab) return;
          if (ab.research && !this.level(c.player, ab.research)) return void this.say(c.player, `Requiert : ${DEFS[ab.research].name}`);
          const casters = units.filter((e) => abilitiesOf(e.def as UnitDef).includes(c.name!) && e.abilityCd === 0);
          if (ab.target !== 'point') return void casters.forEach((e) => this.cast(e, c.name));
          if (c.x === undefined || c.y === undefined || !casters.length) return;
          const [x, y] = [c.x, c.y];
          const e = casters.sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
          return void this.setOrder(e, { kind: 'cast', ability: c.name, x, y });
        }
        for (const e of units) this.cast(e);
        const b = named || buildings.find((b) => (b.def as BuildingDef).ability && b.abilityCd === 0);
        if (b && c.name === 'envol') return void this.takeOff(b);
        if (!b || c.x === undefined || c.y === undefined) return;
        const kind = c.name ?? (b.def as BuildingDef).ability!;
        const ab = ABILITIES[kind];
        if (this.silenced(b.x, b.y)) return void this.say(c.player, 'Silence des ions : impossible ici.');
        if (ab.research && !this.level(c.player, ab.research)) return void this.say(c.player, `Requiert : ${DEFS[ab.research].name}`);
        if (this.players[c.player].energy < ab.energy!) return void this.say(c.player, "Pas assez d'énergie.");
        if (kind === 'rappel' && !this.recall(b, c.x, c.y)) return void this.say(c.player, 'Aucune unité à rappeler.');
        if (kind === 'observation') this.scans.push({ owner: c.player, x: c.x, y: c.y, left: ticks(ab.duration) });
        if (kind === 'observatoire') this.scans.push({ owner: c.player, x: c.x, y: c.y, left: ticks(ab.duration), radius: ab.radius });
        if (kind === 'canonorbital') {
          // The beam needs an Espion watching the spot; it spares nothing under it.
          const [cx, cy] = [c.x, c.y];
          if (![...this.entities.values()].some((s) => s.owner === c.player && s.type === 'espion' && dist(s.x, s.y, cx, cy) <= toFp((s.def as UnitDef).sight))) return void this.say(c.player, 'Un Espion doit viser la cible.');
          for (const t of [...this.entities.values()]) if (t.def.kind !== 'resource' && t.hp > 0 && !t.inside && dist(t.x, t.y, cx, cy) <= toFp(ab.radius!)) this.hurt(t, ab.damage!);
        }
        if (kind === 'murenergie') this.wall(c.player, b, c.x, c.y, ab.radius!, ticks(ab.duration));
        if (kind === 'portedephasage') for (const u of this.entities.values()) if (u.owner === c.player && u.def.kind === 'unit' && dist(u.x, u.y, c.x, c.y) <= toFp(ab.radius!)) u.phased = ticks(ab.duration);
        this.casts.push({ kind, x: c.x, y: c.y });
        this.players[c.player].energy -= ab.energy!;
        b.abilityCd = ticks(ab.cooldown);
        return;
      }
    }
  }

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

  /** Rappel: holds the army units around (x, y) for the channel; false if there are none. */
  private recall(b: Entity, x: number, y: number): boolean {
    const ids = [...this.entities.values()]
      .filter((e) => e.owner === b.owner && e.def.kind === 'unit' && !e.def.worker && e.held === 0 && dist(e.x, e.y, x, y) <= RAPPEL.radius * FP)
      .sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)
      .slice(0, RAPPEL.max)
      .map((e) => e.id);
    if (!ids.length) return false;
    const left = ticks(ABILITIES.rappel.duration);
    for (const id of ids) {
      const e = this.entities.get(id)!;
      this.setOrder(e, null);
      e.held = left + 1;
    }
    this.recalls.push({ owner: b.owner, from: b.id, x, y, ids, left });
    this.teleports.push({ phase: 'start', owner: b.owner, x1: x, y1: y, x2: b.x, y2: b.y, ids });
    return true;
  }

  /** End of a Rappel's channel: the surviving units appear on the open tiles around the Obélisque, if it still stands. */
  private land(r: World['recalls'][number]): void {
    const b = this.entities.get(r.from);
    const units = r.ids.map((id) => this.entities.get(id)).filter((e): e is Entity => !!e && e.hp > 0);
    if (!b || b.hp <= 0) {
      for (const e of units) e.held = 0;
      return;
    }
    const size = (b.def as BuildingDef).size;
    const ring: number[] = [];
    for (let ty = b.ty - 1; ty <= b.ty + size; ty++) {
      for (let tx = b.tx - 1; tx <= b.tx + size; tx++) {
        if ((tx === b.tx - 1 || tx === b.tx + size || ty === b.ty - 1 || ty === b.ty + size) && this.grid.open(tx, ty)) ring.push(tx, ty);
      }
    }
    if (!ring.length) ring.push(...this.grid.nearestOpen(b.tx + size, b.ty + size, this.grid.level(b.tx, b.ty)));
    units.forEach((e, i) => {
      const k = (i * 2) % ring.length;
      e.x = e.px = ring[k] * FP + FP / 2;
      e.y = e.py = ring[k + 1] * FP + FP / 2;
      e.held = ticks(RAPPEL.daze);
    });
    this.teleports.push({ phase: 'end', owner: r.owner, x1: r.x, y1: r.y, x2: b.x, y2: b.y, ids: units.map((e) => e.id) });
  }

  /** Uses the unit's active ability if it is ready. */
  /** Uses an ability on the spot (by default the unit's first one); aimed ones go through castAt. */
  private cast(e: Entity, name = (e.def as UnitDef).ability): void {
    const def = e.def as UnitDef;
    const ab = name && ABILITIES[name];
    if (!ab || ab.target === 'point' || e.abilityCd > 0 || (ab.research && !this.level(e.owner, ab.research)) || this.silenced(e.x, e.y)) return;
    const around = (r: number, test: (t: Entity) => boolean) => [...this.entities.values()].filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, e.x, e.y) <= toFp(r) && test(t));
    if (name === 'enfouissement') {
      e.burrowed = !e.burrowed;
      this.setOrder(e, null);
    } else if (name === 'feucirculaire') {
      for (const t of around(ab.radius!, (t) => this.hostile(t.owner, e.owner))) this.hit(e, t, { damage: ab.damage!, range: 1, cooldown: 0 });
    } else if (name === 'manteau') {
      for (const t of around(ab.radius!, (t) => t.owner === e.owner)) t.camo = ticks(ab.duration);
    } else if (name === 'dephasage') {
      e.phased = ticks(ab.duration);
    } else if (name === 'couloir') {
      // Through the corridor to the nearest other Espion of ours.
      const other = [...this.entities.values()].filter((o) => o !== e && o.owner === e.owner && o.type === 'espion').sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.id - b.id)[0];
      if (!other) return void this.say(e.owner, 'Il faut un second Espion.');
      for (const t of around(ab.radius!, (t) => t.owner === e.owner && t !== e && !flies(t)).slice(0, ab.max)) this.place(t, other.x, other.y);
    } else if (name === 'decollage') {
      // Take off, or land where the ground is open; either takes a moment.
      if (e.airborne && !this.grid.open(tileOf(e.x), tileOf(e.y))) return void this.say(e.owner, 'Impossible d’atterrir ici.');
      e.airborne = !e.airborne;
      e.held = ticks(ab.duration);
      e.path = [];
      e.goal = null;
    } else if (name === 'coupcirculaire') {
      // A sweeping blow: every enemy on the ground within reach (poisoned too, with Lames empoisonnées).
      for (const t of [...this.entities.values()]) {
        if (t.def.kind !== 'unit' || t.hp <= 0 || t.inside || flies(t) || !this.hostile(t.owner, e.owner) || this.gap(e, t) > toFp(ab.radius!)) continue;
        this.hit(e, t, { damage: ab.damage!, range: 0.1, cooldown: 0 });
      }
    } else if (name === 'camouflage') {
      e.camo = ticks(ab.duration);
    } else if (name === 'courroux') {
      e.charged = ticks(ab.duration);
    } else if (name === 'peauderoc') {
      // The most wounded ally in range (itself included) not already protected.
      let best: Entity | undefined;
      for (const t of this.entities.values()) {
        if (t.owner !== e.owner || t.def.kind !== 'unit' || t.skin > 0 || t.hp <= 0 || this.gap(e, t) > SKIN_RANGE * FP) continue;
        if (!best || t.hp * best.maxHp < best.hp * t.maxHp) best = t;
      }
      if (!best) return;
      best.skin = ticks(ab.duration);
      this.shots.push({ x1: e.x, y1: e.y, x2: best.x, y2: best.y, kind: 'heal' });
    } else {
      if (def.ability === 'stimulant') {
        if (e.hp <= STIM_HP) return;
        e.hp -= STIM_HP;
      }
      e.boost = ticks(ab.duration);
      e.speed = speedPerTick(def.speed * (def.ability === 'charge' ? 2 : 1.5));
    }
    e.abilityCd = ticks(ab.cooldown);
    this.casts.push({ kind: name!, x: e.x, y: e.y });
  }

  /** An aimed ability, the caster in range of (x, y). False when there is nothing there to use it on. */
  private castAt(e: Entity, name: string, x: number, y: number): boolean {
    const ab = ABILITIES[name];
    const near = (test: (t: Entity) => boolean) =>
      [...this.entities.values()]
        .filter((t) => t.def.kind === 'unit' && t.hp > 0 && !t.inside && dist(t.x, t.y, x, y) <= toFp(ab.radius!) && test(t))
        .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id);
    if (this.silenced(e.x, e.y)) return false;
    if (name === 'atterrissage') {
      const size = (DEFS.casernevolante as BuildingDef).size;
      const [tx, ty] = [tileOf(x) - (size >> 1), tileOf(y) - (size >> 1)];
      if (!this.canPlace('casernevolante', tx, ty, e.owner)) {
        this.say(e.owner, 'Impossible d’atterrir ici.');
        return true;
      }
      this.transmute(e, 'casernevolante', tx, ty);
      return true;
    }
    if (name === 'chocmental') {
      const t = near((t) => this.hostile(t.owner, e.owner))[0];
      if (!t) return false;
      t.held = Math.max(t.held, ticks(ab.duration));
    } else if (name === 'double') {
      const t = near((t) => t.owner === e.owner && t.type !== 'cadavre')[0];
      if (!t) return false;
      const copy = this.spawn(t.type, e.owner, t.x + FP, t.y);
      copy.ttl = ticks(ab.duration);
    } else if (name === 'deflagration') {
      const t = [...this.entities.values()]
        .filter((t) => t.def.kind !== 'resource' && t.hp > 0 && this.hostile(t.owner, e.owner) && dist(t.x, t.y, x, y) <= toFp(ab.radius!) + t.radius)
        .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
      if (!t) return false;
      this.hit(e, t, { damage: ab.damage!, range: 7, cooldown: 0 });
    } else if (name === 'silence') {
      this.silences.push({ x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
    } else if (name === 'tempete') {
      this.storms.push({ owner: e.owner, x, y, r: toFp(ab.radius!), until: this.tick + ticks(ab.duration) });
    } else if (name === 'flechegaia') {
      const t = [...this.entities.values()]
        .filter((t) => t.def.kind !== 'resource' && t.hp > 0 && this.hostile(t.owner, e.owner) && dist(t.x, t.y, x, y) <= toFp(ab.radius!) + t.radius)
        .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
      if (!t) return false;
      this.hit(e, t, { damage: ab.damage!, range: ab.range!, cooldown: 0 });
    } else if (name === 'pluiedefeu') {
      const foes = near((t) => this.hostile(t.owner, e.owner));
      if (!foes.length) return false;
      for (const t of foes) this.hurt(t, ab.damage!);
    } else if (name === 'teleportgaia') {
      const b = [...this.entities.values()].filter((b) => b.owner === e.owner && b.def.kind === 'building' && b.buildLeft === 0).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
      if (!b) return false;
      this.place(e, b.x, b.y + ((b.def as BuildingDef).size * FP) / 2 + e.radius + FP / 2);
    } else if (name === 'teleport') {
      this.place(e, x, y);
    } else if (name === 'teleportgroupe') {
      const b = [...this.entities.values()].filter((b) => b.owner === e.owner && b.def.kind === 'building' && b.buildLeft === 0).sort((a, c) => dist(a.x, a.y, x, y) - dist(c.x, c.y, x, y) || a.id - c.id)[0];
      if (!b) return false;
      const group = [...this.entities.values()].filter((t) => t.owner === e.owner && t.def.kind === 'unit' && !t.inside && dist(t.x, t.y, e.x, e.y) <= toFp(ab.radius!)).slice(0, ab.max);
      for (const t of group) this.place(t, b.x, b.y + ((b.def as BuildingDef).size * FP) / 2 + FP);
    } else if (name === 'renvoi') {
      const t = near((t) => t.owner === e.owner)[0];
      if (!t) return false;
      t.reflect = ticks(ab.duration);
    } else if (name === 'explosiftoxique') {
      for (const t of near((t) => this.hostile(t.owner, e.owner))) t.poison = Math.max(t.poison, ticks(ab.duration));
    } else if (name === 'regenerant') {
      const t = near((t) => t.owner === e.owner && !(t.def as UnitDef).mechanical)[0];
      if (!t) return false;
      t.invuln = ticks(ab.duration);
    } else if (name === 'reanimation') {
      const i = this.corpses.findIndex((c) => dist(c.x, c.y, x, y) <= toFp(ab.radius!));
      if (i < 0) return false;
      const [c] = this.corpses.splice(i, 1);
      const u = this.spawn('cadavre', e.owner, c.x, c.y);
      u.ttl = ticks(ab.duration);
    } else if (name === 'napalm') {
      const t = near((t) => !!(t.def as UnitDef).mechanical)[0];
      if (!t) return false;
      if (this.hostile(t.owner, e.owner)) {
        this.hit(e, t, { damage: ab.damage!, range: 6, cooldown: 0 });
        t.held = Math.max(t.held, ticks(ab.duration));
      } else t.hp = Math.min(t.maxHp, t.hp + 2 * ab.damage!);
    }
    // Téléportation rapide: the teleport comes back twice as fast.
    e.abilityCd = name === 'teleport' && this.level(e.owner, 'teleportrapide') ? idiv(ticks(ab.cooldown) * (100 - BALANCE.rules.upgrades.teleportrapide), 100) : ticks(ab.cooldown);
    this.casts.push({ kind: name, x, y });
    return true;
  }

  /** Puts a unit at (x, y), or on the nearest open tile there for a walker; it stops what it was doing. */
  private place(t: Entity, x: number, y: number): void {
    if (!flies(t)) {
      const [ox, oy] = this.grid.nearestOpen(tileOf(x), tileOf(y), -1);
      [x, y] = [ox * FP + FP / 2, oy * FP + FP / 2];
    }
    t.x = t.px = x;
    t.y = t.py = y;
    if (this.cells) this.file(t); // teleported: findable at its new spot this tick
    t.path = [];
    t.goal = null;
    this.setOrder(t, null);
  }

  /**
   * Mur d'énergie: a line of tiles across (x, y), square to the caster's direction, blocked for a while.
   * Walkers caught on it are pushed off.
   */
  private wall(owner: number, from: Entity, x: number, y: number, half: number, left: number): void {
    const d = dist(from.x, from.y, x, y) || 1;
    const [ux, uy] = [-(y - from.y) / d, (x - from.x) / d];
    const tiles = new Set<number>();
    for (let k = -half * 2; k <= half * 2; k++) {
      const [tx, ty] = [tileOf(x + Math.trunc((ux * k * FP) / 2)), tileOf(y + Math.trunc((uy * k * FP) / 2))];
      if (this.grid.inside(tx, ty)) tiles.add(ty * this.grid.width + tx);
    }
    for (const i of tiles) this.grid.blocked[i]++;
    this.walls.push({ owner, tiles: [...tiles], left });
    for (const u of this.entities.values()) if (u.def.kind === 'unit' && !flies(u) && !u.inside && tiles.has(tileOf(u.y) * this.grid.width + tileOf(u.x))) this.place(u, u.x, u.y);
  }

  /** Where a shot from (x1, y1) to (x2, y2) meets a Mur d'énergie, if it does. */
  walled(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } | undefined {
    if (!this.walls.length) return undefined;
    const steps = Math.ceil((dist(x1, y1, x2, y2) * 2) / FP);
    for (let k = 1; k < steps; k++) {
      const [x, y] = [x1 + Math.trunc(((x2 - x1) * k) / steps), y1 + Math.trunc(((y2 - y1) * k) / steps)];
      const i = tileOf(y) * this.grid.width + tileOf(x);
      if (this.walls.some((m) => m.tiles.includes(i))) return { x, y };
    }
    return undefined;
  }

  /** Caserne volante: takes off, a slow flyer; anything queued must be finished or cancelled first. */
  private takeOff(b: Entity): void {
    if (b.queue.length) return void this.say(b.owner, 'Production en cours.');
    this.transmute(b, 'casernevol');
  }

  /** A building that becomes a unit, or back (at tiles tx, ty), keeping its id, rally and share of hit points. */
  private transmute(e: Entity, type: string, tx = 0, ty = 0): void {
    const def = DEFS[type] as UnitDef | BuildingDef;
    const hp = e.hp / e.maxHp;
    if (e.def.kind === 'building') this.block(e, -1);
    e.type = type;
    e.def = def;
    e.maxHp = def.hp;
    e.hp = Math.max(1, Math.round(def.hp * hp));
    e.path = [];
    e.goal = null;
    this.setOrder(e, null);
    if (def.kind === 'unit') {
      e.radius = toFp(def.radius);
      e.speed = speedPerTick(def.speed);
      return;
    }
    e.radius = (def.size * FP) / 2;
    e.speed = 0;
    [e.tx, e.ty] = [tx, ty];
    e.x = e.px = tx * FP + e.radius;
    e.y = e.py = ty * FP + e.radius;
    this.block(e, 1);
  }

  /** Unseen by enemies without detection: invisible units, and Belluaires under Camouflage. */
  hidden(e: Entity): boolean {
    return !!(e.def as UnitDef).cloaked || e.camo > 0 || e.burrowed || this.shrouded.has(e.id);
  }

  /** Inside a Silence des ions zone: no ability can be used there. */
  silenced(x: number, y: number): boolean {
    return this.silences.some((z) => z.until > this.tick && dist(z.x, z.y, x, y) <= z.r);
  }

  private smart(c: Extract<Command, { kind: 'smart' }>, units: Entity[], buildings: Entity[]): void {
    const t = this.target(c);
    for (const b of buildings) {
      if (!(b.def as BuildingDef).trains) continue;
      b.rally = { x: c.x, y: c.y };
      b.rallyTarget = t?.type === 'minerai' ? t.id : 0;
    }
    const movers: Entity[] = [];
    for (const e of units) {
      const worker = (e.def as UnitDef).worker;
      if (t && this.hostile(t.owner, e.owner) && this.weapon(e) && reaches(this.weapon(e)!, t.def.kind === 'unit' && flies(t))) {
        this.setOrder(e, { kind: 'attack', target: t.id, auto: false, lx: e.x, ly: e.y });
      } else if (!worker && t && t.owner === e.owner && t.def.kind === 'unit' && (e.def as UnitDef).heal && t.hp < t.maxHp) {
        this.setOrder(e, { kind: 'heal', target: t.id });
      } else if (worker && t?.def.kind === 'resource' && t.type === 'minerai') {
        this.setOrder(e, { kind: 'gather', target: t.id, phase: 'go', timer: 0 });
      } else if (worker && t && t.owner === e.owner && t.def.kind === 'building' && t.buildLeft > 0 && !(t.def as BuildingDef).warp && !(t.def as BuildingDef).absorbs) {
        this.setOrder(e, { kind: 'construct', target: t.id });
      } else if (!worker && t && t !== e && t.owner === e.owner && this.room(t) && t.buildLeft === 0 && !flies(e) && this.boards(e, t)) {
        this.setOrder(e, { kind: 'enter', target: t.id });
      } else if (worker && t && t.owner === e.owner && (t.def as BuildingDef).dropoff && e.carry > 0) {
        this.setOrder(e, { kind: 'gather', target: this.nearestField(e)?.id ?? 0, phase: 'return', timer: 0 });
      } else {
        movers.push(e);
      }
    }
    this.moveGroup(movers, c.x, c.y);
  }

  /** A command's target, only if the player can see it (no clicking enemies through the fog). */
  private target(c: { player: number; target?: number }): Entity | undefined {
    const t = c.target !== undefined ? this.entities.get(c.target) : undefined;
    return t && (t.owner < 0 || this.sees(c.player, t)) ? t : undefined;
  }

  private moveGroup(units: Entity[], x: number, y: number): void {
    if (units.length === 0) return;
    // A compact group keeps its formation; a spread-out one gathers into a block round the point.
    const [ox, oy] = this.formation(units, [x, y]);
    for (const [i, e] of units.entries()) this.setOrder(e, { kind: 'move', x: x + ox[i], y: y + oy[i], arrive: FP / 4 });
  }

  /**
   * Each unit's offset from the destination. A compact group keeps its formation. A spread-out one converges on the
   * point, or, given the point (`to`, a plain move), gets a slot each in a block facing the way it goes: rows across
   * the march, the units nearest the point in the front row, each row filled left to right as the units stand. All of
   * it is reckoned along the march, not the map's axes, so two mirrored groups get mirrored blocks (no side favoured).
   */
  private formation(units: Entity[], to?: [number, number]): [number[], number[], boolean] {
    const n = Math.max(1, units.length);
    const cx = idiv(units.reduce((s, e) => s + e.x, 0), n);
    const cy = idiv(units.reduce((s, e) => s + e.y, 0), n);
    const compact = units.every((e) => dist(e.x, e.y, cx, cy) < 4 * FP);
    if (compact || !to || units.length === 1) return [units.map((e) => (compact ? e.x - cx : 0)), units.map((e) => (compact ? e.y - cy : 0)), compact];
    // The march: from the group's centre to the point (straight "down" if it is already there).
    let [dx, dy] = [to[0] - cx, to[1] - cy];
    if (dx === 0 && dy === 0) dy = FP;
    const len = isqrt(dx * dx + dy * dy);
    const along = (e: Entity) => (e.x - cx) * dx + (e.y - cy) * dy; // larger: nearer the point
    const across = (e: Entity) => (e.y - cy) * dx - (e.x - cx) * dy; // larger: further left of the march
    const cols = isqrt(units.length - 1) + 1;
    const rows = idiv(units.length + cols - 1, cols);
    const step = 2 * units.reduce((m, e) => Math.max(m, e.radius), 0) + FP / 4; // even, so the block is centred exactly
    const order = units.map((_, i) => i).sort((a, b) => along(units[b]) - along(units[a]) || units[a].id - units[b].id);
    const ox: number[] = new Array(units.length);
    const oy: number[] = new Array(units.length);
    for (let r = 0; r < rows; r++) {
      // Front row first; in each row, the units from right to left of the march take the slots right to left.
      const row = order.slice(r * cols, r * cols + cols).sort((a, b) => across(units[a]) - across(units[b]) || units[a].id - units[b].id);
      const fwd = idiv((rows - 1) * step, 2) - r * step;
      row.forEach((u, c) => {
        const side = c * step - idiv((row.length - 1) * step, 2);
        ox[u] = idiv(dx * fwd - dy * side, len);
        oy[u] = idiv(dy * fwd + dx * side, len);
      });
    }
    return [ox, oy, false];
  }

  /** While applying a shift-command: new orders go to the end of each unit's list. */
  private queueing = false;

  private setOrder(e: Entity, order: Order | null): void {
    if (order && this.queueing && (e.order || e.next.length)) {
      e.next.push(order);
      return;
    }
    // An order done (or dropped): the next one in the list, if any.
    if (!order && e.next.length) order = e.next.shift()!;
    const old = e.order;
    if (old?.kind === 'gather') this.release(e, old.target);
    e.order = order;
    e.goal = null;
    e.path = [];
    e.blockedTicks = 0;
    e.stuck = 0;
  }

  // ---------------------------------------------------------------- placement

  /** Can `player` put this building here? (Without a player, the power field is not checked.) */
  canPlace(type: string, tx: number, ty: number, player = -1): boolean {
    const def = DEFS[type] as BuildingDef;
    const g = this.grid;
    if (def.energyRate) {
      // Extractors go exactly on a free energy well.
      for (const w of this.entities.values()) {
        if (w.type === 'puits' && w.tx === tx && w.ty === ty) {
          return ![...this.entities.values()].some((m) => (m.def as BuildingDef).energyRate && m.def.kind === 'building' && m.tx === tx && m.ty === ty);
        }
      }
      return false;
    }
    const cx = tx * FP + (def.size * FP) / 2;
    const cy = ty * FP + (def.size * FP) / 2;
    if (def.needsPower && player >= 0 && !this.powered(player, cx, cy)) return false;
    // An emitter must join the network: its zone has to touch the zone of a linked power building.
    if (def.power && !def.dropoff && player >= 0 && !this.powerNetwork(player).some((b) => dist(b.x, b.y, cx, cy) <= (def.power! + (b.def as BuildingDef).power!) * FP)) return false;
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

  /** Why a building cannot go there: out of the power field (Isdaris), off the creep (Z), or simply blocked. */
  private misplaced(def: BuildingDef, tx: number, ty: number, player: number): string {
    if (!def.needsPower || this.powered(player, tx * FP + (def.size * FP) / 2, ty * FP + (def.size * FP) / 2)) return 'Emplacement invalide.';
    return def.faction === 'z' ? 'Hors du creep.' : "Hors d'un champ d'énergie.";
  }

  /** Is a point inside one of the player's linked power fields (Isdaris)? */
  powered(player: number, x: number, y: number): boolean {
    return this.powerNetwork(player).some((b) => dist(b.x, b.y, x, y) <= (b.def as BuildingDef).power! * FP);
  }

  /**
   * The player's power buildings that are linked to a main building (Obelisk): finished ones whose
   * zones touch, step by step. An emitter cut off from it powers nothing.
   */
  powerNetwork(player: number): Entity[] {
    const nodes = [...this.entities.values()].filter((b) => b.owner === player && (b.def as BuildingDef).power && b.buildLeft === 0);
    const linked = nodes.filter((b) => (b.def as BuildingDef).dropoff);
    const rest = nodes.filter((b) => !(b.def as BuildingDef).dropoff);
    for (let i = 0; i < linked.length; i++) {
      const a = linked[i];
      for (let j = rest.length - 1; j >= 0; j--) {
        const b = rest[j];
        if (dist(a.x, a.y, b.x, b.y) <= ((a.def as BuildingDef).power! + (b.def as BuildingDef).power!) * FP) linked.push(...rest.splice(j, 1));
      }
    }
    return linked;
  }

  /** Z units on their own creep are repaired by the cables, a few hp each second. */
  private repairOnCreep(): void {
    for (const p of this.players) {
      if (p.faction !== 'z') continue;
      const net = this.powerNetwork(p.id);
      for (const u of this.entities.values()) {
        if (u.owner !== p.id || u.def.kind !== 'unit' || u.hp <= 0 || u.hp >= u.maxHp || flies(u)) continue;
        if (net.some((b) => dist(b.x, b.y, u.x, u.y) <= (b.def as BuildingDef).power! * FP)) u.hp = Math.min(u.maxHp, u.hp + BALANCE.rules.creepRepair);
      }
    }
  }

  /** Near one of its player's finished Conseils (or the Grand Conseil). */
  private nearCouncil(e: Entity): boolean {
    const r = toFp(BALANCE.rules.upgrades.conseilAura.radius);
    for (const b of this.entities.values()) if (b.owner === e.owner && (b.type === 'conseil' || b.type === 'grandconseil') && b.buildLeft === 0 && dist(b.x, b.y, e.x, e.y) <= r) return true;
    return false;
  }

  /** Which attack upgrade line a weapon follows: Forge melee or ranged (Humans), Portail or Assembleur (Isdaris). */
  private attackLine(e: Entity, a: Attack): UpgradeLine {
    if (this.players[e.owner].faction === 'isdaris') return (e.def as UnitDef).mechanical ? 'assembleuratk' : 'portailatk';
    if (this.players[e.owner].faction === 'z') return 'zattaque';
    return a.range < 1 ? 'melee' : 'ranged';
  }

  /** Cercle d'énergie: major Isdaris buildings get a stronger shield; Boost génétique: Créatures get hp and speed. */
  private empower(u: Entity, type: string): void {
    const U = BALANCE.rules.upgrades;
    if (type.startsWith('cercle') && u.def.kind === 'building' && ['obelisque', 'portail', 'nanoassembleur', 'orbecommandement', 'trone'].includes(u.type)) {
      const extra = idiv((u.def.shield ?? 0) * U.cerclePercent, 100);
      u.maxShield += extra;
      u.shield += extra;
    } else if (type === 'boostgenetique' && u.type === 'creature') {
      const extra = idiv((u.def as UnitDef).hp * U.boost.hp, 100);
      u.maxHp += extra;
      u.hp += extra;
      u.speed = speedPerTick(((u.def as UnitDef).speed * (100 + U.boost.speed)) / 100);
    }
  }

  /** Armour from research: Armure infanterie for foot soldiers, Blindage véhicules for machines, Peau épaisse for saurians, and unit ones. */
  private armorBonus(t: Entity): number {
    const d = t.def as UnitDef;
    const faction = this.players[t.owner].faction;
    let bonus = faction === 'z' ? this.level(t.owner, 'zblindage') : faction === 'dieux' ? this.level(t.owner, 'armor') : faction === 'isdaris' ? this.level(t.owner, d.mechanical ? 'assembleurarmor' : 'portailarmor') : this.level(t.owner, d.mechanical ? 'vehicles' : d.beast ? 'skin' : 'armor');
    if (t.type === 'moissonneur') bonus += this.level(t.owner, 'robots') * BALANCE.rules.upgrades.robots;
    if (t.type === 'legionnaire') bonus += this.level(t.owner, 'cuirasse');
    if (t.type === 'pegase' && this.level(t.owner, 'charlourd')) bonus += BALANCE.rules.upgrades.charlourd.armor;
    return bonus;
  }

  /** Extra range from research (Canons sciés: Auxiliaires; Trébuchet intégré: Ankylosaures against buildings). */
  private rangeBonus(e: Entity, t?: Entity): number {
    if (e.type === 'ankylosaure' && t?.def.kind === 'building' && this.level(e.owner, 'trebuchet')) return BALANCE.rules.upgrades.trebuchetRange;
    if (e.type === 'baliste' && this.level(e.owner, 'canonlourd')) return BALANCE.rules.upgrades.canonlourdRange;
    return e.type === 'auxiliaire' ? this.level(e.owner, 'canonsscies') : 0;
  }

  /** The weapon a unit fights with now: Scarabées get one by research, a Char Pégase in the air shoots only at flyers. */
  weapon(e: Entity): Attack | undefined {
    if (e.kit) return WEAPONS[e.kit].attack;
    if (e.type === 'scarabee') return this.level(e.owner, 'scarabeassaut') ? BALANCE.rules.upgrades.scarabeAttack : undefined;
    const a = (e.def as UnitDef | BuildingDef).attack;
    return a && e.airborne ? { ...a, air: true, ground: false } : a;
  }

  /** Room in a bunker or carrier: Fortin, Scarabée, and Bourdons with Chargement. */
  room(b: Entity): number {
    return (b.def as BuildingDef | UnitDef).bunker ?? (b.type === 'bourdon' && this.level(b.owner, 'chargement') ? BALANCE.rules.upgrades.chargement : 0);
  }

  /** Who may get in: soldiers that shoot into a Fortin or a Scarabée, any foot soldier into a Bourdon. */
  private boards(e: Entity, b: Entity): boolean {
    const d = e.def as UnitDef;
    if (d.worker || d.mechanical || d.beast) return false;
    return b.type === 'bourdon' || (!!this.weapon(e) && this.weapon(e)!.range > 1);
  }

  /** Croissance économique: serfs and the Caserne's soldiers. */
  private grows(u: Entity): boolean {
    return u.def.kind === 'unit' && (u.type === 'serf' || !!(DEFS.caserne as BuildingDef).trains?.includes(u.type));
  }

  /** Raises a unit's hp by the Croissance économique share, keeping its wounds. */
  private fortify(u: Entity): void {
    const extra = idiv((u.def as UnitDef).hp * BALANCE.rules.upgrades.croissanceHp, 100);
    u.maxHp += extra;
    u.hp += extra;
  }

  /** Training time in ticks, the Caserne's shortened by Entraînement groupé. */
  private trainTime(b: Entity, type: string): number {
    const t = ticks((DEFS[type] as UnitDef | UpgradeDef).buildTime);
    if (DEFS[type].kind !== 'unit') return t;
    let speedup = b.type === 'caserne' && this.level(b.owner, 'entrainementgroupe') ? BALANCE.rules.upgrades.entrainementSpeedup : 0;
    if (b.type === 'portail' && this.level(b.owner, 'miniportail')) speedup += BALANCE.rules.upgrades.miniportailSpeedup;
    // The Grand Conseil plans production: every unit comes out faster while it stands.
    if ([...this.entities.values()].some((g) => g.owner === b.owner && g.type === 'grandconseil' && g.buildLeft === 0)) speedup += BALANCE.rules.upgrades.grandConseilSpeedup;
    return idiv(t * (100 - speedup), 100);
  }

  /** Damage that goes through shields first; armour only protects hp. */
  private hurt(t: Entity, damage: number): void {
    t.lastHit = this.tick;
    if (t.invuln > 0 || t.phased > 0) return;
    if (t.skin > 0) damage = Math.max(1, damage - SKIN_REDUCTION);
    const absorbed = Math.min(t.shield, damage);
    t.shield -= absorbed;
    if (damage > absorbed) {
      const armor = ('armor' in t.def ? t.def.armor : 0) + (t.def.kind === 'unit' && t.owner >= 0 ? this.armorBonus(t) : 0);
      t.hp -= Math.max(1, damage - absorbed - (absorbed > 0 ? 0 : armor));
    }
  }

  /** Shields recharge a few seconds after the last hit (at once, and faster, near a psy reserve); some units heal. */
  private regenerate(e: Entity): void {
    if (e.hp <= 0) return;
    if (e.poison > 0 && --e.poison % ticks(1) === 0) e.hp -= BALANCE.rules.upgrades.poison.damage;
    const regen = 'regen' in e.def ? e.def.regen : undefined;
    const shielding = e.shield < e.maxShield && (e.def.kind !== 'building' || e.buildLeft === 0);
    if (!shielding && !(regen && e.hp < e.maxHp)) return;
    const aura = shielding && this.nearShieldAura(e);
    if (shielding && !aura && this.tick - e.lastHit < ticks(7)) return;
    const rate = regen && e.hp < e.maxHp ? regen : (aura ? 8 : 2) + (e.owner >= 0 ? this.level(e.owner, 'bouclier') * BALANCE.rules.upgrades.boucliersRegen : 0);
    if (++e.regenTimer < ticks(1 / rate)) return;
    e.regenTimer = 0;
    if (shielding) e.shield++;
    else e.hp++;
  }

  private nearShieldAura(e: Entity): boolean {
    for (const b of this.entities.values()) {
      const r = (b.def as BuildingDef).shieldAura;
      if (b.owner === e.owner && r && b.buildLeft === 0 && dist(b.x, b.y, e.x, e.y) <= r * FP) return true;
    }
    return false;
  }

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
    // Holding position: only what is already within reach.
    const t = this.enemyNear(e, e.stand ? toFp(def.attack.range) + e.radius + FP : def.sight * FP);
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
      // Hitting a building or a worker: switch to a more urgent enemy that comes into sight.
      if (t && t.hp > 0 && this.rank(t) > 0 && (this.tick + e.id) % 4 === 0) {
        const better = this.enemyNear(e, def.sight * FP);
        if (better && this.rank(better) < this.rank(t)) {
          o.target = better.id;
          t = better;
          e.goal = null;
        }
      }
      if (!t || t.hp <= 0 || !this.sees(e.owner, t) || this.gap(e, t) > (def.sight + 2) * FP) {
        t = (this.tick + e.id) % 4 === 0 && this.tick >= e.calmUntil ? this.enemyNear(e, def.sight * FP) : undefined;
        o.target = t?.id ?? 0;
        if (!t && this.goTo(e, o.x, o.y)) {
          if (!o.back) return this.setOrder(e, null);
          // A patrol turns round at each end.
          [o.x, o.y, o.back] = [o.back[0], o.back[1], [o.x, o.y]];
          e.goal = null;
        }
        if (!t) return;
        e.goal = null;
      }
      return this.strike(e, t);
    }
    const t = this.entities.get(o.target);
    if (!t || t.hp <= 0 || t.inside || (!this.sees(e.owner, t) && (o.auto || this.hidden(t)))) return this.setOrder(e, null);
    if (o.auto && dist(e.x, e.y, o.lx, o.ly) > (def.sight + 3) * FP) {
      // Chased too far: walk back.
      return this.setOrder(e, { kind: 'move', x: o.lx, y: o.ly, arrive: FP });
    }
    if (o.auto && this.rank(t) > 0 && (this.tick + e.id) % 4 === 0) {
      const better = this.enemyNear(e, def.sight * FP);
      if (better && this.rank(better) < this.rank(t)) o.target = better.id;
    }
    this.strike(e, t);
  }

  /** Attacks if in range, otherwise closes in. */
  private strike(e: Entity, t: Entity): void {
    const a = this.weapon(e);
    if (!a) return;
    if (!reaches(a, flies(t))) return this.setOrder(e, null);
    if (this.gap(e, t) > toFp(a.range + this.rangeBonus(e, t)) + FP / 8) return e.stand ? this.setOrder(e, null) : this.chase(e, t);
    e.shortTicks = 0;
    e.goal = null;
    e.path = [];
    if (e.cooldown > 0) return;
    // Stimulant: attacks 50 % faster.
    if (e.phased > 0) return;
    // Inside an enemy Tempête de sable, ranged weapons are useless.
    if (a.range >= 1 && this.storms.some((z) => this.hostile(z.owner, e.owner) && dist(z.x, z.y, e.x, e.y) <= z.r)) return;
    e.cooldown = e.boost > 0 && (e.def as UnitDef).ability === 'stimulant' ? idiv(ticks(a.cooldown) * 2, 3) : ticks(a.cooldown);
    if (e.type === 'creature' && this.level(e.owner, 'boostgenetique')) e.cooldown = idiv(e.cooldown * (100 - BALANCE.rules.upgrades.boost.rate), 100);
    this.hit(e, t, a);
  }

  /** Deals one attack's damage (with the attacker's Forge upgrades), alerts the victim and lets it fight back. */
  private hit(e: Entity, t: Entity, a: Attack): void {
    // A Mur d'énergie stops shots: they flare on it.
    const stop = a.range >= 1 && this.walled(e.x, e.y, t.x, t.y);
    if (stop) return void this.shots.push({ x1: e.x, y1: e.y, x2: stop.x, y2: stop.y, kind: 'ranged', type: e.type, air1: flies(e), air2: false });
    const U = BALANCE.rules.upgrades;
    const machine = t.def.kind === 'building' || !!(t.def as UnitDef).mechanical;
    let bonus = machine ? (a.vsMechanical ?? 0) : 0;
    if (machine && e.type === 'legionnaire' && this.level(e.owner, 'scieassaut')) bonus += U.scieassautBonus;
    if (e.type === 'pegase' && this.level(e.owner, 'charlourd')) bonus += U.charlourd.damage;
    if (machine && e.type === 'cuve' && this.level(e.owner, 'acide')) bonus += U.acideBonus;
    let upgrade = 0;
    if (e.def.kind === 'unit' && !e.def.worker) upgrade = this.level(e.owner, this.attackLine(e, a)) * Math.max(1, Math.round(a.damage / 10));
    if (e.type === 'moissonneur') upgrade += this.level(e.owner, 'robots') * U.robots;
    // The Échevins' presence: units fighting near one of their Conseils hit a little harder.
    if (e.def.kind === 'unit' && this.nearCouncil(e)) upgrade += Math.max(1, idiv((a.damage + bonus) * U.conseilAura.percent, 100));
    // Courroux du marteau: the charged blow.
    let damage = a.damage + bonus + upgrade;
    if (e.charged > 0 && a.range < 1) {
      damage *= U.courroux;
      e.charged = 0;
    }
    this.hurt(t, damage);
    t.lastAttacker = e.id;
    t.lastHitBy = e.owner;
    // Sphère de renvoi: part of the blow goes back to the attacker.
    if (t.reflect > 0 && e.def.kind === 'unit' && e.hp > 0) this.hurt(e, Math.max(1, idiv((a.damage + bonus) * U.renvoiPercent, 100)));
    // Lames empoisonnées: a Belluaire's blade poisons living units.
    if (e.type === 'belluaire' && t.def.kind === 'unit' && !machine && this.level(e.owner, 'lamesempoisonnees')) t.poison = ticks(U.poison.seconds);
    // Area weapons splash, half damage, on the ground units round the target (Armes chimiques: the Alchimiste's cocktails too).
    const splash = a.splash ?? (e.type === 'alchimiste' && this.level(e.owner, 'armeschimiques') ? U.chemicalSplash : 0);
    if (splash) {
      for (const o of [...this.entities.values()]) {
        if (o === t || o.def.kind !== 'unit' || o.hp <= 0 || o.inside || flies(o) || !this.hostile(o.owner, e.owner)) continue;
        if (dist(o.x, o.y, t.x, t.y) <= toFp(splash)) this.hurt(o, idiv(a.damage + upgrade, 2));
      }
    }
    if (this.tick - (this.lastAlert[t.owner] ?? -Infinity) > ticks(15)) {
      this.lastAlert[t.owner] = this.tick;
      this.say(t.owner, t.def.kind === 'building' ? 'Votre base est attaquée !' : 'Vos troupes sont attaquées !', 'alert');
    }
    this.shots.push({ x1: e.x, y1: e.y, x2: t.x, y2: t.y, kind: a.range < 1 ? 'melee' : 'ranged', type: e.type, air1: flies(e), air2: flies(t) });
    // Idle soldiers hit from afar fight back; against a soldier shooting out of a bunker, at the bunker.
    if (e.inside) e = this.entities.get(e.inside) ?? e;
    const td = t.def as UnitDef;
    if (!t.order && !t.held && t.def.kind === 'unit' && td.attack && !td.worker && reaches(td.attack, flies(e))) {
      this.setOrder(t, { kind: 'attack', target: e.id, auto: true, lx: t.x, ly: t.y });
    }
    // So do soldiers attack-moving that are not already fighting a soldier, even while walking on past an
    // unreachable target (calmUntil), unless the shooter is the very one they just gave up on.
    const o = t.order;
    if (o?.kind === 'attackMove' && !t.held && td.attack && reaches(td.attack, flies(e)) && !(e.id === t.ignore && this.tick < t.ignoreUntil)) {
      const current = this.entities.get(o.target);
      if (!current || current.hp <= 0 || this.rank(current) > this.rank(e)) {
        o.target = e.id;
        t.calmUntil = 0;
        t.goal = null;
      }
    }
  }

  private chase(e: Entity, t: Entity): void {
    if (t.def.kind === 'building') return this.goNear(e, t.tx, t.ty, (t.def as BuildingDef).size);
    if (!e.goal || dist(e.goal.x, e.goal.y, t.x, t.y) > FP) this.plan(e, t.x, t.y);
    if (!this.follow(e) || flies(e)) return void (e.shortTicks = 0);
    // At the end of its path and still out of reach (the target stands below a cliff): after two seconds,
    // leave it be for a while and pick another fight, rather than standing there for ever.
    if (++e.shortTicks < ticks(2)) return;
    e.shortTicks = 0;
    e.ignore = t.id;
    e.ignoreUntil = this.tick + ticks(10);
    // Walk on without picking a fight for a few seconds: others nearby are likely out of reach too.
    e.calmUntil = this.tick + ticks(5);
    e.goal = null;
    const o = e.order;
    if (o?.kind === 'attackMove') o.target = 0;
    else if (o?.kind === 'attack') this.setOrder(e, o.auto ? null : { kind: 'attackMove', x: o.lx, y: o.ly, target: 0 });
  }

  /**
   * Entities filed by 8×8-tile cell while units and buildings act (null otherwise: then every entity is scanned).
   * Positions move a little during the tick, hence the margin when reading it.
   */
  private cells: Map<number, Entity[]> | null = null;

  private index(): void {
    this.cells = new Map();
    for (const e of this.entities.values()) this.file(e);
  }

  private file(e: Entity): void {
    const k = (tileOf(e.y) >> 3) * 1024 + (tileOf(e.x) >> 3);
    const list = this.cells!.get(k);
    if (list) list.push(e);
    else this.cells!.set(k, [e]);
  }

  /** Entities that may lie within `range` of a point, edges included (a superset: callers still measure). */
  private around(x: number, y: number, range: number): Iterable<Entity> {
    if (!this.cells) return this.entities.values();
    const r = range + CELL_MARGIN * FP;
    const out: Entity[] = [];
    for (let cy = Math.max(0, tileOf(y - r)) >> 3; cy <= tileOf(y + r) >> 3; cy++) {
      for (let cx = Math.max(0, tileOf(x - r)) >> 3; cx <= tileOf(x + r) >> 3; cx++) {
        for (const t of this.cells.get(cy * 1024 + cx) ?? []) if (this.entities.get(t.id) === t) out.push(t);
      }
    }
    return out;
  }

  /** Edge-to-edge distance. */
  private gap(e: Entity, t: Entity): number {
    if (t.def.kind === 'unit') return dist(e.x, e.y, t.x, t.y) - e.radius - t.radius;
    const size = (t.def as BuildingDef).size;
    const nx = Math.max(t.tx * FP, Math.min(e.x, (t.tx + size) * FP));
    const ny = Math.max(t.ty * FP, Math.min(e.y, (t.ty + size) * FP));
    return dist(e.x, e.y, nx, ny) - e.radius;
  }

  /** How urgent an enemy is to hit: 0 what shoots back (soldiers, defences), 1 other units (workers), 2 buildings. */
  private rank(t: Entity): number {
    const armed = !!(t.def as UnitDef | BuildingDef).attack && !(t.def as UnitDef).worker;
    return armed ? 0 : t.def.kind === 'unit' ? 1 : 2;
  }

  /** Most threatening visible enemy within range: armed units and defences first, then workers, then buildings. */
  private enemyNear(e: Entity, range: number, unitsOnly = false, a = this.weapon(e)): Entity | undefined {
    let best: Entity | undefined;
    let bestScore = Infinity;
    for (const t of this.around(e.x, e.y, range)) {
      if (!this.hostile(t.owner, e.owner) || t.def.kind === 'resource' || t.hp <= 0 || (unitsOnly && t.def.kind !== 'unit')) continue;
      if (a && !reaches(a, flies(t))) continue;
      if (t.id === e.ignore && this.tick < e.ignoreUntil) continue;
      if (t.inside) continue; // sheltering in a bunker: hit the bunker
      const d = this.gap(e, t);
      if (d > range || !this.sees(e.owner, t)) continue;
      const score = d + [0, 3 * FP, 8 * FP][this.rank(t)];
      // Ties go to the oldest entity, as when every entity was scanned in order.
      if (score < bestScore || (score === bestScore && t.id < best!.id)) [best, bestScore] = [t, score];
    }
    return best;
  }

  /** Most wounded friendly unit in sight. */
  private patient(e: Entity): Entity | undefined {
    let best: Entity | undefined;
    let worst = 1;
    const range = (e.def as UnitDef).sight * FP;
    for (const t of this.entities.values()) {
      if (t === e || t.owner !== e.owner || t.def.kind !== 'unit' || t.hp >= t.maxHp || t.hp <= 0) continue;
      if (dist(e.x, e.y, t.x, t.y) > range) continue;
      const f = t.hp / t.maxHp;
      if (f < worst) [best, worst] = [t, f];
    }
    return best;
  }

  // ---------------------------------------------------------------- buildings

  private operate(b: Entity): void {
    if (b.buildLeft > 0) {
      if (!(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs) return;
      // Materialising (Isdaris) or assembling (Z): builds itself, hp and shield filling up.
      const total = ticks((b.def as BuildingDef).buildTime);
      b.buildLeft--;
      this.grow(b, total);
      if (b.buildLeft === 0) {
        b.shield = b.maxShield;
        this.say(b.owner, `${(b.def as BuildingDef).absorbs ? 'Assemblage' : 'Matérialisation'} terminé${(b.def as BuildingDef).absorbs ? '' : 'e'} : ${b.def.name}.`, 'done');
      }
      return;
    }
    const def = b.def as BuildingDef;
    // Defences (Orbe plasma) shoot the closest enemy unit in range.
    if (def.attack && b.cooldown === 0) {
      const t = this.enemyNear(b, toFp(def.attack.range), true);
      if (t) {
        b.cooldown = ticks(def.attack.cooldown);
        this.hit(b, t, def.attack);
      }
    }
    if (def.energyRate && ++b.timer >= ticks(1 / def.energyRate)) {
      b.timer = 0;
      this.players[b.owner].energy++;
    }
    this.produce(b);
  }

  /** Training, research and morphing through the queue of a building, or of a god (Dieux). */
  private produce(b: Entity): void {
    if (b.queue.length && --b.trainLeft <= 0) {
      const type = b.queue.shift()!;
      const up = DEFS[type];
      if (up.kind === 'building') return this.morph(b, type);
      if (up.kind === 'upgrade') {
        this.players[b.owner].upgrades[up.line] = up.level;
        this.say(b.owner, `Recherche terminée : ${up.name}.`, 'done');
        if (type === 'croissance') for (const u of this.entities.values()) if (u.owner === b.owner && this.grows(u)) this.fortify(u);
        if (type.startsWith('cercle') || type === 'boostgenetique') for (const u of this.entities.values()) if (u.owner === b.owner) this.empower(u, type);
        if (b.queue.length) b.trainLeft = ticks((DEFS[b.queue[0]] as UpgradeDef).buildTime);
        return;
      }
      const u = this.spawnBeside(type, b);
      // Cuve génétique: Créatures come in pairs.
      if (type === 'creature' && this.level(b.owner, 'cuvegenetique')) {
        const twin = this.spawnBeside(type, b);
        if (b.rally) this.setOrder(twin, { kind: 'move', x: b.rally.x, y: b.rally.y, arrive: FP / 2 });
      }
      const field = (u.def as UnitDef).worker && (!b.rally || b.rallyTarget) ? (this.entities.get(b.rallyTarget) ?? this.nearestField(u)) : undefined;
      // Workers go mining by default (or on the rallied field); others walk to the rally point.
      if (field) this.setOrder(u, { kind: 'gather', target: field.id, phase: 'go', timer: 0 });
      else if (b.rally) this.setOrder(u, { kind: 'move', x: b.rally.x, y: b.rally.y, arrive: FP / 2 });
      if (b.queue.length) b.trainLeft = this.trainTime(b, b.queue[0]);
    }
  }

  /**
   * A unit sheltering in a bunker: out of reach, it shoots from inside with one more tile of range
   * (mod: « Bonus 1 portée »); thrown out if the bunker falls.
   */
  private shelter(e: Entity): void {
    const b = this.entities.get(e.inside);
    if (!b || b.hp <= 0) return this.leave(e);
    // Carried along; nobody shoots out of a flying transport.
    e.x = e.px = b.x;
    e.y = e.py = b.y;
    const a = this.weapon(e);
    if (e.cooldown > 0 || !a || flies(b)) return;
    const range = toFp(a.range + 1 + this.rangeBonus(e)) + (b.def.kind === 'building' ? b.def.size : 1) * FP / 2;
    const t = this.enemyNear(b, range, false, a);
    if (!t) return;
    e.cooldown = ticks(a.cooldown);
    this.hit({ ...e, x: b.x, y: b.y } as Entity, t, a);
  }

  /** Out of a bunker, on the nearest open tile beside it. */
  private leave(e: Entity): void {
    const b = this.entities.get(e.inside);
    e.inside = 0;
    const [x, y] = this.grid.nearestOpen(tileOf(e.x), tileOf(e.y), b?.def.kind === 'building' ? this.grid.level(b.tx, b.ty) : -1);
    e.x = e.px = x * FP + FP / 2;
    e.y = e.py = y * FP + FP / 2;
  }

  /**
   * A building site gains its hit points as it goes up: from a tenth to all of them over the build, in exact
   * steps (rounding each tick down used to leave finished buildings short), minus any damage taken meanwhile.
   */
  private grow(b: Entity, total: number): void {
    const done = total - b.buildLeft;
    const gain = idiv(b.maxHp * 9 * done, total * 10) - idiv(b.maxHp * 9 * (done - 1), total * 10);
    b.hp = Math.min(b.maxHp, b.hp + gain);
  }

  /** A building turned into another, in place, keeping its share of hit points and shields. */
  private morph(b: Entity, type: string): void {
    const def = DEFS[type] as BuildingDef;
    const hp = b.hp / b.maxHp;
    const shield = b.maxShield ? b.shield / b.maxShield : 1;
    b.type = type;
    b.def = def;
    b.maxHp = def.hp;
    b.hp = Math.max(1, Math.round(def.hp * hp));
    b.maxShield = def.shield ?? 0;
    b.shield = Math.round(b.maxShield * shield);
    b.cooldown = 0;
    this.say(b.owner, `Transformation terminée : ${def.name}.`, 'done');
  }

  /** Spawns a unit on the open tile next to a building, on the side of its rally point. */
  private spawnBeside(type: string, b: Entity): Entity {
    if (b.def.kind === 'unit') {
      // At a god's feet, on its rally side (in front by default).
      const toward = b.rally ?? { x: b.x, y: b.y - FP };
      const d = dist(b.x, b.y, toward.x, toward.y) || 1;
      const reach = b.radius + FP;
      const [tx, ty] = this.grid.nearestOpen(tileOf(b.x + idiv((toward.x - b.x) * reach, d)), tileOf(b.y + idiv((toward.y - b.y) * reach, d)), -1);
      return this.spawn(type, b.owner, tx * FP + FP / 2, ty * FP + FP / 2);
    }
    const size = (b.def as BuildingDef).size;
    const toward = b.rally ?? { x: b.x + FP, y: b.y + FP };
    let best = this.grid.nearestOpen(b.tx + size, b.ty + size, this.grid.level(b.tx, b.ty)); // walled in: closest open tile
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
      if (++e.blockedTicks > 10) {
        e.goal = null;
        e.stuck++;
      }
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
  private follow(e: Entity): boolean {
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
  private pace(e: Entity): number {
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
  private evict(e: Entity): void {
    const x = tileOf(e.x);
    const y = tileOf(e.y);
    if (this.grid.open(x, y)) return;
    const [ox, oy] = this.grid.nearestOpen(x, y, this.grid.level(x, y));
    const d = dist(e.x, e.y, ox * FP + FP / 2, oy * FP + FP / 2);
    const s = Math.min(e.speed, d);
    if (d > 0) this.tryMove(e, e.x + idiv((ox * FP + FP / 2 - e.x) * s, d), e.y + idiv((oy * FP + FP / 2 - e.y) * s, d), true);
  }

  private touchesIdleFriend(e: Entity): boolean {
    for (const f of this.entities.values()) {
      if (f === e || f.owner !== e.owner || f.order || f.def.kind !== 'unit') continue;
      if (dist(e.x, e.y, f.x, f.y) <= e.radius + f.radius + FP / 16) return true;
    }
    return false;
  }

  /** Moves if the step crosses no cliff or obstacle (`throughBuildings`: cliffs only). */
  private tryMove(e: Entity, nx: number, ny: number, throughBuildings = false): boolean {
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
  private separate(): void {
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
