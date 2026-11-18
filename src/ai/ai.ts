import { ABILITIES, abilitiesOf, spell, KIT, type BuildingDef, DEFS, FACTIONS, RAPPEL, reaches, type FactionDef, type UnitDef, type UpgradeDef, WEAPONS, withKit } from '../data';
import BALANCE from '../balance.json';
import { FP, dist, ticks } from '../sim/fixed';
import { expansions } from '../sim/setup';
import { type Command, type Entity, type World, flies } from '../sim/world';

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
const DEFEND_RADIUS = 14 * FP;
/** A wave on its way to the shared road's middle goes on to its target once its front is this close to it. */
const VIA_REACHED = 6 * FP;
/** Seconds after which a wave stops making for the shared road's middle. */
const VIA_TIMEOUT = 60;
/** Tiles from the shared road's middle within which the road found the other way round counts as the same road. */
const VIA_SAME_ROAD = 8;
const MAX_WAVE = BALANCE.ai.maxWave;
/** Researches in priority order, by faction; any building that hosts one researches it when idle. */
const RESEARCH = BALANCE.ai.research as Record<string, string[]>;
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

/** Abilities the AI uses with the plain rule above (on engaging); the others go through tactics(). */
const SIMPLE = ['stimulant', 'charge', 'peauderoc'];
/** Area abilities aimed at enemy crowds: least enemies under the blast. */
const CROWD: Record<string, number> = { explosiftoxique: 3, napalm: 3, silence: 2, pluiedefeu: 3, tempete: 2 };
/** Dieux: the gods the Porte d'Asgaard summons, and from which minute (one at a time, in this order). */
const GODS = BALANCE.ai.gods as [string, number][];

