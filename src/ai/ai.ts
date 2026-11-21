import { ABILITIES, abilitiesOf, ARTEFACTS, spell, KIT, type BuildingDef, CLASSES, DEFS, FACTIONS, RAPPEL, raises, reaches, type FactionDef, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import BALANCE from '../balance.json';
import { FP, dist, ticks, toFp } from '../sim/fixed';
import { expansions } from '../sim/setup';
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
const EXTENSIONS = ['assembleur', 'laboratoire', 'balise'];
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

/** Abilities the AI uses with the plain rule above (on engaging); the others go through tactics(). */
const SIMPLE = ['stimulant', 'charge', 'peauderoc', 'transe'];
/** Area abilities aimed at enemy crowds: least enemies under the blast. */
/** Powers tried before a unit's others (they share one cooldown), in this order. */
const FIRST = ['cone', 'gravite', 'gel'];
const CROWD: Record<string, number> = { explosiftoxique: 3, silence: 2, pluiedefeu: 3, lumiereardente: 3, tempete: 2, impulsion: 3, vacarme: 3 };
/** Spells that take a caster out of a lost fight: the mana for them is never spent on another. */
const ESCAPE = ['voyage'];
/** Dieux: the gods the Porte d'Asgaard summons, and from which minute (one at a time, in this order). */
const GODS = BALANCE.ai.gods as [string, number][];

// What one turn of the AI works from, step by step: what it has, what it wants, what it keeps back, what it spends.
type Survey = ReturnType<AI['survey']>;
type Need = ReturnType<AI['need']>;
type Turn = Survey & Need & ReturnType<AI['budget']> & { keep: number; low: number };

/** A computer player. It only acts through commands, like a human. */
/** A building spot's key: its middle, in half tiles. */
const spotKey = (tx: number, ty: number, size: number) => `${2 * tx + size},${2 * ty + size}`;

export class AI {
  private waves = 0;
  private trained = 0;
  /** The tech building has fielded a unit of its own once (the first one comes before anything else it holds up). */
  private fielded = false;
  /** Most enemy flying units seen at once: calls for anti-air. */
  private enemyAir = 0;
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
  /** A threat on our base stronger than the army at home, this turn (Mur d'énergie). */
  private danger: { x: number; y: number } | undefined;

  private readonly faction: FactionDef;

  private readonly easy: boolean;
  private readonly hard: boolean;

  /**
   * `level` (menu: easy, normal, hard) changes how it plays, on top of the harvest handicap: the easy AI has a
   * smaller economy and army (its own plan), trains one unit at a time, attacks late with small waves, expands late,
   * never raids workers, researches, casts, kites nor falls back; the hard AI expands sooner and its
   * soldiers focus their fire on the enemy they can finish.
   */
  constructor(private readonly world: World, readonly player: number, private readonly plan: Plan = BIOBALL, level = 'normal') {
    this.faction = FACTIONS[world.players[player].faction];
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
    const home = mine.find((e) => kin(e, this.faction.hq));
    if (!home) return this.lastStand(mine);
    const s = this.survey(mine, home);
    const n = { ...s, ...this.need(s) };
    const ctx: Turn = { ...n, ...this.budget(n), keep: 0, low: 0 };
    this.tend(ctx);
    // Down to fewer than half the workers it wants: the next worker's price is kept from the buildings and the soldiers
    // until one is ordered (Dieux down to a few esprits spent their last minerals elsewhere, and with no income never
    // had the 75 for one again; raided Isdaris put every 70 minerals into a Créature, their last robots unreplaced).
    // Only for a worker that can be trained now: with no room in supply, it kept a Branche's 200 from the 75 (the
    // Branche the esprit waited for); with the Z Intelligence held for its turn into the suprême, the 300 of it.
    ctx.low = ctx.serfs.length < this.serfTarget(ctx) / 2 && this.workerHome(ctx) ? (DEFS[this.faction.worker] as UnitDef).cost.minerals : 0;
    ctx.minerals -= ctx.low;
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
    this.advance(ctx);
    return ctx.out;
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
        minerals -= (DEFS[o.type] as BuildingDef).cost.minerals;
        promisedEnergy += (DEFS[o.type] as BuildingDef).cost.energy;
      }
    }
    const supply = w.supply(this.player);
    const flyersSeen = [...w.entities.values()].filter((e) => w.hostile(e.owner, this.player) && flies(e) && w.sees(this.player, e)).length;
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
  private tend(ctx: Survey): void {
    const { f, p, serfs, buildings } = ctx;
    // Idle serfs go mining.
    for (const s of serfs) {
      if (s.order) continue;
      const f = this.nearest(s, (e) => e.type === 'minerai' && !this.failed.get(s.id)?.has(e.id));
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
      const f = this.nearest(s, (e) => e.type === 'minerai' && !failed.has(e.id) && !e.miner && dist(e.x, e.y, s.x, s.y) < STUCK_REACH * FP);
      if (f) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: f.x, y: f.y, target: f.id });
      this.walking.delete(s.id);
    }
    for (const id of this.walking.keys()) if (!seen.has(id)) this.walking.delete(id);
    // Back to work (mining, carrying), or dead: its failures are forgotten.
    for (const id of this.failed.keys()) {
      const s = this.world.entities.get(id);
      if (!s || s.carry > 0) this.failed.delete(id);
    }

    // Z: three drones work each Assimilateur (notice), taken from the mineral line.
    for (const b of buildings.filter((b) => b.buildLeft === 0 && (b.def as BuildingDef).energyRate && (b.def as BuildingDef).bunker)) {
      const coming = ctx.mine.filter((s) => s.order?.kind === 'enter' && s.order.target === b.id).length;
      for (let n = this.world.room(b) - this.world.load(b) - coming; n > 0; n--) {
        const s = this.builder(serfs.filter((s) => s.order?.kind === 'gather' && !ctx.out.some((c) => c.ids.includes(s.id))), [b.tx, b.ty], (b.def as BuildingDef).size);
        if (!s) break;
        ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: b.x, y: b.y, target: b.id });
      }
    }

    // Abandoned construction sites (builder killed) get a new serf. Warped buildings build themselves.
    for (const site of buildings.filter((b) => b.buildLeft > 0 && !(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs)) {
      if (serfs.some((s) => s.order?.kind === 'construct' && s.order.target === site.id)) continue;
      const s = this.builder(serfs, [site.tx, site.ty], (site.def as BuildingDef).size);
      if (s) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: site.x, y: site.y, target: site.id });
    }

    // A worker that can repair (drone, serf, esprit) repairs a building that has lost 40 % of its hit points, one each, with minerals to spare.
    if (REPAIR[f.worker] && p.minerals > 200) {
      for (const b of buildings.filter((b) => b.buildLeft === 0 && b.hp < (b.maxHp * 6) / 10)) {
        if (serfs.some((s) => s.order?.kind === 'repair' && s.order.target === b.id)) continue;
        const s = this.builder(serfs.filter((s) => s.order?.kind === 'gather'), [b.tx, b.ty], (b.def as BuildingDef).size);
        if (s) ctx.out.push({ player: this.player, kind: 'smart', ids: [s.id], x: b.x, y: b.y, target: b.id });
      }
    }

    // Isdaris: a major building under fire, below a third of its hit points and shield, raises its Bouclier de plasma.
    for (const b of buildings.filter((b) => abilitiesOf(b.def as BuildingDef).includes('bouclierplasma') && b.buildLeft === 0 && b.plasmaCd === 0 && b.phased === 0 && 3 * (b.hp + b.shield) < b.maxHp + b.maxShield)) {
      ctx.out.push({ player: this.player, kind: 'ability', ids: [b.id], name: 'bouclierplasma' });
    }
  }

  /** The buildings wanted this turn, most urgent first, and the tech state they depend on. */
  private need(ctx: Survey) {
    const { w, f, p, mine, home, serfs, builders, gods, army, buildings, count, supply, minute, antiAir, enemyCloaks } = ctx;
    // Supply first, then production buildings, then the mine.
    const building = (type: string) => builders.some((s) => [s.order, ...s.next].some((o) => o?.kind === 'build' && o.type === type)) || builders.some((s) => s.order?.kind === 'build' && s.order.type === type) || buildings.some((b) => b.type === type && b.buildLeft > 0);
    const wants: string[] = [];
    // Production: the casernes, or for the Dieux the Porte and its gods.
    const producers = f.gods ? 1 + gods.length : count(f.barracks);
    if (supply.max < 200 && supply.max - supply.used <= 2 + producers * 2 && !building(f.supply)) wants.push(f.supply);
    // Isdaris: an extra emitter whenever production grows, to widen the power field.
    if (f.pylon && count(f.pylon) < 1 + Math.floor(count(f.barracks) / 2) && !building(f.pylon)) wants.push(f.pylon);
    // One extractor per base: the main's well, then the expansion's (energy is the Isdaris bottleneck).
    const bases = buildings.filter((b) => kin(b, f.hq) && b.buildLeft === 0).length;
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
    const nextExtension = EXTENSIONS.find((x) => buildings.some((b) => (b.def as BuildingDef).researches?.includes(x) && b.buildLeft === 0) && w.researchable(this.player, x) && !w.lacks(this.player, x) && !(firstTech && techDef!.researches?.includes(x)));
    // Z: a Tourelle needs a Pod too, so only with minerals to spare.
    if (f.defense && count(f.defense) < defenses && !building(f.defense) && !(f === FACTIONS.z && ctx.minerals < 500)) wants.push(f.defense);
    // Late buildings (Marché, Alchimisterie, Orbe de commandement), one each, once their time has come.
    // One that needs the tech building waits for its first unit (the Orbe de commandement took all the energy of the first Discobole).
    for (const [type, from] of [...(EXTRA[p.faction] ?? []), ...(MORE_EXTRA[p.faction] ?? [])]) if (minute >= from && count(type) === 0 && !w.lacks(this.player, type) && !(f.tech && (DEFS[type] as BuildingDef).requires?.[f.tech] && !this.fielded)) wants.push(type);
    // Humans: a Fortin by the rally point, manned by four soldiers kept back from the waves.
    const bunker = f.buildable.find((t) => (DEFS[t] as BuildingDef).bunker && !(DEFS[t] as BuildingDef).dropoff && !(DEFS[t] as BuildingDef).energyRate);
    if (bunker && minute > 5 && count(bunker) === 0 && count(f.barracks) >= 2 && !building(bunker)) wants.push(bunker);
    // Expand to the natural once the main is running, then to the map's next free base every few minutes, or
    // sooner when the bases run dry (as many as the map offers, up to MAX_BASES).
    const outpost = f.outpost && !(rich && p.minerals > 1600) ? f.outpost : f.hq;
    const councils = buildings.filter((b) => b.type === f.hq || b.type === f.outpost).length + builders.filter((s) => s.order?.kind === 'build' && (s.order.type === f.hq || s.order.type === f.outpost)).length;
    const firstAt = this.hard ? LEVELS.hard.expandMinute : this.easy ? LEVELS.easy.expandMinute : 7;
    // Rich Dieux go for their natural early; the bases after it come at the usual pace (taking every free base as soon
    // as the bank passed 800 spread them thin: on Origine with a third base they lost 31 of 32 games to the Isdaris).
    const due = councils < 2 ? w.tick > ticks(firstAt * 60) || this.fieldsLeft(home) < 5 : minute >= firstAt + EXPAND_EVERY * (councils - 1) || this.fieldsNear(buildings) < 6;
    const expand = councils < MAX_BASES && (serfs.length >= this.plan.serfs || rich) && due && !!this.spot(outpost, home);
    if (expand) wants.push(outpost);
    // Save up for the expansion once the base is defended.
    const saving = expand && army.filter((u) => !this.wave.has(u.id)).length >= 8 && ctx.minerals < 1000;
    if (moreEnergy && f !== FACTIONS.isdaris && ctx.minerals >= (DEFS[f.extractor] as BuildingDef).cost.minerals + 200) wants.push(f.extractor);
    return { wants, building, moreEnergy, techWanted, techDef, techUp, unlocked, firstTech, nextExtension, outpost, saving };
  }

  /** Energy (and minerals) kept back from cheaper spending for the tech, its units and the next research. */
  private budget(ctx: Survey & Need) {
    const { w, f, p, mine, builders, army, buildings, minute, moreEnergy, techWanted, techDef, techUp, unlocked, nextExtension } = ctx;
    // Z: once its prerequisites stand, the energy of the next step of its tech (Intelligence suprême, Centre
    // d'optimisation, Centre K) is kept from everything else.
    const zNext = f === FACTIONS.z ? (['supreme', 'optimisation', 'centrek'] as const).find((t, i) => minute > 6 + 4 * i && !mine.some((b) => b.type === t || b.queue.includes(t)) && !builders.some((d) => d.order?.kind === 'build' && d.order.type === t)) : undefined;
    // Not before its prerequisites stand: 400 energy kept for an Intelligence suprême that could not come yet held
    // back every socle from minute 6 (the Z army never grew past 5 to 8 units, its energy piled up unused).
    const zTech = zNext && !w.lacks(this.player, zNext) ? zNext : undefined;
    const wantSupreme = zTech === 'supreme' && !w.lacks(this.player, 'supreme');
    const reserve = zTech ? (DEFS[zTech] as BuildingDef).cost.energy : !techDef ? 0 : techUp ? (unlocked.length ? Math.min(...unlocked.map((t) => (DEFS[t] as UnitDef).cost.energy)) : 0) + (nextExtension ? (DEFS[nextExtension] as UpgradeDef).cost.energy : 0) : techWanted ? techDef.cost.energy : 0;
    // The next research in line keeps its energy from the cheaper units and morphs too (otherwise it never came),
    // once the army is a wave strong (soldiers first), and only for a building that does nothing but research:
    // research on a production building (Isdaris Portail) waits for spare resources instead.
    const nextResearch = army.length < this.plan.wave ? undefined : (RESEARCH[p.faction] ?? []).find((t) => w.researchable(this.player, t) && !w.lacks(this.player, t) && buildings.some((b) => b.buildLeft === 0 && !(b.def as BuildingDef).trains?.length && (b.def as BuildingDef).researches?.includes(t)));
    // Research comes before the tech building it would otherwise wait for (Forge upgrades before the Créaturium).
    // Isdaris: the Psycho-assembleur comes first, its Portail upgrades only make the gateway army stronger.
    const researchReserve = techWanted && f !== FACTIONS.isdaris ? 0 : reserve;
    const unitReserve = reserve + (nextResearch ? (DEFS[nextResearch] as UpgradeDef).cost.energy : 0);
    // Isdaris: the gateways and the morphs keep the minerals of the advanced units whenever the Psycho-assembleur is
    // idle, and, once a wave is out, of the second Récepteur and of the Psycho-assembleur itself (the gateways' cheap
    // units otherwise spent every mineral: the advanced units never came and research starved of energy).
    // Also while it researches the extension that unlocks its first unit, so the unit starts the moment it can.
    const techIdle = techUp && (unlocked.length > 0 ? buildings.some((b) => b.type === f.tech && b.buildLeft === 0 && b.queue.length === 0) : !this.fielded);
    const techUnits = unlocked.length ? unlocked : techDef?.trains!.filter((t) => (DEFS[t] as UnitDef).attack) ?? [];
    const gatewaysKeep =
      f !== FACTIONS.isdaris
        ? 0
        : (techIdle ? Math.min(...techUnits.map((t) => (DEFS[t] as UnitDef).cost.minerals)) : 0) +
          (army.length < this.plan.wave ? 0 : (moreEnergy ? (DEFS[f.extractor] as BuildingDef).cost.minerals : 0) + (techWanted ? techDef!.cost.minerals : 0));
    // Z: the minerals of that next step are kept from the socles once three quarters of its energy is there (the socles
    // ate them all: the Centre d'optimisation never came, and the 500 energy kept for it piled up past 600, unspent).
    const zKeep = zTech && p.energy >= ((DEFS[zTech] as BuildingDef).cost.energy * 3) / 4 ? (DEFS[zTech] as BuildingDef).cost.minerals : 0;
    return { reserve, researchReserve, unitReserve, wantSupreme, gatewaysKeep, nextResearch, zKeep };
  }

  /** Wanted buildings: add-ons on their hosts, the rest by a builder, while the bank allows. */
  private place(ctx: Turn): void {
    const { w, f, home, builders, buildings, wants, building, outpost } = ctx;
    // A spot where one of our buildings stands was reached: it may be tried again once that building is gone.
    for (const b of buildings) this.tried.delete(spotKey(b.tx, b.ty, (b.def as BuildingDef).size));
    // Z: add-ons (Plate-forme, Tourelle) come out of a Pod with room for one (the emptiest first); without one, a Pod first.
    const hosts = buildings.filter((b) => (b.def as BuildingDef).addons && b.buildLeft === 0 && w.addonsOf(b) < BALANCE.rules.z.podAddons).sort((a, b) => w.addonsOf(a) - w.addonsOf(b) || a.id - b.id);
    for (let i = 0; i < wants.length; i++) {
      if (!(DEFS[wants[i]] as BuildingDef).addon) continue;
      const at = hosts.findIndex((b) => w.addonSpot(b, wants[i]));
      const host = at < 0 ? undefined : hosts.splice(at, 1)[0];
      const def = DEFS[wants[i]] as BuildingDef;
      if (host && ctx.minerals >= def.cost.minerals && ctx.energy >= def.cost.energy && !w.lacks(this.player, wants[i])) {
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
      // Gaïa, the Dieux's main builder, chains her buildings (a few at most) instead of placing one at a time.
      const chained = f.builder && !this.builder(crew, spot, def.size) ? crew.find((b) => b.next.length < 3) : undefined;
      const builder = this.builder(crew, spot, def.size) ?? chained;
      if (!spot || !builder) continue;
      // Not where a chained building already goes.
      const taken = builders.some((b) => [b.order, ...b.next].some((o) => o?.kind === 'build' && Math.abs(o.tx - spot[0]) < def.size + 3 && Math.abs(o.ty - spot[1]) < def.size + 3));
      if (taken) continue;
      ctx.out.push({ player: this.player, kind: 'build', ids: [builder.id], type, tx: spot[0], ty: spot[1], queue: !!chained });
      const k = spotKey(spot[0], spot[1], def.size);
      this.tried.set(k, (this.tried.get(k) ?? 0) + 1);
      ctx.minerals -= def.cost.minerals;
      ctx.energy -= def.cost.energy;
    }
  }

  /** Workers, research and Isdaris extensions. */
  private research(ctx: Turn): void {
    const { w, f, p, mine, serfs, buildings, minute, wants, techUp, unlocked, nextExtension, saving, reserve, researchReserve, wantSupreme } = ctx;
    // Serfs, then soldiers.
    const serfTarget = this.serfTarget(ctx);
    const workerHome = this.workerHome(ctx);
    // At its own price (a Dieux esprit costs 75: with 85 minerals left and no esprit, they never made one again).
    const workerCost = (DEFS[f.worker] as UnitDef).cost.minerals;
    // Low on workers, one comes even while supply is wanted (it costs one).
    if (workerHome && serfs.length < serfTarget && ctx.minerals + ctx.low >= workerCost && (ctx.low || !wants.includes(f.supply))) {
      ctx.out.push({ player: this.player, kind: 'train', ids: [workerHome.id], type: f.worker });
      ctx.minerals += ctx.low - workerCost;
      ctx.low = 0;
    } else if (f === FACTIONS.z && minute > 8 && workerHome && ctx.minerals >= 150 && ctx.energy >= 75 + reserve && !mine.some((u) => u.type === 'zespion') && !w.lacks(this.player, 'zespion') && !(wantSupreme && p.energy >= 300)) {
      // One Espion (Z.doc): it detects, and goes along with the waves.
      ctx.out.push({ player: this.player, kind: 'train', ids: [workerHome.id], type: 'zespion' });
      ctx.minerals -= 150;
      ctx.energy -= 75;
    }
    // Research in priority order on idle buildings; production buildings only with minerals to spare.
    const researching = new Set<number>();
    const listed = RESEARCH[p.faction] ?? [];
    for (const t of this.easy ? [] : [...listed, ...(minute >= 10 ? LATE[p.faction] : [])]) {
      if (saving || !w.researchable(this.player, t) || w.lacks(this.player, t)) continue;
      // Z: Attaque de proximité only serves the flame thrower; the socles' tiers wait for the first weapon.
      if (t.startsWith('zproxi') && !w.level(this.player, 'lanceflammes')) continue;
      if ((DEFS[t] as UpgradeDef).level > 1 && /^r(quadripode|hexapode|coleoptere)$/.test((DEFS[t] as UpgradeDef).line) && !w.level(this.player, 'lanceroquettes')) continue;
      const host = buildings.find((b) => !researching.has(b.id) && b.buildLeft === 0 && b.queue.length === 0 && (b.def as BuildingDef).researches?.includes(t));
      const cost = (DEFS[t] as UpgradeDef).cost;
      // The researches off the list only with resources to spare, after the units' energy.
      const spare = listed.includes(t) ? 0 : 200;
      if (!host || ctx.minerals < cost.minerals + spare + ((host.def as BuildingDef).trains?.length ? 300 : 0) || ctx.energy - (spare ? ctx.unitReserve + 100 : researchReserve) < cost.energy) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: t });
      researching.add(host.id);
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
    }
    // Isdaris extensions (notice), in order, on the building that hosts each.
    // The extension that unlocks the first tech unit does not wait for the expansion's savings (they held it three minutes).
    if (nextExtension && (!saving || (techUp && !unlocked.length)) && !this.easy) {
      const host = buildings.find((b) => (b.def as BuildingDef).researches?.includes(nextExtension) && b.buildLeft === 0 && b.queue.length === 0);
      const cost = (DEFS[nextExtension] as UpgradeDef).cost;
      if (host && ctx.minerals >= cost.minerals && ctx.energy >= cost.energy) {
        ctx.out.push({ player: this.player, kind: 'train', ids: [host.id], type: nextExtension });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
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
    if (market && ctx.minerals > 500 && ctx.energy < unitReserve + 100) ctx.out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'minerals' });
    else if (market && ctx.energy > 250 && ctx.minerals < 150) ctx.out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'energy' });
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
    const { w, f, mine, army, buildings, free, rally, firstTech, saving, reserve, researchReserve, unitReserve, zKeep, gatewaysKeep, nextResearch } = ctx;
    // Its energy at hand, the next research also keeps its minerals from the units.
    const researchCost = nextResearch && (DEFS[nextResearch] as UpgradeDef).cost;
    ctx.keep = researchCost && ctx.energy - researchReserve >= researchCost.energy ? researchCost.minerals : 0;
    // Heavier units from the other production buildings, one at a time, when affordable; a few of each support kind.
    for (const t of buildings.filter((b) => !kin(b, f.barracks) && !kin(b, f.hq) && b.buildLeft === 0 && b.queue.length === 0 && (b.def as BuildingDef).trains?.length)) {
      // The kind it has fewest of that it can pay for (Discobole and Chimère take turns; an Ankylosaure it could not pay
      // held the Créaturium to one Plésiosaure); against flyers, only what can shoot them. One of each unarmed unit
      // (Scarabée, Isdaris Espion and Voyageur).
      const own = (u: string) => mine.filter((o) => o.type === u).length;
      const trains = ((t.def as BuildingDef).trains ?? []).filter((u) => !w.lacks(this.player, u) && ((DEFS[u] as UnitDef).attack || own(u) === 0) && (t.type === f.tech || own(u) < 3));
      const antiAirTrains = trains.filter((u) => (DEFS[u] as UnitDef).attack && reaches((DEFS[u] as UnitDef).attack!, true));
      const type = (this.enemyAir && antiAirTrains.length ? antiAirTrains : trains)
        .slice()
        .sort((a, b) => own(a) - own(b))
        .find((u) => ctx.minerals - ctx.keep >= (DEFS[u] as UnitDef).cost.minerals && ctx.energy >= (DEFS[u] as UnitDef).cost.energy);
      const def = type && (DEFS[type] as UnitDef);
      if (!def || (saving && !(firstTech && t.type === f.tech)) || free - ctx.out.filter((o) => o.kind === 'train').length < def.supply) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [t.id], type });
      ctx.minerals -= def.cost.minerals;
      ctx.energy -= def.cost.energy;
    }
    for (const c of buildings.filter((b) => !f.gods && kin(b, f.barracks) && b.buildLeft === 0)) {
      if (!c.rally) ctx.out.push({ player: this.player, kind: 'smart', ids: [c.id], x: rally.x, y: rally.y });
      if (saving || c.queue.length > (this.easy ? 0 : 1) || free - ctx.out.filter((o) => o.kind === 'train').length <= 0) continue;
      const type = this.nextUnit(Math.max(0, ctx.energy - unitReserve), army, ctx.minerals);
      const def = DEFS[type] as UnitDef;
      // Z: the minerals of the next step of its tech are kept once its energy is there (zKeep); its energy, kept from
      // the energy-hungry socles only, never holds back one that costs none.
      if (ctx.minerals - ctx.keep - gatewaysKeep - zKeep < def.cost.minerals || ctx.energy - (def.cost.energy ? unitReserve : f === FACTIONS.isdaris || f === FACTIONS.z ? 0 : reserve) < def.cost.energy) continue;
      // Z: a socle waits until its weapon is affordable too, rather than leave with the machine gun.
      const weapon = this.weaponFor(def, ctx.energy - unitReserve);
      const cost = withKit(def, weapon);
      if (ctx.minerals - ctx.keep - gatewaysKeep < cost.minerals || ctx.energy < cost.energy) continue;
      ctx.out.push({ player: this.player, kind: 'train', ids: [c.id], type, weapon });
      ctx.minerals -= cost.minerals;
      ctx.energy -= cost.energy;
      this.trained++;
    }
  }

  /** Z: socle evolutions, building weapons, Centre K kits and Canon IEM. */
  private machines(ctx: Turn): void {
    const { w, f, mine, army, buildings, minute, enemyCloaks, unitReserve } = ctx;
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
      if (!(enemyCloaks && !has(KIT.detection) && kit('kitdetection', socles[0])) && !(!has(KIT.balise) && kit('kitbalise', socles.find((u) => u.tier > 1) ?? socles[0]))) {
        // Spare energy (nothing else takes it late on): Auto-réparateur on any socle, then Invisibilité.
        if (!kit('kitreparateur', socles.find((u) => (u.tier > 1 || ctx.energy > 600) && !(u.support & KIT.reparateur))) && ctx.energy > 600) kit('kitinvisibilite', socles.find((u) => !(u.support & KIT.invisibilite)));
      }
      if (!centrek.iemCd && w.level(this.player, 'canoniem')) {
        const prey = [...w.entities.values()].filter((t) => w.hostile(t.owner, this.player) && t.def.kind === 'unit' && (t.def as UnitDef).mechanical && !(t.def as UnitDef).unique && !t.seizedLeft && w.sees(this.player, t))
          .sort((a, b) => (DEFS[b.type] as UnitDef).cost.minerals + (DEFS[b.type] as UnitDef).cost.energy - (DEFS[a.type] as UnitDef).cost.minerals - (DEFS[a.type] as UnitDef).cost.energy || a.id - b.id)[0];
        if (prey) ctx.out.push({ player: this.player, kind: 'ability', ids: [centrek.id], name: 'canoniem', x: prey.x, y: prey.y });
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
    if (!barge && deck && minute > 14 && !w.lacks(this.player, 'barge') && !buildings.some((b) => b.queue.includes('barge')) && ctx.minerals - ctx.keep >= (DEFS.barge as UnitDef).cost.minerals + 100) {
      ctx.out.push({ player: this.player, kind: 'train', ids: [deck.id], type: 'barge' });
      ctx.minerals -= (DEFS.barge as UnitDef).cost.minerals;
    }
    if (barge) {
      this.wave.delete(barge.id);
      const aboard = mine.filter((u) => u.inside === barge.id);
      const goal = this.enemyTarget(home);
      if (aboard.length && goal) {
        if (dist(barge.x, barge.y, goal.x, goal.y) > 7 * FP) ctx.out.push({ player: this.player, kind: 'move', ids: [barge.id], x: goal.x, y: goal.y });
        else ctx.out.push({ player: this.player, kind: 'unload', ids: [barge.id] });
      } else if (dist(barge.x, barge.y, rally.x, rally.y) > 5 * FP) {
        if (barge.order?.kind !== 'move') ctx.out.push({ player: this.player, kind: 'move', ids: [barge.id], x: rally.x, y: rally.y });
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

  /** Dieux: gods, their troops, levels and artefacts. */
  private summon(ctx: Turn): void {
    const { w, f, mine, home, gods, buildings, minute, free, saving, reserve, unitReserve } = ctx;
    // Dieux: the Porte summons the next god when its time has come; each god summons its troops, when affordable.
    if (f.gods && !saving) {
      const next = GODS.find(([g, from]) => minute >= from && !mine.some((e) => e.type === g) && !buildings.some((b) => b.queue.includes(g)));
      const def = next && (DEFS[next[0]] as UnitDef);
      if (next && def && !w.lacks(this.player, next[0]) && home.queue.length === 0) {
        if (ctx.minerals >= def.cost.minerals && ctx.energy >= def.cost.energy && free - ctx.out.filter((o) => o.kind === 'train').length >= def.supply) {
          ctx.out.push({ player: this.player, kind: 'train', ids: [home.id], type: next[0] });
          ctx.minerals -= def.cost.minerals;
          ctx.energy -= def.cost.energy;
        }
        // Saving up for it, once the first god is out.
        else if (gods.length) ctx.minerals -= def.cost.minerals;
      }
      for (const g of gods) {
        if (g.queue.length > (this.easy ? 0 : 1)) continue;
        // The god's troop the army lacks most against its share (ai.army.dieux); a type without a share, never.
        const share = BALANCE.ai.army.dieux as Record<string, number>;
        const have = (t: string) => mine.filter((e) => e.type === t).length + gods.reduce((n, o) => n + o.queue.filter((q) => q === t).length, 0);
        const type = (g.def as UnitDef).trains!.filter((t) => !w.lacks(this.player, t) && share[t]).sort((a, b) => have(a) / share[a] - have(b) / share[b] || a.localeCompare(b))[0];
        const def = type && (DEFS[type] as UnitDef);
        if (!def || free - ctx.out.filter((o) => o.kind === 'train').length < def.supply) continue;
        if (ctx.minerals - ctx.keep < def.cost.minerals || ctx.energy - (def.cost.energy ? unitReserve : reserve) < def.cost.energy) continue;
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
      const allGods = GODS.every(([t]) => (DEFS[t] as UnitDef).requiresAny || gods.some((e) => e.type === t)) || minute >= 12;
      for (const g of allGods ? gods.filter((e) => (e.def as UnitDef).levels && e.queue.length <= 2 && !e.queue.includes('niveau')) : []) {
        const lv = (g.def as UnitDef).levels!;
        const cost = g.lvl < lv.hp.length ? lv.cost[g.lvl - 1] : undefined;
        if (!cost || ctx.minerals - ctx.keep - BALANCE.ai.godLevelMargin < cost.minerals || ctx.energy - reserve < cost.energy) continue;
        ctx.out.push({ player: this.player, kind: 'train', ids: [g.id], type: 'niveau' });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
      }
      // With an Artefacterie and resources to spare: Force, Résistance, Force, Vitesse for each god in turn.
      const arte = buildings.some((b) => b.type === 'artefacterie' && b.buildLeft === 0);
      for (const g of arte ? gods.filter((e) => this.world.artefacts(e) < BALANCE.rules.upgrades.artefacts.max && e.queue.length <= 2) : []) {
        const t = ['artforce', 'artresistance', 'artforce', 'artvitesse'][this.world.artefacts(g)];
        const cost = (DEFS[t] as UpgradeDef).cost;
        if (ctx.minerals - ctx.keep - BALANCE.ai.godLevelMargin < cost.minerals || ctx.energy - reserve < cost.energy) break;
        ctx.out.push({ player: this.player, kind: 'train', ids: [g.id], type: t });
        ctx.minerals -= cost.minerals;
        ctx.energy -= cost.energy;
      }
    }
  }

  /** Defend the base, otherwise send a new wave. */
  private muster(ctx: Turn): void {
    const { w, home, serfs, gods, army, buildings, supply, minute, mine } = ctx;
    // Defend the base, otherwise attack in waves; reinforcements wait at the rally point.
    // Dead or being recalled (Rappel): out of the wave.
    for (const id of this.wave) if (!w.entities.get(id) || w.entities.get(id)!.held) this.wave.delete(id);
    let atHome = army.filter((u) => !this.wave.has(u.id));
    // Our base first; else a teammate's base under attack, which the army at home goes to help.
    const allied = [...w.entities.values()].filter((b) => b.def.kind === 'building' && b.owner !== this.player && b.owner >= 0 && !w.hostile(b.owner, this.player));
    const threat = this.threat(buildings) ?? (allied.length ? this.threat(allied) : undefined);
    this.danger = threat && army.filter((u) => !this.wave.has(u.id)).reduce((s, u) => s + u.hp + u.shield, 0) < threat.strength ? threat : undefined;
    const shelters = buildings.filter((b) => b.buildLeft === 0 && (b.def as BuildingDef).dropoff && (b.def as BuildingDef).bunker);
    // The danger gone, the sheltered drones come out (back to work as idle workers).
    if (!threat) for (const b of shelters) if (mine.some((u) => u.inside === b.id)) ctx.out.push({ player: this.player, kind: 'unload', ids: [b.id] });
    if (threat) {
      const near = (u: Entity) => dist(u.x, u.y, threat.x, threat.y) < 12 * FP;
      // Outnumbered at home: the wave comes back, unless it is already fighting next to the threat.
      const strength = (us: Entity[]) => us.reduce((s, u) => s + u.hp + u.shield, 0);
      if (strength(atHome) < threat.strength && this.wave.size) {
        for (const id of this.wave) {
          const u = w.entities.get(id)!;
          if (!near(u)) this.wave.delete(id);
        }
        atHome = army.filter((u) => !this.wave.has(u.id));
      }
      // Every defender not already fighting near the threat goes there.
      const ids = atHome
        .filter((u) => {
          const o = u.order;
          if (!o || o.kind === 'move') return true;
          if (o.kind !== 'attack' && o.kind !== 'attackMove') return false;
          // Already heading there, or fighting there: leave it be (a new order would reset its fight).
          const target = w.entities.get(o.target);
          if (target) return !near(target);
          return o.kind === 'attackMove' && dist(o.x, o.y, threat.x, threat.y) > 12 * FP;
        })
        .map((u) => u.id);
      if (ids.length) ctx.out.push({ player: this.player, kind: 'attack', ids, x: threat.x, y: threat.y });
      // No soldiers to speak of against a small raid: the workers next to it fight.
      if (threat.strength > 1 && strength(atHome) < threat.strength / 2 && threat.count <= 4) {
        const pulled = serfs.filter((s) => near(s) && s.order?.kind !== 'build' && s.order?.kind !== 'construct' && s.order?.kind !== 'attack');
        if (pulled.length) ctx.out.push({ player: this.player, kind: 'smart', ids: pulled.map((s) => s.id), x: threat.x, y: threat.y, target: threat.target });
      }
      // Z Refuge: against more than the drones could hold off, they shelter in the Intelligence near the threat.
      // Otherwise (a smaller raid, or one elsewhere) they come out and go back to work.
      const danger = !this.easy && strength(atHome) < threat.strength / 2 && threat.count > 4;
      for (const b of shelters) {
        if (danger && near(b)) ctx.out.push({ player: this.player, kind: 'ability', ids: [b.id], name: 'refuge' });
        else if (mine.some((u) => u.inside === b.id)) ctx.out.push({ player: this.player, kind: 'unload', ids: [b.id] });
      }
    } else if ((!this.easy || minute >= LEVELS.easy.attackMinute) && (atHome.length >= Math.min(this.easy ? LEVELS.easy.maxWave : MAX_WAVE, this.plan.wave + this.waves * this.plan.waveGrowth) || (atHome.length >= 6 && supply.used >= 190) || ((atHome.length > 0 || gods.length > 0) && this.starved(buildings, ctx.p.minerals)) || (minute >= 10 && (atHome.length >= this.plan.wave || this.waves > 0) && this.dominates(atHome)))) {
      // Reinforcements for a wave already out join it: the shared road's middle is for a new wave only (set again for
      // one soldier joining, it turned the front back to it).
      const fresh = this.wave.size === 0;
      const before = this.wave.size;
      // Easy: never more than its wave cap out at once, gods included, those already out counted, the rest stays home.
      const cap = this.easy ? LEVELS.easy.maxWave : Infinity;
      for (const u of atHome) if (this.wave.size < cap) this.wave.add(u.id);
      // Dieux: the gods of the second and third ranks go with it (their auras, heals and spells are for the front);
      // the first rank stays home and summons.
      // Once no income is left, every god goes: nothing is left to summon with, and gods alone never made a wave.
      const dry = this.starved(buildings, ctx.p.minerals);
      for (const g of gods) if ((dry || ((g.def as UnitDef).requiresAny && g.hp * 2 > g.maxHp)) && (this.wave.has(g.id) || this.wave.size < cap)) this.wave.add(g.id);
      // Nobody left (the easy cap full): no wave.
      if (this.wave.size > before) {
        // A wave, not a reinforcement: the next wave's size grows with each wave sent (a soldier joining the one out, as
        // after f8c4786, took the next threshold from 12 to 18).
        if (fresh || atHome.length >= this.plan.wave) this.waves++;
        if (fresh) this.via = this.sharedRoad(home);
      }
    }
  }

  /** Abilities: the simple ones, tactics, Observation céleste, Rappel. */
  private cast(ctx: Turn): void {
    const { w, p, mine, home, gods, army, buildings } = ctx;
    // Abilities: stimulant and charge when engaging, Peau de roc while healing in a fight.
    const casters = army.filter((u) => {
      const ab = (u.def as UnitDef).ability;
      if (!ab || !w.ready(u, ab) || !SIMPLE.includes(ab)) return false;
      if (ab === 'peauderoc') return u.order?.kind === 'heal' || this.engaged(u) !== undefined;
      const d = this.engaged(u);
      return d !== undefined && (ab === 'stimulant' ? u.hp > 50 : ab === 'transe' ? d < 2 * FP : d > 2 * FP);
    });
    if (casters.length && !this.easy) ctx.out.push({ player: this.player, kind: 'ability', ids: casters.map((u) => u.id) });
    // Dieux: an Élémentaire comes « faible et chétive » (notice): it takes its fire form at once (it hits flyers too).
    const weak = army.filter((u) => u.type === 'elembase' && w.ready(u, 'formefeu'));
    if (weak.length) ctx.out.push({ player: this.player, kind: 'ability', ids: weak.map((u) => u.id), name: 'formefeu' });
    // Gaïa too, when she is not building: her arrow.
    const gaia = this.faction.builder ? ctx.builders.filter((b) => b.type === this.faction.builder && b.order?.kind !== 'build' && b.order?.kind !== 'construct') : [];
    // Passengers of a Fortin or a Scarabée use their powers from inside too (notice).
    const aboard = mine.filter((e) => e.inside && e.def.kind === 'unit' && w.abilitiesFor(e).length && (w.entities.get(e.inside)?.def.kind === 'building' || w.entities.get(e.inside)?.type === 'scarabee'));
    if (!this.easy) ctx.out.push(...this.tactics([...army, ...gods, ...gaia, ...aboard]));
    // Dieux: two Élémentaires waiting at home fuse into a Golem, late on; apart, one walks to the other.
    const elems = army.filter((u) => abilitiesOf(u.def as UnitDef).includes('fusion') && !this.wave.has(u.id) && !u.order && u.abilityCd === 0);
    if (ctx.minute >= 15 && elems.length >= 2 && !this.easy) {
      const [a, b] = elems;
      if (dist(a.x, a.y, b.x, b.y) <= (ABILITIES.fusion.radius! + 1) * FP) ctx.out.push({ player: this.player, kind: 'ability', ids: [a.id], name: 'fusion' });
      else ctx.out.push({ player: this.player, kind: 'move', ids: [a.id], x: b.x, y: b.y });
    }
    const caster = buildings.find((b) => (b.def as BuildingDef).ability && b.buildLeft === 0 && b.abilityCd === 0);
    const ability = caster && (caster.def as BuildingDef).ability!;
    if (caster && ability === 'observation' && p.energy >= ABILITIES.observation.energy! && w.level(this.player, 'observation')) {
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
    if (caster && ability === 'rappel' && p.energy >= ABILITIES.rappel.energy!) {
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
    const ready = (b: Entity | undefined, name: string) => !!b && b.buildLeft === 0 && b.abilityCd === 0 && w.level(this.player, ABILITIES[name].research ?? '') > 0 && p.energy >= (ABILITIES[name].energy ?? 0);
    const use = (b: Entity, name: string, at: { x: number; y: number }) => out.push({ player: this.player, kind: 'ability', ids: [b.id], name, x: at.x, y: at.y });
    const orbe = buildings.find((b) => b.type === 'orbecommandement');
    const target = this.wave.size ? this.enemyTarget(home) : undefined;
    if (orbe && target && ready(orbe, 'observatoire')) use(orbe, 'observatoire', target);
    const trone = buildings.find((b) => b.type === 'trone');
    if (!trone) return out;
    // The second step of the Porte: the group still phased goes home.
    if (w.phaseGroups.some((g) => g.owner === this.player) && w.level(this.player, 'porte')) use(trone, 'transfertgroupe', home);
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
    const waiting = waveUnits.filter((u) => !kiters.has(u.id) && (!u.order || u.order.kind === 'move' || stale(u)));
    if (goal && target && waiting.length) ctx.out.push({ player: this.player, kind: 'attack', ids: waiting.map((u) => u.id), x: goal.x, y: goal.y });
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
      const a = (e.def as UnitDef | BuildingDef).attack;
      return w.hostile(e.owner, this.player) && a && !(e.def as UnitDef).worker && (e.def.kind === 'unit' || e.buildLeft === 0) && w.sees(this.player, e);
    });
  }

  private dps(e: Entity): number {
    const a = (e.def as UnitDef | BuildingDef).attack!;
    return a.damage / a.cooldown;
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
    for (const e of this.visibleFoes()) this.foes.set(e.id, [e.hp + e.shield, this.dps(e)]);
    for (const id of this.foes.keys()) if (!this.world.entities.has(id)) this.foes.delete(id);
    const known = this.power([...this.foes.values()]);
    // No enemy fighter or armed building left that we know of, after a wave: whatever is armed at home goes and
    // razes what stands (a side down to its last buildings sat there to the time limit, the winner's few soldiers
    // waiting at home for a full wave).
    // Like the wave's targets, which are every enemy building, seen or not, the enemy's soldiers are then counted
    // whether seen or not: an army out of sight never sets it off.
    // Not one at a time, though: with no wave out to join, half a wave at least (a tower never seen killed lone soldiers).
    // Fewer than a wave against enemies we know of: never.
    const armed = atHome.filter((u) => (u.def as UnitDef).attack);
    const ours = this.power(armed.map((u) => [u.hp + u.shield, this.dps(u)]));
    if (known === 0) return this.waves > 0 && (this.wave.size > 0 || armed.length * 2 >= this.plan.wave) && ours > 0 && ours >= 3 * this.power(this.enemySoldiers().map((e) => [e.hp + e.shield, this.dps(e)]));
    return atHome.length >= this.plan.wave && ours >= 3 * known;
  }

  private outmatched(wave: Entity[]): Entity[] {
    const foes = this.visibleFoes();
    const power = (group: Entity[]) => this.power(group.map((e) => [e.hp + e.shield, this.dps(e)]));
    const out = new Set<Entity>();
    for (const u of wave) {
      if (out.has(u)) continue;
      const near = foes.filter((e) => dist(e.x, e.y, u.x, u.y) < 9 * FP);
      if (!near.length) continue;
      const ours = wave.filter((o) => (o.def as UnitDef).attack && dist(o.x, o.y, u.x, u.y) < 7 * FP);
      // Isdaris fall back sooner: their shields recharge out of combat, so a group pulled out early comes back whole.
      if (power(ours) * 2 < power(near)) ours.forEach((o) => out.add(o));
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
          const best = pool.map((f) => [f, around(pool, f.x, f.y, radius).length] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
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
        } else if (name === 'deflagration' || name === 'chocmental' || name === 'foudre' || name === 'flechegaia') {
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
        } else if (name === 'camouflage' || name === 'dephasage' || name === 'invistemp') {
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
        } else if (name === 'armeeenfers') {
          if (this.engaged(u) !== undefined) cmd = self(u, name);
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
          if (u.hp * 10 < u.maxHp * 7 && w.corpses.some((c) => dist(c.x, c.y, u.x, u.y) <= radius)) cmd = self(u, name);
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
    const cannotPay = [f.worker, ...f.army.map(([t]) => t)].every((t) => {
      const c = (DEFS[t] as UnitDef).cost;
      return !((p.minerals >= c.minerals && p.energy >= c.energy) || (market && p.minerals + p.energy >= c.minerals + c.energy));
    });
    const beaten =
      cannotPay &&
      !mine.some((e) => (e.def.kind === 'unit' && !(e.def as UnitDef).worker && e.type !== f.builder) || (e.def.kind !== 'resource' && e.queue.length > 0));
    const h = this.hopeless;
    if (!beaten) this.hopeless = null;
    else if (!h || p.minerals > h.minerals || (market && p.energy > h.energy)) this.hopeless = { since: w.tick, minerals: p.minerals, energy: p.energy };
    else if (w.tick - h.since >= ticks(60)) return true;
    return false;
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
  private weaponFor(def: UnitDef, energy: number): string | undefined {
    if (!def.weapons) return undefined;
    // The first socle once the Accumulateur is researched gets it: one at least, whatever the rotation says.
    const acc = WEAPONS.accumulateur;
    if (def.weapons.includes('accumulateur') && this.world.level(this.player, acc.research!) && ![...this.world.entities.values()].some((e) => e.owner === this.player && e.kit === 'accumulateur')) return 'accumulateur';
    const kits = Object.entries(KITS).filter(([k]) => {
      const kit = WEAPONS[k];
      return def.weapons!.includes(k) && !(kit.research && !this.world.level(this.player, kit.research)) && (!this.enemyAir || !kit.attack || reaches(kit.attack, true));
    });
    // Energy piling up: the weapons that spend it weigh three times as much.
    const weighted = kits.map(([k, wgt]): [string, number] => [k, energy >= 300 && WEAPONS[k].cost.energy > 0 ? wgt * 3 : wgt]);
    const total = weighted.reduce((n, [, wgt]) => n + wgt, 0);
    let k = this.trained % Math.max(1, total);
    return weighted.find(([, wgt]) => (k -= wgt) < 0)?.[0];
  }

  private nextUnit(energy: number, own: Entity[], minerals: number): string {
    if (this.faction !== FACTIONS.humains) {
      // Weighted rotation through the faction's army; energy-hungry units only when affordable, a few invisible ones at most.
      const cloaked = own.filter((u) => (u.def as UnitDef).cloaked).length;
      const sneak = this.faction.army.find(([t]) => (DEFS[t] as UnitDef).cloaked && (DEFS[t] as UnitDef).cost.energy <= energy && (DEFS[t] as UnitDef).cost.minerals <= minerals && !this.world.lacks(this.player, t));
      if (sneak && cloaked < MAX_CLOAKED) return sneak[0];
      // Against flying enemies, only what can shoot them.
      const affordable = this.faction.army.filter(([t]) => (DEFS[t] as UnitDef).cost.energy <= energy && !(DEFS[t] as UnitDef).cloaked && !this.world.lacks(this.player, t));
      const antiAir = affordable.filter(([t]) => reaches((DEFS[t] as UnitDef).attack!, true));
      // Each weighed by the damage it does to the enemy's army, by class (fiches 2010): an Isdaris Créature does 18
      // to infantry, 6 to Z socles, so against the Z the Archers (29 to machines) take its share.
      const army = (this.enemyAir && antiAir.length ? antiAir : affordable).map(([t, wgt]) => [t, Math.max(1, Math.round(wgt * 4 * this.fit(t)))] as [string, number]);
      // Energy piling up: spend it on the unit that needs the most, rather than on more cheap ones.
      if (energy >= 300) return army.reduce((a, b) => ((DEFS[b[0]] as UnitDef).cost.energy > (DEFS[a[0]] as UnitDef).cost.energy ? b : a))[0];
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
    if (energy >= 150 && minerals >= 225 && share('phalangiste') && !this.enemyAir && !this.world.lacks(this.player, 'phalangiste')) return 'phalangiste';
    // Belluaires (halberd riders, against infantry) once a Créaturium stands.
    if (energy >= 175 && minerals >= 200 && share('belluaire') && !this.enemyAir && !this.world.lacks(this.player, 'belluaire')) return 'belluaire';
    // Healers on schedule, or to burn spare energy, but never more than a third of the army.
    const healers = own.filter((u) => (u.def as UnitDef).heal).length;
    if (energy >= 100 && healers * 3 < own.length + 1 && (energy >= 300 || this.trained % this.plan.healerEvery === this.plan.healerEvery - 1)) return 'soigneur';
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
    const { f, p, mine, home, buildings, free, wantSupreme } = ctx;
    const council = buildings.filter((b) => kin(b, f.hq) && b.buildLeft === 0).sort((a, b) => a.queue.length - b.queue.length)[0] ?? home;
    const at = f.workerFrom ? mine.find((e) => e.type === f.workerFrom) : council;
    if (!at || at.queue.length || home.buildLeft || free <= 0 || (wantSupreme && p.energy >= 300 && at.type === f.hq)) return undefined;
    return at;
  }

  /** Workers wanted: the plan's number per headquarters, up to three. */
  private serfTarget(ctx: Survey): number {
    return this.plan.serfs * Math.min(3, ctx.buildings.filter((b) => kin(b, this.faction.hq) && b.buildLeft === 0).length);
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
  private builder(serfs: Entity[], spot: [number, number] | null, size: number): Entity | undefined {
    if (!spot) return undefined;
    // From the site's middle, not its top-left tile: the same worker from every corner.
    const x = spot[0] * FP + (size * FP) / 2;
    const y = spot[1] * FP + (size * FP) / 2;
    return serfs
      .filter((s) => s.order?.kind !== 'build' && s.order?.kind !== 'construct' && s.carry === 0)
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
      const bases = [...w.entities.values()].filter((b) => b.owner === this.player && kin(b, this.faction.hq) && b.buildLeft === 0);
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
      const inset = Math.floor(((DEFS[this.faction.hq] as BuildingDef).size - def.size) / 2);
      const site = expansions(w, this.player).map(([tx, ty]): [number, number] => [tx + inset, ty + inset]);
      return site.find(([tx, ty]) => w.canPlace(type, tx, ty, this.player) && this.fresh(tx, ty, def.size) && this.walkable(home, tx + Math.floor(def.size / 2), ty + Math.floor(def.size / 2))) ?? null;
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
          if (def.power && !def.morphOnly && first === undefined && this.walkable(home, ax, ay)) first = [tx, ty];
          if (def.power && this.crowdsField(tx + def.size / 2, ty + def.size / 2, def.power)) continue;
          if (!this.walkable(home, ax, ay)) continue;
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
    return this.mapDry() || (this.fieldsNear(buildings) === 0 && minerals < (DEFS[this.faction.outpost ?? this.faction.hq] as BuildingDef).cost.minerals);
  }

  /** Mineral fields left within reach of any of our finished headquarters. */
  private fieldsNear(buildings: Entity[]): number {
    const hqs = buildings.filter((b) => kin(b, this.faction.hq) && b.buildLeft === 0);
    return [...this.world.entities.values()].filter((e) => e.type === 'minerai' && hqs.some((h) => dist(e.x, e.y, h.x, h.y) < 12 * FP)).length;
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

  private threat(buildings: Entity[]): { x: number; y: number; target: number; count: number; strength: number } | undefined {
    const w = this.world;
    const foes: Entity[] = [];
    for (const e of w.entities.values()) {
      if (!w.hostile(e.owner, this.player) || e.def.kind !== 'unit' || !w.sees(this.player, e)) continue;
      const reach = Math.max(DEFEND_RADIUS / 2, ((e.def as UnitDef).attack?.range ?? 0) * FP + 3 * FP);
      if (buildings.some((b) => dist(e.x, e.y, b.x, b.y) < reach + ((b.def as BuildingDef).size * FP) / 2)) foes.push(e);
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
    const guard = known.filter((e) => (e.def as UnitDef | BuildingDef).attack && !(e.def as UnitDef).worker);
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
