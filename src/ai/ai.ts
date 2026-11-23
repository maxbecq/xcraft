import { ABILITIES, abilitiesOf, ARTEFACTS, spell, KIT, type BuildingDef, CLASSES, DEFS, FACTIONS, RAPPEL, raises, reaches, type FactionDef, type UnitDef, type UpgradeDef, WEAPONS, weaponAt, withKit } from '../data';
import BALANCE from '../balance.json';
import { FP, dist, ticks, toFp } from '../sim/fixed';
import { expansions, startSite } from '../sim/setup';
import { armyOf, counter, DOCTRINE, type Doctrine, hash, LEGACY, pickStrategy, type Seen, type Strategy, USUAL_GODS } from './strategy';
import { type Command, type Entity, type World, REPAIR, flies } from '../sim/world';

/** How the AI plays; numbers are counts unless noted. */
export interface Plan {
  serfs: number;
  /** Casernes to own once the economy reaches these serf counts. */
  casernes: [atSerfs: number, count: number][];
  /** Build the mine once this many casernes stand. */
  mineAfter: number;
  /** First attack wave size, and growth per wave. */
  wave: number;
  waveGrowth: number;
  /** Units per soigneur in production. */
  healerEvery: number;
  /** Légionnaires per auxiliaire in production (0..1). */
  legionShare: number;
}

/** "Bioball auxiliaire" from the Human openings, simplified (normal difficulty). */
export const BIOBALL = BALANCE.ai.plan as Plan;

/** Difficulty: the AI plays the same plan, with a harvesting handicap (percent of minerals banked). */
export const DIFFICULTY: Record<string, number> = BALANCE.ai.difficulty;

const THINK_EVERY = 10; // ticks
/** Seconds a worker on its way to a field may stand still before it is sent to another field. */
const STUCK_SECONDS = 5;
/** Tiles within which a stuck worker looks for another field. */
const STUCK_REACH = 12;
const DEFEND_RADIUS = 14 * FP;
/** A wave on its way to the shared road's middle goes on to its target once its front is this close to it. */
const VIA_REACHED = 6 * FP;
/** Seconds after which a wave stops making for the shared road's middle. */
const VIA_TIMEOUT = 60;
/** Tiles from the shared road's middle within which the road found the other way round counts as the same road. */
const VIA_SAME_ROAD = 8;
const MAX_WAVE = BALANCE.ai.maxWave;
/** Researches in priority order, by faction; any building that hosts one researches it when idle. */
const LISTED = BALANCE.ai.research as Record<string, string[]>;
/**
 * ai.research, with the Z Accumulateur first: it waits for the Intelligence suprême and the Centre d'optimisation,
 * then comes before everything else (in the late list, it came at minute 30, once the army was full: no socle got it).
 */
const RESEARCH: Record<string, string[]> = { ...LISTED, z: ['raccumulateur', ...(LISTED.z ?? []).filter((t) => t !== 'raccumulateur')] };
/** Late buildings, by faction: [type, from minute], one of each. */
const EXTRA = BALANCE.ai.extra as unknown as Record<string, [string, number][]>;
const MAX_CLOAKED = BALANCE.ai.maxCloaked;
/** What the easy and hard AIs do differently (see the AI constructor). */
const LEVELS = BALANCE.ai.levels;
/** Bases an AI holds at most, and minutes between its expansions after the natural (maps with more bases). */
const MAX_BASES = 4;
const EXPAND_EVERY = 5;
/** Build orders on one spot before the AI gives it up (its workers never got there). */
const MAX_TRIES = 3;
/** Each team's target base (building id, by team), shared by its AIs (by world). */
const focuses = new WeakMap<World, Map<number, number>>();
export const teamFocus = (w: World) => focuses.get(w) ?? focuses.set(w, new Map()).get(w)!;
/**
 * Extra cost of an enemy another team already targets (free-for-all), worth 30 tiles of road: without it, the
 * equally distant neighbours of a four-corner map are picked by entity order, two AIs pile on the same players
 * and the two others are left alone.
 */
const GANG_UP = (30 * FP) / 20;
/**
 * Isdaris extensions the AI researches, in order: ground vehicles, druides, then flyers. Each waits for its host,
 * so the Laboratoire (Portail) comes first until the Psycho-assembleur stands, whose vehicles then go first.
 */
// The Totem too (Voyageurs, the vehicles' research, the Couloir temporel). Then those of the Orbe de commandement (Assassins, Dragons, its Observatoire) and of the Trône (its three powers),
// each once its host stands: off this list, among the late researches, they never came, nor the units and powers
// behind them.
const EXTENSIONS = ['assembleur', 'laboratoire', 'balise', 'totem', 'autel', 'pyramide', 'relais', 'concentrateur', 'porte', 'observatoire'];
/** Minerals and energy kept over the price before the AI puts a second copy of an extension on another building. */
const SPARE_EXTENSION = 400;
/**
 * Every other research of each faction, after its list (ai.research), from minute 10 and with resources to spare: the
 * AI plays all of its camp, so that the AI-against-AI measures weigh every research. The artefacts and god levels
 * are bought by the gods (summon).
 */
const LATE: Record<string, string[]> = Object.fromEntries(
  Object.keys(FACTIONS).map((f) => [f, Object.entries(DEFS).filter(([k, d]) => d.kind === 'upgrade' && d.faction === f && !(RESEARCH[f] ?? []).includes(k) && !EXTENSIONS.includes(k) && !ARTEFACTS.includes(k) && k !== 'niveau').map(([k]) => k)]),
);
/** Late buildings besides ai.extra, by faction: [type, from minute], one of each (Métallurgie: the Humans' vehicles). */
const MORE_EXTRA: Record<string, [string, number][]> = { humains: [['metallurgie', 12]], isdaris: [['trone', 18]] };
/** `e` is a `type`, or a building turned from one (Grand Conseil, Intelligence suprême, Caserne volante). */
/** Z socle weapons, by weight (ai.kits), the Accumulateur too: its four powers are part of the camp. */
const KITS: Record<string, number> = { ...BALANCE.ai.kits, accumulateur: 1 };
const kin = (e: Entity, type: string) => e.type === type || !!(DEFS[type] as BuildingDef | undefined)?.morphs?.includes(e.type);

/** Dieux units and the forms they turn into (Forme de feu), counted together for the army's shares. */
const FORMS: Record<string, string[]> = { elembase: ['elementaire', 'elemeau', 'elemterre', 'elemair', 'golem'] };
/** Human units each due for a share of the army (nextUnit), held back by the tech's energy reserve only. */
const SHARED = ['phalangiste', 'belluaire'];
/** Abilities the AI uses with the plain rule above (on engaging); the others go through tactics(). */
const SIMPLE = ['stimulant', 'charge'];
/** Area abilities aimed at enemy crowds: least enemies under the blast. */
/** Powers tried before a unit's others (they share one cooldown), in this order. */
const FIRST = ['cone', 'gravite', 'gel'];
const CROWD: Record<string, number> = { explosiftoxique: 3, silence: 2, pluiedefeu: 3, lumiereardente: 3, tempete: 2, impulsion: 3, vacarme: 3 };
/** Spells that take a caster out of a lost fight: the mana for them is never spent on another. */
const ESCAPE = ['voyage'];
/** Dieux: the gods the Porte d'Asgaard summons, and from which minute (one at a time, in this order). */

// What one turn of the AI works from, step by step: what it has, what it wants, what it keeps back, what it spends.
type Survey = ReturnType<AI['survey']>;
type Need = ReturnType<AI['need']>;
type Turn = Survey & Need & ReturnType<AI['budget']> & { keep: number; godEnergy: number; low: number; queued: number; mending: number; urgent: boolean };

/** A computer player. It only acts through commands, like a human. */
/** A building spot's key: its middle, in half tiles. */
const spotKey = (tx: number, ty: number, size: number) => `${2 * tx + size},${2 * ty + size}`;

export class AI {
  private waves = 0;
  private trained = 0;
  /** The tech building has fielded a unit of its own once (the first one comes before anything else it holds up). */
  private fielded = false;
  /** Our workers at the last think, to see which died since (and the set reused for the next). */
  private workers = new Set<number>();
  private workersNow = new Set<number>();
  /** Workers killed and not yet replaced by a new one out (one in a queue only counts while it is there). */
  private unreplaced = 0;
  /** The bank at the last think, and the last tick it grew (minerals brought in), to tell an income from a promise. */
  private lastBank = 0;
  private lastIncome = 0;
  /** Its workers (alive or queued) have reached their target once. */
  private staffed = false;
  /** Most enemy flying units seen at once: calls for anti-air. */
  private enemyAir = 0;
  /** When an armed enemy flyer was last seen. */
  private airSeen = 0;
  /** Soldiers sent in the current attack wave. */
  private wave = new Set<number>();
  /** Enemy fighters and armed buildings we have seen: hp and shields, damage per second, as last seen. */
  private foes = new Map<number, [number, number]>();
  /**
   * Where a new wave goes first: the middle of the road between our headquarters and the enemy's, the road always
   * found from the lower seat to the higher. Each army taking the road its own pathfinding gives it, two armies on
   * a map turned 180° with two equal roads (L'Anneau, round its chasm) took one road each, passed without meeting,
   * and the side whose base was hit first called its wave back, to be beaten piecemeal at home.
   */
  private via: { x: number; y: number; until: number } | null = null;
  /**
   * Build orders given per spot, by its middle in half tiles (by its top-left tile, a building of another size there
   * cleared it in one corner and not in the mirror); a spot tried MAX_TRIES times with nothing built there is given up.
   */
  private tried = new Map<string, number>();
  /** Since when the game has looked lost (see `lost`), with the bank then: minerals, and energy if a Marché could sell it. */
  private hopeless: { since: number; minerals: number; energy: number } | null = null;
  /** Workers on their way to a field: where they stood, and since when (see `tend`). */
  private walking = new Map<number, { x: number; y: number; since: number }>();
  /** Fields each worker got stuck on its way to: never sent there again (two fields out of reach, it went back and forth). */
  private failed = new Map<number, Set<number>>();
  /** No base left: a worker and the price of a headquarters (and of the next worker, a Z drone absorbed) are there. */
  private rebuildable = false;
  /** Workers able to raise a headquarters, this turn. */
  private raisers = 0;
  /** Minerals the Humans' advanced buildings keep from the Casernes for a unit they wait for (the Marché leaves them). */
  private advancedHeld = 0;
  /** That unit is short of energy too: the Marché buys it above the minerals kept (not 500 above them). */
  private advancedEnergyShort = false;
  /** Enemies at our base this turn, whatever their strength (no Couloir temporel then). */
  private homeThreat = false;
  /** A threat on our base stronger than the army at home, this turn (Mur d'énergie). */
  private danger: { x: number; y: number } | undefined;

  private readonly faction: FactionDef;
  /** The game plan drawn at the start (strategy.ts), the doctrine it plays by, and its lists as this game bends them. */
  readonly strategy: Strategy;
  readonly doctrine: Doctrine;
  private gods: [string, number][];
  private researchList: string[];
  /** The army aimed at, bent by what the scouts saw (counter), recomputed each turn. */
  private armyList: [string, number][];
  /** Most of each enemy type seen at once. */
  private seen: Seen = new Map();

  private readonly easy: boolean;
  private readonly hard: boolean;

  /**
   * `level` (menu: easy, normal, hard) changes how it plays, on top of the harvest handicap: the easy AI has a
   * smaller economy and army (its own plan), trains one unit at a time, attacks late with small waves, expands late,
   * never raids workers, researches, casts, kites nor falls back; the hard AI expands sooner and its
   * soldiers focus their fire on the enemy they can finish.
   */
  /**
   * Strategies and doctrine (strategy.ts): by default for the Dieux only, the camp whose tournament showed a gain
   * (23/11: 34 wins in 48 against 22 for the AI before); the other camps play as before (`legacy`) until theirs do.
   * `opts.strategies` or `opts.strategy` turns them on, `opts.legacy` off.
   * `opts.seed`: the game's seed the strategy is drawn with (by default one from the sides and the map).
   */
  constructor(private readonly world: World, readonly player: number, private readonly plan: Plan = BIOBALL, level = 'normal', opts: { seed?: number; strategy?: string; strategies?: boolean; legacy?: boolean; doctrine?: Doctrine } = {}) {
    this.faction = FACTIONS[world.players[player].faction];
    const faction = world.players[player].faction;
    const seed = opts.seed ?? hash(world.players.map((p) => p.faction).join(','), world.map.width, world.map.height);
    const legacy = opts.legacy ?? !(opts.strategies || opts.strategy || faction === 'dieux');
    this.strategy = legacy ? { id: 'classique', name: 'Classique' } : pickStrategy(faction, seed, player, opts.strategy);
    this.doctrine = opts.doctrine ?? (legacy ? LEGACY : DOCTRINE);
    this.gods = this.strategy.gods ?? USUAL_GODS;
    this.researchList = [...new Set([...(this.strategy.research ?? []), ...(RESEARCH[faction] ?? [])])];
    this.armyList = armyOf(faction, this.strategy);
    if (this.strategy.wave) plan = this.plan = { ...plan, wave: this.strategy.wave, waveGrowth: this.strategy.waveGrowth ?? plan.waveGrowth };
    this.easy = level === 'easy';
    if (this.easy) this.plan = { ...plan, ...(LEVELS.easy.plan as Partial<Plan>) };
    // Z: waves of 12, not 8. Sent eight at a time against a bigger army, its socles died to the last one, and the
    // base after them (light control games, 20 Nov, with the Centre d'armement at minute 10 in balance.json ai.extra:
    // Z – Isdaris on the original map 0 wins out of 18 with waves of 8, 8 with waves of 12).
    else if (this.faction === FACTIONS.z) this.plan = { ...plan, wave: Math.max(plan.wave, 12) };
    this.hard = level === 'hard';
  }

  think(): Command[] {
    const w = this.world;
    // Every AI on the same tick: offset by seat, the second one always saw the first one's moves a tick older than its own.
    if (w.tick % THINK_EVERY !== 0 || w.winner !== null || w.players[this.player].resigned) return [];
    const mine = [...w.entities.values()].filter((e) => e.owner === this.player);
    if (this.lost(mine)) return [{ player: this.player, kind: 'resign', ids: [] }];
    // The headquarters, else another base still standing (the Dieux' Antre, its Porte lost): from there it raises a
    // headquarters again instead of a last stand.
    // No base left, but a worker and the price of a headquarters: from any building still standing, it raises one
    // again (the Z lost their last Intelligence with a Pod, drones and 800 minerals, and only made a last stand).
    // At the price a worker pays for it (an Isdaris robot beams it down for a third more).
    const hqDef = DEFS[this.faction.hq] as BuildingDef;
    const hqCost = hqDef.faction === 'isdaris' ? w.beaconCost(hqDef) : hqDef.cost;
    // A Z drone is absorbed into what it builds: the last one leaves the price of the next drone too, or the new
    // Intelligence stood with no drone and nothing to train one with. From any building, a site (a Grenier whose
    // builder was killed) too.
    const raisers = mine.filter((e) => e.def.kind === 'unit' && raises(e.def as UnitDef, this.faction.hq)).length;
    const absorbed = hqDef.absorbs && raisers < 2 ? (DEFS[this.faction.worker] as UnitDef).cost.minerals : 0;
    const bankNow = w.players[this.player];
    this.raisers = raisers;
    // A Marché's trade counts: energy sold for the minerals short (morph sells it while rebuilding).
    const T = BALANCE.rules.trade;
    const market = mine.some((e) => e.type === 'marche' && e.buildLeft === 0);
    const sellable = market ? Math.floor(Math.max(0, bankNow.energy - hqCost.energy) / T.give) * T.get : 0;
    this.rebuildable = !!raisers && bankNow.minerals + sellable >= hqCost.minerals + absorbed && bankNow.energy >= hqCost.energy;
    // Without its price, a building that can still train a unit the bank pays keeps the AI playing (a Plate-forme
    // with 500 minerals sat out the game in a last stand).
    // A Z Pod too, which can raise a Plate-forme without a drone.
    // With what a Marché would give for the energy over the price (morph sells it).
    const pays = (t: string) => {
      const c = (DEFS[t] as BuildingDef | UnitDef).cost;
      const sale = mine.some((e) => e.type === 'marche' && e.buildLeft === 0) ? this.sale(bankNow.energy, c.energy) : 0;
      return c.minerals <= bankNow.minerals + sale && c.energy <= bankNow.energy;
    };
    // Any fighting unit (a Créaturium's saurians are not in the army list).
    const fights = (t: string) => DEFS[t]?.kind === 'unit' && !(DEFS[t] as UnitDef).worker && !!(DEFS[t] as UnitDef).attack;
    const fields = (t: string) => fights(t) && pays(t);
    // A Dieux god trains too (Thor with 800 minerals and no Porte made a last stand).
    const trainer = mine.some((b) => (b.def.kind === 'building' ? b.buildLeft === 0 && ((b.def as BuildingDef).trains?.some(fields) || (b.def as BuildingDef).addons?.some((a) => pays(a) && (DEFS[a] as BuildingDef).trains?.some(fights))) : !!(b.def as UnitDef).trains?.some(fields)));
    // No building left at all (an ally holding on): from one of its workers.
    const rebuild = () => (this.rebuildable || trainer ? mine.find((e) => e.def.kind === 'building') ?? (this.rebuildable ? mine.find((e) => e.def.kind === 'unit' && raises(e.def as UnitDef, this.faction.hq)) : undefined) : undefined);
    // A finished headquarters, a finished base, then a headquarters' site (the Porte's site taken before the Antre that
    // stood held every spending 90 s).
    const home = mine.find((e) => kin(e, this.faction.hq) && e.buildLeft === 0) ?? mine.find((e) => this.isBase(e) && e.buildLeft === 0) ?? mine.find((e) => kin(e, this.faction.hq)) ?? rebuild();
    if (!home) return this.lastStand(mine);
    const bank = w.players[this.player].minerals;
    if (bank > this.lastBank || !this.lastIncome) this.lastIncome = w.tick;
    this.lastBank = bank;
    const s = this.survey(mine, home);
    this.scout();
    const n = { ...s, ...this.need(s) };
    const ctx: Turn = { ...n, ...this.budget(n), keep: 0, godEnergy: 0, low: 0, queued: 0, mending: 0, urgent: false };
    // Down to fewer than half the workers it wants: the next worker's price is kept from the buildings and the soldiers
    // until one is ordered (Dieux down to a few esprits spent their last minerals elsewhere, and with no income never
    // had the 75 for one again; raided Isdaris put every 70 minerals into a Créature, their last robots unreplaced).
    // Only for a worker that can be trained now: with no room in supply, it kept a Branche's 200 from the 75 (the
    // Branche the esprit waited for); with the Z Intelligence held for its turn into the suprême, the 300 of it.
    // A worker killed keeps a worker's price in the bank until its replacement is ordered, even while the worker's home
    // is busy or gone: Dieux raided down from 16 esprits spent to 40 minerals while Gaïa was dead or training, lost the
    // rest, and never had the 100 for an esprit again (0 esprits, 59 minerals, 9000 energy at 35 min). Deaths seen, not
    // a higher target (a new base) nor the clock. Not with supply full (the Branche), nor while the Z Intelligence is
    // held for its turn into the suprême.
    const f = this.faction;
    const target = this.serfTarget(ctx);
    // Workers queued, one count for the reserve and the orders: in the queues of what trains them.
    for (const e of f.workerFrom ? ctx.mine : ctx.buildings) if (f.workerFrom ? e.type === f.workerFrom : kin(e, f.hq)) for (const t of e.queue) if (t === f.worker) ctx.queued++;
    // Died since the last think: gone from the world, not absorbed into a building (a Z drone). A new one out pays one
    // back; one queued only while it is queued (its producer killed, the loss is owed again).
    const now = this.workersNow;
    now.clear();
    let born = 0;
    for (const e of ctx.mine) if (e.type === f.worker) {
      now.add(e.id);
      if (!this.workers.has(e.id)) born++;
    }
    let died = 0;
    for (const id of this.workers) if (!now.has(id)) died++;
    for (const b of ctx.buildings) if (b.absorbed && this.workers.has(b.absorbed) && !now.has(b.absorbed)) died--;
    [this.workersNow, this.workers] = [this.workers, now];
    // Never more than a full complement (a base lost, or none finished for a while, keeps what was lost).
    this.unreplaced = Math.min(Math.max(0, this.unreplaced + died - born), Math.max(target, this.plan.serfs));
    // Survivors enough for the target (a base lost with them): nothing to replace, no order would come. Survivors only:
    // one queued pays the debt when it is out, not before (its producer killed, it never comes).
    if (target > 0 && ctx.serfs.length >= target) this.unreplaced = 0;
    // A replacement queued needs no second order ahead of supply, but its price stays kept until it is out.
    const owed = Math.max(0, this.unreplaced - ctx.queued);
    const held = ctx.holdSupreme;
    // The price is there before the loss too, once the workers have reached their target, from minute 10: a raid kills
    // them all at once (Isdaris with 16 robots and 94 minerals lost them in 20 s, then had no robot at 100 for 23
    // minutes; Dieux the same with esprits). Not sooner: in the opening those 100 cost the Isdaris their defence against
    // the first Human wave. Kept in the bank only: the worker comes ahead of supply only to replace one killed.
    this.staffed ||= ctx.serfs.length + ctx.queued >= target;
    ctx.urgent = (owed > 0 && ctx.free > 0 && !held) || (ctx.serfs.length + ctx.queued < target / 2 && !!this.workerHome(ctx));
    ctx.low = ctx.urgent || (this.unreplaced > 0 && ctx.free > 0 && !held) || (this.staffed && ctx.minute >= 10 && ctx.free > 0 && !held) ? (DEFS[f.worker] as UnitDef).cost.minerals : 0;
    // Repairs under way take from the bank as they go: what they will still cost is not this turn's to spend.
    for (const s of ctx.serfs) {
      const b = s.order?.kind === 'repair' ? w.entities.get(s.order.target) : undefined;
      const R = b && REPAIR[s.type];
      if (!b || !R) continue;
      ctx.mending += Math.ceil(((b.def as BuildingDef).cost.minerals * R.percent * (b.maxHp - b.hp)) / (100 * b.maxHp));
      ctx.energy -= Math.ceil(((b.def as BuildingDef).cost.energy * R.percent * (b.maxHp - b.hp)) / (100 * b.maxHp));
    }
    // No base to train one from (a headquarters to raise again): no worker's price kept from it.
    if (!this.settled(ctx.home)) ctx.low = 0;
    ctx.minerals -= ctx.mending;
    this.tend(ctx);
    ctx.minerals -= ctx.low;
    // Dieux: the next god due keeps its energy from everything before its summons (research spent it first: Apollon,
    // due at minute 5, came at 9 to 12 or never, and Seth's Sphinx took the rest).
    const nextGod = this.nextGod(ctx);
    // Never below nothing: a cost of nothing (a Puits divin, a Nain, Thor's levels) is still paid. Only for a god with
    // room in supply: one that cannot be summoned kept its energy from research for nothing.
    if (nextGod && ctx.gods.length && ctx.free >= (DEFS[nextGod] as UnitDef).supply) ctx.godEnergy = Math.min((DEFS[nextGod] as UnitDef).cost.energy, Math.max(0, ctx.energy));
    ctx.energy -= ctx.godEnergy;
    this.place(ctx);
    this.research(ctx);
    this.morph(ctx);
    this.soldiers(ctx);
    this.machines(ctx);
    this.barge(ctx);
    this.summon(ctx);
    this.muster(ctx);
    this.cast(ctx);
    this.withdraw(ctx);
    this.guard(ctx);
    this.advance(ctx);
    return ctx.out;
  }

  /** What the scouts see of the enemy's army, kept at its most of each type, and the army aimed at bent by it. */
  private scout(): void {
    if (this.doctrine === LEGACY) return;
    const w = this.world;
    const now = new Map<string, number>();
    for (const e of w.entities.values()) if (e.def.kind === 'unit' && !(e.def as UnitDef).worker && w.hostile(e.owner, this.player) && w.sees(this.player, e)) now.set(e.type, (now.get(e.type) ?? 0) + 1);
    for (const [t, n] of now) this.seen.set(t, Math.max(n, this.seen.get(t) ?? 0));
    this.armyList = counter(armyOf(w.players[this.player].faction, this.strategy), this.seen);
    // The enemy's fighters and armed buildings, as last seen, for `sends` (dominates keeps the same memory).
    const seen = this.visibleFoes();
    for (const e of seen) this.foes.set(e.id, [e.hp + e.shield, this.dps(e)]);
    for (const id of this.foes.keys()) {
      const e = w.entities.get(id);
      if (!e || (w.sees(this.player, e) && !seen.includes(e))) this.foes.delete(id);
    }
  }