/** A computer player. It only acts through commands, like a human. */
export class AI {
  private waves = 0;
  private trained = 0;
  /** The tech building has fielded a unit of its own once (the first one comes before anything else it holds up). */
  private fielded = false;
  /** Most enemy flying units seen at once: calls for anti-air. */
  private enemyAir = 0;
  /** Soldiers sent in the current attack wave. */
  private wave = new Set<number>();
  /**
   * Where a new wave goes first: the middle of the road between our headquarters and the enemy's, the road always
   * found from the lower seat to the higher. Each army taking the road its own pathfinding gives it, two armies on
   * a map turned 180° with two equal roads (L'Anneau, round its chasm) took one road each, passed without meeting,
   * and the side whose base was hit first called its wave back, to be beaten piecemeal at home.
   */
  private via: { x: number; y: number; until: number } | null = null;
  /** Build orders given per spot ("tx,ty"); a spot tried MAX_TRIES times with nothing built there is given up. */
  private tried = new Map<string, number>();

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
    this.hard = level === 'hard';
  }

  think(): Command[] {
    const w = this.world;
    if (w.tick % THINK_EVERY !== this.player || w.winner !== null) return [];
    const out: Command[] = [];
    const f = this.faction;
    const mine = [...w.entities.values()].filter((e) => e.owner === this.player);
    const home = mine.find((e) => e.type === f.hq);
    if (!home) return this.lastStand(mine);
    const serfs = mine.filter((e) => e.type === f.worker);
    // Dieux: Gaïa places the buildings, and the gods (production) stay home, out of the army.
    const builders = f.builder ? mine.filter((e) => e.type === f.builder) : serfs;
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

    // Idle serfs go mining.
    for (const s of serfs) {
      if (s.order) continue;
      const f = this.nearest(s, (e) => e.type === 'minerai');
      if (f) out.push({ player: this.player, kind: 'smart', ids: [s.id], x: f.x, y: f.y, target: f.id });
    }

    // Abandoned construction sites (builder killed) get a new serf. Warped buildings build themselves.
    for (const site of buildings.filter((b) => b.buildLeft > 0 && !(b.def as BuildingDef).warp && !(b.def as BuildingDef).absorbs)) {
      if (serfs.some((s) => s.order?.kind === 'construct' && s.order.target === site.id)) continue;
      const s = this.builder(serfs, [site.tx, site.ty]);
      if (s) out.push({ player: this.player, kind: 'smart', ids: [s.id], x: site.x, y: site.y, target: site.id });
    }

    // Supply first, then production buildings, then the mine.
    const building = (type: string) => builders.some((s) => [s.order, ...s.next].some((o) => o?.kind === 'build' && o.type === type)) || builders.some((s) => s.order?.kind === 'build' && s.order.type === type) || buildings.some((b) => b.type === type && b.buildLeft > 0);
    const wants: string[] = [];
    // Production: the casernes, or for the Dieux the Porte and its gods.
    const producers = f.gods ? 1 + gods.length : count(f.barracks);
    if (supply.max < 200 && supply.max - supply.used <= 2 + producers * 2 && !building(f.supply)) wants.push(f.supply);
    // Isdaris: an extra emitter whenever production grows, to widen the power field.
    if (f.pylon && count(f.pylon) < 1 + Math.floor(count(f.barracks) / 2) && !building(f.pylon)) wants.push(f.pylon);
    // One extractor per base: the main's well, then the expansion's (energy is the Isdaris bottleneck).
    const bases = buildings.filter((b) => b.type === f.hq && b.buildLeft === 0).length;
    const firstExtractor = count(f.extractor) === 0;
    if (producers >= this.plan.mineAfter && firstExtractor && !building(f.extractor)) wants.push(f.extractor);
    // The second one, later and only with a free well by a base: never ahead of supply or production, except for the
    // Isdaris, whose research and advanced units starve without it.
    const moreEnergy = !firstExtractor && count(f.extractor) < bases && !building(f.extractor) && !!this.spot(f.extractor, home);
    if (moreEnergy && (f === FACTIONS.isdaris || f.gods)) wants.push(f.extractor);
    let casernesWanted = this.plan.casernes.filter(([at]) => serfs.length >= at).reduce((m, [, n]) => Math.max(m, n), 0);
    // Floating minerals while every caserne is busy: add production.
    const casernes = buildings.filter((b) => b.type === f.barracks);
    if (minerals > 450 && casernes.length >= casernesWanted && casernes.every((c) => c.queue.length > 0) && !building(f.barracks)) casernesWanted = Math.min(8, casernes.length + 1);
    if (!f.gods && count(f.barracks) < casernesWanted) wants.push(f.barracks);
    // Mid-game: a Forge, detection against an enemy that has invisible units, a defence or two.
    const minute = w.tick / ticks(60);
    if (f.forge && count(f.forge) === 0 && producers >= 2 && count(f.extractor) > 0 && !w.lacks(this.player, f.forge)) wants.push(f.forge);
    const enemyCloaks = w.players.some((o) => w.hostile(o.id, this.player) && FACTIONS[o.faction].army.some(([t]) => (DEFS[t] as UnitDef).cloaked));
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
    // Z: once its prerequisites stand, the energy of the next step of its tech (Intelligence suprême, Centre
    // d'optimisation, Centre K) is kept from everything else.
    const zTech = f === FACTIONS.z ? (['supreme', 'optimisation', 'centrek'] as const).find((t, i) => minute > 6 + 4 * i && !mine.some((b) => b.type === t || b.queue.includes(t)) && !builders.some((d) => d.order?.kind === 'build' && d.order.type === t)) : undefined;
    const wantSupreme = zTech === 'supreme' && !w.lacks(this.player, 'supreme');
    const reserve = zTech && !w.lacks(this.player, zTech) ? (DEFS[zTech] as BuildingDef).cost.energy : !techDef ? 0 : techUp ? (unlocked.length ? Math.min(...unlocked.map((t) => (DEFS[t] as UnitDef).cost.energy)) : 0) + (nextExtension ? (DEFS[nextExtension] as UpgradeDef).cost.energy : 0) : techWanted ? techDef.cost.energy : 0;
    // The next research in line keeps its energy from the cheaper units and morphs too (otherwise it never came),
    // once the army is a wave strong (soldiers first), and only for a building that does nothing but research:
    // research on a production building (Isdaris Portail) waits for spare resources instead.
    const nextResearch = army.length < this.plan.wave ? undefined : (RESEARCH[p.faction] ?? []).find((t) => w.researchable(this.player, t) && !w.lacks(this.player, t) && buildings.some((b) => b.buildLeft === 0 && !(b.def as BuildingDef).trains?.length && (b.def as BuildingDef).researches?.includes(t)));
    // Research comes before the tech building it would otherwise wait for (Forge upgrades before the Créaturium).
    // Isdaris: the Psycho-assembleur comes first, its Portail upgrades only make the gateway army stronger.
    const researchReserve = techWanted && f !== FACTIONS.isdaris ? 0 : reserve;
    const unitReserve = reserve + (nextResearch ? (DEFS[nextResearch] as UpgradeDef).cost.energy : 0);
    let energy = p.energy - promisedEnergy;
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
    if (f.defense && count(f.defense) < defenses && !building(f.defense)) wants.push(f.defense);
    // Late buildings (Marché, Alchimisterie, Orbe de commandement), one each, once their time has come.
    // One that needs the tech building waits for its first unit (the Orbe de commandement took all the energy of the first Discobole).
    for (const [type, from] of EXTRA[p.faction] ?? []) if (minute >= from && count(type) === 0 && !w.lacks(this.player, type) && !(f.tech && (DEFS[type] as BuildingDef).requires?.[f.tech] && !this.fielded)) wants.push(type);
    // Humans: a Fortin by the rally point, manned by four soldiers kept back from the waves.
    const bunker = f.buildable.find((t) => (DEFS[t] as BuildingDef).bunker);
    if (bunker && minute > 5 && count(bunker) === 0 && count(f.barracks) >= 2 && !building(bunker)) wants.push(bunker);
    // Expand to the natural once the main is running, then to the map's next free base every few minutes, or
    // sooner when the bases run dry (as many as the map offers, up to MAX_BASES).
    const outpost = f.outpost && !(rich && p.minerals > 1600) ? f.outpost : f.hq;
    const councils = buildings.filter((b) => b.type === f.hq || b.type === f.outpost).length + builders.filter((s) => s.order?.kind === 'build' && (s.order.type === f.hq || s.order.type === f.outpost)).length;
    const firstAt = this.hard ? LEVELS.hard.expandMinute : this.easy ? LEVELS.easy.expandMinute : 7;
    const due = (rich && minute >= 4) || councils < 2 ? w.tick > ticks(firstAt * 60) || this.fieldsLeft(home) < 5 : minute >= firstAt + EXPAND_EVERY * (councils - 1) || this.fieldsNear(buildings) < 6;
    const expand = councils < MAX_BASES && (serfs.length >= this.plan.serfs || rich) && due && !!this.spot(outpost, home);
    if (expand) wants.push(outpost);
    // Save up for the expansion once the base is defended.
    const saving = expand && army.filter((u) => !this.wave.has(u.id)).length >= 8 && minerals < 1000;
    if (moreEnergy && f !== FACTIONS.isdaris && minerals >= (DEFS[f.extractor] as BuildingDef).cost.minerals + 200) wants.push(f.extractor);
    // A spot where one of our buildings stands was reached: it may be tried again once that building is gone.
    for (const b of buildings) this.tried.delete(`${b.tx},${b.ty}`);
    // Z: add-ons (Plate-forme, Tourelle) come out of a Pod with no add-on yet; without one, a Pod first.
    const hosts = buildings.filter((b) => (b.def as BuildingDef).addons && b.buildLeft === 0 && !buildings.some((a) => a.host === b.id));
    for (let i = 0; i < wants.length; i++) {
      if (!(DEFS[wants[i]] as BuildingDef).addon) continue;
      const host = hosts.shift();
      const def = DEFS[wants[i]] as BuildingDef;
      if (host && minerals >= def.cost.minerals && energy >= def.cost.energy && !w.lacks(this.player, wants[i])) {
        out.push({ player: this.player, kind: 'train', ids: [host.id], type: wants[i] });
        minerals -= def.cost.minerals;
        energy -= def.cost.energy;
      } else if (!host && !building(f.supply) && !wants.includes(f.supply)) wants.splice(i + 1, 0, f.supply);
    }
    for (const type of wants) {
      const def = DEFS[type] as BuildingDef;
      if (def.addon) continue;
      if (minerals < def.cost.minerals) {
        if (type === outpost) continue;
        break; // save up for the most urgent one
      }
      if (energy < def.cost.energy) continue;
      const spot = this.spot(type, home, (DEFS[type] as BuildingDef).bunker ? this.rallyPoint(home) : undefined);
      // Gaïa, the Dieux's only builder, chains her buildings (a few at most) instead of placing one at a time.
      const chained = f.builder && !this.builder(builders, spot) ? builders.find((b) => b.next.length < 3) : undefined;
      const builder = this.builder(builders, spot) ?? chained;
      if (!spot || !builder) continue;
      // Not where a chained building already goes.
      const taken = builders.some((b) => [b.order, ...b.next].some((o) => o?.kind === 'build' && Math.abs(o.tx - spot[0]) < def.size + 3 && Math.abs(o.ty - spot[1]) < def.size + 3));
      if (taken) continue;
      out.push({ player: this.player, kind: 'build', ids: [builder.id], type, tx: spot[0], ty: spot[1], queue: !!chained });
      this.tried.set(`${spot[0]},${spot[1]}`, (this.tried.get(`${spot[0]},${spot[1]}`) ?? 0) + 1);
      minerals -= def.cost.minerals;
      energy -= def.cost.energy;
    }

    // Serfs, then soldiers.
    const free = supply.max - supply.used;
    const serfTarget = this.plan.serfs * Math.min(3, buildings.filter((b) => b.type === f.hq && b.buildLeft === 0).length);
    const councilHome = buildings.filter((b) => b.type === f.hq && b.buildLeft === 0).sort((a, b) => a.queue.length - b.queue.length)[0] ?? home;
    const workerHome = f.workerFrom ? mine.find((e) => e.type === f.workerFrom) : councilHome;
    // Z: the Intelligence centrale turns into the Intelligence suprême only with an empty queue: no drone then.
    if (workerHome && serfs.length < serfTarget && workerHome.queue.length === 0 && home.buildLeft === 0 && minerals >= 100 && free > 0 && !wants.includes(f.supply) && !(wantSupreme && p.energy >= 300 && workerHome.type === f.hq)) {
      out.push({ player: this.player, kind: 'train', ids: [workerHome.id], type: f.worker });
      minerals -= 100;
    }
    // Research in priority order on idle buildings; production buildings only with minerals to spare.
    const researching = new Set<number>();
    for (const t of this.easy ? [] : (RESEARCH[p.faction] ?? [])) {
      if (saving || !w.researchable(this.player, t) || w.lacks(this.player, t)) continue;
      // Z: Attaque de proximité only serves the flame thrower; the socles' tiers wait for the first weapon.
      if (t.startsWith('zproxi') && !w.level(this.player, 'lanceflammes')) continue;
      if ((DEFS[t] as UpgradeDef).level > 1 && /^r(quadripode|hexapode|coleoptere)$/.test((DEFS[t] as UpgradeDef).line) && !w.level(this.player, 'lanceroquettes')) continue;
      const host = buildings.find((b) => !researching.has(b.id) && b.buildLeft === 0 && b.queue.length === 0 && (b.def as BuildingDef).researches?.includes(t));
      const cost = (DEFS[t] as UpgradeDef).cost;
      if (!host || minerals < cost.minerals + ((host.def as BuildingDef).trains?.length ? 300 : 0) || energy - researchReserve < cost.energy) continue;
      out.push({ player: this.player, kind: 'train', ids: [host.id], type: t });
      researching.add(host.id);
      minerals -= cost.minerals;
      energy -= cost.energy;
    }
    // Isdaris extensions (notice), in order, on the building that hosts each.
    // The extension that unlocks the first tech unit does not wait for the expansion's savings (they held it three minutes).
    if (nextExtension && (!saving || (techUp && !unlocked.length)) && !this.easy) {
      const host = buildings.find((b) => (b.def as BuildingDef).researches?.includes(nextExtension) && b.buildLeft === 0 && b.queue.length === 0);
      const cost = (DEFS[nextExtension] as UpgradeDef).cost;
      if (host && minerals >= cost.minerals && energy >= cost.energy) {
        out.push({ player: this.player, kind: 'train', ids: [host.id], type: nextExtension });
        minerals -= cost.minerals;
        energy -= cost.energy;
      }
    }
    // Isdaris turn buildings into defences: a Récepteur armé from mid-game, Pylônes sanglants when the tech allows.
    for (const b of buildings) {
      const into = (b.def as BuildingDef).morphs?.find((m) => {
        const d = DEFS[m] as BuildingDef;
        // The Caserne volante is a raiding tool the AI does not play: its casernes stay on the ground.
        // The Intelligence suprême comes before the energy kept for units: the Z tech waits on it.
        if (m === 'casernevolante' || b.buildLeft > 0 || b.queue.length || w.lacks(this.player, m) || minerals - gatewaysKeep < d.cost.minerals || (d.cost.energy > 0 && energy - (m === 'supreme' ? 0 : unitReserve) < d.cost.energy)) return false;
        const have = buildings.filter((o) => o.type === m || o.queue.includes(m)).length;
        // Z: the Intelligence suprême and the Pods supérieurs are where its spare energy goes (Z.doc).
        if (m === 'supreme') return have === 0 && minute > 6;
        if (m === 'podsup') return minute > 8 && have < 3;
        return d.energyRate ? minute > 6 && have === 0 : f.gods ? minute > 6 && have < 4 : minute > 9 && have < 2;
      });
      if (!into || saving) continue;
      out.push({ player: this.player, kind: 'train', ids: [b.id], type: into });
      minerals -= (DEFS[into] as BuildingDef).cost.minerals;
      energy -= (DEFS[into] as BuildingDef).cost.energy;
    }
    // A Marché evens out a lopsided bank: lots of one resource, almost none of the other.
    const market = buildings.find((b) => b.type === 'marche' && b.buildLeft === 0);
    // Minerals piling up while energy holds back the tech (the reserve and the next research): buy energy.
    if (market && minerals > 500 && energy < unitReserve + 100) out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'minerals' });
    else if (market && energy > 250 && minerals < 150) out.push({ player: this.player, kind: 'trade', ids: [market.id], sell: 'energy' });
    // Man the Fortins with soldiers waiting at home.
    for (const b of buildings.filter((o) => (o.def as BuildingDef).bunker && o.buildLeft === 0)) {
      const room = (b.def as BuildingDef).bunker! - mine.filter((u) => u.inside === b.id || (u.order?.kind === 'enter' && u.order.target === b.id)).length;
      const crew = army.filter((u) => !this.wave.has(u.id) && (u.def as UnitDef).attack && (u.def as UnitDef).attack!.range > 1 && u.order?.kind !== 'enter').slice(0, Math.max(0, room));
      if (crew.length) out.push({ player: this.player, kind: 'smart', ids: crew.map((u) => u.id), x: b.x, y: b.y, target: b.id });
    }
    // Its energy at hand, the next research also keeps its minerals from the units.
    const researchCost = nextResearch && (DEFS[nextResearch] as UpgradeDef).cost;
    const keep = researchCost && energy - researchReserve >= researchCost.energy ? researchCost.minerals : 0;
    // Heavier units from the other production buildings, one at a time, when affordable; a few of each support kind.
    for (const t of buildings.filter((b) => b.type !== f.barracks && b.type !== f.hq && b.buildLeft === 0 && b.queue.length === 0 && (b.def as BuildingDef).trains?.length)) {
      // The kind it has fewest of (Discobole and Chimère take turns); against flyers, only what can shoot them.
      const trains = ((t.def as BuildingDef).trains ?? []).filter((u) => !w.lacks(this.player, u) && (DEFS[u] as UnitDef).attack && (t.type === f.tech || mine.filter((o) => o.type === u).length < 3));
      const antiAirTrains = trains.filter((u) => reaches((DEFS[u] as UnitDef).attack!, true));
      const type = (this.enemyAir && antiAirTrains.length ? antiAirTrains : trains).slice().sort((a, b) => mine.filter((u) => u.type === a).length - mine.filter((u) => u.type === b).length)[0];
      const def = type && (DEFS[type] as UnitDef);
      if (!def || (saving && !(firstTech && t.type === f.tech)) || free - out.filter((o) => o.kind === 'train').length < def.supply) continue;
      if (minerals - keep < def.cost.minerals || energy < def.cost.energy) continue;
      out.push({ player: this.player, kind: 'train', ids: [t.id], type });
      minerals -= def.cost.minerals;
      energy -= def.cost.energy;
    }
    const rally = this.rallyPoint(home);
    for (const c of buildings.filter((b) => !f.gods && b.type === f.barracks && b.buildLeft === 0)) {
      if (!c.rally) out.push({ player: this.player, kind: 'smart', ids: [c.id], x: rally.x, y: rally.y });
      if (saving || c.queue.length > (this.easy ? 0 : 1) || free - out.filter((o) => o.kind === 'train').length <= 0) continue;
      const type = this.nextUnit(Math.max(0, energy - unitReserve), army, minerals);
      const def = DEFS[type] as UnitDef;
      // Z: the minerals of the Intelligence suprême are kept once its energy is there (the units ate them all).
      const supreme = wantSupreme && p.energy >= 300 ? 300 : 0;
      if (minerals - keep - gatewaysKeep - supreme < def.cost.minerals || energy - (def.cost.energy ? unitReserve : f === FACTIONS.isdaris ? 0 : reserve) < def.cost.energy) continue;
      // Z: a socle waits until its weapon is affordable too, rather than leave with the machine gun.
      const weapon = this.weaponFor(def, energy - unitReserve);
      const cost = withKit(def, weapon);
      if (minerals - keep - gatewaysKeep < cost.minerals || energy < cost.energy) continue;
      out.push({ player: this.player, kind: 'train', ids: [c.id], type, weapon });
      minerals -= cost.minerals;
      energy -= cost.energy;
      this.trained++;
    }

    // Z: socles resting at home evolve into their next tier once it is researched (Z.doc), when affordable.
    for (const u of army) {
      const next = w.nextTier(u);
      if (!next || u.evolving || this.wave.has(u.id) || (u.order && u.order.kind !== 'move') || w.level(this.player, `r${u.type}`) <= u.tier) continue;
      if (minerals - keep < next.cost.minerals || energy - unitReserve < next.cost.energy) continue;
      out.push({ player: this.player, kind: 'evolve', ids: [u.id] });
      minerals -= next.cost.minerals;
      energy -= next.cost.energy;
    }

    // Z: Tourelles, then from 10 min Assimilateurs, get a weapon of their own (Laser, rockets against flyers).
    for (const b of buildings) {
      const allowed = (b.def as BuildingDef).weapons;
      if (!allowed || b.kit || b.buildLeft > 0 || (b.type === f.extractor && minute < 10)) continue;
      const k = (this.enemyAir ? ['roquettes', 'laser'] : ['laser', 'roquettes']).find((o) => allowed.includes(o) && !(WEAPONS[o].research && !w.level(this.player, WEAPONS[o].research!)));
      const cost = k && WEAPONS[k].cost;
      if (!cost || minerals - keep < cost.minerals + 100 || energy - unitReserve < cost.energy) continue;
      out.push({ player: this.player, kind: 'arm', ids: [b.id], weapon: k });
      minerals -= cost.minerals;
      energy -= cost.energy;
    }

    // Z Centre K: kits on socles of the army (Détection against invisible enemies, Auto-réparateur on evolved socles,
    // one Balise offensive), and the Canon IEM at the costliest enemy machine in sight.
    const centrek = buildings.find((b) => b.type === 'centrek' && b.buildLeft === 0);
    if (centrek) {
      const socles = army.filter((u) => (u.def as UnitDef).weaponLevel && u.hp > 0);
      const kit = (name: string, who: Entity | undefined) => {
        const ab = ABILITIES[name];
        if (!who || centrek.abilityCd || minerals - keep < (ab.minerals ?? 0) || energy - unitReserve < (ab.energy ?? 0)) return false;
        out.push({ player: this.player, kind: 'ability', ids: [centrek.id], name, x: who.x, y: who.y });
        minerals -= ab.minerals ?? 0;
        energy -= ab.energy ?? 0;
        return true;
      };
      const has = (bit: number) => mine.some((u) => u.support & bit);
      if (!(enemyCloaks && !has(KIT.detection) && kit('kitdetection', socles[0])) && !(!has(KIT.balise) && kit('kitbalise', socles.find((u) => u.tier > 1) ?? socles[0]))) {
        kit('kitreparateur', socles.find((u) => u.tier > 1 && !(u.support & KIT.reparateur)));
      }
      if (!centrek.iemCd && w.level(this.player, 'canoniem')) {
        const prey = [...w.entities.values()].filter((t) => w.hostile(t.owner, this.player) && t.def.kind === 'unit' && (t.def as UnitDef).mechanical && !(t.def as UnitDef).unique && !t.seizedLeft && w.sees(this.player, t))
          .sort((a, b) => (DEFS[b.type] as UnitDef).cost.minerals + (DEFS[b.type] as UnitDef).cost.energy - (DEFS[a.type] as UnitDef).cost.minerals - (DEFS[a.type] as UnitDef).cost.energy || a.id - b.id)[0];
        if (prey) out.push({ player: this.player, kind: 'ability', ids: [centrek.id], name: 'canoniem', x: prey.x, y: prey.y });
      }
    }

    // Dieux: the Porte summons the next god when its time has come; each god summons its troops, when affordable.
    if (f.gods && !saving) {
      const next = GODS.find(([g, from]) => minute >= from && !mine.some((e) => e.type === g) && !buildings.some((b) => b.queue.includes(g)));
      const def = next && (DEFS[next[0]] as UnitDef);
      if (next && def && !w.lacks(this.player, next[0]) && home.queue.length === 0) {
        if (minerals >= def.cost.minerals && energy >= def.cost.energy && free - out.filter((o) => o.kind === 'train').length >= def.supply) {
          out.push({ player: this.player, kind: 'train', ids: [home.id], type: next[0] });
          minerals -= def.cost.minerals;
          energy -= def.cost.energy;
        }
        // Saving up for it, once the first god is out.
        else if (gods.length) minerals -= def.cost.minerals;
      }
      for (const g of gods) {
        if (g.queue.length > (this.easy ? 0 : 1)) continue;
        // The god's troop the army lacks most against its share (ai.army.dieux); a type without a share, never.
        const share = BALANCE.ai.army.dieux as Record<string, number>;
        const have = (t: string) => mine.filter((e) => e.type === t).length + gods.reduce((n, o) => n + o.queue.filter((q) => q === t).length, 0);
        const type = (g.def as UnitDef).trains!.filter((t) => !w.lacks(this.player, t) && share[t]).sort((a, b) => have(a) / share[a] - have(b) / share[b] || a.localeCompare(b))[0];
        const def = type && (DEFS[type] as UnitDef);
        if (!def || free - out.filter((o) => o.kind === 'train').length < def.supply) continue;
        if (minerals - keep < def.cost.minerals || energy - (def.cost.energy ? unitReserve : reserve) < def.cost.energy) continue;
        out.push({ player: this.player, kind: 'train', ids: [g.id], type: type! });
        minerals -= def.cost.minerals;
        energy -= def.cost.energy;
        this.trained++;
      }
      // Minerals to spare (a margin kept for the troops), once every god is out: a god buys its next level behind
      // the summons it has queued (Thor, who always has two, never levelled otherwise).
      // Not Gaïa: her levels only speed up buildings, and measured, they ate the minerals the next gods were saved with.
      // Only once the first-rank gods are out; the minerals saved for the next god due are already set aside above.
      const allGods = GODS.every(([t]) => (DEFS[t] as UnitDef).requiresAny || gods.some((e) => e.type === t));
      for (const g of allGods ? gods.filter((e) => (e.def as UnitDef).levels && e.queue.length <= 2 && !e.queue.includes('niveau')) : []) {
        const lv = (g.def as UnitDef).levels!;
        const cost = g.lvl < lv.hp.length ? lv.cost[g.lvl - 1] : undefined;
        if (!cost || minerals - keep - BALANCE.ai.godLevelMargin < cost.minerals || energy - reserve < cost.energy) continue;
        out.push({ player: this.player, kind: 'train', ids: [g.id], type: 'niveau' });
        minerals -= cost.minerals;
        energy -= cost.energy;
      }
    }

    // Defend the base, otherwise attack in waves; reinforcements wait at the rally point.
    // Dead or being recalled (Rappel): out of the wave.
    for (const id of this.wave) if (!w.entities.get(id) || w.entities.get(id)!.held) this.wave.delete(id);
    let atHome = army.filter((u) => !this.wave.has(u.id));
    // Our base first; else a teammate's base under attack, which the army at home goes to help.
    const allied = [...w.entities.values()].filter((b) => b.def.kind === 'building' && b.owner !== this.player && b.owner >= 0 && !w.hostile(b.owner, this.player));
    const threat = this.threat(buildings) ?? (allied.length ? this.threat(allied) : undefined);
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
      if (ids.length) out.push({ player: this.player, kind: 'attack', ids, x: threat.x, y: threat.y });
      // No soldiers to speak of against a small raid: the workers next to it fight.
      if (threat.strength > 1 && strength(atHome) < threat.strength / 2 && threat.count <= 4) {
        const pulled = serfs.filter((s) => near(s) && s.order?.kind !== 'build' && s.order?.kind !== 'construct' && s.order?.kind !== 'attack');
        if (pulled.length) out.push({ player: this.player, kind: 'smart', ids: pulled.map((s) => s.id), x: threat.x, y: threat.y, target: threat.target });
      }
    } else if ((!this.easy || minute >= LEVELS.easy.attackMinute) && (atHome.length >= Math.min(this.easy ? LEVELS.easy.maxWave : MAX_WAVE, this.plan.wave + this.waves * this.plan.waveGrowth) || (atHome.length >= 6 && supply.used >= 190) || (atHome.length > 0 && this.mapDry()))) {
      // Easy: never more than its wave cap at once, the rest stays home.
      atHome.slice(0, this.easy ? LEVELS.easy.maxWave : atHome.length).forEach((u) => this.wave.add(u.id));
      this.waves++;
      this.via = this.sharedRoad(home);
    }
    // Abilities: stimulant and charge when engaging, Peau de roc while healing in a fight.
    const casters = army.filter((u) => {
      const ab = (u.def as UnitDef).ability;
      if (!ab || u.abilityCd > 0 || !SIMPLE.includes(ab)) return false;
      if (ab === 'peauderoc') return u.order?.kind === 'heal' || this.engaged(u) !== undefined;
      const d = this.engaged(u);
      return d !== undefined && (ab === 'stimulant' ? u.hp > 50 : d > 2 * FP);
    });
    if (casters.length && !this.easy) out.push({ player: this.player, kind: 'ability', ids: casters.map((u) => u.id) });
    if (!this.easy) out.push(...this.tactics([...army, ...gods]));
    const caster = buildings.find((b) => (b.def as BuildingDef).ability && b.buildLeft === 0 && b.abilityCd === 0);
    const ability = caster && (caster.def as BuildingDef).ability!;
    if (caster && ability === 'observation' && p.energy >= ABILITIES.observation.energy!) {
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
      if (ambushed) out.push({ player: this.player, kind: 'ability', ids: [caster.id], x: ambushed.x, y: ambushed.y });
    }
    if (caster && ability === 'rappel' && p.energy >= ABILITIES.rappel.energy!) {
      // Rappel a wave that is losing its fight far from home.
      const losing = this.losing([...this.wave].map((id) => w.entities.get(id)!), home);
      if (losing) {
        out.push({ player: this.player, kind: 'ability', ids: [caster.id], x: losing.x, y: losing.y });
        for (const id of this.wave) if (dist(w.entities.get(id)!.x, w.entities.get(id)!.y, losing.x, losing.y) <= RAPPEL.radius * FP) this.wave.delete(id);
      }
    }
    // A wave group that would be massacred falls back to the rally point, to join the next, bigger wave.
    const fleeing = this.easy ? [] : this.outmatched([...this.wave].map((id) => w.entities.get(id)!));
    if (fleeing.length) {
      fleeing.forEach((u) => this.wave.delete(u.id));
      const refuge = this.haven(buildings, rally) ?? rally;
      out.push({ player: this.player, kind: 'smart', ids: fleeing.map((u) => u.id), x: refuge.x, y: refuge.y });
    }

    if (!this.easy) out.push(...this.raid(raiders));
    if (this.hard) out.push(...this.focus([...this.wave].map((id) => w.entities.get(id)!)));
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
      out.push({ player: this.player, kind: 'move', ids: [u.id], x: u.x + Math.trunc(((u.x - biter.x) * 2 * FP) / d), y: u.y + Math.trunc(((u.y - biter.y) * 2 * FP) / d) });
      kiters.add(u.id);
    }
    // Supports (healers, casters, fragile artillery) keep a few tiles behind the front instead of leading the charge.
    const support = (u: Entity) => !!(u.def as UnitDef).heal || ['druide', 'alchimiste', 'cuve'].includes(u.type);
    const front = waveUnits.filter((u) => !support(u));
    if (target && front.length) {
      const cx = front.reduce((s, u) => s + u.x, 0) / front.length;
      const cy = front.reduce((s, u) => s + u.y, 0) / front.length;
      const d = dist(cx, cy, target.x, target.y) || 1;
      const back = { x: Math.trunc(cx - ((target.x - cx) * 3 * FP) / d), y: Math.trunc(cy - ((target.y - cy) * 3 * FP) / d) };
      const leading = waveUnits.filter((u) => support(u) && !kiters.has(u.id) && u.order?.kind !== 'heal' && dist(u.x, u.y, target.x, target.y) < d - 1.5 * FP);
      if (leading.length) out.push({ player: this.player, kind: 'attack', ids: leading.map((u) => u.id), x: back.x, y: back.y });
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
    if (goal && target && waiting.length) out.push({ player: this.player, kind: 'attack', ids: waiting.map((u) => u.id), x: goal.x, y: goal.y });
    return out;
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
  private outmatched(wave: Entity[]): Entity[] {
    const w = this.world;
    const foes = [...w.entities.values()].filter((e) => {
      const a = (e.def as UnitDef | BuildingDef).attack;
      return this.world.hostile(e.owner, this.player) && a && !(e.def as UnitDef).worker && (e.def.kind === 'unit' || e.buildLeft === 0) && w.sees(this.player, e);
    });
    const power = (group: Entity[]) => {
      let hp = 0;
      let dps = 0;
      for (const e of group) {
        const a = (e.def as UnitDef | BuildingDef).attack!;
        hp += e.hp + e.shield;
        dps += a.damage / a.cooldown;
      }
      return hp * dps;
    };
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
    const foes = [...w.entities.values()].filter((e) => e.def.kind === 'unit' && e.hp > 0 && !e.inside && w.hostile(e.owner, this.player) && w.sees(this.player, e));
    if (!foes.length) return [];
    const out: Command[] = [];
    const around = (group: Entity[], x: number, y: number, r: number) => group.filter((e) => dist(e.x, e.y, x, y) <= r);
    const at = (u: Entity, name: string, t: Entity): Command => ({ player: this.player, kind: 'ability', ids: [u.id], name, x: t.x, y: t.y });
    const self = (u: Entity, name: string): Command => ({ player: this.player, kind: 'ability', ids: [u.id], name });
    for (const u of army) {
      if (u.abilityCd > 0 || u.held) continue;
      const near = around(foes, u.x, u.y, 9 * FP);
      if (!near.length) continue;
      for (const name of abilitiesOf(u.def as UnitDef)) {
        const ab = spell(name, u.lvl);
        if (SIMPLE.includes(name) || (ab.research && !w.level(this.player, ab.research))) continue;
        const reach = ((ab.range ?? 0) + 1) * FP;
        const radius = (ab.radius ?? 0) * FP;
        const inReach = around(near, u.x, u.y, reach);
        const allies = around(army, u.x, u.y, reach);
        let cmd: Command | undefined;
        if (CROWD[name]) {
          // Silence only where enemy casters stand.
          const pool = name === 'silence' ? inReach.filter((f) => abilitiesOf(f.def as UnitDef).length) : inReach.filter((f) => !flies(f));
          const best = pool.map((f) => [f, around(pool, f.x, f.y, radius).length] as const).sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)[0];
          if (best && best[1] >= CROWD[name]) cmd = at(u, name, best[0]);
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
        } else if (name === 'camouflage' || name === 'dephasage') {
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
            const x = clamp(Math.trunc(u.x + ((u.x - cx) * jump) / d), w.map.width);
            const y = clamp(Math.trunc(u.y + ((u.y - cy) * jump) / d), w.map.height);
            cmd = { player: this.player, kind: 'ability', ids: [u.id], name, x, y };
          }
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
    const kits = Object.entries(BALANCE.ai.kits).filter(([k]) => {
      const kit = WEAPONS[k];
      return def.weapons!.includes(k) && !(kit.research && !this.world.level(this.player, kit.research)) && (!this.enemyAir || reaches(kit.attack, true));
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
      const army = this.enemyAir && antiAir.length ? antiAir : affordable;
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
    if (energy >= 150 && minerals >= 225 && this.trained % 5 === 2 && !this.enemyAir && !this.world.lacks(this.player, 'phalangiste')) return 'phalangiste';
    // Belluaires (halberd riders, against infantry) once a Créaturium stands, one in five.
    if (energy >= 175 && minerals >= 200 && this.trained % 5 === 4 && !this.enemyAir && !this.world.lacks(this.player, 'belluaire')) return 'belluaire';
    // Healers on schedule, or to burn spare energy, but never more than a third of the army.
    const healers = own.filter((u) => (u.def as UnitDef).heal).length;
    if (energy >= 100 && healers * 3 < own.length + 1 && (energy >= 300 || this.trained % this.plan.healerEvery === this.plan.healerEvery - 1)) return 'soigneur';
    // Deterministic mix of légionnaires among auxiliaires.
    return !this.enemyAir && (this.trained * this.plan.legionShare) % 1 >= 1 - this.plan.legionShare ? 'legionnaire' : 'auxiliaire';
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
  private builder(serfs: Entity[], spot: [number, number] | null): Entity | undefined {
    if (!spot) return undefined;
    const x = spot[0] * FP;
    const y = spot[1] * FP;
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
      const r = (b.def as BuildingDef).shieldAura;
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
      const bases = [...w.entities.values()].filter((b) => b.owner === this.player && b.type === this.faction.hq && b.buildLeft === 0);
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
    if (type === this.faction.hq || type === this.faction.outpost) return expansions(w, this.player).find(([tx, ty]) => w.canPlace(type, tx, ty, this.player) && this.fresh(tx, ty) && this.walkable(home, tx, ty)) ?? null;
    const cx = Math.floor((near ?? home).x / FP);
    const cy = Math.floor((near ?? home).y / FP);
    // Prefer the side facing the map centre, where the minerals are not.
    const sx = cx < w.map.width / 2 ? 1 : -1;
    const sy = cy < w.map.height / 2 ? 1 : -1;
    let first: [number, number] | undefined; // fallback when no spread-out spot is left
    for (let r = near ? 1 : 4; r < 14; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, r], [r, i], [i, -r], [-r, i]]) {
          const tx = cx + dx * sx - Math.floor(def.size / 2);
          const ty = cy + dy * sy - Math.floor(def.size / 2);
          // Leave a one-tile corridor around every building.
          if (!this.clear(tx - 1, ty - 1, def.size + 2) || !w.canPlace(type, tx, ty, this.player) || !this.fresh(tx, ty)) continue;
          if (this.closeToResources(tx, ty, def.size) || this.closeToRamp(tx, ty, def.size)) continue;
          // Power-field buildings spread out to cover more ground: none closer to another field than most of its radius.
          if (def.power && !def.morphOnly && first === undefined && this.walkable(home, tx, ty)) first = [tx, ty];
          if (def.power && this.crowdsField(tx + def.size / 2, ty + def.size / 2, def.power)) continue;
          if (!this.walkable(home, tx, ty)) continue;
          return [tx, ty];
        }
      }
    }
    return first ?? null;
  }

  /** Not a spot given up after MAX_TRIES build orders. */
  private fresh(tx: number, ty: number): boolean {
    return (this.tried.get(`${tx},${ty}`) ?? 0) < MAX_TRIES;
  }

  /**
   * Can workers walk from the base to this tile by a reasonable road? A spot on the low ground at the foot of the
   * base's cliff is next door as the crow flies but a long way round on foot: the worker heads for the cliff edge,
   * gets stuck there and the order fails ("Emplacement inaccessible").
   */
  private walkable(home: Entity, tx: number, ty: number): boolean {
    const g = this.world.grid;
    const [sx, sy] = g.nearestOpen(Math.floor(home.x / FP), Math.floor(home.y / FP));
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

  /** Mineral fields left within reach of any of our finished headquarters. */
  private fieldsNear(buildings: Entity[]): number {
    const hqs = buildings.filter((b) => b.type === this.faction.hq && b.buildLeft === 0);
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
      if (!w.hostile(e.owner, this.player) || e.type !== FACTIONS[w.players[e.owner].faction].hq) continue;
      if (!enemy || dist(e.x, e.y, home.x, home.y) < dist(enemy.x, enemy.y, home.x, home.y)) enemy = e;
    }
    if (!enemy) return null;
    const [a, b] = this.player < enemy.owner ? [home, enemy] : [enemy, home];
    const g = w.grid;
    const [ax, ay] = g.nearestOpen(Math.floor(a.x / FP), Math.floor(a.y / FP));
    const [bx, by] = g.nearestOpen(Math.floor(b.x / FP), Math.floor(b.y / FP));
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
      if (b.type === FACTIONS[w.players[b.owner].faction].hq) defence /= 2;
      let targeted = 0;
      for (const [t, id] of focus) if (t !== team && w.entities.get(id)?.owner === b.owner) targeted++;
      const cost = defence + dist(b.x, b.y, home.x, home.y) / 20 + targeted * GANG_UP;
      if (cost < best) [pick, best] = [b, cost];
    }
    if (pick) focus.set(team, pick.id);
    return pick;
  }
}
