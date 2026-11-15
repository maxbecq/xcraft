import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { FP, dist, ticks } from '../sim/fixed';
import { EXPANSIONS } from '../sim/setup';
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

/** "Bioball auxiliaire" from the Human openings, simplified. */
export const BIOBALL: Plan = {
  serfs: 16,
  casernes: [[9, 1], [12, 2], [15, 3]],
  mineAfter: 2,
  wave: 8,
  waveGrowth: 4,
  healerEvery: 4,
  legionShare: 0.3,
};

const THINK_EVERY = 10; // ticks
const DEFEND_RADIUS = 14 * FP;
const MAX_WAVE = 18;

/** A computer player. It only acts through commands, like a human. */
export class AI {
  private waves = 0;
  private trained = 0;
  /** Soldiers sent in the current attack wave. */
  private wave = new Set<number>();

  constructor(private readonly world: World, readonly player: number, private readonly plan: Plan = BIOBALL) {}

  think(): Command[] {
    const w = this.world;
    if (w.tick % THINK_EVERY !== this.player || w.winner !== null) return [];
    const out: Command[] = [];
    const mine = [...w.entities.values()].filter((e) => e.owner === this.player);
    const home = mine.find((e) => e.type === 'conseil');
    if (!home) return this.lastStand(mine);
    const serfs = mine.filter((e) => e.type === 'serf');
    const army = mine.filter((e) => e.def.kind === 'unit' && !(e.def as UnitDef).worker);
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

    // Abandoned construction sites (builder killed) get a new serf.
    for (const site of buildings.filter((b) => b.buildLeft > 0)) {
      if (serfs.some((s) => s.order?.kind === 'construct' && s.order.target === site.id)) continue;
      const s = this.builder(serfs, [site.tx, site.ty]);
      if (s) out.push({ player: this.player, kind: 'smart', ids: [s.id], x: site.x, y: site.y, target: site.id });
    }

    // Supply first, then production buildings, then the mine.
    const building = (type: string) => serfs.some((s) => s.order?.kind === 'build' && s.order.type === type) || buildings.some((b) => b.type === type && b.buildLeft > 0);
    const wants: string[] = [];
    if (supply.max < 200 && supply.max - supply.used <= 2 + count('caserne') * 2 && !building('grenier')) wants.push('grenier');
    if (count('caserne') >= this.plan.mineAfter && count('mine') === 0) wants.push('mine');
    let casernesWanted = this.plan.casernes.filter(([at]) => serfs.length >= at).reduce((m, [, n]) => Math.max(m, n), 0);
    // Floating minerals while every caserne is busy: add production.
    const casernes = buildings.filter((b) => b.type === 'caserne');
    if (minerals > 450 && casernes.length >= casernesWanted && casernes.every((c) => c.queue.length > 0) && !building('caserne')) casernesWanted = Math.min(8, casernes.length + 1);
    if (count('caserne') < casernesWanted) wants.push('caserne');
    // Expand to the natural once the main is running.
    const councils = buildings.filter((b) => b.type === 'conseil').length + serfs.filter((s) => s.order?.kind === 'build' && s.order.type === 'conseil').length;
    const expand = councils < 2 && serfs.length >= this.plan.serfs && (w.tick > ticks(7 * 60) || this.fieldsLeft(home) < 5);
    if (expand) wants.push('conseil');
    // Save up for the expansion once the base is defended.
    const saving = expand && army.filter((u) => !this.wave.has(u.id)).length >= 8 && minerals < 1000;
    for (const type of wants) {
      const def = DEFS[type] as BuildingDef;
      if (minerals < def.cost.minerals) {
        if (type === 'conseil') continue;
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
    const serfTarget = this.plan.serfs * Math.min(2, buildings.filter((b) => b.type === 'conseil' && b.buildLeft === 0).length);
    const councilHome = buildings.filter((b) => b.type === 'conseil' && b.buildLeft === 0).sort((a, b) => a.queue.length - b.queue.length)[0] ?? home;
    if (serfs.length < serfTarget && councilHome.queue.length === 0 && home.buildLeft === 0 && minerals >= 100 && free > 0 && !wants.includes('grenier')) {
      out.push({ player: this.player, kind: 'train', ids: [councilHome.id], type: 'serf' });
      minerals -= 100;
    }
    const rally = this.rallyPoint(home);
    for (const c of buildings.filter((b) => b.type === 'caserne' && b.buildLeft === 0)) {
      if (!c.rally) out.push({ player: this.player, kind: 'smart', ids: [c.id], x: rally.x, y: rally.y });
      if (saving || c.queue.length > 1 || free - out.filter((o) => o.kind === 'train').length <= 0) continue;
      const type = this.nextUnit(p.energy);
      const def = DEFS[type] as UnitDef;
      if (minerals < def.cost.minerals) continue;
      out.push({ player: this.player, kind: 'train', ids: [c.id], type });
      minerals -= def.cost.minerals;
      this.trained++;
    }

    // Defend the base, otherwise attack in waves; reinforcements wait at the rally point.
    for (const id of this.wave) if (!w.entities.has(id)) this.wave.delete(id);
    const atHome = army.filter((u) => !this.wave.has(u.id));
    const intruder = [...w.entities.values()].find(
      (e) => e.owner >= 0 && e.owner !== this.player && e.def.kind === 'unit' && dist(e.x, e.y, home.x, home.y) < DEFEND_RADIUS && w.sees(this.player, e),
    );
    if (intruder) {
      const ids = atHome.filter((u) => u.order?.kind !== 'attack' && u.order?.kind !== 'attackMove').map((u) => u.id);
      if (ids.length) out.push({ player: this.player, kind: 'attack', ids, x: intruder.x, y: intruder.y });
    } else if (atHome.length >= Math.min(MAX_WAVE, this.plan.wave + this.waves * this.plan.waveGrowth) || (atHome.length >= 6 && supply.used >= supply.max - 2)) {
      atHome.forEach((u) => this.wave.add(u.id));
      this.waves++;
    }
    const target = this.enemyTarget(home);
    const waiting = [...this.wave].map((id) => w.entities.get(id)!).filter((u) => !u.order || u.order.kind === 'move');
    if (target && waiting.length) out.push({ player: this.player, kind: 'attack', ids: waiting.map((u) => u.id), x: target.x, y: target.y });
    return out;
  }

  /** No council left: throw everything at the enemy. */
  private lastStand(mine: Entity[]): Command[] {
    const army = mine.filter((e) => e.def.kind === 'unit' && !e.order);
    const target = [...this.world.entities.values()].find((e) => e.owner >= 0 && e.owner !== this.player && e.def.kind === 'building');
    if (!army.length || !target) return [];
    return [{ player: this.player, kind: 'attack', ids: army.map((u) => u.id), x: target.x, y: target.y }];
  }

  private nextUnit(energy: number): string {
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
  private spot(type: string, home: Entity): [number, number] | null {
    const w = this.world;
    const def = DEFS[type] as BuildingDef;
    if (def.energyRate) {
      const well = this.nearest(home, (e) => e.type === 'puits' && w.canPlace('mine', e.tx, e.ty));
      return well && dist(well.x, well.y, home.x, home.y) < 20 * FP ? [well.tx, well.ty] : null;
    }
    if (type === 'conseil') {
      const [tx, ty] = EXPANSIONS[this.player];
      return w.canPlace(type, tx, ty) ? [tx, ty] : null;
    }
    const cx = Math.floor(home.x / FP);
    const cy = Math.floor(home.y / FP);
    // Prefer the side facing the map centre, where the minerals are not.
    const sx = cx < w.map.width / 2 ? 1 : -1;
    const sy = cy < w.map.height / 2 ? 1 : -1;
    for (let r = 4; r < 14; r++) {
      for (let i = -r; i <= r; i++) {
        for (const [dx, dy] of [[i, r], [r, i], [i, -r], [-r, i]]) {
          const tx = cx + dx * sx - Math.floor(def.size / 2);
          const ty = cy + dy * sy - Math.floor(def.size / 2);
          // Leave a one-tile corridor around every building.
          if (!this.clear(tx - 1, ty - 1, def.size + 2) || !w.canPlace(type, tx, ty)) continue;
          if (this.closeToResources(tx, ty, def.size)) continue;
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

  /** Closest enemy building to our base (the AI knows where the enemy starts). */
  private enemyTarget(home: Entity): Entity | undefined {
    return this.nearest(home, (e) => e.owner >= 0 && e.owner !== this.player && e.def.kind === 'building');
  }
}