  /** What this turn starts from: our units and buildings, the bank (less what builders walking to a site will spend). */
  private survey(mine: Entity[], home: Entity) {
    const w = this.world;
    const f = this.faction;
    // Z drones working an Assimilateur (in it or on their way) no longer mine: counted apart, and replaced.
    const works = (e: Entity) => {
      const b = w.entities.get(e.inside || (e.order?.kind === 'enter' ? e.order.target : 0));
      return !!b && !!(b.def as BuildingDef).energyRate;
    };
    const serfs = mine.filter((e) => e.type === f.worker && !works(e));
    // Dieux: Gaïa places the buildings, Thor, Osiris and Frigg one each (notice); the gods stay home, out of the army.
    const builders = f.builder ? mine.filter((e) => e.type === f.builder || (e.def as UnitDef).builds) : serfs;
    const gods = mine.filter((e) => f.gods?.includes(e.type));
    // Invisible units (Isdaris Assassins) do not join waves: they raid the enemy workers on their own.
    const raiders = mine.filter((e) => e.def.kind === 'unit' && (e.def as UnitDef).cloaked);
    const army = mine.filter((e) => e.def.kind === 'unit' && !(e.def as UnitDef).worker && !(e.def as UnitDef).cloaked && !(e.def as UnitDef).trains && !e.inside);
    const buildings = mine.filter((e) => e.def.kind === 'building');
    // A building turned into another (Récepteur armé…) still counts as what it was.
    const count = (type: string) => buildings.filter((b) => b.type === type || (DEFS[type] as BuildingDef | undefined)?.morphs?.includes(b.type)).length + builders.reduce((n, s) => n + [s.order, ...s.next].filter((o) => o?.kind === 'build' && o.type === type).length, 0);
    const p = w.players[this.player];
    // Resources promised to serfs walking to a construction site are already spent.
    let minerals = p.minerals;
    let promisedEnergy = 0;
    for (const s of builders) {
      for (const o of [s.order, ...s.next]) {
        if (o?.kind !== 'build') continue;
        // An Isdaris robot pays a third more than the building (fiche 2010) when it beams it down.
        const cost = s.def.kind === 'unit' && (DEFS[o.type] as BuildingDef).faction === 'isdaris' ? w.beaconCost(DEFS[o.type] as BuildingDef) : (DEFS[o.type] as BuildingDef).cost;
        minerals -= cost.minerals;
        promisedEnergy += cost.energy;
      }
    }
    const supply = w.supply(this.player);
    // Armed flyers only: one unarmed scout seen once (an Isdaris Espion, a Corbeau, a Z Espion) turned the AI to
    // anti-air units and weapons for the rest of the game.
    const flyersSeen = [...w.entities.values()].filter((e) => w.hostile(e.owner, this.player) && flies(e) && !!w.weapon(e) && w.sees(this.player, e)).length;
    // Forgotten after three minutes without one (a Chimère seen once at minute 6 kept the Humans to anti-air units and
    // no Phalangiste nor Légionnaire for the rest of the game).
    if (flyersSeen) this.airSeen = w.tick;
    else if (w.tick - this.airSeen > ticks(180)) this.enemyAir = 0;
    this.enemyAir = Math.max(this.enemyAir, flyersSeen);
    const antiAir = Math.min(BALANCE.ai.antiAir.max, Math.ceil(this.enemyAir / BALANCE.ai.antiAir.per));
    const minute = w.tick / ticks(60);
    const enemyCloaks = w.players.some((o) => w.hostile(o.id, this.player) && FACTIONS[o.faction].army.some(([t]) => (DEFS[t] as UnitDef).cloaked));
    const free = supply.max - supply.used;
    const rally = this.rallyPoint(home);
    const out: Command[] = [];
    return { w, f, p, mine, home, serfs, builders, gods, raiders, army, buildings, count, supply, minute, antiAir, enemyCloaks, free, rally, out, minerals, energy: p.energy - promisedEnergy };
  }

