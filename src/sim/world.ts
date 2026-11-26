import BALANCE from '../balance.json';
import { ABILITIES, type BuildingDef, type Cost, DEFS, type Def, type Faction, FACTIONS, MYTHS, type Mythology, OBSERVATION, spell, KIT, type UnitDef, type UpgradeDef, type UpgradeLine } from '../data';
import type { GameMap } from '../map';
import { FP, TICK_RATE, dist, idiv, speedPerTick, ticks, tileOf, toFp } from './fixed';
import { Grid } from './grid';
import * as commands from './commands';
import * as economy from './economy';
import * as movement from './movement';
import * as buildings from './buildings';
import * as combat from './combat';
import * as abilities from './abilities';
import { Vision } from './vision';


/** What each building turned into came from (morphs: Alchimisterie → Grande Alchimisterie…). */
const MORPHED_FROM: Record<string, string> = Object.fromEntries(
  Object.entries(DEFS).flatMap(([k, d]) => ((d as BuildingDef).morphs ?? []).map((m) => [m, k])),
);
export type Order =
  | { kind: 'move'; x: number; y: number; arrive: number }
  /** `skip`: fields this trip gave up on, no way into them, since tick `skipped` (economy.ts gather). */
  | { kind: 'gather'; target: number; phase: 'go' | 'mine' | 'return'; timer: number; skip?: number[]; skipped?: number }
  | { kind: 'build'; type: string; tx: number; ty: number }
  | { kind: 'construct'; target: number }
  /** Z drone (Z.doc): repairs an own machine or building, paying as it goes; `owed` in thousandths of a resource. */
  | { kind: 'repair'; target: number; owedM: number; owedE: number }
  /** `auto`: picked by the unit itself; it gives up beyond its leash point (lx, ly). */
  | { kind: 'attack'; target: number; auto: boolean; lx: number; ly: number }
  /** `back`: a patrol, which turns round at (x, y) and heads back there, for ever. */
  | { kind: 'attackMove'; x: number; y: number; target: number; back?: [number, number] }
  | { kind: 'heal'; target: number }
  /** Keeps up with a friendly unit wherever it goes; (lx, ly) is where it was last, to go to if it is lost. */
  | { kind: 'follow'; target: number; lx: number; ly: number }
  /** Walk into a bunker (Fortin) and take cover there. */
  | { kind: 'enter'; target: number }
  /** Walk within range of (x, y), then use an aimed ability there. */
  | { kind: 'cast'; ability: string; x: number; y: number };

/** Flying units go straight over cliffs and buildings. */
export const flies = (e: Entity): boolean => !!(e.def as UnitDef).flying || e.airborne;
/** Moves over cliffs, water and buildings: the flyers, and the units that hover but are hit as ground units. */
export const soars = (e: Entity): boolean => flies(e) || !!(e.def as UnitDef).hover;
/** A building ability's cooldown: the Canon IEM and the Bouclier de plasma keep their own, apart from the building's other ability. */
export const cdOf = (b: Entity, name: string): number => (name === 'canoniem' ? b.iemCd : name === 'bouclierplasma' ? b.plasmaCd : name === 'transfertgroupe' ? 0 : b.abilityCd);
/** Workers that repair, by type: hp a second, share of the worth a full repair costs, machines as well as buildings. */
export const REPAIR: Record<string, { hp: number; percent: number; units: boolean }> = BALANCE.rules.repair;
/** Can a worker of this type repair that (own, finished, wounded) thing? */
export const repairs = (type: string, t: Entity): boolean => !!REPAIR[type] && (t.def.kind === 'building' || (REPAIR[type].units && !!(t.def as UnitDef).mechanical));

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
  /** Along a path: its length and the nearest the unit came to its waypoint, and the steps since it last got nearer (follow). */
  wn: number;
  wd: number;
  still: number;
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
  /** Z Gel électronique: ticks a building stays frozen (no attack, no production, unhurt); a unit by a Balise de
   * vacarme, unable to attack. */
  frozen: number;
  /** Z Accumulateur: ticks its Cône de protection lasts. */
  cone: number;
  /** Z socle: support kits fitted by the Centre K (bits of KIT). */
  support: number;
  /** Z Centre K: ticks before the Canon IEM fires again. */
  iemCd: number;
  /** Taken over by a Canon IEM: the Centre K holding it, its true owner, and ticks left. */
  seizedBy: number;
  seizedFrom: number;
  seizedLeft: number;
  /** Z socle: its tier (1 to 3, Z.doc), and ticks left while it evolves into the next, standing still. */
  tier: number;
  evolving: number;
  /** Z add-on (Plate-forme, Tourelle): the Pod that raised it, or 0. */
  host: number;
  /** Z Plate-forme: the weapon chosen for each socle of the queue (key of WEAPONS, '' for the machine gun). */
  kits: string[];
  trainLeft: number;
  /** A caster's own energy (fiches 2010), in FP; and, for a spell with a cooldown of its own, the tick it is ready again. */
  mana: number;
  spellCd: Record<string, number>;
  /** A Humans site: progress in thousandths of a tick, carried over from one tick to the next. */
  buildFrac: number;
  /** Druide's Double énergétique: an illusion, which neither attacks nor casts. */
  illusion: boolean;
  /** Portail with the Miniportail: ticks left on the unit second in the queue, made alongside the first (0 = idle). */
  trainLeft2: number;
  /** A god: the building it is raising (balance designer 2026-11-22: it stands still till the building is up). */
  raising: number;
  /** A healer whose automatic Soin is switched off (it heals only when told). */
  autoOff: boolean;
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
  /** Ticks left: hidden from enemies without detection (Camouflage), unhurt (the Fantômes), alive (Cadavre réanimé). */
  camo: number;
  invuln: number;
  /** Ticks left of a Régénérant: 5 % of the damage taken, then 1 HP left when it wears off. */
  ferveur: number;
  /** Ticks before a Réservoir set to blow up goes off (Explosion suicidaire). */
  fuse: number;
  /** Réanimation on its own (the balancer, 2026-11-22): off until switched on. */
  autoRaise: boolean;
  ttl: number;
  /** Char Pégase in the air (Décollage). */
  airborne: boolean;
  /** Créature under ground (Enfouissement). */
  burrowed: boolean;
  /** Ticks left: phased out, unhurt and unable to fight (Module déphasant, Porte de déphasage); sending damage back (Sphère de renvoi). */
  phased: number;
  reflect: number;
  /** Sphère de renvoi: damage it may still send back (fiche 2010: 300 at most). */
  reflectLeft: number;
  /** Z socle: weapon chosen when it was built, for good (key of WEAPONS), or '' for the machine gun. */
  kit: string;
  /** Thor's Courroux du marteau: ticks left in which his next blow hits several times as hard. */
  charged: number;
  /** Dieux: a god's level (1 to 5); a building called down by Gaïa, the level she had (it materialises that many times faster). 1 for the rest. */
  lvl: number;
  /** Cri de guerre (Athéna): ticks left, and the damage it adds, in percent. */
  war: number;
  warPct: number;
  /** Soumission divine (Frigg): ticks left under another's control, and the owner it goes back to. */
  charm: number;
  charmOwner: number;
  /** Nuée nauséabonde (Osiris): ticks left of the swarm round it. */
  swarm: number;
  /** Sphinx: ticks left in its Forme de statue. */
  statue: number;
  /** Ticks left slowed by the Élémentaire d'eau's icy shot. */
  chill: number;
  /** Ticks left under a change of pace (Gaz euphorisants, Lumière ardente, Jet de sable), with its walking speed and
   * its time between blows in percent of the usual (100: unchanged). */
  pace: number;
  paceMove: number;
  paceAtk: number;
  /** Ticks left in a Gravité alourdie aura, renewed at each of its pulses: a slow of its own, beside `pace`. */
  heavy: number;
  /** Ticks left blinded by Amon-Râ: it sees only what touches it. */
  blind: number;
  /** Fantôme of the Armée des enfers: damage dealt so far (it vanishes past rules.upgrades.fantomeDamage). */
  dealt: number;
  /** Z Accumulateur: ticks left of its Gravité alourdie, an aura that slows the enemies round it. */
  gravity: number;
  /** Isdaris major building: ticks before its Bouclier de plasma is ready again (apart from its other ability). */
  plasmaCd: number;
  /** Char Pégase: chemical mines in stock (one more every `cooldown` of Pose de mine, up to its `max`). */
  charges: number;
  /** Dieux: the Artefacterie's improvements this god bought (ARTEFACTS), in order. */
  arts: string[];
  /** Isdaris major building: the extensions built onto it (notice), its own, gone with it. */
  exts: string[];
  /** Z building: id of the drone that merged into it (a hint for the renderer, not game state). */
  absorbed?: number;
}

