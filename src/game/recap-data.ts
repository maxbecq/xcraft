/**
 * The end-of-game analysis's data (remark 92): read from the running world after each step (a game played or a replay
 * watched alike), never written to. Its samples keep the fields of the replay analyser's timeline (src/analysis, not
 * yet merged: army, workers, minerals, energy, supply, supplyMax), with this screen's own beside them, so either can
 * feed the screen (game/recap.ts).
 *
 * Killed and lost are told by the simulation's own deaths (World.deaths: what fell to 0 hp), the killer being the owner
 * of the last hit (Entity.lastHitBy); what leaves the map otherwise (taken in, consumed by a mechanic) is neither.
 */
import { type Cost, DEFS, FACTIONS, type UnitDef, withKit } from '../data';
import { TICK_RATE } from '../sim/fixed';
import type { Command, Entity, World } from '../sim/world';

export interface RecapPlayer {
  /** As the analyser's: what the fighting units are still worth (price times health left), workers, banked, supply. */
  army: number;
  workers: number;
  minerals: number;
  energy: number;
  supply: number;
  supplyMax: number;
  /** Price of all it raised and trained since the start, and of all it lost to its enemies. */
  produced: number;
  lost: number;
  /** All that went into its bank since the start (the totals' « récolté »: harvest, refunds and pillage). */
  gathered: number;
  /** Orders given a minute, over the last sample's span. */
  apm: number;
}
export interface RecapSample {
  tick: number;
  players: RecapPlayer[];
}
export interface Moment {
  player: number;
  tick: number;
  kind: 'batiment' | 'unite' | 'combat' | 'base-perdue' | 'fin';
  detail: string;
}
/** A player's totals over the game. */
export interface Totals {
  /** Banked income (harvest, and refunds and pillage alike) and what was paid out, by resource. */
  gotMinerals: number;
  gotEnergy: number;
  spentMinerals: number;
  spentEnergy: number;
  unitsMade: number;
  buildingsMade: number;
  /** Enemy units it killed, enemy buildings it brought down. */
  unitsKilled: number;
  buildingsRazed: number;
  /** Its own units and buildings killed by an enemy. */
  unitsLost: number;
  buildingsLost: number;
}

/** A sample every this many seconds. */
const EVERY = 5;
/** A fight: one side losing this much worth within `FIGHT_WINDOW` seconds; told once in `FIGHT_GAP`. */
const FIGHT_LOSS = 300;
const FIGHT_WINDOW = 10;
const FIGHT_GAP = 30;

const price = (c: Cost) => c.minerals + c.energy;
const worth = (e: Entity) => (e.def.kind === 'unit' ? price(withKit(e.def as UnitDef, e.kit || undefined)) : 'cost' in e.def ? price((e.def as { cost: Cost }).cost) : 0);
const fighter = (e: Entity) => e.def.kind === 'unit' && !(e.def as UnitDef).worker;

interface Known {
  owner: number;
  type: string;
  worth: number;
  building: boolean;
  /** Owner of the last hit, as of the last step it was seen. */
  hitBy: number;
}

export class Recorder {
  readonly timeline: RecapSample[] = [];
  readonly moments: Moment[] = [];
  readonly totals: Totals[];
  private known = new Map<number, Known>();
  private seenTypes: Set<string>[];
  private produced: number[];
  private lost: number[];
  private orders: number[];
  private bank: { m: number; e: number }[];
  /** Worth lost per player, for the fights. */
  private losses: { tick: number; player: number; worth: number }[] = [];
  private lastFight: number[];
  private ended = false;

  constructor(private readonly world: World) {
    const n = world.players.length;
    this.seenTypes = Array.from({ length: n }, () => new Set());
    this.produced = new Array(n).fill(0);
    this.lost = new Array(n).fill(0);
    this.orders = new Array(n).fill(0);
    this.lastFight = new Array(n).fill(-Infinity);
    this.bank = world.players.map((p) => ({ m: p.minerals, e: p.energy }));
    this.totals = world.players.map(() => ({ gotMinerals: 0, gotEnergy: 0, spentMinerals: 0, spentEnergy: 0, unitsMade: 0, buildingsMade: 0, unitsKilled: 0, buildingsRazed: 0, unitsLost: 0, buildingsLost: 0 }));
    // What stands at the start is neither produced nor a key moment.
    for (const e of world.entities.values()) {
      if (!this.owned(e)) continue;
      this.known.set(e.id, this.know(e));
      this.seenTypes[e.owner].add(e.type);
    }
  }

  private owned(e: Entity): boolean {
    return e.owner >= 0 && !!this.world.players[e.owner] && e.def.kind !== 'resource';
  }

  private know(e: Entity): Known {
    return { owner: e.owner, type: e.type, worth: worth(e), building: e.def.kind === 'building', hitBy: e.lastHitBy };
  }

  /** After each step, with the orders it carried out. */
  observe(cmds: readonly Command[]): void {
    const w = this.world;
    for (const c of cmds) if (this.orders[c.player] !== undefined) this.orders[c.player]++;
    this.bankMoves();
    this.entities();
    if (w.tick % TICK_RATE === 0) this.fights();
    if (w.tick % (EVERY * TICK_RATE) === 0) this.sample();
    if (w.winner !== null && !this.ended) {
      this.ended = true;
      this.sample();
      const team = w.players.filter((p) => p.team === w.players[w.winner!]?.team);
      this.moments.push({ player: team[0]?.id ?? -1, tick: w.tick, kind: 'fin', detail: 'Victoire' });
    }
  }

