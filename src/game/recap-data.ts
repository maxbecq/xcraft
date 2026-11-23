/**
 * The end-of-game analysis's data (remark 92, a prototype): sampled from the running world (a game played or a replay
 * watched alike), never written to. Its samples keep the fields of the replay analyser's timeline (src/analysis, not
 * yet merged: army, workers, minerals, energy, supply, supplyMax), with this screen's own beside them, so either can
 * feed the screen (game/recap.ts).
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
  /** Price of all it raised and trained since the start, and of all it lost. */
  produced: number;
  lost: number;
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

/** A sample every this many seconds. */
const EVERY = 5;
/** A fight: one side losing this much worth within `FIGHT_WINDOW` seconds; told once in `FIGHT_GAP`. */
const FIGHT_LOSS = 300;
const FIGHT_WINDOW = 10;
const FIGHT_GAP = 30;

const price = (c: Cost) => c.minerals + c.energy;
const worth = (e: Entity) => (e.def.kind === 'unit' ? price(withKit(e.def as UnitDef, e.kit || undefined)) : 'cost' in e.def ? price((e.def as { cost: Cost }).cost) : 0);
const fighter = (e: Entity) => e.def.kind === 'unit' && !(e.def as UnitDef).worker;

export class Recorder {
  readonly timeline: RecapSample[] = [];
  readonly moments: Moment[] = [];
  private known = new Map<number, { owner: number; type: string; worth: number }>();
  private seenTypes: Set<string>[];
  private produced: number[];
  private lost: number[];
  private orders: number[];
  /** Worth lost per player, per second, for the fights. */
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
    // What stands at the start is neither produced nor a key moment.
    for (const e of world.entities.values()) {
      if (e.owner < 0 || !world.players[e.owner]) continue;
      this.known.set(e.id, { owner: e.owner, type: e.type, worth: worth(e) });
      this.seenTypes[e.owner].add(e.type);
    }
  }

  /** After each step, with the orders it carried out. */
  observe(cmds: readonly Command[]): void {
    const w = this.world;
    for (const c of cmds) if (this.orders[c.player] !== undefined) this.orders[c.player]++;
    if (w.tick % TICK_RATE === 0) this.second();
    if (w.tick % (EVERY * TICK_RATE) === 0) this.sample();
    if (w.winner !== null && !this.ended) {
      this.ended = true;
      this.sample();
      const team = w.players.filter((p) => p.team === w.winner);
      this.moments.push({ player: team[0]?.id ?? -1, tick: w.tick, kind: 'fin', detail: 'Victoire' });
    }
  }

  /** Once a second: what appeared and what is gone. */
  private second(): void {
    const w = this.world;
    const now = new Set<number>();
    for (const e of w.entities.values()) {
      if (e.owner < 0 || !w.players[e.owner] || e.hp <= 0) continue;
      now.add(e.id);
      const k = this.known.get(e.id);
      if (k && k.type === e.type) continue;
      const v = worth(e);
      this.known.set(e.id, { owner: e.owner, type: e.type, worth: v });
      if (k) continue; // changed in place (evolved, landed): not made anew
      this.produced[e.owner] += v;
      if (this.seenTypes[e.owner].has(e.type)) continue;
      this.seenTypes[e.owner].add(e.type);
      if (e.def.kind === 'building') this.moments.push({ player: e.owner, tick: w.tick, kind: 'batiment', detail: DEFS[e.type]?.name ?? e.type });
      else if (fighter(e)) this.moments.push({ player: e.owner, tick: w.tick, kind: 'unite', detail: DEFS[e.type]?.name ?? e.type });
    }
    for (const [id, k] of this.known) {
      if (now.has(id)) continue;
      this.known.delete(id);
      this.lost[k.owner] += k.worth;
      this.losses.push({ tick: w.tick, player: k.owner, worth: k.worth });
      if (FACTIONS[w.players[k.owner].faction].hq === k.type) this.moments.push({ player: k.owner, tick: w.tick, kind: 'base-perdue', detail: `${DEFS[k.type]?.name ?? k.type} détruit` });
    }
    const from = w.tick - FIGHT_WINDOW * TICK_RATE;
    this.losses = this.losses.filter((l) => l.tick > from);
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
        return { army: Math.round(army), workers, minerals: p.minerals, energy: p.energy, supply: s.used, supplyMax: s.max, produced: this.produced[p.id], lost: this.lost[p.id], apm };
      }),
    });
  }
}
