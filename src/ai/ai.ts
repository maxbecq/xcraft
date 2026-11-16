import { ABILITIES, type BuildingDef, DEFS, FACTIONS, RAPPEL, type FactionDef, type UnitDef, type UpgradeDef } from '../data';
import { FP, dist, ticks } from '../sim/fixed';
import { expansion } from '../sim/setup';
import type { Command, Entity, World } from '../sim/world';

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
export const BIOBALL: Plan = {
  serfs: 16,
  casernes: [[9, 1], [12, 2], [15, 3]],
  mineAfter: 2,
  wave: 8,
  waveGrowth: 4,
  healerEvery: 4,
  legionShare: 0.3,
};

/** Difficulty: the AI plays the same plan, with a harvesting handicap (percent of minerals banked). */
export const DIFFICULTY: Record<string, number> = { easy: 70, normal: 100, hard: 130 };

const THINK_EVERY = 10; // ticks
const DEFEND_RADIUS = 14 * FP;
const MAX_WAVE = 18;
/** Forge lines in research order. */
const RESEARCH = ['ranged', 'armor', 'melee'];
const MAX_CLOAKED = 3;

/** A computer player. It only acts through commands, like a human. */
export class AI {
  private waves = 0;
  private trained = 0;
  /** Soldiers sent in the current attack wave. */
  private wave = new Set<number>();

  private readonly faction: FactionDef;