/** The Yggdrasill's three forms (Prescience d'Yggdrasill makes them detectors). */
const YGGDRASILL = ['branche', 'protecteur', 'furieux'];

/** Bac à sable, « Ressources illimitées »: each resource topped up to this at every tick. */
const UNLIMITED = 99999;

export interface Player {
  id: number;
  faction: Faction;
  minerals: number;
  energy: number;
  /** Percentage of harvested minerals actually banked (AI difficulty). */
  handicap: number;
  /** Levels researched, by upgrade line (a one-off research is its own line, at level 1). */
  upgrades: Record<UpgradeLine, number>;
  /** Dieux: ticks charged of each mythology's ultimate spell at the Temple primordial (full: ready to cast). */
  ultimates?: Partial<Record<Mythology, number>>;
  /** Players on the same team share their sight and never fight each other. */
  team: number;
  /** Bac à sable (a match with one player), its options: resources never run out; buildings, training and research
   * finish at once; the whole map shows. All off unless picked. */
  unlimited?: boolean;
  instant?: boolean;
  reveal?: boolean;
  /** Gave up (an AI that had lost): out of the match, its buildings standing or not. */
  resigned?: boolean;
}

export type Command =
  | { player: number; kind: 'move'; ids: number[]; x: number; y: number; queue?: boolean }
  /** Right-click: move, gather, construct, return cargo or set a rally point, depending on the target. */
  | { player: number; kind: 'smart'; ids: number[]; x: number; y: number; target?: number; queue?: boolean }
  /** The rally point of the selected producers (buildings, and Dieux gods, whose right click moves them), as `smart`'s. */
  | { player: number; kind: 'rally'; ids: number[]; x: number; y: number; target?: number }
  | { player: number; kind: 'stop'; ids: number[] }
  /** Hold position: stop, and from then on only shoot what comes within reach, never step out to chase. */
  | { player: number; kind: 'hold'; ids: number[] }
  /** Patrol between where each unit stands and (x, y), fighting what comes into sight on the way. */
  | { player: number; kind: 'patrol'; ids: number[]; x: number; y: number; queue?: boolean }
  | { player: number; kind: 'build'; ids: number[]; type: string; tx: number; ty: number; queue?: boolean }
  | { player: number; kind: 'train'; ids: number[]; type: string; weapon?: string; slot?: number }
  /** Z: buys a weapon for each selected Tourelle or Assimilateur without one (Z.doc: « arme adaptable »). */
  | { player: number; kind: 'arm'; ids: number[]; weapon: string }
  /** Z: each selected socle evolves into its next tier, in place (paid per socle). */
  | { player: number; kind: 'evolve'; ids: number[] }
  /** Without `slot`, the last in the queue (or a site being raised); with it, that place in the queue. */
  | { player: number; kind: 'cancel'; ids: number[]; slot?: number }
  /** Every unit in the given bunkers walks out. */
  /** Everyone out of the carriers or bunkers named, or only `unit` (a click on its portrait). */
  | { player: number; kind: 'unload'; ids: number[]; unit?: number }
  /** Each selected unit uses its active ability, if ready; a building's ability (one building per command) aims at (x, y). */
  | { player: number; kind: 'ability'; ids: number[]; x?: number; y?: number; name?: string }
  /** Marché: sells some of one resource for some of the other. */
  | { player: number; kind: 'trade'; ids: number[]; sell: 'minerals' | 'energy' }
  /** Attack a target, or attack-move to a point when there is none. */
  | { player: number; kind: 'attack'; ids: number[]; x: number; y: number; target?: number; queue?: boolean }
  /** Bac à sable only (a match with one player): one of its options turned on or off. Orders like any other, so a
   * replay plays them back. */
  | { player: number; kind: 'sandbox'; ids: number[]; tool: SandboxTool; on: boolean }
  /** An ability used on its own or not (Soin, Réanimation), for the units named that have it. */
  /** The player gives up. Only the AI sends it; a network game refuses it (net.ts has no fields for it). */
  | { player: number; kind: 'resign'; ids: number[] };