  /** Idle workers, abandoned construction sites, Z repairs. */
  private tend(ctx: Survey & { low: number }): void {
    const { f, serfs, buildings } = ctx;
    // Idle serfs go mining.
    // Not to a field under an enemy's armed building: the fields near home mined out, each idle worker in turn walked
    // to the minerals under the enemy's towers and died.
    const w0 = this.world;
    // The field, or halfway from home to it (a field past a ramp a Fortin holds).
    // (the base nearest the field, where its minerals go).
    const bases = buildings.filter((b) => this.isBase(b) && b.buildLeft === 0);
    const dropAt = (e: Entity) => bases.reduce((a, b) => (dist(b.x, b.y, e.x, e.y) < dist(a.x, a.y, e.x, e.y) ? b : a), bases[0] ?? ctx.home);
    // The road the workers really take, not a straight line (a Fortin over the only ramp, off the line's middle).
    // From the worker too, when far from that base (sent from the main across a pass to the expansion's fields).
    const guarded = (e: Entity, from?: Entity) => this.underFire(e) || this.exposedRoad(dropAt(e), e) || (!!from && dist(from.x, from.y, e.x, e.y) > 12 * FP && this.exposedRoad(from, e));
    for (const s of serfs) {
      // One mining a field under fire (the simulation moved it on to the next field when its own ran out) goes to a
      // safe one, if any.
      const target = s.order?.kind === 'gather' ? w0.entities.get(s.order.target) : undefined;
      if (target && guarded(target, s) && s.carry === 0) {
        const safe = this.nearest(s, (e) => e.type === 'minerai' && !this.failed.get(s.id)?.has(e.id) && !guarded(e, s));
        // None safe left: it stops rather than walk under the guns.
        ctx.out.push(safe ? { player: this.player, kind: 'smart', ids: [s.id], x: safe.x, y: safe.y, target: safe.id } : { player: this.player, kind: 'stop', ids: [s.id] });
        continue;
      }
      if (s.order) continue;
      const f = this.nearest(s, (e) => e.type === 'minerai' && !this.failed.get(s.id)?.has(e.id) && !guarded(e, s));
      if (f) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: f.x, y: f.y, target: f.id });
    }

    // A worker that has not moved for STUCK_SECONDS on its way to a field (it can stand on the field's corner, out of
    // reach of it, for good: twenty Dieux esprits on one field on L'Anneau mined nothing for 20 minutes) goes to another.
    const seen = new Set<number>();
    for (const s of serfs) {
      const o = s.order;
      if (o?.kind !== 'gather' || o.phase !== 'go' || s.carry > 0) continue;
      seen.add(s.id);
      const last = this.walking.get(s.id);
      if (!last || last.x !== s.x || last.y !== s.y) {
        this.walking.set(s.id, { x: s.x, y: s.y, since: this.world.tick });
        continue;
      }
      if (this.world.tick - last.since < ticks(STUCK_SECONDS)) continue;
      // Waiting by a field another worker mines is not being stuck.
      const field = this.world.entities.get(o.target);
      if (field && this.world.reachRect(s, field.tx, field.ty, 1)) continue;
      const failed = this.failed.get(s.id) ?? new Set<number>();
      this.failed.set(s.id, failed.add(o.target));
      // Only a field nearby (as the sim's own search, 12 tiles): never off to the other end of the map.
      // Not one under an enemy's guns either.
      const f = this.nearest(s, (e) => e.type === 'minerai' && !failed.has(e.id) && !e.miner && dist(e.x, e.y, s.x, s.y) < STUCK_REACH * FP && !guarded(e));
      if (f) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: f.x, y: f.y, target: f.id });
      this.walking.delete(s.id);
    }
    for (const id of this.walking.keys()) if (!seen.has(id)) this.walking.delete(id);
    // Back to work (mining, carrying), or dead: its failures are forgotten.
    for (const id of this.failed.keys()) {
      const s = this.world.entities.get(id);
      if (!s || s.carry > 0) this.failed.delete(id);
    }

    // No base left (a headquarters to raise again), or the mineral line down to two with no drone to be had (its price
    // or the supply for it short):
    // the drones in an Assimilateur come out.
    const workerCost = (DEFS[f.worker] as UnitDef).cost.minerals;
    const dry = serfs.filter((s) => s.order?.kind === 'gather').length < 3 && (ctx.p.minerals < workerCost || ctx.free <= 0);
    if (!this.settled(ctx.home) || dry) for (const b of buildings) if ((b.def as BuildingDef).energyRate && (b.def as BuildingDef).bunker && this.world.load(b) > 0) ctx.out.push({ player: this.player, kind: 'unload', ids: [b.id] });
    // Z: three drones work each Assimilateur (notice), taken from the mineral line, which keeps half the plan's drones
    // (raided down to three, all three went into it: no minerals came in again to replace them).
    let miners = serfs.filter((s) => s.order?.kind === 'gather').length;
    for (const b of buildings.filter((b) => b.buildLeft === 0 && (b.def as BuildingDef).energyRate && (b.def as BuildingDef).bunker && this.settled(ctx.home) && !dry)) {
      const coming = ctx.mine.filter((s) => s.order?.kind === 'enter' && s.order.target === b.id).length;
      for (let n = this.world.room(b) - this.world.load(b) - coming; n > 0 && miners > this.plan.serfs / 2; n--, miners--) {
        const s = this.builder(serfs.filter((s) => s.order?.kind === 'gather' && !ctx.out.some((c) => c.ids.includes(s.id))), [b.tx, b.ty], (b.def as BuildingDef).size);
        if (!s) break;
        ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: b.x, y: b.y, target: b.id });
      }
    }

    // Abandoned construction sites (builder killed) get a new serf. Warped buildings build themselves.
    for (const site of buildings.filter((b) => b.buildLeft > 0 && !(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs)) {
      if (serfs.some((s) => s.order?.kind === 'construct' && s.order.target === site.id)) continue;
      const s = this.builder(serfs, [site.tx, site.ty], (site.def as BuildingDef).size, !this.settled(ctx.home));
      if (s) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: site.x, y: site.y, target: site.id });
    }

    // A worker that can repair (drone, serf, esprit) repairs a building that has lost 40 % of its hit points, one each, with minerals to spare.
    // From the turn's budget (less what sites are promised and repairs under way will cost), above the worker's price
    // kept; what it will cost is taken from that budget at once.
    // Not with no base: the repair took the price of the headquarters to raise again.
    if (REPAIR[f.worker] && this.settled(ctx.home)) {
      for (const b of buildings.filter((b) => b.buildLeft === 0 && b.hp < (b.maxHp * 6) / 10)) {
        const part = (n: number) => Math.ceil((n * REPAIR[f.worker].percent * (b.maxHp - b.hp)) / (100 * b.maxHp));
        const cost = part((b.def as BuildingDef).cost.minerals);
        const energy = part((b.def as BuildingDef).cost.energy);
        // Its energy too, from what the sites are not promised.
        if (ctx.minerals - ctx.low - cost < 200 || ctx.energy < energy) continue;
        if (serfs.some((s) => s.order?.kind === 'repair' && s.order.target === b.id)) continue;
        const s = this.builder(serfs.filter((s) => s.order?.kind === 'gather'), [b.tx, b.ty], (b.def as BuildingDef).size);
        if (!s) continue;
        ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: b.x, y: b.y, target: b.id });
        ctx.minerals -= cost;
        ctx.energy -= energy;
      }
    }

    // Isdaris: a major building under fire (hit within the last 3 s, not after the fight), below a third of its hit points and shield, raises its Bouclier de plasma.
    for (const b of buildings.filter((b) => abilitiesOf(b.def as BuildingDef).includes('bouclierplasma') && b.buildLeft === 0 && b.plasmaCd === 0 && b.phased === 0 && 3 * (b.hp + b.shield) < b.maxHp + b.maxShield && this.world.tick - b.lastHit < ticks(3))) {
      ctx.out.push({ player: this.player, kind: 'ability', ids: [b.id], name: 'bouclierplasma' });
    }
  }

  /** The buildings wanted this turn, most urgent first, and the tech state they depend on. */
  private need(ctx: Survey) {
    const { w, f, p, mine, home, serfs, builders, gods, army, buildings, count, supply, minute, antiAir, enemyCloaks } = ctx;
    // Supply first, then production buildings, then the mine.
    const building = (type: string) => builders.some((s) => [s.order, ...s.next].some((o) => o?.kind === 'build' && o.type === type)) || builders.some((s) => s.order?.kind === 'build' && s.order.type === type) || buildings.some((b) => b.type === type && b.buildLeft > 0);
    const wants: string[] = [];
    // Its headquarters lost, another base standing: a headquarters first (the Dieux' Porte, which summons the gods),
    // its price saved from everything else (the gods spent the rest on troops), while minerals still come in: the bank
    // grew within the last minute. Otherwise (no field left, or an esprit stuck on its way back, its order still
    // « gather ») what is left is spent instead of saved for ever.
    const noHq = !kin(home, f.hq) && !building(f.hq);
    // No base at all and the headquarters out of reach, its outpost within it (Dieux: an Antre at 600 when the Porte's
    // 1200 are not there): the outpost first, to mine again.
    const cheaper = noHq && !this.settled(home) && !!f.outpost && p.minerals < (DEFS[f.hq] as BuildingDef).cost.minerals && p.minerals >= (DEFS[f.outpost] as BuildingDef).cost.minerals;
    if (noHq) wants.push(cheaper ? f.outpost! : f.hq);
    // Production: the casernes, or for the Dieux the Porte and its gods.
    const producers = f.gods ? 1 + gods.length : count(f.barracks);
    const supplyShort = supply.max < 200 && supply.max - supply.used <= 2 + producers * 2 && !building(f.supply);
    if (supplyShort) wants.push(f.supply);
    // Isdaris: an extra emitter whenever production grows, to widen the power field.
    if (f.pylon && count(f.pylon) < 1 + Math.floor(count(f.barracks) / 2) && !building(f.pylon)) wants.push(f.pylon);
    // One extractor per base: the main's well, then the expansion's (energy is the Isdaris bottleneck).
    const bases = buildings.filter((b) => this.isBase(b) && b.buildLeft === 0).length;
    const firstExtractor = count(f.extractor) === 0;
    if (producers >= this.plan.mineAfter && firstExtractor && !building(f.extractor)) wants.push(f.extractor);
    // The second one, later and only with a free well by a base: never ahead of supply or production, except for the
    // Isdaris, whose research and advanced units starve without it.
    const moreEnergy = !firstExtractor && count(f.extractor) < bases && !building(f.extractor) && !!this.spot(f.extractor, home);
    // Humans too: with one Mine, the Créaturium's units took every point of energy and no research came in 35 min.
    if (moreEnergy && (f === FACTIONS.isdaris || f.gods || f === FACTIONS.humains)) wants.push(f.extractor);
    let casernesWanted = this.plan.casernes.filter(([at]) => serfs.length >= at).reduce((m, [, n]) => Math.max(m, n), 0);
    // Z: a Plate-forme takes a Pod of its own (and the drone each building absorbs): two by plan, a third only with
    // minerals to spare (below), or the bank went into Pods instead of socles.
    if (f === FACTIONS.z) casernesWanted = Math.min(casernesWanted, 2);
    // No worker or no base left: one production building at least, to fight on (a lone Pod raised no Plate-forme).
    // Not while a headquarters rises again (its last drone in it, the next one's price is kept).
    if ((serfs.length === 0 || !this.settled(home)) && !f.gods && !building(f.hq)) casernesWanted = Math.max(casernesWanted, 1);
    // Floating minerals while every caserne is busy: add production.
    const casernes = buildings.filter((b) => b.type === f.barracks);
    if (ctx.minerals > 450 && casernes.length >= casernesWanted && casernes.every((c) => c.queue.length > 0) && !building(f.barracks)) casernesWanted = Math.min(8, casernes.length + 1);
    if (!f.gods && count(f.barracks) < casernesWanted) wants.push(f.barracks);
    // Mid-game: a Forge, detection against an enemy that has invisible units, a defence or two.
    if (f.forge && count(f.forge) === 0 && producers >= 2 && count(f.extractor) > 0 && !w.lacks(this.player, f.forge)) wants.push(f.forge);
    // One tower late anyway: level 3 upgrades need it.
    // Flying enemies: a few more of the defence that shoots them down (Tour alchimistique, Orbe plasma).
    const detectors = f.detector && f.detector !== f.defense ? Math.max((enemyCloaks && minute > 6 ? 1 : 0) + (minute > 11 ? 1 : 0), antiAir) : 0;
    // Dieux: their gods summon one unit at a time, minerals pile up: spare ones go into more Branches (turned into
    // Yggdrasill protecteurs) and into bases, sooner.
    const rich = !!f.gods && p.minerals > 800;
    const defenses = f.defense ? (minute > 6 ? 1 : 0) + (minute > 11 ? 1 : 0) + antiAir + (rich ? Math.min(3, Math.floor(minute / 4) + Math.floor(p.minerals / 800)) : 0) : 0;
    if (f.detector && count(f.detector) < detectors && !building(f.detector)) wants.push(f.detector);
    // The second production building, for heavier units, only with resources to spare: its units cost
    // more for their strength than the gateway's (an early one cost the Isdaris AI most of its games).
    // Humans: the Créaturium mid-game (energy is kept for it), its saurians outlasting the Isdaris infantry.
    // Isdaris: the Psycho-assembleur on a clock too: waiting for spare minerals and energy, it never came.
    const tech = (BALANCE.ai.tech as Record<string, { minute: number; barracks: number }>)[p.faction];
    const techTime = !!tech && minute >= tech.minute && count(f.barracks) >= tech.barracks;
    const techWanted = !!f.tech && count(f.tech) === 0 && techTime && !w.lacks(this.player, f.tech);
    if (techWanted) wants.push(f.tech!);
    // Energy kept back for the tech building, then for its units, so cheaper units do not eat it all.
    const techDef = f.tech ? (DEFS[f.tech] as BuildingDef) : undefined;
    const techUp = buildings.some((b) => b.type === f.tech && b.buildLeft === 0);
    // Isdaris units come with extensions researched on their building (notice): keep energy for the next one.
    const unlocked = techDef?.trains!.filter((t) => !w.lacks(this.player, t) && (DEFS[t] as UnitDef).attack) ?? [];
    this.fielded ||= !!techDef && mine.some((u) => techDef.trains!.includes(u.type));
    // Its first unit unlocked: the tech building trains it before researching anything else (the Balise held it a minute).
    const firstTech = f === FACTIONS.isdaris && unlocked.length > 0 && !this.fielded;
    const nextExtension = EXTENSIONS.find((x) => buildings.some((b) => (b.def as BuildingDef).researches?.includes(x) && b.buildLeft === 0 && w.researchable(this.player, x, b)) && !w.hasExt(this.player, x) && !buildings.some((b) => b.queue.includes(x)) && !(firstTech && techDef!.researches?.includes(x)));
    // Z: a Tourelle needs a Pod too, so only with minerals to spare.
    if (f.defense && count(f.defense) < defenses && !building(f.defense) && !(f === FACTIONS.z && ctx.minerals < 500)) wants.push(f.defense);
    // Late buildings (Marché, Alchimisterie, Orbe de commandement), one each, once their time has come.
    // One that needs the tech building waits for its first unit (the Orbe de commandement took all the energy of the first Discobole).
    for (const [type, from] of [...(EXTRA[p.faction] ?? []), ...(MORE_EXTRA[p.faction] ?? []), ...(this.strategy.extra ?? [])]) if (minute >= from && count(type) === 0 && !w.lacks(this.player, type) && !(f.tech && (DEFS[type] as BuildingDef).requires?.[f.tech] && !this.fielded)) wants.push(type);
    // Humans: a Fortin by the rally point, manned by four soldiers kept back from the waves.
    const bunker = f.buildable.find((t) => (DEFS[t] as BuildingDef).bunker && !(DEFS[t] as BuildingDef).dropoff && !(DEFS[t] as BuildingDef).energyRate);
    if (bunker && minute > 5 && count(bunker) === 0 && count(f.barracks) >= 2 && !building(bunker)) wants.push(bunker);
    // Expand to the natural once the main is running, then to the map's next free base every few minutes, or
    // sooner when the bases run dry (as many as the map offers, up to MAX_BASES).
    const outpost = f.outpost && !(rich && p.minerals > 1600) ? f.outpost : f.hq;
    // Every base, a headquarters turned into another included (the Z Intelligence suprême was not counted).
    const councils = buildings.filter((b) => this.isBase(b)).length + builders.filter((s) => s.order?.kind === 'build' && (s.order.type === f.hq || s.order.type === f.outpost)).length;
    const firstAt = this.hard ? LEVELS.hard.expandMinute : this.easy ? LEVELS.easy.expandMinute : f.gods && this.doctrine.dieuxExpand ? this.doctrine.dieuxExpand : 7;
    // Rich Dieux go for their natural early; the bases after it come at the usual pace (taking every free base as soon
    // as the bank passed 800 spread them thin: on Origine with a third base they lost 31 of 32 games to the Isdaris).
    // Dieux sitting on 1200 minerals take their natural at once: their energy, one Puits a base, held back their gods.
    const due = councils < 2 ? w.tick > ticks(firstAt * 60) || this.fieldsLeft(home) < 5 || (rich && p.minerals > 1200) : minute >= firstAt + EXPAND_EVERY * (councils - 1) || this.fieldsNear(buildings) < 6;
    // With fewer workers than planned too once the bases are mined out (raided, supply full: none could come, and
    // the last fields were at the expansion).
    const expand = councils < MAX_BASES && (serfs.length >= this.plan.serfs || rich || this.fieldsNear(buildings) < 3) && due && !!this.spot(outpost, home);
    if (expand) wants.push(outpost);
    // Save up for the expansion once the base is defended.
    // Only while minerals come in: with none, the units stayed home for an expansion it could never pay.
    // No base at all, a worker to raise it or a site rising by itself (a Conseil's site with its last serf killed never
    // rose, and the savings for it held every unit for good; a Z Intelligence absorbed its last drone and goes on), a
    // spot for it or its site begun (its last minerals, the next worker's price, went into research
    // while it rose): its price is kept from everything (spent while its builder came out of an Assimilateur, the
    // headquarters could not be paid any more).
    // Up to its price as its builder pays it (an Isdaris robot 1330, a third more: saving stopped at 1000, and the
    // bank never reached it).
    const outpostDef = DEFS[outpost] as BuildingDef;
    const outpostPrice = Math.max(1000, (outpostDef.faction === 'isdaris' ? w.beaconCost(outpostDef) : outpostDef.cost).minerals);
    const saving = (expand && army.filter((u) => !this.wave.has(u.id)).length >= 8 && ctx.minerals < outpostPrice && w.tick - this.lastIncome < ticks(60)) || (noHq && ctx.minerals < (DEFS[f.hq] as BuildingDef).cost.minerals && w.tick - this.lastIncome < ticks(60) && this.fieldsNear(buildings) > 0) || (!this.settled(home) && (this.raisers > 0 || buildings.some((b) => kin(b, f.hq) && b.buildLeft > 0 && ((b.def as BuildingDef).absorbs || (b.def as BuildingDef).warp))) && (building(f.hq) || (this.rebuildable && !!this.spot(f.hq, home))));
    if (moreEnergy && f !== FACTIONS.isdaris && ctx.minerals >= (DEFS[f.extractor] as BuildingDef).cost.minerals + 200) wants.push(f.extractor);
    return { wants, supplyShort, building, moreEnergy, techWanted, techDef, techUp, unlocked, firstTech, nextExtension, outpost, saving };
  }

  /** Energy (and minerals) kept back from cheaper spending for the tech, its units and the next research. */
  private budget(ctx: Survey & Need) {
    const { w, f, p, mine, serfs, builders, army, buildings, minute, moreEnergy, techWanted, techDef, techUp, unlocked, nextExtension } = ctx;
    const techMinute = (BALANCE.ai.tech as Record<string, { minute: number }>)[p.faction]?.minute ?? 0;
    // The tech building's next unit keeps its energy only while that building is idle: training, it needs none, and
    // the reserve held the Casernes' Phalangistes and Belluaires and every late research for good.
    // Humans only: the Isdaris Psycho-assembleur trains on without gaps from that reserve.
    const techBusy = f === FACTIONS.humains && buildings.some((b) => b.type === f.tech && b.buildLeft === 0 && b.queue.length > 0);
    // Isdaris: the next extension (the Laboratoire on a Portail) keeps its price from minute 6, before the Psycho-
    // assembleur too: Créatures and Archers spent every mineral and point of energy as they came, and the Laboratoire,
    // with the Druides and every Portail research behind it, came late or never.
    const extensionDue = !!nextExtension && minute >= 6 && !this.easy;
    // Z: once its prerequisites stand, the energy of the next step of its tech (Intelligence suprême, Centre
    // d'optimisation, Centre K) is kept from everything else.
    const zNext = f === FACTIONS.z ? (['supreme', 'optimisation', 'centrek'] as const).find((t, i) => minute > 6 + 4 * i && !mine.some((b) => b.type === t || b.queue.includes(t)) && !builders.some((d) => d.order?.kind === 'build' && d.order.type === t)) : undefined;
    // Not before its prerequisites stand: 400 energy kept for an Intelligence suprême that could not come yet held
    // back every socle from minute 6 (the Z army never grew past 5 to 8 units, its energy piled up unused).
    // Nor with its minerals short and none coming in: its energy, kept for good, held back the socles.
    // Nor with its energy short and none coming in (no Assimilateur standing).
    const zTech = zNext && !w.lacks(this.player, zNext) && (w.tick - this.lastIncome < ticks(60) || p.minerals >= (DEFS[zNext] as BuildingDef).cost.minerals) && (p.energy >= (DEFS[zNext] as BuildingDef).cost.energy || buildings.some((b) => (b.def as BuildingDef).energyRate && b.buildLeft === 0)) ? zNext : undefined;
    const wantSupreme = zTech === 'supreme' && !w.lacks(this.player, 'supreme');
    // The Intelligence is kept idle for its turn into the suprême (no drone, no Espion) only with its price there and a
    // drone left, or drones enough to mine it: raided down to a few, it waited for 300 minerals no drone was left to mine.
    const supreme = (DEFS.supreme as BuildingDef).cost;
    // And only with energy coming in (an Assimilateur standing): stuck at 350, it held the drones for good.
    const holdSupreme = wantSupreme && p.energy >= 300 && buildings.some((b) => (b.def as BuildingDef).energyRate && b.buildLeft === 0) && ((p.minerals >= supreme.minerals && p.energy >= supreme.energy && serfs.length > 0) || serfs.length >= this.plan.serfs / 2);
    const reserve = zTech ? (DEFS[zTech] as BuildingDef).cost.energy : !techDef ? 0 : techUp ? (unlocked.length && !techBusy ? Math.min(...unlocked.map((t) => (DEFS[t] as UnitDef).cost.energy)) : 0) + (nextExtension ? (DEFS[nextExtension] as UpgradeDef).cost.energy : 0) : techWanted ? techDef.cost.energy : extensionDue ? (DEFS[nextExtension!] as UpgradeDef).cost.energy : 0;
    // The next research in line keeps its energy from the cheaper units and morphs too (otherwise it never came),
    // once the army is a wave strong (soldiers first), and only for a building that does nothing but research:
    // research on a production building (Isdaris Portail) waits for spare resources instead.
    // Not for the easy AI, which researches nothing: the minerals kept for it held back its units for good.
    // Nor with no minerals coming in: its price, kept for good, held back the last units.
    const nextResearch = this.easy || army.length < this.plan.wave || w.tick - this.lastIncome >= ticks(60) ? undefined : this.researchList.find((t) => w.researchable(this.player, t) && !w.lacks(this.player, t) && buildings.some((b) => b.buildLeft === 0 && !(b.def as BuildingDef).trains?.length && (b.def as BuildingDef).researches?.includes(t)));
    // Research comes before the tech building it would otherwise wait for (Forge upgrades before the Créaturium).
    // Isdaris: the Psycho-assembleur comes first, its Portail upgrades only make the gateway army stronger.
    // Not once the tech building is three minutes late: the Forge's research took every point of energy as it came,
    // and the Créaturium (400) never stood, nor anything it unlocks.
    const researchReserve = techWanted && f !== FACTIONS.isdaris && minute < techMinute + 3 ? 0 : reserve;
    const unitReserve = reserve + (nextResearch ? (DEFS[nextResearch] as UpgradeDef).cost.energy : 0);
    // Isdaris: the gateways and the morphs keep the minerals of the advanced units whenever the Psycho-assembleur is
    // idle, and, once a wave is out, of the second Récepteur and of the Psycho-assembleur itself (the gateways' cheap
    // units otherwise spent every mineral: the advanced units never came and research starved of energy).
    // Also while it researches the extension that unlocks its first unit, so the unit starts the moment it can.
    const techIdle = techUp && (unlocked.length > 0 ? buildings.some((b) => b.type === f.tech && b.buildLeft === 0 && b.queue.length === 0) : !this.fielded);
    const techUnits = unlocked.length ? unlocked : techDef?.trains!.filter((t) => (DEFS[t] as UnitDef).attack) ?? [];
    const gatewaysKeep =
      // Humans: the Créaturium wanted keeps its minerals from the Casernes once three quarters of its energy is there,
      // while minerals come in (their infantry took every 100 as it came, and it never stood).
      f === FACTIONS.humains
        ? techWanted && p.energy >= (techDef!.cost.energy * 3) / 4 && w.tick - this.lastIncome < ticks(60) ? techDef!.cost.minerals : 0
        : // Not the easy AI: it researches no extension, the units it kept minerals for never came. Nor with no minerals
      // coming in: the Portails held them for units the Psycho-assembleur could not pay.
      f !== FACTIONS.isdaris || this.easy || w.tick - this.lastIncome >= ticks(60)
        ? 0
        : (techIdle ? Math.min(...techUnits.map((t) => (DEFS[t] as UnitDef).cost.minerals)) : 0) +
          (army.length < this.plan.wave ? 0 : moreEnergy ? (DEFS[f.extractor] as BuildingDef).cost.minerals : 0) +
          // The Psycho-assembleur's minerals also once it is three minutes late: under pressure, the army never stood a
          // wave strong at home, and it never came (Carrefour, 27 minutes).
          (techWanted && (army.length >= this.plan.wave || minute >= techMinute + 3) ? techDef!.cost.minerals : 0) +
          (extensionDue ? (DEFS[nextExtension!] as UpgradeDef).cost.minerals : 0);
    // Z: the minerals of that next step are kept from the socles once three quarters of its energy is there (the socles
    // ate them all: the Centre d'optimisation never came, and the 500 energy kept for it piled up past 600, unspent).
    // Only while minerals come in: with none, it held every socle for a building that could not come.
    const zKeep = zTech && p.energy >= ((DEFS[zTech] as BuildingDef).cost.energy * 3) / 4 && w.tick - this.lastIncome < ticks(60) ? (DEFS[zTech] as BuildingDef).cost.minerals : 0;
    return { reserve, researchReserve, unitReserve, wantSupreme, holdSupreme, gatewaysKeep, nextResearch, zKeep };
  }

  /** Wanted buildings: add-ons on their hosts, the rest by a builder, while the bank allows. */
  private place(ctx: Turn): void {
    const { w, f, home, builders, buildings, wants, building, outpost } = ctx;
    // A spot where one of our buildings stands was reached: it may be tried again once that building is gone.
    for (const b of buildings) this.tried.delete(spotKey(b.tx, b.ty, (b.def as BuildingDef).size));
    // Z: add-ons (Plate-forme, Tourelle) come out of a Pod with room for one (the emptiest first); without one, a Pod first.
    const hosts = buildings.filter((b) => (b.def as BuildingDef).addons && b.buildLeft === 0 && w.addonsOf(b) < BALANCE.rules.z.podAddons).sort((a, b) => w.addonsOf(a) - w.addonsOf(b) || a.id - b.id);
    // A lost headquarters' site, looked for once this turn.
    const hqSpot = !this.settled(home) && !building(f.hq) && this.rebuildable ? this.spot(f.hq, home) : null;
    // No add-on while a lost headquarters is to be raised again: they took the next drone's price kept with it.
    // Once its site stands (paid already), with drones to spare, they come again.
    // With no headquarters' price to keep (none can be raised, or no site for it, all under fire), a Pod raises a
    // Plate-forme to fight on.
    for (let i = 0; i < wants.length && (this.settled(home) || building(f.hq) || !this.rebuildable || !hqSpot); i++) {
      if (!(DEFS[wants[i]] as BuildingDef).addon) continue;
      const at = hosts.findIndex((b) => w.addonSpot(b, wants[i]));
      const host = at < 0 ? undefined : hosts.splice(at, 1)[0];
      const def = DEFS[wants[i]] as BuildingDef;
      // Not with the minerals of a more urgent building before it (paid first, the add-ons took the price of the Pod
      // that would free supply, or of the Intelligence to raise again).
      // Not a headquarters no worker can raise (no drone left: the Pod kept its 800 and raised nothing).
      // While a headquarters rises again with no drone to spare, the next drone's price too.
      // Not a building no worker of ours can raise (no drone left: the Pod's 300 held the Plate-forme).
      const ahead = wants.slice(0, i).reduce((n, t) => n + ((DEFS[t] as BuildingDef).addon || (t === f.hq && (!this.rebuildable || !hqSpot) && !this.settled(home)) || !builders.some((b) => raises(b.def as UnitDef, t)) ? 0 : (DEFS[t] as BuildingDef).cost.minerals), 0) + (!this.settled(home) && building(f.hq) && ctx.serfs.length < 2 ? (DEFS[f.worker] as UnitDef).cost.minerals : 0);
      if (host && ctx.minerals - ahead >= def.cost.minerals && ctx.energy >= def.cost.energy && !w.lacks(this.player, wants[i])) {
        ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: wants[i] });
        ctx.minerals -= def.cost.minerals;
        ctx.energy -= def.cost.energy;
      } else if (!host && !building(f.supply) && !wants.includes(f.supply)) wants.splice(i + 1, 0, f.supply);
    }
    const beamed = new Set<number>();
    for (const type of wants) {
      const def = DEFS[type] as BuildingDef;
      if (def.addon) continue;
      if (ctx.minerals < def.cost.minerals) {
        if (type === outpost) continue;
        // Supply short: its price is saved from the units and research too (the Z Plates-formes spent every mineral as
        // it came, and the next Pod, at 300, came four minutes late, supply full).
        // Only while minerals come in: with none left, what is in the bank goes into units that fit.
        // Not a Dieux Branche wanted as a defence only.
        if (type === f.supply && ctx.supplyShort && w.tick - this.lastIncome < ticks(60)) ctx.minerals = Math.min(ctx.minerals, 0);
        break; // save up for the most urgent one
      }
      if (ctx.energy < def.cost.energy) continue;
      const spot = this.spot(type, home, (DEFS[type] as BuildingDef).bunker ? this.rallyPoint(home) : undefined);
      // Isdaris (fiche 2010, mod): an Obélisque at rest materialises it, on a spot its side sees; the robots only beam
      // down Obélisques and Récepteurs, for a third more, where no Obélisque can.
      const obelisk = buildings.find((b) => raises(b.def as BuildingDef, type) && b.buildLeft === 0 && (b.spellCd.materialisation ?? 0) <= w.tick && !beamed.has(b.id));
      if (obelisk && spot && w.vision[this.player].visible(spot[0] + (def.size >> 1), spot[1] + (def.size >> 1))) {
        ctx.out.push({ player: this.player, kind: 'build', ids: [obelisk.id], type, tx: spot[0], ty: spot[1] });
        beamed.add(obelisk.id); // one per Obélisque and think
        ctx.minerals -= def.cost.minerals;
        ctx.energy -= def.cost.energy;
        continue;
      }
      const crew = builders.filter((b) => raises(b.def as UnitDef, type));
      // Not a worker given another building this turn: the second replaced the first (a drone sent to a Pod went to a
      // Centre de socles instead), a site tried for nothing.
      // A lost headquarters: only a worker whose road to the site is out of an enemy's reach.
      const safeRoad = (b: Entity) => !((type === outpost || (type === f.hq && !this.settled(home))) && spot && this.exposedRoad(b, { x: (spot[0] + def.size / 2) * FP, y: (spot[1] + def.size / 2) * FP }));
      const unordered = crew.filter((b) => !ctx.out.some((c) => c.kind === 'build' && c.ids.includes(b.id)) && safeRoad(b));
      // Gaïa, the Dieux's main builder, chains her buildings (a few at most) instead of placing one at a time.
      const chained = f.builder && !this.builder(unordered, spot, def.size, !this.settled(home)) ? crew.find((b) => b.next.length < 3) : undefined;
      const builder = this.builder(unordered, spot, def.size, !this.settled(home)) ?? chained;
      if (!spot || !builder) continue;
      // A lost headquarters: not where the builder's road passes under an enemy's guns (its last drone died on the ramp).
      // Its price stays kept for it (spot() looks for a site some raiser reaches safely).
      // An expansion so reached is skipped, the other buildings go on.
      const roadHit = (type === outpost || (type === f.hq && !this.settled(home))) && this.exposedRoad(builder, { x: (spot[0] + def.size / 2) * FP, y: (spot[1] + def.size / 2) * FP });
      if (roadHit && type === f.hq && !this.settled(home)) break;
      if (roadHit) continue;
      // Not where a chained building already goes.
      const taken = builders.some((b) => [b.order, ...b.next].some((o) => o?.kind === 'build' && Math.abs(o.tx - spot[0]) < def.size + 3 && Math.abs(o.ty - spot[1]) < def.size + 3));
      // Nor where a building ordered this turn goes (two 3×3 centres got the same spot; the second was lost on arrival).
      // Footprints compared by their middles (the same both ways round, whatever their sizes).
      const near = (c: { tx: number; ty: number; type: string }) => {
        const s2 = (DEFS[c.type] as BuildingDef).size;
        return Math.abs(2 * c.tx + s2 - 2 * spot[0] - def.size) < s2 + def.size + 6 && Math.abs(2 * c.ty + s2 - 2 * spot[1] - def.size) < s2 + def.size + 6;
      };
      if (taken || ctx.out.some((c) => c.kind === 'build' && near(c))) continue;
      // An Isdaris robot pays a third more than the building (fiche 2010).
      const cost = builder.def.kind === 'unit' && def.faction === 'isdaris' ? w.beaconCost(def) : def.cost;
      // The last Z drone, absorbed into what it builds, leaves the price of the next one (a Pod took the last 300).
      // Drones already given a building (this turn or before) are spoken for.
      const spare = ctx.serfs.filter((s) => s.order?.kind !== 'build' && !ctx.out.some((c) => c.kind === 'build' && c.ids.includes(s.id))).length;
      if (def.absorbs && spare <= 1 && ctx.minerals < cost.minerals + (DEFS[f.worker] as UnitDef).cost.minerals) continue;
      if (ctx.energy < cost.energy) continue;
      if (ctx.minerals < cost.minerals) {
        if (type === outpost) continue;
        break; // save up for it, as for the building's own price
      }
      ctx.out.push({ player: this.player, kind: 'build', ids: [builder.id], type, tx: spot[0], ty: spot[1], queue: !!chained });
      // A god out with the wave leaves it to build (Frigg's Artefacterie): kept in it, it was sent back to the front.
      this.wave.delete(builder.id);
      const k = spotKey(spot[0], spot[1], def.size);
      this.tried.set(k, (this.tried.get(k) ?? 0) + 1);
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
    }
  }

  /** Workers, research and Isdaris extensions. */
  private research(ctx: Turn): void {
    const { w, f, p, mine, serfs, buildings, minute, wants, techUp, unlocked, nextExtension, saving, reserve, researchReserve } = ctx;
    // Serfs, then soldiers.
    const serfTarget = this.serfTarget(ctx);
    const workerHome = this.workerHome(ctx);
    // At its own price (a Dieux esprit costs 75: with 85 minerals left and no esprit, they never made one again).
    const workerCost = (DEFS[f.worker] as UnitDef).cost.minerals;
    // Low on workers, one comes even while supply is wanted (it costs one).
    if (workerHome && serfs.length + ctx.queued < serfTarget && ctx.minerals + ctx.low >= workerCost && (ctx.urgent || !wants.includes(f.supply))) {
      ctx.out.push({ player: this.player, kind: 'train', ids: [workerHome.id], type: f.worker });
      ctx.minerals += ctx.low - workerCost;
      ctx.low = 0;
    } else if (f === FACTIONS.z && minute > 8 && workerHome && ctx.minerals >= 150 && ctx.energy >= 75 + reserve && !mine.some((u) => u.type === 'zespion') && !w.lacks(this.player, 'zespion') && !ctx.holdSupreme) {
      // One Espion (Z.doc): it detects, and goes along with the waves.
      ctx.out.push({ player: this.player, kind: 'train', ids: [workerHome.id], type: 'zespion' });
      ctx.minerals -= 150;
      ctx.energy -= 75;
    }
    // Research in priority order on idle buildings; production buildings only with minerals to spare.
    const researching = new Set<number>();
    const listed = this.researchList;
    for (const t of this.easy ? [] : [...listed, ...(minute >= 10 ? LATE[p.faction] : [])]) {
      // An extension goes through its own step below (the Totem, in both, was paid for twice in the turn's budget).
      if (saving || !w.researchable(this.player, t) || EXTENSIONS.includes(t)) continue;
      // Z: Attaque de proximité only serves the flame thrower; the socles' tiers wait for the first weapon.
      if (t.startsWith('zproxi') && !w.level(this.player, 'lanceflammes')) continue;
      if ((DEFS[t] as UpgradeDef).level > 1 && /^r(quadripode|hexapode|coleoptere)$/.test((DEFS[t] as UpgradeDef).line) && !w.level(this.player, 'lanceroquettes')) continue;
      // The building itself must allow it: an extension it lacks, the extension a research needs there (Laboratoire, Totem…).
      // A production building researches when idle, with minerals to spare. With three of them or more, one takes the
      // listed research behind the unit it trains, at its price: the Isdaris Portails, never idle nor 300 ahead, did no
      // research in 35 minutes.
      const hosts = buildings.filter((b) => !researching.has(b.id) && b.buildLeft === 0 && (b.def as BuildingDef).researches?.includes(t) && w.researchable(this.player, t, b) && !w.lacks(this.player, t, undefined, b));
      // Three of its kind (the one with the Laboratoire for its research): that one takes it behind its units.
      const many = listed.includes(t) && hosts.length > 0 && buildings.filter((b) => b.type === hosts[0].type && b.buildLeft === 0).length >= 3 && !!(hosts[0].def as BuildingDef).trains?.length;
      const host = hosts.find((b) => b.queue.length === 0) ?? (many ? hosts.slice().sort((a, b) => a.queue.length - b.queue.length || a.id - b.id)[0] : undefined);
      const cost = (DEFS[t] as UpgradeDef).cost;
      // The researches off the list only with resources to spare, after the units' energy.
      const spare = listed.includes(t) ? 0 : 200;
      if (!host || ctx.minerals < cost.minerals + spare + ((host.def as BuildingDef).trains?.length && !many ? 300 : 0) || ctx.energy - (spare ? ctx.unitReserve + 100 : researchReserve) < cost.energy) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: t });
      researching.add(host.id);
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
    }
    // Isdaris extensions (notice), in order, on the building that hosts each.
    // The extension that unlocks the first tech unit does not wait for the expansion's savings (they held it three minutes).
    if (nextExtension && (!saving || (techUp && !unlocked.length)) && !this.easy) {
      // As for research: with three hosts or more, the least busy one takes it behind its units (the Laboratoire waited
      // for an idle Portail that never came, and every Portail research with it).
      const hosts = buildings.filter((b) => (b.def as BuildingDef).researches?.includes(nextExtension) && b.buildLeft === 0 && w.researchable(this.player, nextExtension, b));
      const host = hosts.find((b) => b.queue.length === 0) ?? (hosts.length >= 3 ? hosts.slice().sort((a, b) => a.queue.length - b.queue.length || a.id - b.id)[0] : undefined);
      const cost = (DEFS[nextExtension] as UpgradeDef).cost;
      if (host && ctx.minerals >= cost.minerals && ctx.energy >= cost.energy) {
        ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: nextExtension });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
      }
    }
    // An extension is its building's own (notice): once the first stands, another building of its type gets one too,
    // so it trains those units as well; only with resources well to spare, one a turn, never on a busy building.
    if (!nextExtension && !saving && !this.easy) {
      for (const x of EXTENSIONS) {
        const cost = (DEFS[x] as UpgradeDef).cost;
        if (!w.hasExt(this.player, x) || buildings.some((b) => b.queue.includes(x)) || ctx.minerals < cost.minerals + SPARE_EXTENSION || ctx.energy < cost.energy + SPARE_EXTENSION) continue;
        const host = buildings.find((b) => (b.def as BuildingDef).researches?.includes(x) && b.queue.length === 0 && w.researchable(this.player, x, b));
        if (!host) continue;
        ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: x });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
        break;
      }
    }
  }

  /** Buildings turned into others, the Marché, Fortin crews. */
  private morph(ctx: Turn): void {
    const { w, f, mine, army, buildings, minute, saving, unitReserve, gatewaysKeep } = ctx;
    // Isdaris turn buildings into defences: a Récepteur armé from mid-game, Pylônes sanglants when the tech allows.
    for (const b of buildings) {
      const into = (b.def as BuildingDef).morphs?.find((m) => {
        const d = DEFS[m] as BuildingDef;
        // The Caserne volante is a raiding tool the AI does not play: its casernes stay on the ground.
        // The Intelligence suprême comes before the energy kept for units: the Z tech waits on it.
        if (b.buildLeft > 0 || b.queue.length || w.lacks(this.player, m) || ctx.minerals - gatewaysKeep < d.cost.minerals || (d.cost.energy > 0 && ctx.energy - (m === 'supreme' ? 0 : unitReserve) < d.cost.energy)) return false;
        const have = buildings.filter((o) => o.type === m || o.queue.includes(m)).length;
        // Z: the Intelligence suprême and the Pods supérieurs are where its spare energy goes (Z.doc).
        if (m === 'supreme') return have === 0 && minute > 6;
        if (m === 'podsup') return minute > 8 && have < 3;
        // Humans: one Caserne volante late, the Grand Conseil and the Grande Alchimisterie (its Cuves) mid-game.
        if (m === 'casernevolante') return minute > 15 && have === 0;
        if (m === 'grandconseil' || m === 'grandealchimisterie') return minute > 12 && have === 0;
        return d.energyRate ? minute > 6 && have === 0 : f.gods ? minute > 6 && have < 4 : minute > 9 && have < 2;
      });
      if (!into || saving) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [b.id], type: into });
      ctx.minerals -= (DEFS[into] as BuildingDef).cost.minerals;
      ctx.energy -= (DEFS[into] as BuildingDef).cost.energy;
    }
    // A Marché evens out a lopsided bank: lots of one resource, almost none of the other.
    const market = buildings.find((b) => b.type === 'marche' && b.buildLeft === 0);
    // Minerals piling up while energy holds back the tech (the reserve and the next research): buy energy.
    // What is sold leaves this turn's budget at once (what comes back only arrives with the trade).
    // A lost headquarters to raise again, short of minerals, its site not begun: energy sold first, never minerals.
    const raising = !this.settled(ctx.home) && this.rebuildable && !buildings.some((b) => kin(b, f.hq) && b.buildLeft > 0);
    if (market && raising && ctx.p.minerals < (DEFS[f.hq] as BuildingDef).cost.minerals && ctx.energy >= BALANCE.rules.trade.give) {
      ctx.out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'energy' });
      ctx.energy -= BALANCE.rules.trade.give;
    // Not the minerals kept for an advanced building's unit (last turn's): sold as they came, the bank stayed at 500
    // and the Casernes stood idle under the keep.
    } else if (market && !raising && ctx.minerals > (this.advancedEnergyShort ? Math.max(500, this.advancedHeld + BALANCE.rules.trade.give) : 500 + this.advancedHeld) && ctx.energy < unitReserve + 100) {
      ctx.out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'minerals' });
      ctx.minerals -= BALANCE.rules.trade.give;
    } else if (market && ((ctx.energy > 250 && ctx.minerals < 150) || ((!this.settled(ctx.home) || ctx.serfs.length === 0) && this.shortOfMinerals(ctx)))) {
      // (with no base: for a unit short of minerals the sale can pay, as think counted it)
      ctx.out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'energy' });
      ctx.energy -= BALANCE.rules.trade.give;
    }
    // Man the Fortins with soldiers waiting at home (the Z Intelligence shelters drones only). With no income left
    // they come out and join the last waves: a crew sat in its Fortin to the time limit while one new soldier at a
    // time walked out to die.
    const bunkers = buildings.filter((o) => (o.def as BuildingDef).bunker && !(o.def as BuildingDef).dropoff && !(o.def as BuildingDef).energyRate && o.buildLeft === 0);
    if (bunkers.length && this.starved(buildings, ctx.p.minerals)) {
      const manned = bunkers.filter((b) => mine.some((u) => u.inside === b.id));
      if (manned.length) ctx.out.push({ player: this.player, kind: 'unload', ids: manned.map((b) => b.id) });
    } else for (const b of bunkers) {
      const room = (b.def as BuildingDef).bunker! - mine.filter((u) => u.inside === b.id || (u.order?.kind === 'enter' && u.order.target === b.id)).length;
      const crew = army.filter((u) => !this.wave.has(u.id) && (u.def as UnitDef).attack && (u.def as UnitDef).attack!.range > 1 && u.order?.kind !== 'enter').slice(0, Math.max(0, room));
      if (crew.length) ctx.out.push({ player: this.player, kind: 'smart', ids: crew.map((u) => u.id), x: b.x, y: b.y, target: b.id });
    }
  }

  /** Units from the production buildings. */
  private soldiers(ctx: Turn): void {
    const { w, f, mine, army, buildings, rally, firstTech, saving, reserve, researchReserve, unitReserve, zKeep, gatewaysKeep, nextResearch } = ctx;
    // Its energy at hand, the next research also keeps its minerals from the units.
    const researchCost = nextResearch && (DEFS[nextResearch] as UpgradeDef).cost;
    ctx.keep = researchCost && ctx.energy - researchReserve >= researchCost.energy ? researchCost.minerals : 0;
    let advancedKeep = 0;
    this.advancedEnergyShort = false;
    // Heavier units from the other production buildings, one at a time, when affordable; a few of each support kind.
    for (const t of buildings.filter((b) => !kin(b, f.barracks) && !kin(b, f.hq) && b.buildLeft === 0 && b.queue.length === 0 && (b.def as BuildingDef).trains?.length)) {
      // The kind it has fewest of that it can pay for (Discobole and Chimère take turns; an Ankylosaure it could not pay
      // held the Créaturium to one Plésiosaure); against flyers, only what can shoot them. One of each unarmed unit
      // (Scarabée, Isdaris Espion and Voyageur).
      const own = (u: string) => mine.filter((o) => o.type === u).length;
      const trains = ((t.def as BuildingDef).trains ?? []).filter((u) => !w.lacks(this.player, u, undefined, t) && ((DEFS[u] as UnitDef).attack || own(u) < (abilitiesOf(DEFS[u] as UnitDef).includes('couloir') && w.level(this.player, 'couloir') ? 2 : 1)) && (t.type === f.tech || own(u) < 3));
      const antiAirTrains = trains.filter((u) => (DEFS[u] as UnitDef).attack && reaches((DEFS[u] as UnitDef).attack!, true));
      const pays = (u: string) => ctx.minerals - ctx.keep >= (DEFS[u] as UnitDef).cost.minerals && ctx.energy >= (DEFS[u] as UnitDef).cost.energy && (DEFS[u] as UnitDef).supply <= this.room(ctx);
      // Against flyers, what shoots them if one can be paid, else what can (the last Créaturium waited for an
      // Ankylosaure it could not pay, its Plésiosaure left out).
      // (while minerals come in, it waits for the anti-air unit, as before).
      // Not for supply: minerals coming in free none.
      const order = (this.enemyAir && antiAirTrains.length && (antiAirTrains.some(pays) || (w.tick - this.lastIncome < ticks(60) && antiAirTrains.some((u) => (DEFS[u] as UnitDef).supply <= this.room(ctx)))) ? antiAirTrains : trains).slice().sort((a, b) => own(a) - own(b));
      // The tech building waits for the energy of a unit it has none of, its minerals there, rather than train another
      // of the cheaper ones (the Ankylosaure, 390, never came: a Plésiosaure, 225, left each time the energy got there).
      const first = order.find((u) => (DEFS[u] as UnitDef).attack);
      // (for its energy only: short of supply, another unit goes)
      if (f === FACTIONS.humains && t.type === f.tech && first && own(first) === 0 && ctx.energy < (DEFS[first] as UnitDef).cost.energy && (DEFS[first] as UnitDef).supply <= this.room(ctx) && ctx.minerals - ctx.keep >= (DEFS[first] as UnitDef).cost.minerals && order.some((u) => u !== first && own(u) > 0 && pays(u)) && buildings.some((b) => (b.def as BuildingDef).energyRate && b.buildLeft === 0)) continue;
      // Humans: a unit an advanced building has none of and cannot pay yet keeps its minerals from the Casernes while
      // minerals come in (the Casernes drained the bank each turn: no Scarabée at 500 nor Char Pégase at 650 came).
      if (f === FACTIONS.humains && first && own(first) === 0 && !pays(first) && w.tick - this.lastIncome < ticks(60) && !order.some((u) => own(u) === 0 && pays(u))) {
        advancedKeep = Math.max(advancedKeep, (DEFS[first] as UnitDef).cost.minerals);
        if (ctx.energy < (DEFS[first] as UnitDef).cost.energy) this.advancedEnergyShort = true;
        continue;
      }
      const type = order.find(pays);
      const def = type && (DEFS[type] as UnitDef);
      if (!def || (saving && !(firstTech && t.type === f.tech)) || this.room(ctx) < def.supply) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [t.id], type });
      ctx.minerals -= def.cost.minerals;
      ctx.energy -= def.cost.energy;
    }
    this.advancedHeld = advancedKeep;
    if (!advancedKeep) this.advancedEnergyShort = false;
    for (const c of buildings.filter((b) => !f.gods && kin(b, f.barracks) && b.buildLeft === 0)) {
      if (!c.rally) ctx.out.push({ player: this.player, kind: 'smart', ids: [c.id], x: rally.x, y: rally.y });
      if (saving || c.queue.length > (this.easy ? 0 : 1) || this.room(ctx) <= 0) continue;
      // The invisible raiders counted too (out of the army, their cap was never reached).
      const type = this.nextUnit(Math.max(0, ctx.energy - unitReserve), [...army, ...ctx.raiders], ctx.minerals - ctx.keep - gatewaysKeep - zKeep - advancedKeep, c, this.room(ctx), Math.max(0, ctx.energy - reserve));
      const def = DEFS[type] as UnitDef;
      // Z: the minerals of the next step of its tech are kept once its energy is there (zKeep); its energy, kept from
      // the energy-hungry socles only, never holds back one that costs none.
      // A unit costing no energy is never held back by the energy kept for the tech (it spends none of it: the Casernes
      // trained nothing from minute 8 to 11, energy under the Créaturium's 400).
      // A Phalangiste or Belluaire due for its share of the army: above the tech's reserve only, not the next
      // research's too (625 to 1075 energy were wanted, never there).
      const shared = SHARED.includes(type);
      if (ctx.minerals - ctx.keep - gatewaysKeep - zKeep - advancedKeep < def.cost.minerals || ctx.energy - (def.cost.energy ? (shared ? reserve : unitReserve) : 0) < def.cost.energy) {
        // No minerals coming in: waiting for it is for ever, the rotation moves on to what the bank can pay.
        if (w.tick - this.lastIncome >= ticks(60)) this.trained++;
        continue;
      }
      // Z: a socle waits until its weapon is affordable too, rather than leave with the machine gun.
      const accOrdered = ctx.out.some((o) => o.kind === 'train' && o.weapon === 'accumulateur');
      const weapon = this.weaponFor(def, ctx.energy - unitReserve, ctx.minerals - ctx.keep - gatewaysKeep - zKeep, accOrdered);
      const cost = withKit(def, weapon);
      // The weapon's price above the same reserves as the socle's. Waiting for it moves the rotation on: the same socle
      // and weapon came back every turn, and nothing else did.
      if (ctx.minerals - ctx.keep - gatewaysKeep - (weapon ? zKeep : 0) < cost.minerals || ctx.energy - (weapon && cost.energy ? unitReserve : 0) < cost.energy) {
        if (weapon) this.trained++;
        continue;
      }
      ctx.out.push({ player: this.player, kind: 'train', ids: [c.id], type, weapon });
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
      this.trained++;
    }
  }

  /** Z: socle evolutions, building weapons, Centre K kits and Canon IEM. */
  private machines(ctx: Turn): void {
    const { w, f, mine, army, buildings, minute, enemyCloaks, unitReserve } = ctx;
    // No base: what is left goes to the headquarters to raise again.
    if (!this.settled(ctx.home)) return;
    // Z: socles resting at home evolve into their next tier once it is researched (Z.doc), when affordable.
    for (const u of army) {
      const next = w.nextTier(u);
      if (!next || u.evolving || this.wave.has(u.id) || (u.order && u.order.kind !== 'move') || w.level(this.player, `r${u.type}`) <= u.tier) continue;
      if (ctx.minerals - ctx.keep < next.cost.minerals || ctx.energy - unitReserve < next.cost.energy) continue;
      ctx.out.push({ player: this.player, kind: 'evolve', ids: [u.id] });
      ctx.minerals -= next.cost.minerals;
      ctx.energy -= next.cost.energy;
    }

    // Z: Tourelles, then from 10 min Assimilateurs, get a weapon of their own (Laser, rockets against flyers).
    for (const b of buildings) {
      const allowed = (b.def as BuildingDef).weapons;
      if (!allowed || b.kit || b.buildLeft > 0 || (b.type === f.extractor && minute < 10)) continue;
      const k = (this.enemyAir ? ['roquettes', 'laser'] : ['laser', 'roquettes']).find((o) => allowed.includes(o) && !(WEAPONS[o].research && !w.level(this.player, WEAPONS[o].research!)));
      const cost = k && WEAPONS[k].cost;
      if (!cost || ctx.minerals - ctx.keep < cost.minerals + 100 || ctx.energy - unitReserve < cost.energy) continue;
      ctx.out.push({ player: this.player, kind: 'arm', ids: [b.id], weapon: k });
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
    }

    // Z Centre K: kits on socles of the army (Détection against invisible enemies, Auto-réparateur on evolved socles,
    // one Balise offensive), and the Canon IEM at the costliest enemy machine in sight.
    const centrek = buildings.find((b) => b.type === 'centrek' && b.buildLeft === 0);
    if (centrek) {
      const socles = army.filter((u) => (u.def as UnitDef).weaponLevel && u.hp > 0);
      const kit = (name: string, who: Entity | undefined) => {
        const ab = ABILITIES[name];
        if (!who || centrek.abilityCd || ctx.minerals - ctx.keep < (ab.minerals ?? 0) || ctx.energy - unitReserve < (ab.energy ?? 0)) return false;
        ctx.out.push({ player: this.player, kind: 'ability', ids: [centrek.id], name, x: who.x, y: who.y });
        ctx.minerals -= ab.minerals ?? 0;
        ctx.energy -= ab.energy ?? 0;
        return true;
      };
      const has = (bit: number) => mine.some((u) => u.support & bit);
      if (!(enemyCloaks && !has(KIT.detection) && kit('kitdetection', socles[0]))) {
        // Spare energy (nothing else takes it late on): Auto-réparateur on any socle, then Invisibilité.
        if (!kit('kitreparateur', socles.find((u) => (u.tier > 1 || ctx.energy > 600) && !(u.support & KIT.reparateur))) && ctx.energy > 600) kit('kitinvisibilite', socles.find((u) => !(u.support & KIT.invisibilite)));
      }
    }
  }

  /** Z: the Barge ferries a leaving wave. */
  private barge(ctx: Turn): void {
    const { w, mine, home, buildings, minute, rally } = ctx;
    // Z Barge: one, once researched, kept out of the waves; it ferries the ground units of a leaving wave that stand
    // by it, flies them to the target and lets them out 7 tiles short, then comes back.
    const barge = mine.find((u) => u.type === 'barge' && u.hp > 0);
    const deck = buildings.find((b) => (b.def as BuildingDef).trains?.includes('barge') && b.buildLeft === 0 && b.queue.length === 0);
    if (!barge && deck && minute > 14 && !ctx.saving && this.room(ctx) >= (DEFS.barge as UnitDef).supply && !w.lacks(this.player, 'barge') && !buildings.some((b) => b.queue.includes('barge')) && ctx.minerals - ctx.keep >= (DEFS.barge as UnitDef).cost.minerals + 100) {
      ctx.out.push({ player: this.player, kind: 'train', ids: [deck.id], type: 'barge' });
      ctx.minerals -= (DEFS.barge as UnitDef).cost.minerals;
    }
    if (barge) {
      this.wave.delete(barge.id);
      const aboard = mine.filter((u) => u.inside === barge.id);
      const goal = this.enemyTarget(home);
      if (aboard.length && goal) {
        // Once on its way, not sent again (each order started its path over).
        const going = barge.order?.kind === 'move' && dist(barge.order.x, barge.order.y, goal.x, goal.y) < FP;
        if (dist(barge.x, barge.y, goal.x, goal.y) > 7 * FP) {
          if (!going) ctx.out.push({ player: this.player, kind: 'move', ids: [barge.id], x: goal.x, y: goal.y });
        }
        else ctx.out.push({ player: this.player, kind: 'unload', ids: [barge.id] });
      } else if (dist(barge.x, barge.y, rally.x, rally.y) > 5 * FP) {
        // Unloaded, it turns back at once (its flight to the target went on after the unload).
        if (barge.order?.kind !== 'move' || dist(barge.order.x, barge.order.y, rally.x, rally.y) > 5 * FP) ctx.out.push({ player: this.player, kind: 'move', ids: [barge.id], x: rally.x, y: rally.y });
      } else if (goal) {
        let room = w.room(barge) - w.load(barge);
        const riders: number[] = [];
        for (const id of this.wave) {
          const u = w.entities.get(id);
          if (!u || u.inside || flies(u) || u.order?.kind === 'enter' || dist(u.x, u.y, barge.x, barge.y) > 6 * FP || (u.def as UnitDef).supply > room) continue;
          room -= (u.def as UnitDef).supply;
          riders.push(u.id);
        }
        if (riders.length) ctx.out.push({ player: this.player, kind: 'smart', ids: riders, x: barge.x, y: barge.y, target: barge.id });
      }
    }
  }

  /** Dieux: the god the Porte summons next, its time come (and none summoning). */
  private nextGod(ctx: Turn): string | undefined {
    const { w, f, mine, home, buildings, minute, saving } = ctx;
    if (!f.gods || saving || !kin(home, f.hq) || home.queue.length) return undefined;
    // The first one due that can come (one waiting on gods summoned after it in a strategy's order held every god behind it).
    const due = this.gods.filter(([g, from]) => minute >= from && !mine.some((e) => e.type === g) && !buildings.some((b) => b.queue.includes(g)));
    const next = this.doctrine === LEGACY ? due[0] : due.find(([g]) => !w.lacks(this.player, g));
    return next && !w.lacks(this.player, next[0]) ? next[0] : undefined;
  }

  /** Dieux: gods, their troops, levels and artefacts. */
  private summon(ctx: Turn): void {
    const { w, f, mine, home, gods, buildings, minute, saving, reserve, unitReserve } = ctx;
    // Dieux: the Porte summons the next god when its time has come; each god summons its troops, when affordable.
    if (f.gods && !saving) {
      const next = this.nextGod(ctx);
      const def = next && (DEFS[next] as UnitDef);
      ctx.energy += ctx.godEnergy;
      if (next && def) {
        if (ctx.minerals >= def.cost.minerals && ctx.energy >= def.cost.energy && this.room(ctx) >= def.supply) {
          ctx.out.push({ player: this.player, kind: 'train', ids: [home.id], type: next });
          ctx.minerals -= def.cost.minerals;
          ctx.energy -= def.cost.energy;
        }
        // Saving up for it, once the first god is out: its energy too, or the troops ate every point of it (Seth's
        // Sphinx took the Puits' whole output: Apollon, due at minute 5, never came, nor Odin, and with two gods
        // summoning one unit at a time 1000 to 5000 minerals lay unspent from minute 6 to 12).
        // Only for a god with room in supply, after what this turn already ordered: one that cannot come keeps nothing.
        else if (gods.length && this.room(ctx) >= def.supply) {
          // Doctrine: its minerals kept only once most of its energy is there; short of energy, the minerals held for it
          // starved the troops (Dieux at 500 to 900 minerals, their gods idle, waiting for Seth's 200 energy).
          if (this.doctrine === LEGACY || ctx.energy * 2 >= def.cost.energy) ctx.minerals -= def.cost.minerals;
          ctx.energy -= def.cost.energy;
        }
      }
      // The god's troop the army lacks most against its share (ai.army.dieux); a type without a share, never.
      const share = Object.fromEntries(this.armyList) as Record<string, number>;
      // A unit counted in the forms it turns into (an Élémentaire takes its fire form at once: never counted, Athéna
      // trained nothing else).
      const kinds = (t: string) => [t, ...(FORMS[t] ?? [])];
      const have = (t: string) => mine.filter((e) => kinds(t).includes(e.type)).length + gods.reduce((n, o) => n + o.queue.filter((q) => q === t).length, 0);
      const ratio = (g: Entity) => Math.min(...(g.def as UnitDef).trains!.filter((t) => !w.lacks(this.player, t) && share[t]).map((t) => have(t) / share[t]), Infinity);
      // Doctrine: the god whose troop the army lacks most is served first, and the others queue nothing more ahead
      // (Thor's Nains, first in line, took every mineral: Apollon's Minotaures and Athéna's Élémentaires never came).
      const order = this.doctrine === LEGACY ? gods : gods.slice().sort((a, b) => ratio(a) - ratio(b) || a.id - b.id);
      const most = order.length ? ratio(order[0]) : Infinity;
      for (const g of order) {
        // A god keeps `godQueue` summons ahead once minerals pile up (one ahead held the Dieux' bank at 2000 to 2600).
        if (g.queue.length > (this.easy ? 0 : ctx.minerals > 400 ? this.doctrine.godQueue : 1)) continue;
        if (this.doctrine !== LEGACY && g.queue.length > 0 && ratio(g) > most + 1) continue;
        const pays = (t: string) => {
          const d = DEFS[t] as UnitDef;
          // A troop that costs no energy is never held back by the energy kept (for the next god).
          return this.room(ctx) >= d.supply && ctx.minerals - ctx.keep >= d.cost.minerals && !(d.cost.energy > 0 && ctx.energy - unitReserve < d.cost.energy);
        };
        // The one the army lacks most that can be paid (the first one out of reach kept the god idle, minerals piling up).
        const type = (g.def as UnitDef).trains!.filter((t) => !w.lacks(this.player, t) && share[t]).sort((a, b) => have(a) / share[a] - have(b) / share[b] || a.localeCompare(b)).find(pays);
        const def = type && (DEFS[type] as UnitDef);
        if (!def) continue;
        ctx.out.push({ player: this.player, kind: 'train', ids: [g.id], type: type! });
        ctx.minerals -= def.cost.minerals;
        ctx.energy -= def.cost.energy;
        this.trained++;
      }
      // Minerals to spare (a margin kept for the troops), once every god is out: a god buys its next level behind
      // the summons it has queued (Thor, who always has two, never levelled otherwise).
      // Not Gaïa: her levels only speed up buildings, and measured, they ate the minerals the next gods were saved with.
      // Only once the first-rank gods are out; the minerals saved for the next god due are already set aside above.
      // (or from minute 12 anyway: short of energy, Apollon may never come).
      const allGods = this.gods.every(([t]) => (DEFS[t] as UnitDef).requiresAny || gods.some((e) => e.type === t)) || minute >= 12;
      // A level that costs no energy (Thor's) comes sooner, from minerals to spare: energy, not minerals, held the next
      // gods back, and Thor's levels were the one place 1000 to 5000 idle minerals could go.
      for (const g of gods.filter((e) => (e.def as UnitDef).levels && e.queue.length <= 2 && !e.queue.includes('niveau'))) {
        const lv = (g.def as UnitDef).levels!;
        const cost = g.lvl < lv.hp.length ? lv.cost[g.lvl - 1] : undefined;
        // Doctrine: a god's second level at once, without the margin: it summons twice as fast (base time over its
        // level), the one way the Dieux' production keeps up with their income.
        const second = this.doctrine !== LEGACY && g.lvl < this.doctrine.godLevel;
        if (!cost || !(allGods || cost.energy === 0 || second)) continue;
        if (ctx.minerals - ctx.keep - (second ? 0 : BALANCE.ai.godLevelMargin) < cost.minerals || (cost.energy > 0 && ctx.energy - reserve < cost.energy)) continue;
        ctx.out.push({ player: this.player, kind: 'train', ids: [g.id], type: 'niveau' });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
      }
      // With an Artefacterie and resources to spare: Force, Résistance, Force, Vitesse for each god in turn.
      // Given from the Artefacterie, one at a time (it rests between two).
      const arte = buildings.find((b) => b.type === 'artefacterie' && b.buildLeft === 0 && b.abilityCd === 0);
      const g = arte && gods.find((e) => this.world.artefacts(e) < BALANCE.rules.upgrades.artefacts.max);
      if (arte && g) {
        const t = ['artforce', 'artresistance', 'artforce', 'artvitesse'][this.world.artefacts(g)];
        const cost = (DEFS[t] as UpgradeDef).cost;
        if (ctx.minerals - ctx.keep - BALANCE.ai.godLevelMargin >= cost.minerals && ctx.energy - reserve >= cost.energy) {
          ctx.out.push({ player: this.player, kind: 'ability', ids: [arte.id], name: t, x: g.x, y: g.y });
          ctx.minerals -= cost.minerals;
          ctx.energy -= cost.energy;
        }
      }
    }
  }

  /** Defend the base, otherwise send a new wave. */
  private muster(ctx: Turn): void {
    const { w, home, serfs, gods, army, buildings, supply, minute, mine } = ctx;
    // Defend the base, otherwise attack in waves; reinforcements wait at the rally point.
    // Dead or being recalled (Rappel): out of the wave.
    for (const id of this.wave) if (!w.entities.get(id) || w.entities.get(id)!.held) this.wave.delete(id);
    // Dieux: a troop a god out with the wave summoned at the front joins the wave (alone, it had no orders).
    for (const g of gods) {
      if (!this.wave.has(g.id) || dist(g.x, g.y, home.x, home.y) < 20 * FP) continue;
      // Fighting already or not (it is given an attack of its own at once); within the easy AI's cap.
      // Not one falling back (withdraw's move): taken in again, it turned round to the fight it fled.
      for (const u of army) if (!this.wave.has(u.id) && u.order?.kind !== 'move' && dist(u.x, u.y, g.x, g.y) < 6 * FP && (!this.easy || this.wave.size < LEVELS.easy.maxWave)) this.wave.add(u.id);
    }
    // First-rank gods sent with a last wave come home once income is back (they summon).
    const out1 = gods.filter((g) => this.wave.has(g.id) && !(g.def as UnitDef).requiresAny);
    if (out1.length && !this.starved(buildings, ctx.p.minerals)) {
      const home1 = out1;
      for (const g of home1) this.wave.delete(g.id);
      if (home1.length) ctx.out.push({ player: this.player, kind: 'move', ids: home1.map((g) => g.id), x: ctx.rally.x, y: ctx.rally.y });
    }
    let atHome = army.filter((u) => !this.wave.has(u.id));
    // Our base first; else a teammate's base under attack, which the army at home goes to help.
    const allied = [...w.entities.values()].filter((b) => b.def.kind === 'building' && b.owner !== this.player && b.owner >= 0 && !w.hostile(b.owner, this.player));
    // Dieux: their esprits at work count as the base too (raids killed them by waves, up to 33 in a game, while the
    // army stayed out: the fields lie beyond the reach watched around the buildings).
    const guarded = this.faction.gods ? [...buildings, ...serfs.filter((s) => s.order?.kind === 'gather')] : buildings;
    const raid = this.threat(guarded) ?? (allied.length ? this.threat(allied) : undefined);
    // A raid of flyers none of the army can shoot holds no wave home (a flyer watching a Pod kept a full wave of
    // ground socles there).
    const threat = raid && raid.armed.length && raid.armed.every(flies) && !army.some((u) => w.weapon(u) && reaches(w.weapon(u)!, true)) ? undefined : raid;
    this.homeThreat = !!raid;
    this.danger = threat && army.filter((u) => !this.wave.has(u.id)).reduce((s, u) => s + u.hp + u.shield, 0) < threat.strength ? threat : undefined;
    // The Z's Intelligence only: the Humains' Conseil has a Refuge too (the balancer, 2026-11-22), left to the player for now.
    const shelters = buildings.filter((b) => b.buildLeft === 0 && (b.def as BuildingDef).dropoff && (b.def as BuildingDef).bunker && (b.def as BuildingDef).faction === 'z');
    // The danger gone, the sheltered drones come out (back to work as idle workers).
    // A raid of flyers the army cannot shoot still sends the drones near it into shelter, if its arms hit the ground (a
    // Drake over the mineral line, the drones left outside).
    if (!threat) for (const b of shelters) {
      // Only from one within its reach of it (plus a few tiles) or of a drone the Refuge would take in: one hovering off
      // kept them in for good, and one over the mineral line was let be.
      const take = (ABILITIES.refuge.radius ?? 8) * FP;
      const exposed = serfs.filter((d) => dist(d.x, d.y, b.x, b.y) <= take);
      const hide = !!raid && !this.easy && raid.armed.some((e) => {
        const a = w.weapon(e);
        if (!a || !reaches(a, false)) return false;
        const r = (a.range + 1) * FP;
        return this.toEdge(e, b) <= r + 2 * FP || exposed.some((d) => dist(d.x, d.y, e.x, e.y) <= r);
      });
      if (hide) ctx.out.push({ player: this.player, kind: 'ability', ids: [b.id], name: 'refuge' });
      else if (mine.some((u) => u.inside === b.id)) ctx.out.push({ player: this.player, kind: 'unload', ids: [b.id] });
    }
    if (threat) {
      const near = (u: Entity) => dist(u.x, u.y, threat.x, threat.y) < 12 * FP;
      // Outnumbered at home: the wave comes back, unless it is already fighting next to the threat.
      const strength = (us: Entity[]) => us.reduce((s, u) => s + u.hp + u.shield, 0);
      if (strength(atHome) < threat.strength && this.wave.size) {
        const back: number[] = [];
        for (const id of this.wave) {
          const u = w.entities.get(id)!;
          if (near(u)) continue;
          this.wave.delete(id);
          // A god (not in the army) is given no order with it: it went on alone to the enemy base and died.
          if (gods.includes(u)) back.push(id);
        }
        if (back.length) ctx.out.push({ player: this.player, kind: 'move', ids: back, x: ctx.rally.x, y: ctx.rally.y });
        atHome = army.filter((u) => !this.wave.has(u.id));
      }
      // Every defender not already fighting near the threat goes there.
      // Only those whose weapon reaches it (Légionnaires sent under a Drake they could not hit), when the raid is all
      // flyers: one flyer leading a raid on foot kept the infantry home.
      const airRaid = threat.armed.length > 0 && threat.armed.every(flies);
      const ids = atHome
        .filter((u) => {
          if (airRaid && !(w.weapon(u) && reaches(w.weapon(u)!, true))) return false;
          const o = u.order;
          if (!o || o.kind === 'move') return true;
          if (o.kind !== 'attack' && o.kind !== 'attackMove') return false;
          // Already heading there, or fighting there: leave it be (a new order would reset its fight).
          const target = w.entities.get(o.target);
          if (target) return !near(target);
          return o.kind === 'attackMove' && dist(o.x, o.y, threat.x, threat.y) > 12 * FP;
        })
        .map((u) => u.id);
      // Doctrine: too few and too weak against the raid, the defenders gather at the rally point (by the base's
      // defences) instead of running at it one by one as they come out.
      const weak = this.doctrine !== LEGACY && atHome.length < this.doctrine.regroup && strength(atHome) * this.doctrine.retreat < threat.strength;
      if (ids.length && !weak) ctx.out.push({ player: this.player, kind: 'attack', ids, x: threat.x, y: threat.y });
      // Doctrine: the gods at home fight a raid on the base too (left out of the army, Thor stood by while the first
      // wave killed the Nains one by one); not one badly hurt, nor one already fighting.
      if (this.doctrine.godsDefend) {
        const godIds = gods.filter((g) => !this.wave.has(g.id) && g.hp * 2 > g.maxHp && dist(g.x, g.y, threat.x, threat.y) < 25 * FP && g.order?.kind !== 'attack' && g.order?.kind !== 'attackMove').map((g) => g.id);
        if (godIds.length) ctx.out.push({ player: this.player, kind: 'attack', ids: godIds, x: threat.x, y: threat.y });
      }
      // No soldiers to speak of against a small raid: the workers next to it fight.
      // Not against flyers their arms cannot reach (drones gathered under a Drake's blasts).
      // Only with workers and defenders together as strong as the raid: three drones sent at four heavy units died.
      let fought = false;
      if (threat.strength > 1 && strength(atHome) < threat.strength / 2 && threat.count <= 4 && !airRaid) {
        const pulled = serfs.filter((s) => near(s) && s.order?.kind !== 'build' && s.order?.kind !== 'construct' && s.order?.kind !== 'attack' && !ctx.out.some((c) => c.kind === 'build' && c.ids.includes(s.id)));
        // Weighed by hit points times damage per second against the other side's classes, not hit points alone (four
        // drones sent at a lone Phalangiste, 30 to machines from 6 tiles, against their 3 to it at contact).
        const power = (us: Entity[], them: Entity[]) => this.power(us.map((u) => [u.hp + u.shield, this.dpsVs(u, them)]));
        const ours = [...pulled, ...atHome];
        // Workers strike the raiders on foot only, and at one of them (sent at a Plésiosaure, they gathered under it).
        const onFoot = threat.armed.filter((e) => !flies(e));
        const workerPower = this.power(pulled.map((u) => [u.hp + u.shield, this.dpsVs(u, onFoot)])) + power(atHome, threat.armed);
        fought = pulled.length > 0 && onFoot.length > 0 && workerPower >= power(threat.armed, ours);
        if (fought) ctx.out.push({ player: this.player, kind: 'smart', ids: pulled.map((s) => s.id), x: onFoot[0].x, y: onFoot[0].y, target: onFoot[0].id });
      }
      // Z Refuge: against more than the drones could hold off, they shelter in the Intelligence near the threat (a
      // small raid they are too weak to fight too). Otherwise (one elsewhere) they come out and go back to work.
      // Never against raiders that cannot hit the ground: shelter helps nothing there (a Pégase in the air kept the
      // drones inside).
      const danger = !this.easy && strength(atHome) < threat.strength / 2 && (threat.count > 4 || (!fought && threat.strength > 1)) && threat.armed.some((e) => !!w.weapon(e) && reaches(w.weapon(e)!, false));
      for (const b of shelters) {
        if (danger && near(b)) ctx.out.push({ player: this.player, kind: 'ability', ids: [b.id], name: 'refuge' });
        else if (mine.some((u) => u.inside === b.id)) ctx.out.push({ player: this.player, kind: 'unload', ids: [b.id] });
      }
    } else if (((!this.easy || minute >= LEVELS.easy.attackMinute) && (atHome.length >= Math.min(this.easy ? LEVELS.easy.maxWave : MAX_WAVE, this.plan.wave + this.waves * this.plan.waveGrowth) || (atHome.length >= 6 && supply.used >= 190) || ((atHome.length > 0 || gods.length > 0) && this.starved(buildings, ctx.p.minerals) && (gods.length > 0 || atHome.length * 2 >= this.plan.wave || !this.affordable(ctx))) || (minute >= 10 && (atHome.length >= this.plan.wave || this.waves > 0) && this.dominates(atHome)))) && this.sends(atHome, ctx)) {
      // No income left: half a wave at least goes, or the last units it can pay for (one at a time, each new Créature
      // joined a wave of three dying under a manned Fortin, for twenty minutes, to a draw).
      // Reinforcements for a wave already out join it: the shared road's middle is for a new wave only (set again for
      // one soldier joining, it turned the front back to it).
      const fresh = this.wave.size === 0;
      const before = this.wave.size;
      // Easy: never more than its wave cap out at once, gods included, those already out counted, the rest stays home.
      const cap = this.easy ? LEVELS.easy.maxWave : Infinity;
      // Not the Barge, which ferries the waves on its own (barge).
      // With the Couloir temporel, one Espion stays home as its gate (cast).
      const corridor = w.level(this.player, 'couloir') > 0 && army.filter((u) => abilitiesOf(u.def as UnitDef).includes('couloir')).length >= 2;
      let gateKept = corridor && army.some((u) => abilitiesOf(u.def as UnitDef).includes('couloir') && !atHome.includes(u) && !this.wave.has(u.id));
      for (const u of atHome) {
        if (corridor && !gateKept && abilitiesOf(u.def as UnitDef).includes('couloir')) {
          gateKept = true;
          continue;
        }
        if (this.wave.size < cap && u.type !== 'barge') this.wave.add(u.id);
      }
      // Dieux: the gods of the second and third ranks go with it (their auras, heals and spells are for the front);
      // the first rank stays home and summons.
      // Once no income is left, every god goes: nothing is left to summon with, and gods alone never made a wave.
      const dry = this.starved(buildings, ctx.p.minerals);
      for (const g of gods) if ((dry || (this.doctrine.godsWave && (g.def as UnitDef).requiresAny && g.hp * 2 > g.maxHp)) && (this.wave.has(g.id) || this.wave.size < cap)) this.wave.add(g.id);
      // Nobody left (the easy cap full): no wave.
      if (this.wave.size > before) {
        // A wave, not a reinforcement: the next wave's size grows with each wave sent (a soldier joining the one out, as
        // after f8c4786, took the next threshold from 12 to 18).
        if (fresh || atHome.length >= this.plan.wave) this.waves++;
        if (fresh) this.via = this.sharedRoad(home);
      }
    }
  }

  /**
   * Doctrine, for the soldiers at home ready to go: no wave before the strategy's minute, a new wave only when its
   * power is `engage` times the enemy army known, reinforcements for a wave out only `regroup` at a time. Not when
   * nothing more will come (no income, nothing to pay, supply full): then whatever is left goes.
   */
  private sends(atHome: Entity[], ctx: Turn): boolean {
    const d = this.doctrine;
    if (d === LEGACY || this.easy) return true;
    const last = ctx.supply.used >= 190 || (this.starved(ctx.buildings, ctx.p.minerals) && !this.affordable(ctx));
    if (last || ctx.minute >= 25) return true;
    if (this.wave.size > 0) return atHome.length >= d.regroup;
    if (ctx.minute < (this.strategy.attackMinute ?? 0)) return false;
    const known = this.power([...this.foes.values()]);
    const armed = atHome.filter((u) => !!this.world.weapon(u));
    return known === 0 || this.power(armed.map((u) => [u.hp + u.shield, this.dps(u)])) >= d.engage * known;
  }

  /**
   * Doctrine: a god near armed enemies with too little of our army round it (`escort` of their power) gets the
   * soldiers at home not far off sent to it; badly hurt, it falls back to the rally point, out of the wave. Pulling
   * every god back cost the Dieux their best fighters (tournament of 23/11: 5 wins in 24 against 12 without).
   */
  private guard(ctx: Turn): void {
    const d = this.doctrine;
    if (d === LEGACY || this.easy || !d.escort) return;
    const { w, gods, army, rally } = ctx;
    const foes = this.visibleFoes();
    const back: number[] = [];
    const sent = new Set<number>();
    for (const g of gods) {
      if (dist(g.x, g.y, rally.x, rally.y) < 10 * FP) continue;
      const near = foes.filter((e) => dist(e.x, e.y, g.x, g.y) < 10 * FP);
      if (!near.length) continue;
      const escort = army.filter((u) => !!w.weapon(u) && dist(u.x, u.y, g.x, g.y) < 8 * FP);
      const ours = this.power(escort.map((u) => [u.hp + u.shield, this.dps(u)]));
      const theirs = this.power(near.map((e) => [e.hp + e.shield, this.dps(e)]));
      if (ours >= d.escort * theirs) continue;
      if (g.hp * 2 < g.maxHp) {
        if (g.order?.kind === 'move' && dist(g.order.x, g.order.y, rally.x, rally.y) < 2 * FP) continue;
        this.wave.delete(g.id);
        back.push(g.id);
        continue;
      }
      const help = army.filter((u) => !sent.has(u.id) && !this.wave.has(u.id) && !!w.weapon(u) && dist(u.x, u.y, g.x, g.y) < 25 * FP && dist(u.x, u.y, g.x, g.y) >= 8 * FP && u.order?.kind !== 'attack');
      for (const u of help) sent.add(u.id);
      if (help.length) ctx.out.push({ player: this.player, kind: 'attack', ids: help.map((u) => u.id), x: g.x, y: g.y });
    }
    if (back.length) ctx.out.push({ player: this.player, kind: 'move', ids: back, x: rally.x, y: rally.y });
  }

  /** Abilities: the simple ones, tactics, Observation céleste, Rappel. */
  private cast(ctx: Turn): void {
    const { w, p, mine, home, gods, army, buildings } = ctx;
    // Abilities: stimulant and charge when engaging, Peau de roc while healing in a fight.
    const casters = army.filter((u) => {
      const ab = (u.def as UnitDef).ability;
      if (!ab || !w.ready(u, ab) || !SIMPLE.includes(ab)) return false;
      const d = this.engaged(u);
      return d !== undefined && (ab === 'stimulant' ? u.hp > 50 : d > 2 * FP);
    });
    if (casters.length && !this.easy) ctx.out.push({ player: this.player, kind: 'ability', ids: casters.map((u) => u.id) });
    // Peau de roc (aimed at a unit since the balancer, 2026-11-22): on the one the Soigneur heals in a fight, else itself.
    if (!this.easy) {
      for (const u of army) {
        if ((u.def as UnitDef).ability !== 'peauderoc' || !w.ready(u, 'peauderoc')) continue;
        const healed = u.order?.kind === 'heal' ? w.entities.get(u.order.target) : undefined;
        const t = healed && healed.skin === 0 ? healed : this.engaged(u) !== undefined && u.skin === 0 ? u : undefined;
        if (t) ctx.out.push({ player: this.player, kind: 'ability', ids: [u.id], name: 'peauderoc', x: t.x, y: t.y });
      }
    }
    // Dieux: an Élémentaire comes « faible et chétive » (notice): it takes its fire form at once (it hits flyers too).
    const weak = army.filter((u) => u.type === 'elembase' && w.ready(u, 'formefeu'));
    if (weak.length) ctx.out.push({ player: this.player, kind: 'ability', ids: weak.map((u) => u.id), name: 'formefeu' });
    // Gaïa too, when she is not building: her arrow.
    const gaia = this.faction.builder ? ctx.builders.filter((b) => b.type === this.faction.builder && b.order?.kind !== 'build' && b.order?.kind !== 'construct') : [];
    // Passengers of a Fortin or a Scarabée use their powers from inside too (notice).
    const aboard = mine.filter((e) => e.inside && e.def.kind === 'unit' && w.abilitiesFor(e).length && (w.entities.get(e.inside)?.def.kind === 'building' || w.entities.get(e.inside)?.type === 'scarabee'));
    // The invisible raiders too (an Assassin's Choc mental was never cast).
    if (!this.easy) ctx.out.push(...this.tactics([...army, ...gods, ...gaia, ...aboard, ...ctx.raiders]));
    // Isdaris Couloir temporel: one Espion stays at the rally point, the other goes with the wave; the reinforcements
    // gathered round the first go through to the second (it was never cast: one Espion only, no rule for it).
    const spies = army.filter((u) => abilitiesOf(u.def as UnitDef).includes('couloir'));
    if (spies.length >= 2 && !this.easy && w.level(this.player, 'couloir')) {
      const gate = spies.find((u) => !this.wave.has(u.id));
      // With the wave's armed front still round it (left alone when the wave fell back, it drew packets to their death).
      const far = spies.find((u) => this.wave.has(u.id) && dist(u.x, u.y, home.x, home.y) > 25 * FP && army.filter((o) => this.wave.has(o.id) && !!w.weapon(o) && dist(o.x, o.y, u.x, u.y) < 10 * FP).length >= 3);
      if (gate && dist(gate.x, gate.y, ctx.rally.x, ctx.rally.y) > 3 * FP && gate.order?.kind !== 'move') ctx.out.push({ player: this.player, kind: 'move', ids: [gate.id], x: ctx.rally.x, y: ctx.rally.y });
      const r = (ABILITIES.couloir.radius ?? 3) * FP;
      // Those round it, waiting or setting off with a new wave (muster has just sent them).
      const waiting = gate ? army.filter((u) => u !== gate && !flies(u) && dist(u.x, u.y, gate.x, gate.y) <= r) : [];
      // Never while the base is under attack: it sent the defenders holding a raid off to the front. Nor with a worker
      // within reach: the corridor takes every unit of ours on the ground round it, robots first.
      const robots = gate ? ctx.serfs.some((u) => dist(u.x, u.y, gate.x, gate.y) <= r) : true;
      if (gate && far && waiting.length >= 4 && w.ready(gate, 'couloir') && !this.homeThreat && !robots) {
        ctx.out.push({ player: this.player, kind: 'ability', ids: [gate.id], name: 'couloir' });
        // Those sent through join the wave (outside it, they had no orders at the front): those that fit, in the
        // order the simulation takes them (ABILITIES.couloir.max of supply).
        let room = ABILITIES.couloir.max ?? 8;
        for (const u of waiting) {
          const sup = (u.def as UnitDef).supply;
          if (sup > room) continue;
          room -= sup;
          this.wave.add(u.id);
        }
      }
    }
    // Dieux: two Élémentaires waiting at home fuse into a Golem, late on; apart, one walks to the other.
    const elems = army.filter((u) => abilitiesOf(u.def as UnitDef).includes('fusion') && !this.wave.has(u.id) && !u.order && u.abilityCd === 0);
    if (ctx.minute >= 15 && elems.length >= 2 && !this.easy) {
      const [a, b] = elems;
      if (dist(a.x, a.y, b.x, b.y) <= (ABILITIES.fusion.radius! + 1) * FP) ctx.out.push({ player: this.player, kind: 'ability', ids: [a.id], name: 'fusion' });
      else ctx.out.push({ player: this.player, kind: 'move', ids: [a.id], x: b.x, y: b.y });
    }
    // Each power's own building (the first one with any power was an Orbe plasma once the Obélisque was rebuilt: no
    // Rappel again).
    const holder = (name: string) => buildings.find((b) => (b.def as BuildingDef).ability === name && b.buildLeft === 0 && b.abilityCd === 0);
    let caster = holder('observation');
    if (caster && w.level(this.player, 'observation') && p.energy >= ABILITIES.observation.energy!) {
      // Observation céleste only where an undetected invisible unit just hit us from close by, not on far shooters.
      const ambushed = mine.find((u) => {
        const a = w.entities.get(u.lastAttacker);
        return (
          w.tick - u.lastHit < ticks(1) &&
          !!a &&
          (a.def as UnitDef).cloaked &&
          !w.sees(this.player, a) &&
          dist(a.x, a.y, u.x, u.y) < 3 * FP &&
          !w.scans.some((s) => s.owner === this.player && dist(s.x, s.y, u.x, u.y) < 5 * FP)
        );
      });
      if (ambushed) ctx.out.push({ player: this.player, kind: 'ability', ids: [caster.id], x: ambushed.x, y: ambushed.y });
    }
    caster = holder('rappel');
    if (caster && p.energy >= ABILITIES.rappel.energy!) {
      // Rappel a wave that is losing its fight far from home.
      const losing = this.losing([...this.wave].map((id) => w.entities.get(id)!), home);
      if (losing) {
        ctx.out.push({ player: this.player, kind: 'ability', ids: [caster.id], x: losing.x, y: losing.y });
        for (const id of this.wave) if (dist(w.entities.get(id)!.x, w.entities.get(id)!.y, losing.x, losing.y) <= RAPPEL.radius * FP) this.wave.delete(id);
      }
    }
    ctx.out.push(...this.altar(ctx));
    // Scouts light up the wave's target: the Z Espion's Balise once close to it, Athéna's Chouette from afar.
    const goal = this.wave.size ? this.enemyTarget(home) : undefined;
    for (const [type, name] of [['zespion', 'balisez'], ['athena', 'chouette']]) {
      const u = goal && [...army, ...gods].find((e) => e.type === type && w.ready(e, name) && dist(e.x, e.y, goal.x, goal.y) <= ((ABILITIES[name].range ?? 0) + 4) * FP);
      if (u && goal) ctx.out.push({ player: this.player, kind: 'ability', ids: [u.id], name, x: goal.x, y: goal.y });
    }
  }

  /**
   * Isdaris: the Orbe de commandement's Observatoire over the wave's target; the Trône's canon orbital on an enemy
   * crowd an Espion of ours watches, its Porte de déphasage on a group losing far from home (then the group home), its
   * Mur d'énergie across a raid our army at home cannot hold.
   */
  private altar(ctx: Turn): Command[] {
    const { w, p, home, buildings, army } = ctx;
    const out: Command[] = [];
    const ready = (b: Entity | undefined, name: string) => !!b && b.buildLeft === 0 && b.abilityCd === 0 && !w.needs(this.player, ABILITIES[name].research, b) && p.energy >= (ABILITIES[name].energy ?? 0);
    const use = (b: Entity, name: string, at: { x: number; y: number }) => out.push({ player: this.player, kind: 'ability', ids: [b.id], name, x: at.x, y: at.y });
    const orbe = buildings.find((b) => b.type === 'orbecommandement' && b.exts.includes('observatoire')) ?? buildings.find((b) => b.type === 'orbecommandement');
    const target = this.wave.size ? this.enemyTarget(home) : undefined;
    if (orbe && target && ready(orbe, 'observatoire')) use(orbe, 'observatoire', target);
    const trone = buildings.find((b) => b.type === 'trone');
    if (!trone) return out;
    // The second step of the Porte: the group still phased goes home.
    if (w.phaseGroups.some((g) => g.owner === this.player) && w.hasExt(this.player, 'porte', trone)) use(trone, 'transfertgroupe', home);
    if (ready(trone, 'canonorbital')) {
      const foes = [...w.entities.values()].filter((e) => e.def.kind === 'unit' && e.hp > 0 && w.hostile(e.owner, this.player) && w.sees(this.player, e));
      const spies = army.filter((u) => u.type === 'espion');
      const r = (ABILITIES.canonorbital.radius ?? 2) * FP;
      const best = foes
        .filter((e) => spies.some((s) => dist(s.x, s.y, e.x, e.y) <= (s.def as UnitDef).sight * FP))
        .map((e) => [e, foes.filter((o) => dist(o.x, o.y, e.x, e.y) <= r).length] as const)
        .sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
      if (best && best[1] >= 4) return use(trone, 'canonorbital', best[0]), out;
    }
    const losing = this.losing([...this.wave].map((id) => w.entities.get(id)!), home);
    if (losing && ready(trone, 'portedephasage')) return use(trone, 'portedephasage', losing), out;
    if (this.danger && ready(trone, 'murenergie')) use(trone, 'murenergie', this.danger);
    return out;
  }

  /** Hurt gods and outmatched groups fall back; raids and focus fire. */
  private withdraw(ctx: Turn): void {
    const { w, gods, raiders, buildings, rally } = ctx;
    // A god badly hurt leaves the wave for home: losing it costs its levels and its troops.
    const hurtGods = gods.filter((g) => this.wave.has(g.id) && g.hp * 10 < g.maxHp * 4);
    if (hurtGods.length) {
      hurtGods.forEach((g) => this.wave.delete(g.id));
      // Hadès goes home under ground.
      const deep = hurtGods.filter((g) => abilitiesOf(g.def as UnitDef).includes('voyage') && this.world.ready(g, 'voyage'));
      for (const g of deep) ctx.out.push({ player: this.player, kind: 'ability', ids: [g.id], name: 'voyage', x: rally.x, y: rally.y });
      const walk = hurtGods.filter((g) => !deep.includes(g));
      if (walk.length) ctx.out.push({ player: this.player, kind: 'move', ids: walk.map((g) => g.id), x: rally.x, y: rally.y });
    }
    // A wave group that would be massacred falls back to the rally point, to join the next, bigger wave.
    const fleeing = this.easy ? [] : this.outmatched([...this.wave].map((id) => w.entities.get(id)!));
    if (fleeing.length) {
      fleeing.forEach((u) => this.wave.delete(u.id));
      const refuge = this.haven(buildings, rally) ?? rally;
      ctx.out.push({ player: this.player, kind: 'smart', ids: fleeing.map((u) => u.id), x: refuge.x, y: refuge.y });
    }

    if (!this.easy) ctx.out.push(...this.raid(raiders));
    if (this.hard) ctx.out.push(...this.focus([...this.wave].map((id) => w.entities.get(id)!)));
  }

  /** The wave moves: kiting, supports behind the front, by the shared road, on to the target. */
  private advance(ctx: Turn): void {
    const { w, home } = ctx;
    const target = this.enemyTarget(home);
    const waveUnits = [...this.wave].map((id) => w.entities.get(id)!);
    // Ranged units kite: a melee enemy at their throat while their weapon reloads, they step back.
    const kiters = new Set<number>();
    for (const u of waveUnits) {
      const a = w.weapon(u);
      if (this.easy || !a || a.range < 5 || u.cooldown < ticks(a.cooldown) / 3) continue;
      const biter = this.nearest(u, (e) => w.hostile(e.owner, this.player) && e.def.kind === 'unit' && !!(e.def as UnitDef).attack && (e.def as UnitDef).attack!.range < 1 && !(e.def as UnitDef).worker && w.sees(this.player, e));
      if (!biter || dist(biter.x, biter.y, u.x, u.y) > 2 * FP) continue;
      const d = dist(biter.x, biter.y, u.x, u.y) || 1;
      ctx.out.push({ player: this.player, kind: 'move', ids: [u.id], x: u.x + Math.trunc(((u.x - biter.x) * 2 * FP) / d), y: u.y + Math.trunc(((u.y - biter.y) * 2 * FP) / d) });
      kiters.add(u.id);
    }
    // Supports (healers, casters, fragile artillery) keep a few tiles behind the front instead of leading the charge.
    const support = (u: Entity) => !!(u.def as UnitDef).heal || ['druide', 'alchimiste', 'cuve', 'isis'].includes(u.type);
    const front = waveUnits.filter((u) => !support(u));
    if (target && front.length) {
      const cx = front.reduce((s, u) => s + u.x, 0) / front.length;
      const cy = front.reduce((s, u) => s + u.y, 0) / front.length;
      const d = dist(cx, cy, target.x, target.y) || 1;
      // Rounded toward the map's middle (trunc of a float mean rounded each corner's point another way).
      const [hx, hy] = [(w.map.width * FP) / 2, (w.map.height * FP) / 2];
      const back = { x: Math.trunc(cx - ((target.x - cx) * 3 * FP) / d - hx) + hx, y: Math.trunc(cy - ((target.y - cy) * 3 * FP) / d - hy) + hy };
      const leading = waveUnits.filter((u) => support(u) && !kiters.has(u.id) && u.order?.kind !== 'heal' && dist(u.x, u.y, target.x, target.y) < d - 1.5 * FP);
      if (leading.length) ctx.out.push({ player: this.player, kind: 'attack', ids: leading.map((u) => u.id), x: back.x, y: back.y });
      for (const u of leading) kiters.add(u.id);
    }
    // The shared road's middle first, until the front gets there (or it is out of reach).
    if (this.via && (!front.length || w.tick > this.via.until)) this.via = null;
    if (this.via && front.length) {
      const cx = front.reduce((s, u) => s + u.x, 0) / front.length;
      const cy = front.reduce((s, u) => s + u.y, 0) / front.length;
      if (dist(cx, cy, this.via.x, this.via.y) < VIA_REACHED) this.via = null;
    }
    const goal = this.via ?? target;
    // Also those still walking to an old target's spot, which may never be reached (below a cliff): the target moved on.
    const stale = (u: Entity) => !!goal && u.order?.kind === 'attackMove' && !u.order.target && dist(u.order.x, u.order.y, goal.x, goal.y) > 10 * FP;
    const waiting = waveUnits.filter((u) => !kiters.has(u.id) && !!w.weapon(u) && (!u.order || u.order.kind === 'move' || stale(u)));
    if (goal && target && waiting.length) ctx.out.push({ player: this.player, kind: 'attack', ids: waiting.map((u) => u.id), x: goal.x, y: goal.y });
    // Unarmed members (the Z Espion, socles with the Réparateur or the Accumulateur) are left home by an attack order
    // (the simulation gives it to armed units only): they follow the armed front, its Balise and kits with it.
    const armed = front.filter((u) => !!w.weapon(u));
    if (armed.length) {
      const [hx, hy] = [(w.map.width * FP) / 2, (w.map.height * FP) / 2];
      const cx = Math.trunc(armed.reduce((s, u) => s + u.x, 0) / armed.length - hx) + hx;
      const cy = Math.trunc(armed.reduce((s, u) => s + u.y, 0) / armed.length - hy) + hy;
      const lagging = waveUnits.filter((u) => !w.weapon(u) && !kiters.has(u.id) && (!u.order || (u.order.kind === 'move' && dist(u.order.x, u.order.y, cx, cy) > 3 * FP)) && dist(u.x, u.y, cx, cy) > 4 * FP);
      if (lagging.length) ctx.out.push({ player: this.player, kind: 'move', ids: lagging.map((u) => u.id), x: cx, y: cy });
    }
  }


  /**
   * Centre of a group of our wave, far from home, whose hp and shields are less than a third of those of the
   * visible enemy soldiers around it.
   */
  private losing(wave: Entity[], home: Entity): Entity | undefined {
    const w = this.world;
    for (const u of wave) {
      if (dist(u.x, u.y, home.x, home.y) < 25 * FP) continue;
      const ours = wave.filter((o) => dist(o.x, o.y, u.x, u.y) <= RAPPEL.radius * FP);
      if (ours.length < 3) continue;
      let foes = 0;
      for (const e of w.entities.values()) {
        const d = e.def as UnitDef;
        if (this.world.hostile(e.owner, this.player) && e.def.kind === 'unit' && d.attack && !d.worker && dist(e.x, e.y, u.x, u.y) < 10 * FP && w.sees(this.player, e)) foes += e.hp + e.shield;
      }
      if (3 * ours.reduce((s, o) => s + o.hp + o.shield, 0) < foes) return u;
    }
    return undefined;
  }

  /**
   * Wave units in a fight they cannot win: around each one, our soldiers against the visible enemy soldiers and
   * defences, each side weighed by hp and shields times damage per second (a group's strength grows with both).
   */
  /** Armed enemy units, seen or not. */
  private enemySoldiers(): Entity[] {
    return [...this.world.entities.values()].filter((e) => this.world.hostile(e.owner, this.player) && e.def.kind === 'unit' && (e.def as UnitDef).attack && !(e.def as UnitDef).worker);
  }

  private visibleFoes(): Entity[] {
    const w = this.world;
    return [...w.entities.values()].filter((e) => {
      // The weapon it fights with (an armed Z Assimilateur has none in its definition), a manned Fortin's crew too.
      const a = w.weapon(e) || (e.def.kind === 'building' && this.crew(e).length > 0);
      return w.hostile(e.owner, this.player) && a && !(e.def as UnitDef).worker && (e.def.kind === 'unit' || e.buildLeft === 0) && w.sees(this.player, e);
    });
  }

  /** Damage per second of the weapon it fights with (a Z socle with the Réparateur or the Accumulateur: none). */
  /** Damage per second against a group, by each one's class (fiches 2010), on average. */
  private dpsVs(e: Entity, them: Entity[]): number {
    const a = this.world.weapon(e);
    if (!a || !them.length) return a ? a.damage / a.cooldown : 0;
    let sum = 0;
    for (const t of them) sum += a.vs ? a.vs[CLASSES.indexOf((t.def as UnitDef | BuildingDef).cls ?? 'BL')] ?? a.damage : a.damage;
    return sum / them.length / a.cooldown;
  }

  /** `air` true: against flyers only; false: against ground units only (an anti-air weapon counts for nothing). */
  private dps(e: Entity, air?: boolean): number {
    const a = this.world.weapon(e);
    let d = a && (air === undefined || reaches(a, air)) ? a.damage / a.cooldown : 0;
    // A Fortin fights with its crew.
    if (e.def.kind === 'building') for (const u of this.crew(e)) d += this.dps(u, air);
    return d;
  }

  /** A group's fighting power: its hp and shields times its damage per second. */
  private power(group: [number, number][]): number {
    let hp = 0;
    let dps = 0;
    for (const [h, d] of group) [hp, dps] = [hp + h, dps + d];
    return hp * dps;
  }

  /**
   * The army at home is three times as strong as every enemy fighter and armed building we have seen (as last seen):
   * it goes, however few. The wave size only grows, and a side that could not reach it (soldiers in a Fortin, workers
   * counted in its supply) sat at home over the enemy's last buildings until the time limit.
   */
  private dominates(atHome: Entity[]): boolean {
    const seen = this.visibleFoes();
    for (const e of seen) this.foes.set(e.id, [e.hp + e.shield, this.dps(e)]);
    // Gone, or seen with nothing to fight with any more (a Fortin its crew left).
    for (const id of this.foes.keys()) {
      const e = this.world.entities.get(id);
      if (!e || (this.world.sees(this.player, e) && !seen.includes(e))) this.foes.delete(id);
    }
    const known = this.power([...this.foes.values()]);
    // No enemy fighter or armed building left that we know of, after a wave: whatever is armed at home goes and
    // razes what stands (a side down to its last buildings sat there to the time limit, the winner's few soldiers
    // waiting at home for a full wave).
    // Like the wave's targets, which are every enemy building, seen or not, the enemy's soldiers are then counted
    // whether seen or not: an army out of sight never sets it off.
    // Not one at a time, though: with no wave out to join, half a wave at least (a tower never seen killed lone soldiers).
    // Fewer than a wave against enemies we know of: never.
    const armed = atHome.filter((u) => !!this.world.weapon(u));
    const ours = this.power(armed.map((u) => [u.hp + u.shield, this.dps(u)]));
    if (known === 0) return this.waves > 0 && (this.wave.size > 0 || armed.length * 2 >= this.plan.wave) && ours > 0 && ours >= 3 * this.power(this.enemySoldiers().map((e) => [e.hp + e.shield, this.dps(e)]));
    return atHome.length >= this.plan.wave && ours >= 3 * known;
  }

  private outmatched(wave: Entity[]): Entity[] {
    const foes = this.visibleFoes();
    // Each side by what reaches the other: flyers, ground units, or both (undefined).
    const side = (group: Entity[]) => (group.length && group.every(flies) ? true : group.every((u) => !flies(u)) ? false : undefined);
    const power = (group: Entity[], air?: boolean) => this.power(group.map((e) => [e.hp + e.shield, this.dps(e, air)]));
    const out = new Set<Entity>();
    for (const u of wave) {
      if (out.has(u)) continue;
      const near = foes.filter((e) => dist(e.x, e.y, u.x, u.y) < 9 * FP);
      if (!near.length) continue;
      const ours = wave.filter((o) => !!this.world.weapon(o) && dist(o.x, o.y, u.x, u.y) < 7 * FP);
      // Isdaris fall back sooner: their shields recharge out of combat, so a group pulled out early comes back whole.
      // Flyers only: the enemy's power that reaches them (a Fortin of Phalangistes cannot).
      // And ours by what reaches the flyers when the enemies there all fly (flame throwers under Drakes stayed on).
      // (a ground wave fell back before one Coléoptère whose Déchiqueteur hits flyers only).
      if (power(ours, side(near)) * this.doctrine.retreat < power(near, side(ours))) ours.forEach((o) => out.add(o));
    }
    return [...out];
  }

  /**
   * Raiders go after the enemy worker closest to them, which leads them to the mineral line; a raider already
   * on a worker keeps at it. With no worker known, they wait at home.
   */
  private raid(raiders: Entity[]): Command[] {
    const w = this.world;
    const out: Command[] = [];
    for (const r of raiders) {
      const o = r.order;
      const current = o && (o.kind === 'attack' || o.kind === 'attackMove') ? w.entities.get(o.target) : undefined;
      if (current && (current.def as UnitDef).worker && current.hp > 0) continue;
      // Workers are where the enemy headquarters are: the AI knows the start spots, like a player who scouted.
      const prey = this.nearest(r, (e) => this.world.hostile(e.owner, this.player) && !!(e.def as UnitDef).worker && e.hp > 0);
      if (prey) out.push({ player: this.player, kind: 'attack', ids: [r.id], x: prey.x, y: prey.y, target: prey.id });
    }
    return out;
  }

  /**
   * Combat abilities, one per unit and think: blasts on enemy crowds, bolts and stuns on the toughest or the
   * casters, heals and shields on hurt allies, self abilities when hurt or surrounded.
   */
  private tactics(army: Entity[]): Command[] {
    const w = this.world;
    // No early way out without enemy soldiers in sight: the Cuve's acid and the Gel go for buildings.
    const foes = [...w.entities.values()].filter((e) => e.def.kind === 'unit' && e.hp > 0 && !e.inside && w.hostile(e.owner, this.player) && w.sees(this.player, e));
    const out: Command[] = [];
    const around = (group: Entity[], x: number, y: number, r: number) => group.filter((e) => dist(e.x, e.y, x, y) <= r);
    const at = (u: Entity, name: string, t: Entity): Command => ({ player: this.player, kind: 'ability', ids: [u.id], name, x: t.x, y: t.y });
    const self = (u: Entity, name: string): Command => ({ player: this.player, kind: 'ability', ids: [u.id], name });
    for (const u of army) {
      if (u.abilityCd > 0 || u.held) continue;
      const near = around(foes, u.x, u.y, 9 * FP);
      // The Cuve's acid and the Accumulateur's Gel are for buildings, enemy soldiers around or not.
      if (!near.length && !w.abilitiesFor(u).some((n) => n === 'acidedissolvant' || n === 'gel')) continue;
      // One cooldown for all of a unit's powers: the Accumulateur's rarer ones first, or the Vacarme, ready on any
      // crowd, took every turn and the Cône and the Gravité never came.
      for (const name of w.abilitiesFor(u).slice().sort((a, b) => Number(FIRST.includes(b)) - Number(FIRST.includes(a)) || FIRST.indexOf(a) - FIRST.indexOf(b))) {
        const ab = spell(name, u.lvl);
        if (SIMPLE.includes(name) || (ab.research && !w.level(this.player, ab.research)) || !w.ready(u, name)) continue;
        // A caster keeps the mana of its way out (Hadès' Voyage, 40): spent on the Rayon de la mort, he could not flee.
        // Not where both never fit (Hadès at level 1 holds 150, the Rayon costs 140).
        const flight = w.abilitiesFor(u).find((n) => ESCAPE.includes(n) && n !== name);
        const keep = flight ? (spell(flight, u.lvl).mana ?? 0) : 0;
        if (keep && ab.mana && ab.mana + keep <= (w.manaOf(u)?.[0] ?? 0) && u.mana - toFp(ab.mana) < toFp(keep)) continue;
        // A caster in a shelter cannot walk up: exactly the reach the command allows (the shelter's edge), no tile more,
        // or the order is refused and asked again every think.
        const shelter = u.inside ? w.entities.get(u.inside) : undefined;
        const reach = shelter ? toFp(ab.range ?? 0) + (shelter.def.kind === 'building' ? ((shelter.def as BuildingDef).size * FP) / 2 : shelter.radius) : ((ab.range ?? 0) + 1) * FP;
        const radius = (ab.radius ?? 0) * FP;
        const inReach = around(near, u.x, u.y, reach);
        const allies = around(army, u.x, u.y, reach);
        let cmd: Command | undefined;
        if (ab.ultimate) {
          // Ultimates, once charged: on the thickest enemy crowd in reach (the Tempête spares where our own stand).
          if (!w.ultimateReady(this.player, ab.ultimate)) continue;
          const pool = inReach.filter((f) => !flies(f) || name !== 'jormungand');
          const best = pool.map((f) => [f, around(pool, f.x, f.y, radius).length - (name === 'tempetezeus' ? 2 * around(army, f.x, f.y, radius).length : 0)] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
          if (best && best[1] >= (name === 'jormungand' ? 2 : 5)) cmd = at(u, name, best[0]);
        } else if (CROWD[name]) {
          // Silence only where enemy casters stand.
          const pool = name === 'silence' ? inReach.filter((f) => abilitiesOf(f.def as UnitDef).length) : inReach.filter((f) => !flies(f));
          // The Pluie de feu burns its own side too: not where as many of ours stand.
          const best = pool.map((f) => [f, around(pool, f.x, f.y, radius).length - (name === 'pluiedefeu' ? 2 * around(army, f.x, f.y, radius).length : 0)] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
          if (best && best[1] >= CROWD[name]) cmd = at(u, name, best[0]);
        } else if (name === 'jetdesable') {
          // The toughest enemy machine in reach.
          const pick = inReach.filter((f) => (f.def as UnitDef).mechanical && f.pace === 0).sort((a, b) => b.hp + b.shield - (a.hp + a.shield) || a.id - b.id)[0];
          if (pick) cmd = at(u, name, pick);
        } else if (name === 'formeair' || name === 'formefeu') {
          // Élémentaire: to air against flyers alone, back to fire once ground enemies come.
          const air = near.some((f) => flies(f));
          const ground = near.some((f) => !flies(f));
          if (name === 'formeair' ? air && !ground : ground && u.type === 'elemair') cmd = self(u, name);
        } else if (name === 'deflagration' || name === 'chocmental' || name === 'foudre') {
          // The toughest enemy in reach (for the stun, a caster first).
          const pick = inReach.filter((f) => !(f.def as UnitDef).worker).sort((a, b) => Number(name === 'chocmental' && !!abilitiesOf(b.def as UnitDef).length) - Number(name === 'chocmental' && !!abilitiesOf(a.def as UnitDef).length) || b.hp + b.shield - (a.hp + a.shield) || a.id - b.id)[0];
          if (pick && pick.maxHp + pick.maxShield >= 100) cmd = at(u, name, pick);
        } else if (name === 'regenerant') {
          const hurt = allies.filter((a) => a.hp * 10 < a.maxHp * 7 && !flies(a));
          const best = hurt.map((a) => [a, around(hurt, a.x, a.y, radius).length] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
          if (best && best[1] >= 3) cmd = at(u, name, best[0]);
        } else if (name === 'renvoi' || name === 'double') {
          // The biggest ally under fire (Renvoi), or simply the biggest one in the fight (Double).
          const pick = allies.filter((a) => a !== u && a.type !== 'cadavre' && (name === 'double' || w.tick - a.lastHit < ticks(2))).sort((a, b) => b.maxHp + b.maxShield - (a.maxHp + a.maxShield) || a.id - b.id)[0];
          if (pick) cmd = at(u, name, pick);
        } else if (name === 'coupcirculaire' || name === 'feucirculaire') {
          if (around(near, u.x, u.y, radius + u.radius).filter((f) => !flies(f)).length >= (name === 'feucirculaire' ? 3 : 2)) cmd = self(u, name);
        } else if (name === 'camouflage' || name === 'camouflagewalkyrie' || name === 'dephasage') {
          if (u.hp * 100 < u.maxHp * (name === 'dephasage' ? 35 : 50)) cmd = self(u, name);
        } else if (name === 'manteau') {
          if (around(army, u.x, u.y, radius).length >= 6 && around(near, u.x, u.y, 7 * FP).length >= 4) cmd = self(u, name);
        } else if (name === 'teleport') {
          // Porte-disques, Chimère, Dragon: shields down and hurt, they jump out of the fight, away from the enemies.
          if (u.hp + u.shield < (u.maxHp + u.maxShield) * 0.4) {
            const cx = near.reduce((s, f) => s + f.x, 0) / near.length;
            const cy = near.reduce((s, f) => s + f.y, 0) / near.length;
            const d = dist(u.x, u.y, cx, cy) || 1;
            const jump = ((ab.range ?? 0) - 1) * FP;
            const clamp = (v: number, max: number) => Math.min(Math.max(v, FP), max * FP - FP);
            const x = clamp(u.x + Math.trunc(((u.x - cx) * jump) / d), w.map.width);
            const y = clamp(u.y + Math.trunc(((u.y - cy) * jump) / d), w.map.height);
            cmd = { player: this.player, kind: 'ability', ids: [u.id], name, x, y };
          }
        } else if (name === 'dissipation') {
          // An enemy summoned or under a boon first, else an ally held or poisoned.
          const foe = inReach.find((f) => f.ttl > 0 || f.reflect > 0 || f.war > 0 || f.invuln > 0);
          const friend = foe ? undefined : allies.find((a) => a.held > ticks(1) || a.poison > 0);
          if (foe ?? friend) cmd = at(u, name, (foe ?? friend)!);
        } else if (name === 'soumission') {
          // The toughest enemy soldier in reach that can change side.
          const pick = inReach.filter((f) => !(f.def as UnitDef).worker && !(f.def as UnitDef).unique && f.charm === 0).sort((a, b) => b.maxHp - a.maxHp || a.id - b.id)[0];
          if (pick && pick.maxHp >= 150) cmd = at(u, name, pick);
        } else if (name === 'voile') {
          if (this.engaged(u) !== undefined && around(army, u.x, u.y, radius).length >= 5) cmd = self(u, name);
        } else if (name === 'rayonmort') {
          if (around(near, u.x, u.y, (u.def as UnitDef).sight * FP).length >= 4) cmd = self(u, name);
        } else if (name === 'nuee') {
          if (around(near, u.x, u.y, radius + u.radius).length >= 2) cmd = self(u, name);
        } else if (name === 'statue') {
          // To stone while hurt under fire, back once mended.
          if (u.statue === 0 ? u.hp * 2 < u.maxHp && w.tick - u.lastHit < ticks(2) : u.hp * 10 > u.maxHp * 9) cmd = self(u, name);
        } else if (name === 'cridegueurre') {
          if (this.engaged(u) !== undefined && around(army, u.x, u.y, radius).length >= 4) cmd = self(u, name);
        } else if (name === 'soinsdivins') {
          if (around(army, u.x, u.y, radius).filter((a) => a.hp * 10 < a.maxHp * 7 && !(a.def as UnitDef).mechanical).length >= 3) cmd = self(u, name);
        } else if (name === 'resurrection') {
          const fallen = w.corpses.filter((c) => c.owner === this.player && w.tick - c.tick < ticks(ab.duration) && dist(c.x, c.y, u.x, u.y) <= radius).length;
          if (fallen >= Math.min(2, ab.max ?? 1)) cmd = self(u, name);
        } else if (name === 'courroux') {
          const d = this.engaged(u);
          if (d !== undefined && d < 3 * FP) cmd = self(u, name);
        } else if (name === 'enfouissement') {
          // Créature: badly hurt in a fight, it burrows (unseen, it bursts out when an enemy comes by).
          if (!u.burrowed && u.hp * 10 < u.maxHp * 4) cmd = self(u, name);
        } else if (name === 'teleportgroupe') {
          // Voyageur: three of ours around badly hurt, the group goes home.
          const home = this.homeOf();
          if (home && allies.filter((a) => a.hp + a.shield < (a.maxHp + a.maxShield) / 2).length >= 3) cmd = at(u, name, home);
        } else if (name === 'napalm') {
          // The toughest enemy vehicle in reach, else a badly hurt one of ours (repaired).
          const pick = inReach.filter((f) => (f.def as UnitDef).mechanical).sort((a, b) => b.hp + b.shield - (a.hp + a.shield) || a.id - b.id)[0] ?? allies.find((a) => (a.def as UnitDef).mechanical && a.hp * 2 < a.maxHp);
          if (pick) cmd = at(u, name, pick);
        } else if (name === 'gel') {
          // Accumulateur: the enemy building in reach that shoots, or else that trains.
          const pick = [...w.entities.values()]
            .filter((b) => b.def.kind === 'building' && b.hp > 0 && !b.frozen && w.hostile(b.owner, this.player) && w.sees(this.player, b) && ((b.def as BuildingDef).attack || b.queue.length) && dist(b.x, b.y, u.x, u.y) <= reach + ((b.def as BuildingDef).size * FP) / 2)
            .sort((a, b) => Number(!!(b.def as BuildingDef).attack) - Number(!!(a.def as BuildingDef).attack) || a.id - b.id)[0];
          if (pick) cmd = at(u, name, pick);
        } else if (name === 'cone') {
          // Five of ours around under fire: none of them hurt a while.
          if (around(army, u.x, u.y, radius).filter((a) => w.tick - a.lastHit < ticks(2)).length >= 5) cmd = self(u, name);
        } else if (name === 'gravite') {
          // Six enemies close by (the Accumulateur has no weapon: never 'engaged' in a fight of its own).
          if (around(near, u.x, u.y, 7 * FP).length >= 6) cmd = self(u, name);
        } else if (name === 'acidedissolvant') {
          // The enemy building in reach with the most hit points left.
          const pick = [...w.entities.values()]
            .filter((b) => b.def.kind === 'building' && b.hp > 0 && w.hostile(b.owner, this.player) && w.sees(this.player, b) && dist(b.x, b.y, u.x, u.y) <= reach + ((b.def as BuildingDef).size * FP) / 2)
            .sort((a, b) => b.hp - a.hp || a.id - b.id)[0];
          if (pick) cmd = at(u, name, pick);
        } else if (name === 'explosioncuve') {
          // Blown up in the thick of the enemy, few of ours around; or dying with enemies at hand.
          const r = radius + u.radius;
          const hit = around(near, u.x, u.y, r).filter((f) => !flies(f)).length;
          const ours = around(army, u.x, u.y, r).filter((a) => a !== u && !flies(a)).length;
          if ((hit >= 5 && ours * 2 <= hit) || (u.hp * 4 < u.maxHp && hit >= 2 && ours < hit)) cmd = self(u, name);
        } else if (name === 'gazeuphorisants') {
          // On the thickest group of our living soldiers in a fight.
          const fighting = allies.filter((a) => !(a.def as UnitDef).mechanical && this.engaged(a) !== undefined);
          const best = fighting.map((a) => [a, around(fighting, a.x, a.y, radius).length] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
          if (best && best[1] >= 4) cmd = at(u, name, best[0]);
        } else if (name === 'reanimation') {
          // A fresh corpse in reach rises to fight for us.
          const c = w.corpses.filter((c) => dist(c.x, c.y, u.x, u.y) <= reach).sort((a, b) => b.tick - a.tick)[0];
          if (c) cmd = { player: this.player, kind: 'ability', ids: [u.id], name, x: c.x, y: c.y };
        } else if (name === 'festin') {
          // A fresh body in reach, when hurt: aimed at it.
          const c = u.hp * 10 < u.maxHp * 7 ? w.corpses.filter((c) => dist(c.x, c.y, u.x, u.y) <= reach).sort((a, b) => dist(a.x, a.y, u.x, u.y) - dist(b.x, b.y, u.x, u.y) || b.tick - a.tick)[0] : undefined;
          if (c) cmd = { player: this.player, kind: 'ability', ids: [u.id], name, x: c.x, y: c.y };
        } else if (name === 'posermine') {
          // Pégase on the ground: a mine under it when enemy walkers come close.
          if (!u.airborne && u.charges > 0 && around(near, u.x, u.y, 6 * FP).filter((f) => !flies(f)).length >= 2) cmd = self(u, name);
        } else if (name === 'decollage') {
          // Pégase: up against flyers only, down again once none is left.
          const air = near.some((f) => flies(f));
          const ground = near.some((f) => !flies(f));
          if (u.airborne ? !air : air && !ground) cmd = self(u, name);
        }
        if (cmd) {
          out.push(cmd);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Focus fire (hard AI): a soldier already fighting switches to the enemy in its reach closest to death, when that
   * one is much weaker than its current target.
   */
  private focus(wave: Entity[]): Command[] {
    const w = this.world;
    const picks = new Map<number, number[]>();
    for (const u of wave) {
      const a = w.weapon(u);
      const o = u.order;
      const current = o?.kind === 'attack' || o?.kind === 'attackMove' ? w.entities.get(o.target) : undefined;
      if (!a || !current || current.def.kind !== 'unit') continue;
      const reach = (a.range + 0.5) * FP + u.radius;
      let best = current;
      for (const e of w.entities.values()) {
        if (e.def.kind !== 'unit' || e.hp <= 0 || e.inside || !w.hostile(e.owner, this.player) || !reaches(a, flies(e)) || !w.sees(this.player, e)) continue;
        if (dist(e.x, e.y, u.x, u.y) - e.radius > reach) continue;
        if (e.hp + e.shield < best.hp + best.shield || (e.hp + e.shield === best.hp + best.shield && e.id < best.id)) best = e;
      }
      if (best !== current && (best.hp + best.shield) * 10 < (current.hp + current.shield) * 6) picks.set(best.id, [...(picks.get(best.id) ?? []), u.id]);
    }
    return [...picks].map(([target, ids]) => {
      const t = w.entities.get(target)!;
      return { player: this.player, kind: 'attack', ids, x: t.x, y: t.y, target };
    });
  }

  /** Distance to the enemy the unit is fighting, if it is close. */
  private engaged(u: Entity): number | undefined {
    const o = u.order;
    const t = o && (o.kind === 'attack' || o.kind === 'attackMove') ? this.world.entities.get(o.target) : undefined;
    const d = t && t.def.kind === 'unit' ? dist(u.x, u.y, t.x, t.y) : undefined;
    return d !== undefined && d < 7 * FP ? d : undefined;
  }

  /** No council left: throw everything at the enemy. */
  /**
   * The game is lost and we give up rather than wait for the enemy to raze a dead town: for a full minute, no unit
   * but workers (and Gaïa, who comes back), nothing being trained, not enough to pay for any of our units, a worker
   * included, and no income (minerals, or energy a Marché could sell, never went up).
   */
  private lost(mine: Entity[]): boolean {
    const w = this.world;
    const p = w.players[this.player];
    const f = this.faction;
    const market = mine.some((e) => e.type === 'marche' && e.buildLeft === 0);
    // Paid, and with something to train it (a lone Pod and 150 minerals: no drone nor Plate-forme could come, and the
    // AI sat idle to the time limit), or an add-on the bank pays that would.
    // A Marché's sale at its real rate (minerals and energy added one for one, the side never resigned for a unit no
    // sale could pay).
    const pays = (c: { minerals: number; energy: number }) => p.energy >= c.energy && p.minerals + (market ? this.sale(p.energy, c.energy) : 0) >= c.minerals;
    // Finished, or a site rising by itself (a Z Intelligence its last drone went into, an Obélisque, a Porte).
    const ready = mine.filter((e) => e.buildLeft === 0 || (e.def as BuildingDef).absorbs || (e.def as BuildingDef).warp);
    // A Dieux god summons units too, and the Porte the gods.
    const trainable = (t: string) => ready.some((e) => (e.type === f.workerFrom && t === f.worker) || (e.def.kind === 'unit' && !!(e.def as UnitDef).trains?.includes(t))) || ready.some((b) => b.def.kind === 'building' && ((b.def as BuildingDef).trains?.includes(t) || (b.def as BuildingDef).addons?.some((a) => pays((DEFS[a] as BuildingDef).cost) && (DEFS[a] as BuildingDef).trains?.includes(t) && w.addonsOf(b) < BALANCE.rules.z.podAddons && !!w.addonSpot(b, a))));
    // With room for it in supply (a Plate-forme alone gives none).
    const sup = w.supply(this.player);
    const cannotPay = [f.worker, ...f.army.map(([t]) => t), ...(f.gods ?? [])].every((t) => !(pays((DEFS[t] as UnitDef).cost) && trainable(t) && sup.max - sup.used >= (DEFS[t] as UnitDef).supply));
    const beaten =
      cannotPay &&
      // A headquarters' site rising (by itself or with a worker left to raise it) is hope too: the economy restarts once
      // it stands.
      // An armed unit (an Espion alone does nothing a last stand could order).
      !mine.some((e) => (e.def.kind === 'unit' && !(e.def as UnitDef).worker && e.type !== f.builder && !!w.weapon(e)) || (e.def.kind !== 'resource' && e.queue.length > 0) || (kin(e, f.hq) && e.buildLeft > 0 && (!!(e.def as BuildingDef).absorbs || !!(e.def as BuildingDef).warp || mine.some((u) => u.type === f.worker))));
    const h = this.hopeless;
    if (!beaten) this.hopeless = null;
    else if (!h || p.minerals > h.minerals || (market && p.energy > h.energy)) this.hopeless = { since: w.tick, minerals: p.minerals, energy: p.energy };
    else if (w.tick - h.since >= ticks(60)) return true;
    return false;
  }

  /** Supply left this turn: free supply less what the units ordered this turn take (not research, morphs, add-ons). */
  private room(ctx: Turn): number {
    let used = 0;
    for (const o of ctx.out) if (o.kind === 'train' && DEFS[o.type]?.kind === 'unit') used += (DEFS[o.type] as UnitDef).supply;
    return ctx.free - used;
  }

  /** Our headquarters, any. */
  private homeOf(): Entity | undefined {
    for (const e of this.world.entities.values()) if (e.owner === this.player && kin(e, this.faction.hq)) return e;
    return undefined;
  }

  private lastStand(mine: Entity[]): Command[] {
    const army = mine.filter((e) => e.def.kind === 'unit' && !e.order);
    const target = [...this.world.entities.values()].find((e) => this.world.hostile(e.owner, this.player) && e.def.kind === 'building');
    if (!army.length || !target) return [];
    return [{ player: this.player, kind: 'attack', ids: army.map((u) => u.id), x: target.x, y: target.y }];
  }

  /**
   * Z: the weapon a socle is built with, for good: a weighted rotation through the researched ones (only those that
   * hit flyers against them); the machine gun (undefined) before any is researched.
   */
  /** Z: a weapon this socle may be built with: researched, and against flyers one that reaches them on this carrier. */
  private kitAllowed(def: UnitDef, k: string): boolean {
    const kit = WEAPONS[k];
    // The Déchiqueteur reaches flyers on a flying socle.
    return !!def.weapons?.includes(k) && !(kit.research && !this.world.level(this.player, kit.research)) && (!this.enemyAir || !kit.attack || reaches(weaponAt(k, 1, !!def.flying) ?? kit.attack, true));
  }

  /** Z: this socle can be paid with one of the weapons it may get (with none of them: the machine gun). */
  private kitFits(def: UnitDef, minerals: number, energy: number): boolean {
    const kits = Object.keys(KITS).filter((k) => this.kitAllowed(def, k));
    return (kits.length ? kits : [undefined]).some((k) => {
      const c = withKit(def, k);
      return c.minerals <= minerals && c.energy <= energy;
    });
  }

  /** `ordered`: an Accumulateur already ordered this turn. */
  private weaponFor(def: UnitDef, energy: number, minerals = Infinity, ordered = false): string | undefined {
    if (!def.weapons) return undefined;
    // The first socle once the Accumulateur is researched gets it: one at least, whatever the rotation says, when it
    // can be paid (forced while the energy was short, it held every Plate-forme).
    const acc = WEAPONS.accumulateur;
    const accCost = withKit(def, 'accumulateur');
    if (def.weapons.includes('accumulateur') && this.world.level(this.player, acc.research!) && accCost.energy <= energy && accCost.minerals <= minerals && !ordered && ![...this.world.entities.values()].some((e) => e.owner === this.player && (e.kit === 'accumulateur' || e.kits.includes('accumulateur')))) return 'accumulateur';
    const kits = Object.entries(KITS).filter(([k]) => this.kitAllowed(def, k));
    // Energy piling up: the weapons that spend it weigh three times as much.
    const weighted = kits.map(([k, wgt]): [string, number] => [k, energy >= 300 && WEAPONS[k].cost.energy > 0 ? wgt * 3 : wgt]);
    const total = weighted.reduce((n, [, wgt]) => n + wgt, 0);
    let k = this.trained % Math.max(1, total);
    return weighted.find(([, wgt]) => (k -= wgt) < 0)?.[0];
  }

  /** `at`: the building that will train it, whose own Isdaris extensions count (a Druide needs the Laboratoire there). */
  /** `shareEnergy`: the energy for a Phalangiste or Belluaire due for its share (above the tech's reserve only). */
  private nextUnit(energy: number, own: Entity[], minerals: number, at?: Entity, room = Infinity, shareEnergy = energy): string {
    if (this.faction !== FACTIONS.humains) {
      // Weighted rotation through the faction's army; energy-hungry units only when affordable, a few invisible ones at most.
      const cloaked = own.filter((u) => (u.def as UnitDef).cloaked).length;
      const sneak = this.armyList.find(([t]) => (DEFS[t] as UnitDef).cloaked && (DEFS[t] as UnitDef).cost.energy <= energy && (DEFS[t] as UnitDef).cost.minerals <= minerals && !this.world.lacks(this.player, t, undefined, at));
      if (sneak && cloaked < MAX_CLOAKED) return sneak[0];
      // Against flying enemies, only what can shoot them.
      // Only what fits in supply: a 4-supply Octopode with 2 left was picked again every turn, and nothing came.
      const fits = this.armyList.filter(([t]) => (DEFS[t] as UnitDef).cost.energy <= energy && !(DEFS[t] as UnitDef).cloaked && !this.world.lacks(this.player, t, undefined, at) && (DEFS[t] as UnitDef).supply <= room);
      const affordable = fits.length ? fits : this.armyList.filter(([t]) => (DEFS[t] as UnitDef).cost.energy <= energy && !(DEFS[t] as UnitDef).cloaked && !this.world.lacks(this.player, t, undefined, at));
      const antiAir = affordable.filter(([t]) => reaches((DEFS[t] as UnitDef).attack!, true));
      // Each weighed by the damage it does to the enemy's army, by class (fiches 2010): an Isdaris Créature does 18
      // to infantry, 6 to Z socles, so against the Z the Archers (29 to machines) take its share.
      // Anti-air only while it can be paid, or minerals still come in to pay it (an Archer at 150 picked for ever with
      // 100 left, and the Créature at 70 never came).
      const airPay = antiAir.some(([t]) => (DEFS[t] as UnitDef).cost.minerals <= minerals) || this.world.tick - this.lastIncome < ticks(60);
      const army = (this.enemyAir && antiAir.length && airPay ? antiAir : affordable).map(([t, wgt]) => [t, Math.max(1, Math.round(wgt * 4 * this.fit(t)))] as [string, number]);
      // Energy piling up: spend it on the unit that needs the most, rather than on more cheap ones; one whose minerals
      // are there (an Octopode at 675 picked with 200 in the bank held every Plate-forme while a drone de combat could come).
      // A socle with a weapon it may get, minerals and energy (the Laser put an Hexapode out of reach every turn).
      const rich = army.filter(([t]) => this.kitFits(DEFS[t] as UnitDef, minerals, energy));
      if (energy >= 300 && rich.length) return rich.reduce((a, b) => ((DEFS[b[0]] as UnitDef).cost.energy > (DEFS[a[0]] as UnitDef).cost.energy ? b : a))[0];
      const total = army.reduce((n, [, wgt]) => n + wgt, 0);
      let k = this.trained % total;
      for (const [t, wgt] of army) {
        if (k < wgt) return t;
        k -= wgt;
      }
      return army[0][0];
    }
    // Phalangistes (grenades, long range) once a Forge stands, one in five.
    // (One in five trained, they never came: the energy was seldom there on that turn. Now a sixth of the army each.)
    const share = (t: string) => own.filter((u) => u.type === t).length * 6 < own.length;
    if (shareEnergy >= 150 && minerals >= 225 && share('phalangiste') && !this.enemyAir && !this.world.lacks(this.player, 'phalangiste', undefined, at)) return 'phalangiste';
    // Belluaires (halberd riders, against infantry) once a Créaturium stands.
    if (shareEnergy >= 175 && minerals >= 200 && share('belluaire') && !this.enemyAir && !this.world.lacks(this.player, 'belluaire', undefined, at)) return 'belluaire';
    // Healers on schedule, or to burn spare energy, but never more than a third of the army.
    const healers = own.filter((u) => (u.def as UnitDef).heal).length;
    // With its minerals there: chosen for the energy alone, it held the last Caserne for good.
    if (energy >= 100 && minerals >= (DEFS.soigneur as UnitDef).cost.minerals && healers * 3 < own.length + 1 && (energy >= 300 || this.trained % this.plan.healerEvery === this.plan.healerEvery - 1)) return 'soigneur';
    // Deterministic mix of légionnaires among auxiliaires.
    return !this.enemyAir && (this.trained * this.plan.legionShare) % 1 >= 1 - this.plan.legionShare ? 'legionnaire' : 'auxiliaire';
  }

  /**
   * How well a unit's weapon fits the enemy: its mean damage against the classes of the enemy factions' armies (as
   * the AI builds them, ai.army), over its best damage; 1 for a weapon without classes.
   */
  private fit(type: string): number {
    const vs = (DEFS[type] as UnitDef).attack?.vs;
    if (!vs) return 1;
    let sum = 0;
    let n = 0;
    for (const o of this.world.players) {
      if (!this.world.hostile(o.id, this.player)) continue;
      for (const [t, wgt] of Object.entries((BALANCE.ai.army as Record<string, Record<string, number>>)[o.faction] ?? {})) {
        sum += wgt * vs[CLASSES.indexOf((DEFS[t] as UnitDef).cls ?? 'BL')];
        n += wgt;
      }
    }
    return n ? sum / n / Math.max(...vs) : 1;
  }

  /**
   * Where a worker can be trained this turn, if anywhere: the least busy headquarters (or the Dieux's Gaïa) with an
   * empty queue, room in supply, the base standing. Z: the Intelligence centrale turns into the Intelligence suprême
   * only with an empty queue, so no drone then.
   */
  private workerHome(ctx: Turn): Entity | undefined {
    const { f, mine, home, buildings, free, holdSupreme } = ctx;
    const council = buildings.filter((b) => kin(b, f.hq) && b.buildLeft === 0).sort((a, b) => a.queue.length - b.queue.length)[0] ?? home;
    const at = f.workerFrom ? mine.find((e) => e.type === f.workerFrom) : council;
    if (!at || at.queue.length || at.buildLeft || free <= 0 || (holdSupreme && at.type === f.hq)) return undefined;
    // Not a building that trains no worker (a Pod standing in for a lost headquarters), nor a worker standing in for one.
    if (at.def.kind === 'building' ? !(at.def as BuildingDef).trains?.includes(f.worker) : at.type !== f.workerFrom) return undefined;
    return at;
  }

  /**
   * A base: a headquarters, or the Dieux' Antre (an outpost: a drop-off with its fields and its well). One definition
   * for the workers wanted, the wells, the extractors due and the fields left (an early natural taken as an Antre got
   * no Puits, no esprits of its own, and its fields counted for nothing).
   */
  private isBase(e: Entity): boolean {
    return kin(e, this.faction.hq) || (!!this.faction.outpost && e.type === this.faction.outpost);
  }

  /** A finished base stands at home: not a building standing in for a lost one, nor its site still rising. */
  private settled(home: Entity): boolean {
    return this.isBase(home) && home.buildLeft === 0;
  }

  /** Workers wanted: the plan's number per base, up to three. */
  private serfTarget(ctx: Survey): number {
    return this.plan.serfs * Math.min(3, ctx.buildings.filter((b) => this.isBase(b) && b.buildLeft === 0).length);
  }

  private nearest(from: Entity, test: (e: Entity) => boolean): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const e of this.world.entities.values()) {
      if (!test(e)) continue;
      const d = dist(from.x, from.y, e.x, e.y);
      if (d < bestD) [best, bestD] = [e, d];
    }
    return best;
  }

  /** A serf that is not carrying minerals nor already building, closest to the site. */
  /** `loaded`: one carrying minerals too (no base left to bring them to: its load would keep it from building for ever). */
  private builder(serfs: Entity[], spot: [number, number] | null, size: number, loaded = false): Entity | undefined {
    if (!spot) return undefined;
    // From the site's middle, not its top-left tile: the same worker from every corner.
    const x = spot[0] * FP + (size * FP) / 2;
    const y = spot[1] * FP + (size * FP) / 2;
    return serfs
      // Not one sheltered in a building (Z Refuge): its build order is dropped, and it was given again every turn.
      .filter((s) => s.order?.kind !== 'build' && s.order?.kind !== 'construct' && (loaded || s.carry === 0) && !s.inside)
      .sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y) || a.id - b.id)[0];
  }

  /** Where to put a building: a free well for a mine, else a spot spiralling out from the council, away from minerals. */
  /**
   * Where shields recharge fastest: our finished building with a shield aura (Réserve psy) closest to `near`
   * (the rally point). `close`: only one whose aura reaches it.
   */
  private haven(buildings: Entity[], near: { x: number; y: number }, close = false): Entity | undefined {
    let best: Entity | undefined;
    let bestD = Infinity;
    for (const b of buildings) {
      const r = (b.def as BuildingDef).shieldCharge ? ABILITIES.rechargebouclier.range! : 0;
      if (!r || b.buildLeft > 0) continue;
      const d = dist(b.x, b.y, near.x, near.y);
      if (close && d > r * FP) continue;
      if (d < bestD) [best, bestD] = [b, d];
    }
    return best;
  }

  /** Where to put a building: a free well for a mine, else a spot spiralling out from the council (or from `near`), away from minerals. */
  private spot(type: string, home: Entity, near?: { x: number; y: number }): [number, number] | null {
    const w = this.world;
    const def = DEFS[type] as BuildingDef;
    if (def.energyRate) {
      // The free well nearest one of our bases.
      const bases = [...w.entities.values()].filter((b) => b.owner === this.player && this.isBase(b) && b.buildLeft === 0);
      let best: Entity | undefined;
      let bestD = 14 * FP;
      for (const e of w.entities.values()) {
        if (e.type !== 'puits' || !w.canPlace(type, e.tx, e.ty, this.player)) continue;
        for (const b of bases) {
          const d = dist(e.x, e.y, b.x, b.y);
          if (d < bestD) [best, bestD] = [e, d];
        }
      }
      return best ? [best.tx, best.ty] : null;
    }
    // The road measured to the footprint's middle tile: to its top-left one, the base in the opposite corner measured
    // to the mirror's bottom-right instead.
    if (type === this.faction.hq || type === this.faction.outpost) {
      // Centred on the site, laid out for a headquarters: a smaller outpost (the Dieux' Antre) at its top-left corner
      // stood two tiles off the mirror of the one in the opposite corner.
      // An odd difference (a 3x3 Antre in a 4x4 slot) leaves half a tile: toward the map's middle on each axis, so the
      // opposite corner's spot is the mirror of this one.
      const spare = (DEFS[this.faction.hq] as BuildingDef).size - def.size;
      const inset = (t: number, axis: number) => (spare % 2 === 0 || 2 * t + (DEFS[this.faction.hq] as BuildingDef).size < axis ? Math.ceil(spare / 2) : Math.floor(spare / 2));
      // Its headquarters lost, its start's spot comes first (left out of the expansions, it could not be raised again
      // there once the other sites were taken).
      const lost = type === this.faction.hq && ![...w.entities.values()].some((e) => e.owner === this.player && kin(e, this.faction.hq));
      const start = lost ? startSite(w, this.player) : undefined;
      const site = [...(start ? [start] : []), ...expansions(w, this.player)].map(([tx, ty]): [number, number] => [tx + inset(tx, w.map.width), ty + inset(ty, w.map.height)]);
      // An expansion with a field left round it (a site mined out, its base lost, was taken again for its last 800).
      const mined = (tx: number, ty: number) => {
        const [cx, cy] = [(tx + def.size / 2) * FP, (ty + def.size / 2) * FP];
        let n = 0;
        for (const e of w.entities.values()) if (e.type === 'minerai' && dist(e.x, e.y, cx, cy) < 12 * FP && ++n >= 1) return false;
        return true;
      };
      // Not under an enemy's guns (the builder died on the way, and with it every rebuild), nor, for a lost
      // headquarters, where no worker of ours has a road out of their reach.
      // (an expansion's too: a drone sent over a ramp a Fortin held, again and again).
      const raisers = lost || type === this.faction.outpost || type === this.faction.hq ? [...w.entities.values()].filter((e) => e.owner === this.player && e.def.kind === 'unit' && raises(e.def as UnitDef, type)) : [];
      const ok = ([tx, ty]: [number, number]) => {
        const c = { x: (tx + def.size / 2) * FP, y: (ty + def.size / 2) * FP };
        return w.canPlace(type, tx, ty, this.player) && this.fresh(tx, ty, def.size) && this.walkable(home, tx + Math.floor(def.size / 2), ty + Math.floor(def.size / 2)) && !this.underFire(c) && (!raisers.length || raisers.some((r) => !this.exposedRoad(r, c)));
      };
      // The start's spot first while it has minerals; mined out, a site with some, the start's spot as a last resort.
      // Its headquarters lost, any free site at all comes last (the start's spot taken by the enemy, it raised none).
      const found = site.find((s) => !mined(...s) && ok(s)) ?? (start ? site.find(ok) : undefined);
      if (found || !start) return found ?? null;
      // Every site taken (the enemy built on the old one): any free ground round what still stands of ours (the
      // building or worker standing in for home), where its workers are, as other buildings.
      near = { x: home.x, y: home.y };
    }
    // The middle in half tiles (a building's middle is on a tile's centre or edge): whole, the same from every corner.
    const [c2x, c2y] = [Math.floor((2 * (near ?? home).x) / FP), Math.floor((2 * (near ?? home).y) / FP)];
    // Prefer the side facing the map centre, where the minerals are not.
    // A site right on a middle line (on an odd-sized map's axis) takes its side from the other line: the same both
    // ways, its mirror's spot was not the mirror of its own.
    const [ox, oy] = [2 * (near ?? home).x - w.map.width * FP, 2 * (near ?? home).y - w.map.height * FP];
    const sx = ox === 0 ? (oy < 0 ? -1 : 1) : ox < 0 ? 1 : -1;
    const sy = oy === 0 ? (ox < 0 ? 1 : -1) : oy < 0 ? 1 : -1;
    let first: [number, number] | undefined; // fallback when no spread-out spot is left
    for (let r = near ? 1 : 4; r < 14; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, r], [r, i], [i, -r], [-r, i]]) {
          // Centred on the spiral's point; half a tile left over goes toward the corner the base faces from, so the
          // base in the opposite corner gets the mirror of the spot, round a middle on a tile's edge too (a tile off).
          const [hx, hy] = [c2x + 2 * dx * sx - def.size, c2y + 2 * dy * sy - def.size];
          const tx = sx > 0 ? Math.floor(hx / 2) : Math.ceil(hx / 2);
          const ty = sy > 0 ? Math.floor(hy / 2) : Math.ceil(hy / 2);
          // Leave a one-tile corridor around every building.
          if (!this.clear(tx - 1, ty - 1, def.size + 2) || !w.canPlace(type, tx, ty, this.player) || !this.fresh(tx, ty, def.size)) continue;
          // Round the base, only on its own plateau: once it was full, a spot on the low ground outside passed.
          if (!near && !this.onPlateau(home, tx, ty, def.size)) continue;
          if (this.closeToResources(tx, ty, def.size) || this.closeToRamp(tx, ty, def.size)) continue;
          // Power-field buildings spread out to cover more ground: none closer to another field than most of its radius.
          // The road is measured to the footprint's middle tile, taken toward the same corner (the same in the mirror).
          const mid = (t: number, s: number) => t + (s > 0 ? Math.floor(def.size / 2) : Math.ceil(def.size / 2) - 1);
          const [ax, ay] = [mid(tx, sx), mid(ty, sy)];
          if (def.power && !def.morphOnly && first === undefined && this.walkable(home, ax, ay) && !(type === this.faction.hq && !this.safeSite(type, { x: (tx + def.size / 2) * FP, y: (ty + def.size / 2) * FP }))) first = [tx, ty];
          if (def.power && this.crowdsField(tx + def.size / 2, ty + def.size / 2, def.power)) continue;
          if (!this.walkable(home, ax, ay)) continue;
          // A headquarters raised again away from its sites: not under an enemy's guns (its last drone died on the way).
          if (type === this.faction.hq && !this.safeSite(type, { x: (tx + def.size / 2) * FP, y: (ty + def.size / 2) * FP })) continue;
          return [tx, ty];
        }
      }
    }
    return first ?? null;
  }

  /** Per base, the tiles of its plateau: those at its level that its tile reaches without leaving that level. */
  private readonly plateaus = new Map<number, Uint8Array>();

  /** Is a footprint all on `home`'s plateau? */
  private onPlateau(home: Entity, tx: number, ty: number, size: number): boolean {
    const g = this.world.grid;
    let mask = this.plateaus.get(home.id);
    if (!mask) {
      // Terrain only (buildings ignored): the plateau does not change in a game.
      mask = new Uint8Array(g.width * g.height);
      const [hx, hy] = [Math.floor(home.x / FP), Math.floor(home.y / FP)];
      const level = g.level(hx, hy);
      const todo = [hy * g.width + hx];
      mask[todo[0]] = 1;
      while (todo.length) {
        const i = todo.pop()!;
        const [x, y] = [i % g.width, Math.floor(i / g.width)];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const [nx, ny] = [x + dx, y + dy];
          const j = ny * g.width + nx;
          if (!g.inside(nx, ny) || mask[j] || g.level(nx, ny) !== level || !g.canStep(x, y, nx, ny, true)) continue;
          mask[j] = 1;
          todo.push(j);
        }
      }
      this.plateaus.set(home.id, mask);
    }
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (!g.inside(x, y) || !mask[y * g.width + x]) return false;
    return true;
  }

  /** Not a spot given up after MAX_TRIES build orders. */
  private fresh(tx: number, ty: number, size: number): boolean {
    return (this.tried.get(spotKey(tx, ty, size)) ?? 0) < MAX_TRIES;
  }

  /**
   * Can workers walk from the base to this tile by a reasonable road? A spot on the low ground at the foot of the
   * base's cliff is next door as the crow flies but a long way round on foot: the worker heads for the cliff edge,
   * gets stuck there and the order fails ("Emplacement inaccessible").
   */
  private walkable(home: Entity, tx: number, ty: number): boolean {
    // Asked again for the same tile, thought after thought (an outpost's site while the AI saves up for it, a base
    // with no room left gone round again for every building wanted): the road is searched once and kept while the
    // grid stays as it was (Grid.changes: no building put or gone, no wall up or down), so the answer is the one a new
    // search would give. Each search was a quarter of a millisecond, up to a tenth of a whole game's time.
    if (this.roadsAt !== this.world.grid.changes) {
      this.roadsAt = this.world.grid.changes;
      this.roads.clear();
    }
    const key = (home.id * 1024 + ty) * 1024 + tx;
    let ok = this.roads.get(key);
    if (ok === undefined) this.roads.set(key, (ok = this.road(home, tx, ty)));
    return ok;
  }
  private readonly roads = new Map<number, boolean>();
  private roadsAt = -1;

  private road(home: Entity, tx: number, ty: number): boolean {
    const g = this.world.grid;
    // From the open tile nearest the base toward the map's centre: the scan's fixed order picked a different one for
    // the base in the opposite corner, and so a different length of road.
    const [sx, sy] = g.nearestOpen(Math.floor(home.x / FP), Math.floor(home.y / FP), -1, [(g.width - 1) / 2, (g.height - 1) / 2]);
    const path = g.findPath(sx, sy, tx, ty);
    if ((path.length ? path[path.length - 1] : sy * g.width + sx) !== ty * g.width + tx) return false;
    return path.length <= Math.hypot(tx - sx, ty - sy) * 3 + 20;
  }

  /** Would a new power field centred on (x, y) tiles mostly overlap one of ours? */
  private crowdsField(x: number, y: number, radius: number): boolean {
    for (const b of this.world.entities.values()) {
      const p = (b.def as BuildingDef).power;
      if (b.owner !== this.player || !p) continue;
      if (Math.hypot(b.x / FP - x, b.y / FP - y) < Math.max(p, radius) * 0.9) return true;
    }
    return false;
  }

  private clear(tx: number, ty: number, size: number): boolean {
    const g = this.world.grid;
    for (let y = ty; y < ty + size; y++) for (let x = tx; x < tx + size; x++) if (!g.open(x, y)) return false;
    return true;
  }

  /** Buildings keep two tiles away from ramps, or they can wall the army in its own base. */
  private closeToRamp(tx: number, ty: number, size: number): boolean {
    const map = this.world.map;
    for (let y = ty - 2; y < ty + size + 2; y++) {
      for (let x = tx - 2; x < tx + size + 2; x++) {
        if (x >= 0 && y >= 0 && x < map.width && y < map.height && map.ramp[y * map.width + x]) return true;
      }
    }
    return false;
  }

  private closeToResources(tx: number, ty: number, size: number): boolean {
    const cx = (tx + size / 2) * FP;
    const cy = (ty + size / 2) * FP;
    for (const e of this.world.entities.values()) {
      if ((e.type === 'minerai' || e.type === 'puits') && dist(cx, cy, e.x, e.y) < (size / 2 + 3) * FP) return true;
    }
    return false;
  }

  /** No mineral left anywhere on the map: the army will not grow any more, so it goes with what it has. */
  private mapDry(): boolean {
    for (const e of this.world.entities.values()) if (e.type === 'minerai') return false;
    return true;
  }

  /**
   * No income left: the map is dry, or no mineral field stands by our bases and we cannot pay for a new one (the
   * fields left were the enemy's natural, which neither side could take any more: both sat to the time limit).
   */
  private starved(buildings: Entity[], minerals: number): boolean {
    // No worker left, none queued, and none to be had (its price or the supply for it short): no income will come,
    // fields or not.
    const f = this.faction;
    const w = this.world;
    const supply = w.supply(this.player);
    // Supply under construction is supply to come.
    // A site that rises by itself, that is (no worker is left to raise a Grenier or a Branche).
    const short = minerals < (DEFS[f.worker] as UnitDef).cost.minerals || (supply.used >= supply.max && !buildings.some((b) => kin(b, f.supply) && b.buildLeft > 0 && ((b.def as BuildingDef).warp || (b.def as BuildingDef).absorbs)));
    // Nor anything to train one (a headquarters' site no worker can finish).
    // A site rising by itself counts (a Z Intelligence its last drone went into).
    const rising = (e: Entity) => e.buildLeft === 0 || !!(e.def as BuildingDef).absorbs || !!(e.def as BuildingDef).warp;
    const trains = [...w.entities.values()].some((e) => e.owner === this.player && rising(e) && (e.type === f.workerFrom || (e.def.kind === 'building' && (e.def as BuildingDef).trains?.includes(f.worker))));
    if ((short || !trains) && ![...w.entities.values()].some((e) => e.owner === this.player && (e.type === f.worker || e.queue.includes(f.worker)))) return true;
    return this.mapDry() || (this.fieldsNear(buildings) === 0 && minerals < (DEFS[this.faction.outpost ?? this.faction.hq] as BuildingDef).cost.minerals);
  }

  /** Some unit of the army can still be paid from the bank and trained (without income, the last ones are still to come). */
  private affordable(ctx: Turn): boolean {
    // With a building to train it and room in supply: none left, no unit is still to come.
    // Units in a queue, paid already, are on their way too. What can still be bought is judged on this turn's budget
    // (the worker's price kept is not for them).
    const army = this.faction.army.map(([t]) => t);
    if (ctx.buildings.some((b) => b.queue.some((t) => army.includes(t))) || ctx.out.some((c) => c.kind === 'train' && army.includes(c.type))) return true;
    // The same budget the production buildings spend from (the minerals kept for the Psycho-assembleur's units held
    // every Portail, and the last units waited for ever).
    const budget = ctx.minerals - ctx.keep - ctx.gatewaysKeep - ctx.zKeep;
    return ctx.free > 0 && army.some((t) => (DEFS[t] as UnitDef).cost.minerals <= budget && (DEFS[t] as UnitDef).cost.energy <= ctx.energy && ctx.buildings.some((b) => b.buildLeft === 0 && (b.def as BuildingDef).trains?.includes(t)));
  }

  /** Mineral fields left within reach of any of our finished bases. */
  private fieldsNear(buildings: Entity[]): number {
    const hqs = buildings.filter((b) => this.isBase(b) && b.buildLeft === 0);
    // Not one under an enemy's guns: the workers are never sent there (tend).
    return [...this.world.entities.values()].filter((e) => {
      if (e.type !== 'minerai') return false;
      // The base nearest it, where its minerals go (tend).
      const h = hqs.filter((h) => dist(e.x, e.y, h.x, h.y) < 12 * FP).sort((a, b) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, b.x, b.y) || a.id - b.id)[0];
      // Nor one whose road from the base is under them.
      return !!h && !this.underFire(e) && !this.exposedRoad(h, e);
    }).length;
  }

  /** Enemy buildings whose weapons hit the ground, with their range (a manned Fortin's crew, not its workers, a tile further), by tick. */
  private guns: { tick: number; list: [Entity, number][] } = { tick: -1, list: [] };

  /** Roads from a base to a field that pass under an enemy's guns, by base and field; worked out again every 30 s. */
  private exposed = new Map<string, boolean>();
  private exposedAt = -1;

  private exposedRoad(base: { x: number; y: number }, field: { x: number; y: number }): boolean {
    const w = this.world;
    this.underFire(base); // fills this tick's guns
    if (!this.guns.list.length) return false;
    if (this.exposedAt < 0 || w.tick - this.exposedAt >= ticks(30)) {
      this.exposed.clear();
      this.exposedAt = w.tick;
    }
    // Only with a gun near the box from the base to the field: a road far from every gun is never worked out.
    const pad = 16 * FP;
    const [x0, x1] = [Math.min(base.x, field.x) - pad, Math.max(base.x, field.x) + pad];
    const [y0, y1] = [Math.min(base.y, field.y) - pad, Math.max(base.y, field.y) + pad];
    if (!this.guns.list.some(([g]) => g.x >= x0 && g.x <= x1 && g.y >= y0 && g.y <= y1)) return false;
    // By the tiles it goes from and to.
    const key = `${Math.floor(base.x / FP)},${Math.floor(base.y / FP)}:${Math.floor(field.x / FP)},${Math.floor(field.y / FP)}`;
    let hit = this.exposed.get(key);
    if (hit === undefined) {
      const g = w.grid;
      const [sx, sy] = g.nearestOpen(Math.floor(base.x / FP), Math.floor(base.y / FP), -1, [(g.width - 1) / 2, (g.height - 1) / 2]);
      // To the open tile by the field (the field's own tile is blocked: the search went over the whole area).
      const [fx, fy] = g.nearestOpen(Math.floor(field.x / FP), Math.floor(field.y / FP), -1, [sx, sy]);
      const path = g.findPath(sx, sy, fx, fy);
      hit = false;
      for (let i = 0; i < path.length && !hit; i += 2) hit = this.underFire({ x: ((path[i] % g.width) + 0.5) * FP, y: (Math.floor(path[i] / g.width) + 0.5) * FP });
      this.exposed.set(key, hit);
    }
    return hit;
  }

  /** A site out of an enemy's guns, one of our workers that can raise it having a road there out of them too. */
  private safeSite(type: string, c: { x: number; y: number }): boolean {
    if (this.underFire(c)) return false;
    const raisers = [...this.world.entities.values()].filter((e) => e.owner === this.player && e.def.kind === 'unit' && raises(e.def as UnitDef, type));
    return !raisers.length || raisers.some((r) => !this.exposedRoad(r, c));
  }

  /** No base (or no worker): a fighting unit (the next worker) a building of ours trains is short of minerals only,
   * and a sale leaves its energy. */
  private shortOfMinerals(ctx: Turn): boolean {
    const T = BALANCE.rules.trade;
    return ctx.buildings.some((b) => b.buildLeft === 0 && (b.def as BuildingDef).trains?.some((t) => {
      const d = DEFS[t] as UnitDef;
      // (or, no worker left, the next worker)
      // The bank with the worker's price kept back put in again (research spends it on that worker).
      const m = ctx.minerals + ctx.low;
      return d.kind === 'unit' && (ctx.serfs.length === 0 && this.settled(ctx.home) ? t === this.faction.worker : !d.worker && !!d.attack) && m < d.cost.minerals && ctx.energy - T.give >= d.cost.energy && m + this.sale(ctx.energy, d.cost.energy) >= d.cost.minerals;
    }));
  }

  /** From a point to a building's footprint (its nearest edge or corner), as the simulation measures a shot. */
  private toEdge(e: { x: number; y: number }, b: Entity): number {
    const half = (((b.def as BuildingDef).size ?? 0) * FP) / 2;
    return Math.hypot(Math.max(0, Math.abs(e.x - b.x) - half), Math.max(0, Math.abs(e.y - b.y) - half));
  }

  /** Minerals a Marché would add for the energy over `keepEnergy`, at the trade's real rate (give energy, get minerals). */
  private sale(energy: number, keepEnergy: number): number {
    const T = BALANCE.rules.trade;
    return Math.floor(Math.max(0, energy - keepEnergy) / T.give) * T.get;
  }

  /** Armed soldiers manning a building (a Fortin's crew shoots from inside). */
  private crew(b: Entity): Entity[] {
    if (!(b.def as BuildingDef).bunker) return [];
    const out: Entity[] = [];
    for (const u of this.world.entities.values()) if (u.inside === b.id && !(u.def as UnitDef).worker && this.world.weapon(u)) out.push(u);
    return out;
  }

  /** A point (a field, a site) an enemy building would shoot at a worker by. */
  private underFire(e: { x: number; y: number }): boolean {
    const w = this.world;
    if (this.guns.tick !== w.tick) {
      const list: [Entity, number][] = [];
      for (const b of w.entities.values()) {
        if (b.def.kind !== 'building' || !w.hostile(b.owner, this.player) || b.buildLeft > 0) continue;
        const a = w.weapon(b);
        if (a && reaches(a, false)) list.push([b, a.range]);
        for (const u of this.crew(b)) if (reaches(w.weapon(u)!, false)) list.push([b, w.weapon(u)!.range + 1]);
      }
      this.guns = { tick: w.tick, list };
    }
    return this.guns.list.some(([g, r]) => dist(g.x, g.y, e.x, e.y) < (r + 3) * FP);
  }

  /** Mineral fields left within reach of the council. */
  private fieldsLeft(home: Entity): number {
    return [...this.world.entities.values()].filter((e) => e.type === 'minerai' && dist(e.x, e.y, home.x, home.y) < 12 * FP).length;
  }

  /** Gathering point between the council and the map centre. */
  private rallyPoint(home: Entity): { x: number; y: number } {
    const w = this.world;
    const mx = (w.map.width * FP) / 2;
    const my = (w.map.height * FP) / 2;
    const d = dist(home.x, home.y, mx, my) || 1;
    return { x: home.x + Math.trunc(((mx - home.x) * 6 * FP) / d), y: home.y + Math.trunc(((my - home.y) * 6 * FP) / d) };
  }

  /**
   * Visible enemy units near any of our buildings (or hitting them from range): where to send defenders, the
   * enemy unit to hit, how many there are and their hp and shields.
   */
  /**
   * The middle of the road between our headquarters and the nearest enemy one, as both sides find it, when the two
   * sides' own roads part (null when they share it).
   */
  private sharedRoad(home: Entity): { x: number; y: number; until: number } | null {
    const w = this.world;
    let enemy: Entity | undefined;
    for (const e of w.entities.values()) {
      if (!w.hostile(e.owner, this.player) || !kin(e, FACTIONS[w.players[e.owner].faction].hq)) continue;
      if (!enemy || dist(e.x, e.y, home.x, home.y) < dist(enemy.x, enemy.y, home.x, home.y)) enemy = e;
    }
    if (!enemy) return null;
    const [a, b] = this.player < enemy.owner ? [home, enemy] : [enemy, home];
    const g = w.grid;
    // Ties toward the map's middle, not the scan order: the same road from every corner.
    const mid0: [number, number] = [(g.width - 1) / 2, (g.height - 1) / 2];
    const [ax, ay] = g.nearestOpen(Math.floor(a.x / FP), Math.floor(a.y / FP), -1, mid0);
    const [bx, by] = g.nearestOpen(Math.floor(b.x / FP), Math.floor(b.y / FP), -1, mid0);
    const path = g.findPath(ax, ay, bx, by);
    if (path.length < 2 || path[path.length - 1] !== by * g.width + bx) return null;
    const mid = path[path.length >> 1];
    const [mx, my] = [mid % g.width, Math.floor(mid / g.width)];
    // Most maps: the road found the other way round goes by the same middle, and the armies meet without help.
    const back = g.findPath(bx, by, ax, ay);
    if (back.some((t) => Math.abs((t % g.width) - mx) + Math.abs(Math.floor(t / g.width) - my) <= VIA_SAME_ROAD)) return null;
    return { x: mx * FP + FP / 2, y: my * FP + FP / 2, until: w.tick + ticks(VIA_TIMEOUT) };
  }

  private threat(buildings: Entity[]): { x: number; y: number; target: number; count: number; strength: number; armed: Entity[] } | undefined {
    const w = this.world;
    const foes: Entity[] = [];
    const ours = [...w.entities.values()].filter((u) => u.owner === this.player && u.def.kind === 'unit' && flies(u));
    const anchor = this.homeOf() ?? buildings.find((b) => b.owner === this.player);
    for (const e of w.entities.values()) {
      if (!w.hostile(e.owner, this.player) || e.def.kind !== 'unit' || !w.sees(this.player, e)) continue;
      // Not an unarmed flyer (an Espion hovering by an outlying building, out of the defenders' reach, kept the army
      // home on defence and no wave ever left; its Impulsion only holds units still a few seconds).
      // Nor a flyer whose weapon cannot hit the ground (a Char Pégase in the air kept the drones in Refuge for good).
      // Unless one of our flyers is there for it to shoot.
      if (flies(e) && !(w.weapon(e) && reaches(w.weapon(e)!, false)) && !(w.weapon(e) && ours.some((u) => dist(u.x, u.y, e.x, e.y) <= (w.weapon(e)!.range + ((u.def as UnitDef).radius ?? 0) + ((e.def as UnitDef).radius ?? 0) + 0.125) * FP))) continue;
      const reach = Math.max(DEFEND_RADIUS / 2, ((e.def as UnitDef).attack?.range ?? 0) * FP + 3 * FP);
      if (!buildings.some((b) => dist(e.x, e.y, b.x, b.y) < reach + (((b.def as BuildingDef).size ?? 0) * FP) / 2)) continue;
      // Nor a raider on foot that cannot walk to us (across a cliff from a Pod, it kept a full wave home for good).
      // Unless its weapon reaches one of them from there (a Phalangiste firing across the cliff).
      // Its research's range too (Trébuchet intégré against buildings), as the simulation counts it.
      const shoots = (b: Entity) => ((w.weapon(e)?.range ?? 0) + w.rangeBonus(e, b)) * FP;
      if (!flies(e) && anchor && !buildings.some((b) => this.toEdge(e, b) <= shoots(b) + (((e.def as UnitDef).radius ?? 0) + 0.125) * FP) && !this.walkable(anchor, Math.floor(e.x / FP), Math.floor(e.y / FP))) continue;
      foes.push(e);
    }
    if (!foes.length) return undefined;
    // Soldiers before workers: a scout alone is not worth pulling the army back for.
    const armed = foes.filter((e) => (e.def as UnitDef).attack && !(e.def as UnitDef).worker);
    const lead = armed[0] ?? foes[0];
    return {
      x: lead.x,
      y: lead.y,
      target: lead.id,
      count: foes.length,
      strength: armed.reduce((s, e) => s + e.hp + e.shield, 0) || 1,
      armed,
    };
  }

  /**
   * Where the wave goes: the enemy headquarters closest to us (its workers mine there), then whatever building
   * is closest. On the way and there, units pick soldiers first, then workers, then buildings.
   */
  private enemyTarget(home: Entity): Entity | undefined {
    const w = this.world;
    // Teammates hit the same base: the first to choose sets the team's focus, the others follow while it stands.
    const team = w.players[this.player].team;
    const focus = teamFocus(w);
    const held = w.entities.get(focus.get(team) ?? 0);
    if (held && held.hp > 0 && w.hostile(held.owner, this.player)) return held;
    // The enemy building that costs least to reach and take: its defences (armed buildings and soldiers we know of
    // round it), then distance; a headquarters counts as half defended, since its fall hurts most.
    const known = [...w.entities.values()].filter((e) => w.hostile(e.owner, this.player) && (e.def.kind === 'building' || w.sees(this.player, e)));
    const guard = known.filter((e) => (!!w.weapon(e) || (e.def.kind === 'building' && this.crew(e).length > 0)) && !(e.def as UnitDef).worker);
    let pick: Entity | undefined;
    let best = Infinity;
    for (const b of known) {
      if (b.def.kind !== 'building') continue;
      let defence = 0;
      for (const g of guard) if (dist(g.x, g.y, b.x, b.y) < 9 * FP) defence += g.hp + g.shield;
      if (kin(b, FACTIONS[w.players[b.owner].faction].hq)) defence /= 2;
      let targeted = 0;
      for (const [t, id] of focus) if (t !== team && w.entities.get(id)?.owner === b.owner) targeted++;
      const cost = defence + dist(b.x, b.y, home.x, home.y) / 20 + targeted * GANG_UP;
      if (cost < best) [pick, best] = [b, cost];
    }
    if (pick) focus.set(team, pick.id);
    return pick;
  }
}