  constructor(private readonly world: World, readonly player: number, private readonly plan: Plan = BIOBALL) {
    this.faction = FACTIONS[world.players[player].faction];
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
    // Invisible units (Isdaris Assassins) do not join waves: they raid the enemy workers on their own.
    const raiders = mine.filter((e) => e.def.kind === 'unit' && (e.def as UnitDef).cloaked);
    const army = mine.filter((e) => e.def.kind === 'unit' && !(e.def as UnitDef).worker && !(e.def as UnitDef).cloaked);
    const buildings = mine.filter((e) => e.def.kind === 'building');
    const count = (type: string) => buildings.filter((b) => b.type === type).length + serfs.filter((s) => s.order?.kind === 'build' && s.order.type === type).length;
    const p = w.players[this.player];
    // Minerals promised to serfs walking to a construction site are already spent.
    let minerals = p.minerals;
    for (const s of serfs) if (s.order?.kind === 'build') minerals -= (DEFS[s.order.type] as BuildingDef).cost.minerals;
    const supply = w.supply(this.player);

    // Idle serfs go mining.
    for (const s of serfs) {
      if (s.order) continue;
      const f = this.nearest(s, (e) => e.type === 'minerai');
      if (f) out.push({ player: this.player, kind: 'smart', ids: [s.id], x: f.x, y: f.y, target: f.id });
    }

    // Abandoned construction sites (builder killed) get a new serf. Warped buildings build themselves.
    for (const site of buildings.filter((b) => b.buildLeft > 0 && !(b.def as BuildingDef).warp)) {
      if (serfs.some((s) => s.order?.kind === 'construct' && s.order.target === site.id)) continue;
      const s = this.builder(serfs, [site.tx, site.ty]);
      if (s) out.push({ player: this.player, kind: 'smart', ids: [s.id], x: site.x, y: site.y, target: site.id });
    }

    // Supply first, then production buildings, then the mine.
    const building = (type: string) => serfs.some((s) => s.order?.kind === 'build' && s.order.type === type) || buildings.some((b) => b.type === type && b.buildLeft > 0);
    const wants: string[] = [];
    if (supply.max < 200 && supply.max - supply.used <= 2 + count(f.barracks) * 2 && !building(f.supply)) wants.push(f.supply);
    // Isdaris: an extra emitter whenever production grows, to widen the power field.
    if (f.pylon && count(f.pylon) < 1 + Math.floor(count(f.barracks) / 2) && !building(f.pylon)) wants.push(f.pylon);
    if (count(f.barracks) >= this.plan.mineAfter && count(f.extractor) === 0) wants.push(f.extractor);
    let casernesWanted = this.plan.casernes.filter(([at]) => serfs.length >= at).reduce((m, [, n]) => Math.max(m, n), 0);
    // Floating minerals while every caserne is busy: add production.
    const casernes = buildings.filter((b) => b.type === f.barracks);
    if (minerals > 450 && casernes.length >= casernesWanted && casernes.every((c) => c.queue.length > 0) && !building(f.barracks)) casernesWanted = Math.min(8, casernes.length + 1);
    if (count(f.barracks) < casernesWanted) wants.push(f.barracks);
    // Mid-game: a Forge, detection against an enemy that has invisible units, a defence or two.
    const minute = w.tick / ticks(60);
    if (f.forge && count(f.forge) === 0 && count(f.barracks) >= 2 && count(f.extractor) > 0) wants.push(f.forge);
    const enemyCloaks = w.players.some((o) => w.hostile(o.id, this.player) && FACTIONS[o.faction].army.some(([t]) => (DEFS[t] as UnitDef).cloaked));
    // One tower late anyway: level 3 upgrades need it.
    const detectors = f.detector && f.detector !== f.defense ? (enemyCloaks && minute > 6 ? 1 : 0) + (minute > 11 ? 1 : 0) : 0;
    const defenses = f.defense ? (minute > 6 ? 1 : 0) + (minute > 11 ? 1 : 0) : 0;
    if (f.detector && count(f.detector) < detectors && !building(f.detector)) wants.push(f.detector);
    // The second production building, for heavier units, only with resources to spare: its units cost
    // more for their strength than the gateway's (an early one cost the Isdaris AI most of its games).
    if (f.tech && count(f.tech) === 0 && count(f.barracks) >= 3 && minerals > 900 && p.energy > 400 && !w.lacks(this.player, f.tech)) wants.push(f.tech);
    if (f.defense && count(f.defense) < defenses && !building(f.defense)) wants.push(f.defense);
    // Expand to the natural once the main is running.
    const councils = buildings.filter((b) => b.type === f.hq).length + serfs.filter((s) => s.order?.kind === 'build' && s.order.type === f.hq).length;
    const expand = councils < 2 && serfs.length >= this.plan.serfs && (w.tick > ticks(7 * 60) || this.fieldsLeft(home) < 5);
    if (expand) wants.push(f.hq);
    // Save up for the expansion once the base is defended.
    const saving = expand && army.filter((u) => !this.wave.has(u.id)).length >= 8 && minerals < 1000;
    for (const type of wants) {
      const def = DEFS[type] as BuildingDef;
      if (minerals < def.cost.minerals) {
        if (type === f.hq) continue;
        break; // save up for the most urgent one
      }
      const spot = this.spot(type, home);
      const builder = this.builder(serfs, spot);
      if (!spot || !builder) continue;
      out.push({ player: this.player, kind: 'build', ids: [builder.id], type, tx: spot[0], ty: spot[1] });
      minerals -= def.cost.minerals;
    }

    // Serfs, then soldiers.
    const free = supply.max - supply.used;
    const serfTarget = this.plan.serfs * Math.min(2, buildings.filter((b) => b.type === f.hq && b.buildLeft === 0).length);
    const councilHome = buildings.filter((b) => b.type === f.hq && b.buildLeft === 0).sort((a, b) => a.queue.length - b.queue.length)[0] ?? home;
    if (serfs.length < serfTarget && councilHome.queue.length === 0 && home.buildLeft === 0 && minerals >= 100 && free > 0 && !wants.includes(f.supply)) {
      out.push({ player: this.player, kind: 'train', ids: [councilHome.id], type: f.worker });
      minerals -= 100;
    }
    // Forge upgrades, one line after the other, when there is money to spare.
    for (const forge of buildings.filter((b) => b.type === f.forge && b.buildLeft === 0 && b.queue.length === 0)) {
      const next = RESEARCH.map((line) => (DEFS[forge.type] as BuildingDef).researches!.find((t) => (DEFS[t] as UpgradeDef).line === line && w.researchable(this.player, t) && !w.lacks(this.player, t)))
        .filter((t): t is string => !!t)
        .sort((a, b) => (DEFS[a] as UpgradeDef).level - (DEFS[b] as UpgradeDef).level)[0];
      const cost = next && (DEFS[next] as UpgradeDef).cost;
      if (cost && minerals >= cost.minerals && p.energy >= cost.energy) {
        out.push({ player: this.player, kind: 'train', ids: [forge.id], type: next });
        minerals -= cost.minerals;
      }
    }
    // Heavier units from the second production building, one at a time, when affordable.
    for (const t of buildings.filter((b) => b.type === f.tech && b.buildLeft === 0 && b.queue.length === 0)) {
      const type = (t.def as BuildingDef).trains?.[0];
      const def = type && (DEFS[type] as UnitDef);
      if (!def || saving || free - out.filter((o) => o.kind === 'train').length < def.supply) continue;
      if (minerals < def.cost.minerals || p.energy < def.cost.energy) continue;
      out.push({ player: this.player, kind: 'train', ids: [t.id], type });
      minerals -= def.cost.minerals;
    }
    const rally = this.rallyPoint(home);
    for (const c of buildings.filter((b) => b.type === f.barracks && b.buildLeft === 0)) {
      if (!c.rally) out.push({ player: this.player, kind: 'smart', ids: [c.id], x: rally.x, y: rally.y });
      if (saving || c.queue.length > 1 || free - out.filter((o) => o.kind === 'train').length <= 0) continue;
      const type = this.nextUnit(p.energy, army, minerals);
      const def = DEFS[type] as UnitDef;
      if (minerals < def.cost.minerals || p.energy < def.cost.energy) continue;
      out.push({ player: this.player, kind: 'train', ids: [c.id], type });
      minerals -= def.cost.minerals;
      this.trained++;
    }

    // Defend the base, otherwise attack in waves; reinforcements wait at the rally point.
    // Dead or being recalled (Rappel): out of the wave.
    for (const id of this.wave) if (!w.entities.get(id) || w.entities.get(id)!.held) this.wave.delete(id);
    let atHome = army.filter((u) => !this.wave.has(u.id));
    const threat = this.threat(buildings);
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
    } else if (atHome.length >= Math.min(MAX_WAVE, this.plan.wave + this.waves * this.plan.waveGrowth) || (atHome.length >= 6 && supply.used >= supply.max - 2)) {
      atHome.forEach((u) => this.wave.add(u.id));
      this.waves++;
    }
    // Abilities: stimulant and charge when engaging, Peau de roc while healing in a fight.
    const casters = army.filter((u) => {
      const ab = (u.def as UnitDef).ability;
      if (!ab || u.abilityCd > 0) return false;
      if (ab === 'peauderoc') return u.order?.kind === 'heal' || this.engaged(u) !== undefined;
      const d = this.engaged(u);
      return d !== undefined && (ab === 'stimulant' ? u.hp > 50 : d > 2 * FP);
    });
    if (casters.length) out.push({ player: this.player, kind: 'ability', ids: casters.map((u) => u.id) });
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
    const fleeing = this.outmatched([...this.wave].map((id) => w.entities.get(id)!));
    if (fleeing.length) {
      fleeing.forEach((u) => this.wave.delete(u.id));
      const refuge = this.haven(buildings, rally) ?? rally;
      out.push({ player: this.player, kind: 'smart', ids: fleeing.map((u) => u.id), x: refuge.x, y: refuge.y });
    }