export type SandboxTool = 'unlimited' | 'instant' | 'reveal';

export interface Shot {
  /** Shooter and target centres (fixed-point). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'ranged' | 'melee' | 'heal';
  /** Shooter's type, for its sound, and the shooter (render: a Lance-flammes keeps its jet going). */
  type?: string;
  id?: number;
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
export interface World extends Methods<typeof commands>, Methods<typeof abilities>, Methods<typeof combat>, Methods<typeof buildings>, Methods<typeof movement>, Methods<typeof economy> {}

/** Entities by what a scan looks for (World.listed). */
interface Lists {
  dropoffs: Entity[];
  fields: Entity[];
  councils: Entity[];
  odins: Entity[];
  athenas: Entity[];
  shielded: Entity[];
}

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
  /** Groups phased by a Porte de déphasage, which the Trône may still send elsewhere while they are phased. */
  phaseGroups: { owner: number; ids: number[]; left: number }[] = [];
  /** Canon orbital shots on their way: they strike when `left` runs out. */
  strikes: { owner: number; x: number; y: number; left: number }[] = [];
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
  /** Explosifs toxiques: clouds that hurt every enemy unit in them, once a second, `hits` more times from tick `next`. */
  clouds: { owner: number; x: number; y: number; r: number; damage: number; hits: number; next: number }[] = [];
  /** Units coming back by themselves at their side's headquarters (Gaïa), at a tick. */
  private respawns: { owner: number; type: string; at: number }[] = [];
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
      order: null, goal: null, path: [], blockedTicks: 0, wn: -1, wd: 0, still: 0, inside: 0, ignore: 0, ignoreUntil: 0, calmUntil: 0, shortTicks: 0, stuck: 0,
      tx: 0, ty: 0, buildLeft: 0, queue: [], kits: [], host: 0, tier: 1, evolving: 0, frozen: 0, cone: 0, support: 0, iemCd: 0, seizedBy: 0, seizedFrom: 0, seizedLeft: 0, trainLeft: 0, mana: 'mana' in def && def.mana ? toFp(def.mana[1]) : 'levels' in def && def.levels && def.faction === 'dieux' ? toFp(BALANCE.rules.godMana.max[0] / 2) : 0, spellCd: {}, buildFrac: 0, trainLeft2: 0, raising: 0, autoOff: false, illusion: false, rally: null, rallyTarget: 0,
      carry: 0, amount: def.kind === 'resource' ? def.amount : 0, miner: 0, timer: 0, cooldown: 0,
      shield: 'shield' in def ? (def.shield ?? 0) : 0, maxShield: 'shield' in def ? (def.shield ?? 0) : 0, lastHit: -1e9, regenTimer: 0, boost: 0, skin: 0, ferveur: 0, fuse: 0, autoRaise: false, abilityCd: 0, held: 0, stand: false, lastAttacker: 0, lastHitBy: -1, poison: 0, camo: 0, invuln: 0, airborne: false, burrowed: false, phased: 0, reflect: 0, reflectLeft: 0, kit: '', charged: 0, lvl: 1, war: 0, warPct: 0, charm: 0, charmOwner: -1, swarm: 0, statue: 0, chill: 0, pace: 0, paceMove: 100, paceAtk: 100, heavy: 0, blind: 0, dealt: 0, gravity: 0, plasmaCd: 0, charges: 'abilities' in def && def.abilities?.includes('posermine') ? ABILITIES.posermine.max! : 0, arts: [], exts: [], ttl: 'lifetime' in def && def.lifetime ? ticks(def.lifetime) : 0,
    };
    if (size) {
      e.tx = tileOf(x);
      e.ty = tileOf(y);
      e.x = e.px = e.tx * FP + (size * FP) / 2;
      e.y = e.py = e.ty * FP + (size * FP) / 2;
      this.block(e, 1);
    }
    this.entities.set(e.id, e);
    this.unlist();
    if (this.cells) this.file(e);
    if (owner >= 0 && this.grows(e) && this.level(owner, 'croissance')) this.fortify(e);
    if (owner >= 0 && (e.type === 'drone' || e.type === 'dronecombat') && this.level(owner, 'sonderobuste')) this.fortify(e);
    if (owner >= 0 && e.type === 'zespion' && this.level(owner, 'megaespion')) this.fortify(e);
    // Scarabée amélioré: born with its extra speed, like the ones already out.
    if (owner >= 0 && e.type === 'scarabee' && this.level(owner, 'scarabeassaut')) e.speed = this.baseSpeed(e);
    if (owner >= 0) for (const line of ['cercle1', 'cercle2', 'boostgenetique', 'drakegeant', 'auraputride']) if (this.level(owner, line.replace(/\d$/, '')) >= (DEFS[line] as UpgradeDef).level) this.empower(e, line);
    return e;
  }

  remove(e: Entity): void {
    if (e.def.kind !== 'unit') this.block(e, -1);
    // A caster gone with its Cône still up: it counted among the live cones, and coned() would look through every
    // entity at every hit until the game's end.
    if (e.cone > 0) {
      e.cone = 0;
      this.cones--;
    }
    this.entities.delete(e.id);
    this.unlist();
  }

  block(e: Entity, delta: number): void {
    const size = (e.def as BuildingDef).size;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) this.grid.blocked[y * this.grid.width + x] += delta;
    this.grid.changes++;
  }

  step(commands: readonly Command[]): void {
    this.events = [];
    this.shots = [];
    this.deaths = [];
    this.teleports = [];
    this.casts = [];
    this.scans = this.scans.filter((s) => --s.left > 0);
    for (const m of this.walls) {
      if (--m.left !== 0) continue;
      for (const i of m.tiles) this.grid.blocked[i]--;
      this.grid.changes++;
    }
    this.walls = this.walls.filter((m) => m.left > 0);
    for (const r of this.recalls) if (--r.left === 0) this.land(r);
    this.recalls = this.recalls.filter((r) => r.left > 0);
    for (const s of this.strikes) if (--s.left === 0) this.orbitalHit(s);
    this.strikes = this.strikes.filter((s) => s.left > 0);
    this.phaseGroups = this.phaseGroups.filter((g) => --g.left > 0);
    if (this.tick % 4 === 0) this.see();
    for (const c of commands) {
      // Shift: orders go after what the units are already doing; otherwise they replace it all (setOrder).
      this.queueing = 'queue' in c && !!c.queue;
      this.commanding = this.queueing ? null : c;
      this.apply(c);
      this.queueing = false;
      this.commanding = null;
    }
    for (const e of this.entities.values()) if (e.owner >= 0 && this.players[e.owner].instant) this.hurry(e);
    for (const p of this.players) if (p.unlimited) [p.minerals, p.energy] = [Math.max(p.minerals, UNLIMITED), Math.max(p.energy, UNLIMITED)];
    for (const e of this.entities.values()) {
      e.px = e.x;
      e.py = e.y;
      if (e.cooldown > 0) e.cooldown--;
      if (e.abilityCd > 0) e.abilityCd--;
      const mana = this.manaOf(e);
      if (mana && e.mana < toFp(mana[0])) e.mana = Math.min(toFp(mana[0]), e.mana + idiv(toFp(mana[2]), ticks(1)));
      if (e.held > 0) e.held--;
      if (e.camo > 0) e.camo--;
      if (e.phased > 0) e.phased--;
      if (e.reflect > 0) e.reflect--;
      if (e.invuln > 0) e.invuln--;
      // Régénérant wears off: the toxins turn on their host, 1 HP left (the balancer, 2026-11-22).
      if (e.ferveur > 0 && --e.ferveur === 0) e.hp = Math.min(e.hp, 1);
      if (e.fuse > 0 && --e.fuse === 0) this.cuveBlast(e);
      if (e.ttl > 0 && --e.ttl === 0) {
        if (e.type === 'minealchimique') this.mineBlast(e);
        e.hp = 0;
      }
      if (e.skin > 0) e.skin--;
      if (e.charged > 0) e.charged--;
      if (e.war > 0) e.war--;
      if (e.swarm > 0) e.swarm--;
      if (e.statue > 0 && --e.statue === 0) e.speed = this.baseSpeed(e);
      if (e.chill > 0 && --e.chill === 0 && e.boost === 0) e.speed = this.baseSpeed(e);
      if (e.pace > 0 && --e.pace === 0 && e.boost === 0) e.speed = this.baseSpeed(e);
      if (e.heavy > 0 && --e.heavy === 0 && e.boost === 0) e.speed = this.baseSpeed(e);
      if (e.charm > 0 && --e.charm === 0) this.turn(e, e.charmOwner);
      // Once a second, staggered: Osiris's putrid aura and swarm, the Fontaine du Nil.
      if ((this.tick + e.id) % ticks(1) === 0) this.pulse(e);
      if (e.type === 'minechimique') this.mineTrigger(e);
      // Minage (mod): every 12 s the crew makes a mine, for 35 minerals and 20 energy, while the stock is not full and the side can pay.
      if (e.charges < (ABILITIES.posermine.max ?? 0) && e.type === 'pegase' && (e.def as UnitDef).abilities?.includes('posermine') && (this.tick + e.id) % ticks(ABILITIES.posermine.cooldown) === 0) {
        const [p, price] = [this.players[e.owner], BALANCE.rules.upgrades.minePrice];
        if (p && p.minerals >= price.minerals && p.energy >= price.energy) {
          p.minerals -= price.minerals;
          p.energy -= price.energy;
          e.charges++;
        }
      }
      if (e.boost > 0 && --e.boost === 0) e.speed = this.baseSpeed(e);
      if (e.evolving > 0 && --e.evolving === 0) this.evolved(e);
      if (e.iemCd > 0) e.iemCd--;
      if (e.plasmaCd > 0) e.plasmaCd--;
      if (e.gravity > 0) e.gravity--;
      if (e.blind > 0) e.blind--;
      if (e.frozen > 0) e.frozen--;
      if (e.cone > 0 && --e.cone === 0) this.cones--;
      // Canon IEM: the machine goes back when its time is up or when the Centre K holding it falls.
      if (e.seizedLeft > 0 && (--e.seizedLeft === 0 || this.entities.get(e.seizedBy)?.owner !== e.owner)) this.unseize(e);
      this.regenerate(e);
      this.rechargeShields(e);
    }
    this.revive();
    this.chargeUltimates();
    this.storms = this.storms.filter((z) => z.until > this.tick);
    this.poisonClouds();
    this.index();
    // Those there when the tick began, without copying them: what spawns meanwhile comes after them (ids only grow)
    // and waits for the next tick, and none but the one thinking can leave the map during the loop.
    const last = this.nextId - 1;
    for (const e of this.entities.values()) {
      if (e.id > last) break;
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
    // A disc a player already got this pass (same tile, radius and height: a crowd on one tile) is not revealed again.
    const W = this.grid.width;
    const done = this.vision.map(() => new Set<number>());
    for (const e of this.entities.values()) {
      if (e.owner < 0 || !('sight' in e.def)) continue;
      const r = e.def.kind === 'building' && e.buildLeft > 0 ? 3 : e.blind > 0 ? 1 : e.airborne && e.type === 'pegase' ? BALANCE.rules.upgrades.pegaseAir.sight : e.def.sight + (e.type === 'espion' && this.level(e.owner, 'omniscience') ? BALANCE.rules.upgrades.omniscience : 0) + (e.type === 'zespion' && this.level(e.owner, 'megaespion') ? BALANCE.rules.z.megaEspion.sight : 0);
      const tx = tileOf(e.x);
      const ty = tileOf(e.y);
      const high = soars(e);
      const edge = (e.x % FP === 0 ? 1 : 0) + (e.y % FP === 0 ? 2 : 0);
      const k = Number.isInteger(r) && r >= 0 && r < 1024 && tx >= 0 && tx < W && ty >= 0 ? (((ty * W + tx) * 1024 + r) * 2 + (high ? 1 : 0)) * 4 + edge : -1;
      for (const a of this.team[e.owner]) {
        if (k >= 0) {
          if (done[a].has(k)) continue;
          done[a].add(k);
        }
        if (edge) this.vision[a].revealAt(e.x, e.y, FP, r, high);
        else this.vision[a].reveal(tx, ty, r, high);
      }
    }
    for (const s of this.scans) for (const a of this.team[s.owner]) this.vision[a].revealAt(s.x, s.y, FP, s.radius ?? OBSERVATION.radius);
    for (const d of this.detected) d.clear();
    // Déflecteurs hide the allied ground units round them.
    this.shrouded.clear();
    // The Déflecteurs listed first: the units are then looked through once, and only if there is one.
    const veils: [Entity, number][] = [];
    for (const d of this.entities.values()) {
      const r = (d.def as BuildingDef).cloakAura;
      if (r && d.buildLeft === 0) veils.push([d, toFp(r)]);
    }
    if (veils.length)
      for (const u of this.entities.values()) {
        if (u.def.kind !== 'unit' || flies(u)) continue;
        for (const [d, r] of veils) if (u.owner === d.owner && dist(u.x, u.y, d.x, d.y) <= r) this.shrouded.add(u.id);
      }
    // The detectors and their range, listed once (at the first hidden unit) rather than for each hidden unit.
    let detectors: [Entity, number][] | undefined;
    for (const e of this.entities.values()) {
      if (!this.hidden(e)) continue;
      for (const s of this.scans) if (this.hostile(s.owner, e.owner) && dist(s.x, s.y, e.x, e.y) <= toFp(s.radius ?? OBSERVATION.radius)) for (const a of this.team[s.owner]) this.detected[a].add(e.id);
      detectors ??= [...this.entities.values()].flatMap((s): [Entity, number][] => {
        const r = (s.def as UnitDef | BuildingDef).detector ?? (s.type === 'plesiosaure' && this.level(s.owner, 'oeilpercant') ? BALANCE.rules.upgrades.oeilpercant : YGGDRASILL.includes(s.type) && this.level(s.owner, 'prescience') ? BALANCE.rules.upgrades.prescience : s.support & KIT.detection ? (s.def as UnitDef).sight : 0);
        return r && s.buildLeft === 0 ? [[s, r]] : [];
      });
      for (const [s, r] of detectors) if (this.hostile(s.owner, e.owner) && dist(s.x, s.y, e.x, e.y) <= r * FP) for (const a of this.team[s.owner]) this.detected[a].add(e.id);
    }
  }

  /** Can this player currently see the entity? */
  sees(player: number, e: Entity): boolean {
    if (e.owner === player || (e.owner >= 0 && !this.hostile(e.owner, player))) return true;
    if (e.inside) return false;
    if (e.def.kind === 'unit') {
      // Right on a tile's edge, on either side of it: the same from every corner of the map.
      const [tx, ty, v] = [tileOf(e.x), tileOf(e.y), this.vision[player]];
      const seen = v.visible(tx, ty) || (e.x % FP === 0 && (v.visible(tx - 1, ty) || (e.y % FP === 0 && v.visible(tx - 1, ty - 1)))) || (e.y % FP === 0 && v.visible(tx, ty - 1));
      return seen && (!this.hidden(e) || this.detected[player].has(e.id));
    }
    const size = (e.def as BuildingDef).size ?? 1;
    for (let y = e.ty; y < e.ty + size; y++) for (let x = e.tx; x < e.tx + size; x++) if (this.vision[player].visible(x, y)) return true;
    return false;
  }

  /** Recent bodies (Réanimation), dropped after 20 s. */
  corpses: { x: number; y: number; tick: number; owner: number; type: string }[] = [];

  private bury(): void {
    this.corpses = this.corpses.filter((c) => this.tick - c.tick < ticks(20));
    // No copy: only the entity at hand leaves the map, which a Map's iteration allows.
    for (const e of this.entities.values()) {
      if (e.hp > 0 || e.def.kind === 'resource') continue;
      // A unit taken for a while (Soumission, Canon IEM) dies its own player's.
      const owner = e.charm ? e.charmOwner : e.seizedLeft ? e.seizedFrom : e.owner;
      this.deaths.push({ x: e.x, y: e.y, type: e.type, owner, air: flies(e) });
      // Living units leave a body an Alchimiste can raise for a while.
      if (e.def.kind === 'unit' && !e.def.mechanical && !flies(e) && e.type !== 'cadavre') this.corpses.push({ x: e.x, y: e.y, tick: this.tick, owner, type: e.type });
      // Pillage: the player who brings an enemy building down takes a share of what it cost.
      if (e.def.kind === 'building' && e.lastHitBy >= 0 && this.hostile(e.lastHitBy, e.owner) && this.level(e.lastHitBy, 'pillage')) {
        const share = BALANCE.rules.upgrades.pillageShare;
        this.players[e.lastHitBy].minerals += idiv(e.def.cost.minerals * share, 100);
        this.players[e.lastHitBy].energy += idiv(e.def.cost.energy * share, 100);
      }
      if (e.order?.kind === 'gather') this.release(e, e.order.target);
      if (e.def.kind === 'unit' && e.def.respawn) this.respawns.push({ owner: e.owner, type: e.type, at: this.tick + ticks(e.def.respawn) });
      this.remove(e);
    }
  }

  /**
   * The Temple primordial charges each mythology's ultimate while its three gods stand (notice: the charge stops,
   * and keeps what it had, when one is missing); full, any of the three can cast it.
   */
  private chargeUltimates(): void {
    const full = ticks(BALANCE.units.primordial.charge);
    for (const p of this.players) {
      if (p.faction !== 'dieux') continue;
      let temple = false;
      const standing = new Set<string>();
      for (const e of this.entities.values()) {
        if (e.owner !== p.id || e.hp <= 0) continue;
        if (e.type === 'primordial' && e.buildLeft === 0) temple = true;
        else if (e.def.kind === 'unit' && (e.def as UnitDef).unique) standing.add(e.type);
      }
      if (!temple) continue;
      for (const [m, my] of Object.entries(MYTHS) as [Mythology, (typeof MYTHS)[Mythology]][]) {
        const now = p.ultimates?.[m] ?? 0;
        if (now >= full || !my.gods.every((g) => standing.has(g))) continue;
        (p.ultimates ??= {})[m] = now + 1;
        if (now + 1 === full) this.say(p.id, `Sort ultime ${my.name} chargé : ${ABILITIES[my.spell].name}.`, 'done');
      }
    }
  }

  /** Whether that mythology's ultimate is charged for the player. */
  ultimateReady(player: number, m: Mythology): boolean {
    return (this.players[player].ultimates?.[m] ?? 0) >= ticks(BALANCE.units.primordial.charge);
  }

  /** Gaïa comes back by her side's headquarters once her time is up (later, if it has none standing). */
  private revive(): void {
    for (const r of this.respawns) {
      if (this.tick < r.at) continue;
      // The first finished headquarters, looked for without copying every entity (done each tick while there is none).
      let hq: Entity | undefined;
      for (const b of this.entities.values())
        if (b.owner === r.owner && b.type === FACTIONS[this.players[r.owner].faction].hq && b.buildLeft === 0) {
          hq = b;
          break;
        }
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

  /** Bac à sable: a building site stands finished, and what a queue is making comes out at the next tick. */
  private hurry(e: Entity): void {
    if (e.def.kind === 'building' && e.buildLeft > 0) {
      e.buildLeft = 0;
      e.hp = e.maxHp;
      e.shield = e.maxShield;
      this.say(e.owner, `Construction terminée : ${e.def.name}.`, 'done');
    }
    if (e.queue.length && e.trainLeft > 1) e.trainLeft = 1;
    if (e.trainLeft2 > 1) e.trainLeft2 = 1;
  }

  /** A player with no building left, or who resigned, is defeated; the last team standing wins (`winner` is one of its players). A
   * match with one player (Bac à sable) never ends. */
  private judge(): void {
    if (this.winner !== null || this.players.length < 2) return;
    const alive = this.players.filter((p) => !p.resigned && [...this.entities.values()].some((e) => e.owner === p.id && e.def.kind === 'building'));
    if (alive.length === 0) this.winner = -1;
    else if (alive.every((p) => p.team === alive[0].team)) this.winner = alive[0].id;
    // The match goes on (an ally still stands): a side that gave up leaves the field, as a player who quits, so its
    // workers stop mining, its towers stop shooting and its buildings stop producing. A 1 v 1 has ended above.
    if (this.winner !== null || !this.players.some((p) => p.resigned)) return;
    for (const e of this.entities.values()) {
      if (e.def.kind === 'resource' || !this.players[e.owner]?.resigned) continue;
      if (e.order?.kind === 'gather') this.release(e, e.order.target);
      this.remove(e);
    }
    this.respawns = this.respawns.filter((r) => !this.players[r.owner]?.resigned);
  }

  // ---------------------------------------------------------------- players

  supply(player: number): { used: number; max: number } {
    let used = 0;
    let max = 0;
    // Offrandes (Dieux): the gods stop counting.
    const offrandes = this.level(player, 'offrandes') > 0;
    const counts = (t: string) => (DEFS[t].kind === 'unit' && !(offrandes && (DEFS[t] as UnitDef).unique) ? (DEFS[t] as UnitDef).supply : 0);
    for (const e of this.entities.values()) {
      if (e.owner !== player) continue;
      if (e.def.kind === 'unit') used += counts(e.type);
      else if (e.def.kind === 'building') {
        if (e.def.supply < 0) used -= e.def.supply;
        else if (e.buildLeft === 0) max += e.def.supply;
      }
      if (e.def.kind !== 'resource') for (const t of e.queue) used += counts(t); // a god's queued level counts nothing
    }
    return { used, max: Math.min(200, max) };
  }

  /** A building site, just paid for: a tenth of its hit points, no shield, building itself if it warps in. */
  site(type: string, owner: number, tx: number, ty: number, lvl = 1): Entity {
    const b = this.spawn(type, owner, tx * FP, ty * FP);
    b.buildLeft = this.buildTicks(b);
    b.lvl = lvl;
    b.hp = Math.max(1, idiv(b.maxHp, 10));
    b.shield = 0;
    return b;
  }

  /** What an Isdaris robot pays to beam a building down on itself: a third more (fiche 2010; the mod's 333 for 250). */
  beaconCost(def: { cost: Cost }): Cost {
    const up = (n: number) => idiv(n * (100 + BALANCE.rules.materialisation.beaconSurcharge), 100);
    return { minerals: up(def.cost.minerals), energy: up(def.cost.energy) };
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

  /**
   * Is this upgrade the next level of its line, counting the levels already queued? An extension: one of `host`'s type
   * (`at`, or any if none is given) does not carry it yet nor has it queued.
   */
  researchable(player: number, type: string, at?: Entity): boolean {
    const up = DEFS[type];
    if (up?.kind !== 'upgrade' || up.faction !== this.players[player].faction) return false;
    if (up.host) {
      const free = (b: Entity) => b.type === up.host && b.buildLeft === 0 && !b.exts.includes(type) && !b.queue.includes(type);
      return at ? at.owner === player && free(at) : [...this.entities.values()].some((b) => b.owner === player && free(b));
    }
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

  /**
   * An Isdaris extension standing: on `at` when that building is of the extension's host type (what it unlocks there is
   * that building's own: its units, its research, its power), else on any finished building of the player's (the Autel
   * lets every Portail train Assassins, the Pyramide every Psycho-assembleur Dragons: notice).
   */
  hasExt(player: number, ext: string, at?: Entity): boolean {
    const host = (DEFS[ext] as UpgradeDef).host;
    if (at && at.type === host) return at.exts.includes(ext);
    for (const b of this.entities.values()) if (b.owner === player && b.type === host && b.buildLeft === 0 && b.hp > 0 && b.exts.includes(ext)) return true;
    return false;
  }

  /** How many finished buildings (and units) of each type a player has: one pass, for many requirement checks. */
  builtCounts(player: number): Map<string, number> {
    const n = new Map<string, number>();
    for (const e of this.entities.values()) {
      if (e.owner !== player || e.buildLeft > 0) continue;
      // A Humains building turned into another (Grande Alchimisterie, Caserne volante, Grand Conseil) still counts as
      // what it was: « requiert Alchimisterie » stays met once it has grown (the balancer's tree, 2026-11-22).
      for (let t: string | undefined = e.type; t; t = (DEFS[t] as BuildingDef).faction === 'humains' || t === 'podsup' ? MORPHED_FROM[t] : undefined) n.set(t, (n.get(t) ?? 0) + 1);
    }
    return n;
  }

  /**
   * What `type` still requires, or ''. `built`: builtCounts(player), when the caller checks many types at once. `at`: the
   * building that would make it, whose own extensions count (hasExt).
   */
  lacks(player: number, type: string, built?: Map<string, number>, at?: Entity): string {
    if ((DEFS[type] as BuildingDef | UnitDef).unique && [...this.entities.values()].some((b) => b.owner === player && (b.type === type || b.queue.includes(type)))) return 'Un seul par joueur.';
    const count = (t: string) => (built ??= this.builtCounts(player)).get(t) ?? 0;
    const any = (DEFS[type] as BuildingDef).requiresAny;
    if (any && any.of.reduce((s, t) => s + count(t), 0) < any.count) {
      return `Requiert : ${any.count} parmi ${any.of.map((t) => DEFS[t].name).join(', ')}`;
    }
    const req = (DEFS[type] as UpgradeDef | UnitDef | BuildingDef).requires ?? {};
    const missing = Object.entries(req)
      .filter(([t, n]) =>
        DEFS[t].kind === 'upgrade'
          ? (DEFS[t] as UpgradeDef).host
            ? !this.hasExt(player, t, at)
            : this.level(player, (DEFS[t] as UpgradeDef).line) < (DEFS[t] as UpgradeDef).level
          : count(t) < n,
      )
      // A research is named as such: « Pod supérieur » alone read as the building (équilibreur 23/11).
      .map(([t, n]) => (n > 1 ? `${n} × ${DEFS[t].name}` : DEFS[t].kind === 'upgrade' && Object.values(DEFS).some((d) => d.kind !== 'upgrade' && d.name === DEFS[t].name) ? `recherche ${DEFS[t].name}` : DEFS[t].name));
    return missing.length ? `Requiert : ${missing.join(', ')}` : '';
  }

  /** While applying a shift-command: new orders go to the end of each unit's list. */
  /** Cônes de protection active (Z Accumulateur): when none, no one looks for one. */
  cones = 0;

  /**
   * The entities a few scans look for, each list in the order of the entities themselves (by id), so a scan of a list
   * finds what the scan of every entity found, ties included: the buildings minerals are brought back to, the mineral
   * fields, the Conseils, Odin and Athéna (their auras), and what carries a shield. Told apart by what never changes
   * but through spawn, remove, retype and empower, which drop the lists (`listed` makes them again when next asked);
   * the rest (owner, finished or not, alive, in reach) is still asked of each one, as before. A worker's way home
   * went through every entity at every tick.
   */
  private lists: Lists | null = null;
  listed(): Lists {
    if (this.lists) return this.lists;
    const l: Lists = { dropoffs: [], fields: [], councils: [], odins: [], athenas: [], shielded: [] };
    for (const e of this.entities.values()) {
      if ((e.def as BuildingDef).dropoff) l.dropoffs.push(e);
      if (e.type === 'minerai') l.fields.push(e);
      else if (e.type === 'conseil' || e.type === 'grandconseil') l.councils.push(e);
      else if (e.type === 'odin') l.odins.push(e);
      else if (e.type === 'athena') l.athenas.push(e);
      if (e.maxShield > 0) l.shielded.push(e);
    }
    return (this.lists = l);
  }
  /** The lists are out of date (an entity came, went, changed type or gained a shield). */
  unlist(): void {
    this.lists = null;
  }

  queueing = false;
  /** Long paths searched this tick (movement.ts pathFor). */
  searched: { sx: number; sy: number; gx: number; gy: number; tiles: number[] }[] = [];
  searchedAt = -1;
  /** Per rectangle (movement.ts doorstep), the regions this tick's searches found no way into it from. */
  shut = new Map<number, Set<number>>(); // every region found shut off, merged
  shutAt = -1;
  /**
   * The command being applied without Shift: a unit it gives an order to (or stops) drops its queued ones then. Not
   * before: a command refused, a production or an upgrade bought left the Shift-queued moves of the units selected
   * with the building gone.
   */
  commanding: Command | null = null;

  // ---------------------------------------------------------------- placement

  // ---------------------------------------------------------------- unit behaviour

  private think(e: Entity): void {
    if (e.inside) return this.shelter(e);
    // A god summons only while it stands still (even pushed onto a blocked tile, which it steps off without a goal);
    // Gaïa's Esprits come out as she walks (balance designer, 2026-11-22).
    if (e.queue.length && (!e.goal || e.type === 'gaia') && e.held === 0) this.produce(e);
    // Caught under a new building (with or without orders): walk out first.
    if (!soars(e) && !this.grid.open(tileOf(e.x), tileOf(e.y))) return this.evict(e);
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
      if (!e.order && !soars(e)) this.evict(e);
      return;
    }
    switch (o.kind) {
      case 'cast': {
        const ab = spell(o.ability, e.lvl);
        if (!this.ready(e, o.ability)) return this.setOrder(e, null);
        // Aimed at a building: its edge is near enough (a big one's middle may be out of reach).
        const on = [...this.entities.values()].find((b) => b.def.kind === 'building' && Math.abs(b.x - o.x) * 2 <= (b.def as BuildingDef).size * FP && Math.abs(b.y - o.y) * 2 <= (b.def as BuildingDef).size * FP);
        if ((on ? this.gap(e, on) : dist(e.x, e.y, o.x, o.y)) > toFp(ab.range ?? 0)) {
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
      case 'follow': {
        const t = this.entities.get(o.target);
        // Lost (dead, gone inside, taken over): on to where it was last.
        if (!t || t.hp <= 0 || t.inside || this.hostile(t.owner, e.owner)) return this.setOrder(e, { kind: 'move', x: o.lx, y: o.ly, arrive: FP / 2 });
        o.lx = t.x;
        o.ly = t.y;
        if (this.gap(e, t) > FP) return this.chase(e, t);
        e.goal = null;
        return;
      }
      case 'enter': {
        const b = this.entities.get(o.target);
        const room = b && this.room(b);
        // Checked again on arrival: a Scarabée may have been lifted into a Bourdon meanwhile, or filled.
        if (!b || !room || b.hp <= 0 || b.owner !== e.owner || !this.boards(e, b)) return this.setOrder(e, null);
        if (b.def.kind === 'unit') {
          // A carrier (Scarabée, Bourdon): walk up to it, wherever it goes.
          if (this.gap(e, b) > FP / 2) return this.chase(e, b);
        } else if (!this.reachRect(e, b.tx, b.ty, (b.def as BuildingDef).size)) return void this.goNear(e, b.tx, b.ty, (b.def as BuildingDef).size);
        if (this.load(b, e) > room) {
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
        // An Isdaris robot is the beacon: the site within its sight (notice, fiche 2010).
        const beam = def.faction === 'isdaris' ? (e.def as UnitDef).sight : WARP_RANGE;
        const there = def.warp ? dist(e.x, e.y, cx, cy) <= beam * FP : this.reachRect(e, o.tx, o.ty, def.size);
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
        // Checked again on the spot: another worker may have raised the one-per-player building since the order.
        const lack = this.lacks(e.owner, o.type);
        if (lack) {
          this.say(e.owner, lack);
          return this.setOrder(e, null);
        }
        // Fiche 2010: an Obélisque or a Récepteur beamed down on a robot costs a third more, out of the construction zone
        // only (équilibreur 24/11).
        if (!this.pay(e.owner, def.faction === 'isdaris' && !this.powered(e.owner, cx, cy) ? { cost: this.beaconCost(def) } : def)) return this.setOrder(e, null);
        const b = this.site(o.type, e.owner, o.tx, o.ty, e.lvl);
        if ((e.def as UnitDef).unique) e.raising = b.id;
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
      case 'repair': {
        const b = this.entities.get(o.target);
        if (!b || b.owner !== e.owner || b.hp <= 0 || b.hp >= b.maxHp || e.stuck > 5) return this.setOrder(e, null);
        const size = b.def.kind === 'building' ? (b.def as BuildingDef).size : 0;
        if (size ? !this.reachRect(e, b.tx, b.ty, size) : dist(e.x, e.y, b.x, b.y) > e.radius + b.radius + FP) {
          if (size) this.goNear(e, b.tx, b.ty, size);
          else this.goTo(e, b.x, b.y);
          return;
        }
        if (this.tick % TICK_RATE !== 0) return;
        // A full repair costs a quarter of what it is worth (a proposal: Z.doc says « contre ressources »).
        const R = REPAIR[e.type];
        const heal = Math.min(R.hp, b.maxHp - b.hp);
        const cost = (b.def as { cost: Cost }).cost;
        o.owedM += idiv(cost.minerals * R.percent * heal * 10, b.maxHp);
        o.owedE += idiv(cost.energy * R.percent * heal * 10, b.maxHp);
        const p = this.players[e.owner];
        const m = idiv(o.owedM, 1000);
        const en = idiv(o.owedE, 1000);
        if (p.minerals < m || p.energy < en) {
          this.say(e.owner, 'Pas assez de ressources pour réparer.');
          return this.setOrder(e, null);
        }
        p.minerals -= m;
        p.energy -= en;
        o.owedM -= m * 1000;
        o.owedE -= en * 1000;
        b.hp += heal;
        return;
      }
      case 'construct': {
        const b = this.entities.get(o.target);
        if (!b || b.buildLeft === 0 || e.stuck > 5) return this.setOrder(e, null);
        if (!this.reachRect(e, b.tx, b.ty, (b.def as BuildingDef).size)) {
          this.goNear(e, b.tx, b.ty, (b.def as BuildingDef).size);
          return;
        }
        // Fiche 2010 (Serf): each worker on site cuts the time left by 10 %, so n of them build (10/9)^(n-1) times as
        // fast. The one with the lowest id works for the whole crew, once a tick.
        const crew = [...this.entities.values()].filter((w) => w.order?.kind === 'construct' && w.order.target === b.id && this.reachRect(w, b.tx, b.ty, (b.def as BuildingDef).size));
        if (crew.some((w) => w.id < e.id)) return;
        const n = Math.min(crew.length, 10);
        b.buildFrac += idiv(1000 * 10 ** (n - 1), 9 ** (n - 1));
        const total = ticks((b.def as BuildingDef).buildTime);
        for (; b.buildFrac >= 1000 && b.buildLeft > 0; b.buildFrac -= 1000) {
          b.buildLeft--;
          this.grow(b, total);
        }
        if (b.buildLeft === 0) {
          this.say(b.owner, `Construction terminée : ${b.def.name}.`, 'done');
          // Those that built it from behind (out of the camera's sight: it looks from +x +y) come out round the front
          // corner, where they can be seen and picked; one with orders queued goes on with them instead.
          const half = idiv((b.def as BuildingDef).size * FP, 2) + FP;
          const behind = [...this.entities.values()].filter((w) => w.order?.kind === 'construct' && w.order.target === b.id && !w.next.length && w.x - b.x + (w.y - b.y) < 0);
          this.moveGroup(behind, b.x + half, b.y + half);
        }
        return;
      }
      case 'gather':
        return this.gather(e, o);
    }
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
      if (e.lvl > 1) mix(e.lvl); // only then: replays recorded before the levels keep their hashes
      if (e.arts.length) mix(e.arts.length * 31);
      for (const x of e.exts) mix(x.length * 53 + x.charCodeAt(0) * 59); // Isdaris extensions, only when built
      // Mixed only when set, like the level: hashes of games without them stay as they were.
      if (e.illusion) mix(7919);
      if (e.trainLeft2) mix(e.trainLeft2 * 37);
      if (e.order?.kind === 'gather' && e.order.skip?.length) {
        mix(e.order.skipped! * 41);
        for (const id of e.order.skip) mix(id * 43);
      }
    }
    for (const p of this.players) {
      mix(p.minerals);
      mix(p.energy);
      for (const line of Object.keys(p.upgrades).sort()) mix(p.upgrades[line] * (line.length + 1));
      for (const m of Object.keys(p.ultimates ?? {}).sort()) mix(p.ultimates![m as Mythology]! * (m.length + 7));
      if (p.resigned) mix(104729);
    }
    return h >>> 0;
  }
}

// Installed like the class's own methods: on the prototype, not enumerable.
for (const m of [commands, abilities, combat, buildings, movement, economy]) for (const [k, f] of Object.entries(m)) Object.defineProperty(World.prototype, k, { value: f, writable: true, configurable: true });