  /** What went into and out of each bank this step. */
  private bankMoves(): void {
    for (const p of this.world.players) {
      const b = this.bank[p.id];
      const t = this.totals[p.id];
      const dm = p.minerals - b.m;
      const de = p.energy - b.e;
      if (dm > 0) t.gotMinerals += dm;
      else t.spentMinerals -= dm;
      if (de > 0) t.gotEnergy += de;
      else t.spentEnergy -= de;
      b.m = p.minerals;
      b.e = p.energy;
    }
  }

  /** What appeared, what died and to whom, what left otherwise. */
  private entities(): void {
    const w = this.world;
    const here = new Set<number>();
    for (const e of w.entities.values()) {
      if (!this.owned(e)) continue;
      here.add(e.id);
      const k = this.known.get(e.id);
      if (k && k.type === e.type) {
        k.hitBy = e.lastHitBy;
        continue;
      }
      this.known.set(e.id, this.know(e));
      if (k) continue; // changed in place (evolved, landed): not made anew
      this.produced[e.owner] += worth(e);
      if (e.def.kind === 'building') this.totals[e.owner].buildingsMade++;
      else this.totals[e.owner].unitsMade++;
      if (this.seenTypes[e.owner].has(e.type)) continue;
      this.seenTypes[e.owner].add(e.type);
      if (e.def.kind === 'building') this.moments.push({ player: e.owner, tick: w.tick, kind: 'batiment', detail: DEFS[e.type]?.name ?? e.type });
      else if (fighter(e)) this.moments.push({ player: e.owner, tick: w.tick, kind: 'unite', detail: DEFS[e.type]?.name ?? e.type });
    }
    const died = new Map<string, number>();
    for (const d of w.deaths) died.set(`${d.type}|${d.owner}`, (died.get(`${d.type}|${d.owner}`) ?? 0) + 1);
    for (const [id, k] of this.known) {
      if (here.has(id)) continue;
      this.known.delete(id);
      const n = died.get(`${k.type}|${k.owner}`) ?? 0;
      // Gone without dying (carried inside, absorbed, consumed): neither lost nor killed.
      if (!n) continue;
      died.set(`${k.type}|${k.owner}`, n - 1);
      if (k.hitBy < 0 || k.hitBy === k.owner || !w.players[k.hitBy] || !w.hostile(k.hitBy, k.owner)) continue;
      const own = this.totals[k.owner];
      const foe = this.totals[k.hitBy];
      if (k.building) {
        own.buildingsLost++;
        foe.buildingsRazed++;
      } else {
        own.unitsLost++;
        foe.unitsKilled++;
      }
      this.lost[k.owner] += k.worth;
      this.losses.push({ tick: w.tick, player: k.owner, worth: k.worth });
      if (FACTIONS[w.players[k.owner].faction].hq === k.type) this.moments.push({ player: k.owner, tick: w.tick, kind: 'base-perdue', detail: `${DEFS[k.type]?.name ?? k.type} détruit` });
    }
  }

  /** Once a second: a side losing much in a short while is a fight. */
  private fights(): void {
    const w = this.world;
    this.losses = this.losses.filter((l) => l.tick > w.tick - FIGHT_WINDOW * TICK_RATE);
    for (let p = 0; p < this.lost.length; p++) {
      const sum = this.losses.filter((l) => l.player === p).reduce((s, l) => s + l.worth, 0);
      if (sum < FIGHT_LOSS || w.tick - this.lastFight[p] < FIGHT_GAP * TICK_RATE) continue;
      this.lastFight[p] = w.tick;
      this.moments.push({ player: p, tick: w.tick, kind: 'combat', detail: `Combat : perd ${Math.round(sum)} en ${FIGHT_WINDOW} s` });
    }
  }

  private sample(): void {
    const w = this.world;
    const last = this.timeline.at(-1);
    if (last?.tick === w.tick) return;
    const span = (w.tick - (last?.tick ?? 0)) / TICK_RATE || EVERY;
    this.timeline.push({
      tick: w.tick,
      players: w.players.map((p) => {
        let army = 0;
        let workers = 0;
        for (const e of w.entities.values()) {
          if (e.owner !== p.id || e.hp <= 0) continue;
          if ((e.def as UnitDef).worker) workers++;
          else if (fighter(e)) army += (worth(e) * (e.hp + e.shield)) / Math.max(1, e.maxHp + e.maxShield);
        }
        const s = w.supply(p.id);
        const apm = Math.round((this.orders[p.id] * 60) / span);
        this.orders[p.id] = 0;
        return { army: Math.round(army), workers, minerals: p.minerals, energy: p.energy, supply: s.used, supplyMax: s.max, produced: this.produced[p.id], lost: this.lost[p.id], gathered: this.totals[p.id].gotMinerals + this.totals[p.id].gotEnergy, apm };
      }),
    });
  }
}