    out.push(...this.raid(raiders));
    const target = this.enemyTarget(home);
    const waiting = [...this.wave].map((id) => w.entities.get(id)!).filter((u) => !u.order || u.order.kind === 'move');
    if (target && waiting.length) out.push({ player: this.player, kind: 'attack', ids: waiting.map((u) => u.id), x: target.x, y: target.y });
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
      if (power(ours) * (this.faction === FACTIONS.isdaris ? 1.2 : 2) < power(near)) ours.forEach((o) => out.add(o));
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

  private nextUnit(energy: number, own: Entity[], minerals: number): string {
    if (this.faction !== FACTIONS.humains) {
      // Weighted rotation through the faction's army; energy-hungry units only when affordable, a few invisible ones at most.
      const cloaked = own.filter((u) => (u.def as UnitDef).cloaked).length;
      const sneak = this.faction.army.find(([t]) => (DEFS[t] as UnitDef).cloaked && (DEFS[t] as UnitDef).cost.energy <= energy && (DEFS[t] as UnitDef).cost.minerals <= minerals);
      if (sneak && cloaked < MAX_CLOAKED) return sneak[0];
      const army = this.faction.army.filter(([t]) => (DEFS[t] as UnitDef).cost.energy <= energy && !(DEFS[t] as UnitDef).cloaked);
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
    if (energy >= 150 && minerals >= 225 && this.trained % 5 === 2 && !this.world.lacks(this.player, 'phalangiste')) return 'phalangiste';
    if (energy >= 100 && (energy >= 300 || this.trained % this.plan.healerEvery === this.plan.healerEvery - 1)) return 'soigneur';
    // Deterministic mix of légionnaires among auxiliaires.
    return (this.trained * this.plan.legionShare) % 1 >= 1 - this.plan.legionShare ? 'legionnaire' : 'auxiliaire';
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
      const well = this.nearest(home, (e) => e.type === 'puits' && w.canPlace(type, e.tx, e.ty, this.player));
      return well && dist(well.x, well.y, home.x, home.y) < 20 * FP ? [well.tx, well.ty] : null;
    }
    if (type === this.faction.hq) {
      const [tx, ty] = expansion(w, this.player);
      return w.canPlace(type, tx, ty, this.player) ? [tx, ty] : null;
    }
    const cx = Math.floor((near ?? home).x / FP);
    const cy = Math.floor((near ?? home).y / FP);
    // Prefer the side facing the map centre, where the minerals are not.
    const sx = cx < w.map.width / 2 ? 1 : -1;
    const sy = cy < w.map.height / 2 ? 1 : -1;
    for (let r = near ? 1 : 4; r < 14; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, r], [r, i], [i, -r], [-r, i]]) {
          const tx = cx + dx * sx - Math.floor(def.size / 2);
          const ty = cy + dy * sy - Math.floor(def.size / 2);
          // Leave a one-tile corridor around every building.
          if (!this.clear(tx - 1, ty - 1, def.size + 2) || !w.canPlace(type, tx, ty, this.player)) continue;
          if (this.closeToResources(tx, ty, def.size) || this.closeToRamp(tx, ty, def.size)) continue;
          return [tx, ty];
        }
      }
    }
    return null;
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
    const enemy = (e: Entity) => this.world.hostile(e.owner, this.player);
    return this.nearest(home, (e) => enemy(e) && e.type === FACTIONS[this.world.players[e.owner].faction].hq) ?? this.nearest(home, (e) => enemy(e) && e.def.kind === 'building');
  }
}
