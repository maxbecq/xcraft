/**
 * Game analysis without rendering: watches a running world (or replays a saved game) and notes, with the moment of
 * each, the economic faults and the tactical weaknesses of every player. A reading aid, never a balance measure: the
 * thresholds are rules of thumb, a fault here is a hint to look at that moment of the game.
 */
import { type Attack, CLASSES, DEFS, FACTIONS, type UnitDef, withKit } from '../data';
import type { Replay } from '../game/replay';
import { DEFAULT_MAP } from '../maps';
import { clsOf, hits } from '../sim/combat';
import { FP, TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command, Entity, World } from '../sim/world';

export type Family = 'economie' | 'tactique';
export type FaultKind =
  | 'production-arretee'
  | 'ressources-accumulees'
  | 'ouvriers-inactifs'
  | 'base-perdue'
  | 'recherche-absente'
  | 'armee-inferieure'
  | 'combat-en-inferiorite'
  | 'unite-cle-exposee'
  | 'armee-eparpillee'
  | 'pas-de-repli'
  | 'renforts-goutte-a-goutte'
  | 'composition-inadaptee';

export const FAULTS: Record<FaultKind, { family: Family; label: string }> = {
  'production-arretee': { family: 'economie', label: 'Production arrêtée' },
  'ressources-accumulees': { family: 'economie', label: 'Ressources accumulées' },
  'ouvriers-inactifs': { family: 'economie', label: 'Ouvriers inactifs' },
  'base-perdue': { family: 'economie', label: 'Base perdue jamais reconstruite' },
  'recherche-absente': { family: 'economie', label: 'Recherche jamais faite' },
  'armee-inferieure': { family: 'tactique', label: 'Armée nettement inférieure' },
  'combat-en-inferiorite': { family: 'tactique', label: 'Combat engagé en infériorité' },
  'unite-cle-exposee': { family: 'tactique', label: 'Dieu ou unité clé isolé et exposé' },
  'armee-eparpillee': { family: 'tactique', label: 'Armée éparpillée' },
  'pas-de-repli': { family: 'tactique', label: 'Pas de repli' },
  'renforts-goutte-a-goutte': { family: 'tactique', label: 'Renforts envoyés au compte-gouttes' },
  'composition-inadaptee': { family: 'tactique', label: 'Composition mal adaptée à l’adversaire' },
};

export interface Fault {
  player: number;
  kind: FaultKind;
  /** When it began, and for a lasting state when it ended (ticks). */
  tick: number;
  endTick?: number;
  /** Where, for a fight (tiles). */
  x?: number;
  y?: number;
  detail: string;
}

/** Something worth seeing in the game's story that is not a fault: `echange-de-bases`, the army away at the enemy's
 * while its own base is under attack (a race may be a choice, so no penalty). */
export interface GameNote {
  player: number;
  kind: 'echange-de-bases';
  tick: number;
  detail: string;
}

/** Every ten seconds, each player's state: for an end-of-game screen's curves. */
export interface Sample {
  tick: number;
  players: { army: number; workers: number; minerals: number; energy: number; supply: number; supplyMax: number }[];
}

export interface Analysis {
  factions: string[];
  ticks: number;
  winner: number | null;
  faults: Fault[];
  notes: GameNote[];
  timeline: Sample[];
  /** A replay with no end recorded, played on REPLAY_TAIL seconds past its last order with no winner: cut short. */
  truncated?: boolean;
}

/** Rules of thumb, in seconds, tiles and resources (minerals + energy). */
export const THRESHOLDS = {
  /** Production stopped this long with this much in stock. */
  idleProduction: 30,
  idleProductionStock: 150,
  /** Stock above this, this long. */
  float: 1000,
  floatTime: 60,
  /** This many workers doing nothing, this long. */
  idleWorkers: 3,
  idleWorkersTime: 20,
  /** A base not replaced this long after its fall (the player still standing). */
  baseGrace: 60,
  /** No research by then (a game at least that long). */
  research: 10 * 60,
  /** Own army under this share of its enemies', theirs at least `armyFloor`, this long. */
  inferior: 0.5,
  armyFloor: 400,
  inferiorTime: 30,
  /** A fight: own and enemy forces within this radius of a hit unit; outnumbered under this ratio. */
  fightRadius: 10,
  outnumbered: 0.6,
  fightFloor: 300,
  /** A fight is judged this long after its first shots, and over once no shot comes near it for `fightEnd`. */
  fightJudge: 5,
  fightEnd: 15,
  /** A group fighting outnumbered that loses this share within `wipeTime` did not fall back. */
  wiped: 0.8,
  wipeTime: 30,
  /** Trickle: combat units dying with at most `trickleAlone` others of theirs within `fightRadius` while the enemy there
   * is worth `fightFloor`; `trickleDeaths` of them within `trickleWindow` seconds, spread over `trickleSpread` at least
   * (a group wiped at once is « pas de repli », not this). */
  trickleAlone: 2,
  trickleDeaths: 6,
  trickleWindow: 90,
  trickleSpread: 30,
  /** Base race: own base hit while this share of the army stands (or stood within `raceWindow` seconds) nearer enemy
   * buildings than its own; once per `raceGap`. */
  raceAway: 0.5,
  raceWindow: 30,
  raceGap: 60,
  /** A key unit: a god, a unique one, a hero, or one costing this much. */
  keyValue: 400,
  /** Alone: own support within this radius under this share of the enemy's, and under `keyAway` of the rest of its army
   * (with the whole army there, it is a lost fight, not a unit left alone). */
  keyRadius: 8,
  keyAlone: 0.3,
  keyAway: 0.5,
  keyFloor: 250,
  keyGap: 90,
  /** Scattered: units this far from own buildings, at least `scatterCount`, more than half their value out of the main group. */
  homeRadius: 15,
  groupRadius: 10,
  scatterCount: 6,
  scatterShare: 0.5,
  scatterTime: 20,
  /** Composition: checked when both armies are worth this; a fault under these shares. */
  compositionFloor: 600,
  compositionRoster: 0.5,
  airShare: 0.3,
  antiAir: 0.25,
  compositionGap: 90,
};

const T = THRESHOLDS;
const sec = (s: number) => s * TICK_RATE;
const tiles = (v: number) => v / FP;
export const clock = (tick: number) => {
  const s = Math.floor(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A combat unit's price (with its Z weapon). */
function value(e: Entity): number {
  const c = withKit(e.def as UnitDef, e.kit || undefined);
  return c.minerals + c.energy;
}

/** Price times health left: what a unit is still worth in a fight. */
function strength(e: Entity): number {
  return (value(e) * (e.hp + e.shield)) / Math.max(1, e.maxHp + e.maxShield);
}

const isGod = (type: string) => !!FACTIONS.dieux.gods?.includes(type);

/** Damage per cost of an attack against a mix of targets (each with its weight), a rough measure of fit. */
function fit(a: Attack | undefined, cost: number, mix: [Entity, number][]): number {
  if (!a || cost <= 0) return 0;
  let sum = 0;
  let total = 0;
  for (const [t, w] of mix) {
    total += w;
    if (hits(a, t)) sum += (w * (a.vs ? a.vs[CLASSES.indexOf(clsOf(t))] : a.damage)) / Math.max(1, a.cooldown);
  }
  return total ? sum / total / cost : 0;
}

/** Watches a world as it plays: call `observe()` after each step, `finish()` at the end. */
export class Analyzer {
  readonly faults: Fault[] = [];
  readonly timeline: Sample[] = [];
  readonly notes: GameNote[] = [];
  /** Lone deaths (ticks) per player, and the trickle being counted. */
  private lone: number[][] = [];
  private trickle: ({ from: number; last: number; count: number; noted: boolean } | undefined)[] = [];
  private since = new Map<string, { tick: number; peak: number }>();
  private lastNoted = new Map<string, number>();
  private bases: Set<number>[];
  private lost: { player: number; tick: number; type: string; fault?: Fault }[] = [];
  private engaged: ({ x: number; y: number; start: number; seen: number; judged: boolean; wiped?: boolean } | undefined)[] = [];
  private groups: { player: number; tick: number; ids: number[]; worth: number; x: number; y: number }[] = [];
  private keys: { id: number; fault: Fault; until: number }[] = [];
  private researched: (number | null)[];
  /** When each player stopped playing (beaten or resigned). */
  private gone: (number | undefined)[] = [];

  constructor(private world: World) {
    this.bases = world.players.map(() => new Set());
    this.researched = world.players.map(() => null);
  }

  /** Call after each `world.step`; looks once a second. */
  observe(): void {
    const w = this.world;
    this.lonely();
    this.wipedOut();
    if (w.tick % TICK_RATE !== 0) return;
    const armies = w.players.map((p) => [...w.entities.values()].filter((e) => e.owner === p.id && this.combatant(e)));
    const worth = armies.map((a) => a.reduce((s, e) => s + strength(e), 0));
    const playing = (p: number) => !w.players[p].resigned && [...w.entities.values()].some((e) => e.owner === p && e.def.kind === 'building');
    for (const p of w.players) {
      if (!playing(p.id)) {
        // Its states closed when it leaves, not at the game's end (an ally plays on: Codex review, point 6).
        if (this.gone[p.id] === undefined) {
          this.gone[p.id] = w.tick;
          for (const key of [...this.since.keys()]) if (key.startsWith(`${p.id}:`)) this.close(key, w.tick);
          this.closeTrickle(p.id);
        }
        continue;
      }
      const foes = w.players.filter((q) => q.id !== p.id && w.hostile(p.id, q.id) && playing(q.id)).map((q) => q.id);
      this.economy(p.id);
      const enemy = foes.reduce((s, q) => s + worth[q], 0);
      this.span(p.id, 'armee-inferieure', enemy >= T.armyFloor && worth[p.id] < T.inferior * enemy, enemy ? Math.round((100 * worth[p.id]) / enemy) : 0, T.inferiorTime, (peak) => `armée à ${-peak} % de celle de l’adversaire au pire`, true);
      const foeArmy = foes.flatMap((q) => armies[q]);
      this.fights(p.id, armies[p.id], foes, worth[p.id]);
      this.scattered(p.id, armies[p.id]);
      this.composition(p.id, armies[p.id], foeArmy, worth[p.id], enemy);
      this.race(p.id, armies[p.id], foes, worth[p.id]);
    }
    this.followUp();
    if (w.tick % sec(10) === 0) {
      this.timeline.push({
        tick: w.tick,
        players: w.players.map((p) => {
          const s = w.supply(p.id);
          const workers = [...w.entities.values()].filter((e) => e.owner === p.id && (e.def as UnitDef).worker).length;
          return { army: Math.round(worth[p.id]), workers, minerals: p.minerals, energy: p.energy, supply: s.used, supplyMax: s.max };
        }),
      });
    }
  }

  /** The analysis so far, the states still going closed at the current tick. */
  finish(): Analysis {
    const w = this.world;
    for (const key of [...this.since.keys()]) this.close(key, w.tick);
    for (let p = 0; p < w.players.length; p++) this.closeTrickle(p);
    for (const l of this.lost) {
      if (l.fault || (this.gone[l.player] ?? w.tick) - l.tick < sec(T.baseGrace)) continue;
      this.note({ player: l.player, kind: 'base-perdue', tick: l.tick, detail: `${DEFS[l.type]?.name ?? l.type} perdu, jamais remplacé (fin à ${clock(w.tick)})` });
    }
    // Over the time each player played (to its defeat or resignation).
    for (const p of w.players) {
      const played = this.gone[p.id] ?? w.tick;
      if (played < sec(T.research)) continue;
      const at = this.researched[p.id];
      if (at === null && !p.resigned) this.note({ player: p.id, kind: 'recherche-absente', tick: sec(T.research), detail: `aucune recherche en ${clock(played)} de partie` });
      if (at !== null && at > sec(T.research)) this.note({ player: p.id, kind: 'recherche-absente', tick: sec(T.research), detail: `première recherche seulement à ${clock(at)}` });
    }
    this.faults.sort((a, b) => a.tick - b.tick || a.player - b.player);
    return { factions: w.players.map((p) => p.faction), ticks: w.tick, winner: w.winner, faults: this.faults, notes: this.notes, timeline: this.timeline };
  }

  private combatant(e: Entity): boolean {
    if (e.def.kind !== 'unit' || e.hp <= 0 || e.illusion || e.inside) return false;
    const d = e.def as UnitDef;
    return !d.worker && (!!this.world.weapon(e) || !!d.heal);
  }

  private note(f: Fault): Fault {
    this.faults.push(f);
    return f;
  }

  /** A state lasting at least `min` seconds becomes one fault, from its start to its end; `peak` keeps its worst value
   * (the highest, or the lowest when `low`). */
  private span(player: number, kind: FaultKind, on: boolean, value: number, min: number, detail: (peak: number) => string, low = false): void {
    const key = `${player}:${kind}`;
    const cur = this.since.get(key);
    const v = low ? -value : value;
    if (on) {
      if (!cur) this.since.set(key, { tick: this.world.tick, peak: v });
      else cur.peak = Math.max(cur.peak, v);
      this.details.set(key, { min, detail });
    } else if (cur) this.close(key, this.world.tick);
  }

  private details = new Map<string, { min: number; detail: (peak: number) => string }>();

  private close(key: string, tick: number): void {
    const cur = this.since.get(key)!;
    this.since.delete(key);
    const d = this.details.get(key)!;
    if (tick - cur.tick < sec(d.min)) return;
    const [player, kind] = key.split(':') as [string, FaultKind];
    this.note({ player: +player, kind, tick: cur.tick, endTick: tick, detail: d.detail(cur.peak) });
  }

  private economy(p: number): void {
    const w = this.world;
    const pl = w.players[p];
    const own = [...w.entities.values()].filter((e) => e.owner === p);
    // Production: something that makes units besides workers, all idle, with stock to spend.
    const makers = own.filter((e) => e.buildLeft === 0 && e.hp > 0 && ((e.def as { trains?: string[] }).trains ?? []).some((t) => DEFS[t]?.kind === 'unit' && !(DEFS[t] as UnitDef).worker));
    const s = w.supply(p);
    const stock = pl.minerals + pl.energy;
    const idle = makers.length > 0 && makers.every((e) => e.queue.length === 0) && stock >= T.idleProductionStock && !(s.max >= 200 && s.used >= s.max);
    this.span(p, 'production-arretee', idle, stock, T.idleProduction, (peak) => `${makers.length} producteur(s) à l’arrêt, jusqu’à ${peak} en réserve${s.used >= s.max ? ', logistique pleine' : ''}`);
    this.span(p, 'ressources-accumulees', stock >= T.float, stock, T.floatTime, (peak) => `jusqu’à ${peak} ressources en réserve`);
    const workers = own.filter((e) => (e.def as UnitDef).worker && e.def.kind === 'unit');
    const lazy = workers.filter((e) => !e.order && e.next.length === 0 && !e.inside).length;
    this.span(p, 'ouvriers-inactifs', lazy >= T.idleWorkers, lazy, T.idleWorkersTime, (peak) => `jusqu’à ${peak} ouvriers sans ordre`);
    // Bases: drop-offs standing; one gone is a loss until a new one is up.
    const bases = new Set(own.filter((e) => e.def.kind === 'building' && e.buildLeft === 0 && (e.def as { dropoff?: boolean }).dropoff).map((e) => e.id));
    for (const id of this.bases[p]) if (!bases.has(id)) this.lost.push({ player: p, tick: w.tick, type: this.baseTypes.get(id) ?? '?' });
    for (const id of bases) if (!this.bases[p].has(id) && w.tick > 0) {
      // A new base makes up for the oldest loss still open.
      const i = this.lost.findIndex((l) => l.player === p && !l.fault);
      if (i >= 0) this.lost.splice(i, 1);
    }
    for (const e of own) if (bases.has(e.id)) this.baseTypes.set(e.id, e.type);
    this.bases[p] = bases;
    if (this.researched[p] === null && Object.values(pl.upgrades).some((n) => n > 0)) this.researched[p] = w.tick;
  }

  private baseTypes = new Map<number, string>();

  /** Own and enemy forces within `r` tiles of (x, y): enemy defences count too. */
  private forces(p: number, foes: number[], x: number, y: number, r: number, except?: Entity): { own: number; enemy: number; ids: number[] } {
    let own = 0;
    let enemy = 0;
    const ids: number[] = [];
    for (const e of this.world.around(x, y, r * FP)) {
      if (e === except || e.hp <= 0 || Math.hypot(e.x - x, e.y - y) > r * FP) continue;
      if (e.owner === p && this.combatant(e)) (own += strength(e)), ids.push(e.id);
      else if (foes.includes(e.owner) && (this.combatant(e) || (e.def.kind === 'building' && this.world.weapon(e) && e.buildLeft === 0))) enemy += this.combatant(e) ? strength(e) : value(e);
    }
    return { own, enemy, ids };
  }

  private fights(p: number, army: Entity[], foes: number[], worth: number): void {
    const w = this.world;
    const hit = army.filter((e) => w.tick - e.lastHit < TICK_RATE && e.lastHit > 0);
    if (!hit.length) return;
    const ready = (key: string, gap: number) => w.tick - (this.lastNoted.get(key) ?? -Infinity) >= sec(gap);
    // Key units alone under fire.
    for (const e of hit) {
      const d = e.def as UnitDef;
      if (!(isGod(e.type) || d.unique || d.cls === 'H' || value(e) >= T.keyValue)) continue;
      const key = `key:${e.id}`;
      if (!ready(key, T.keyGap)) continue;
      const f = this.forces(p, foes, e.x, e.y, T.keyRadius, e);
      if (f.enemy < T.keyFloor || f.own >= T.keyAlone * f.enemy || (worth - strength(e) > 0 && f.own >= T.keyAway * (worth - strength(e)))) continue;
      this.lastNoted.set(key, w.tick);
      const fault = this.note({ player: p, kind: 'unite-cle-exposee', tick: w.tick, x: Math.round(tiles(e.x)), y: Math.round(tiles(e.y)), detail: `${d.name} seul face à ${Math.round(f.enemy)} de forces ennemies (${Math.round(f.own)} en soutien)` });
      this.keys.push({ id: e.id, fault, until: w.tick + sec(15) });
    }
    // One engagement per place: judged once, `fightJudge` seconds in (the first shots are only the vanguard), and only
    // away from home (defending one's base is not choosing the fight).
    const near = (e: Entity, x: number, y: number) => Math.hypot(e.x - x * FP, e.y - y * FP) <= 2 * T.fightRadius * FP;
    let g = this.engaged[p];
    if (g && w.tick - g.seen > sec(T.fightEnd)) g = this.engaged[p] = undefined;
    const close = g ? hit.filter((e) => near(e, g!.x, g!.y)) : [];
    if (!g || !close.length) {
      const e = hit[0];
      this.engaged[p] = { x: tiles(e.x), y: tiles(e.y), start: w.tick, seen: w.tick, judged: false };
      return;
    }
    g.seen = w.tick;
    if (g.judged || w.tick - g.start < sec(T.fightJudge)) return;
    g.judged = true;
    const homes = [...w.entities.values()].filter((b) => b.owner === p && b.def.kind === 'building');
    let worst: { e: Entity; f: ReturnType<Analyzer['forces']> } | null = null;
    for (const e of close) {
      if (homes.some((b) => Math.abs(b.x - e.x) <= T.homeRadius * FP && Math.abs(b.y - e.y) <= T.homeRadius * FP)) continue;
      const f = this.forces(p, foes, e.x, e.y, T.fightRadius);
      if (f.enemy >= T.fightFloor && f.own < T.outnumbered * f.enemy && (!worst || f.own / f.enemy < worst.f.own / worst.f.enemy)) worst = { e, f };
    }
    if (!worst) return;
    const { e, f } = worst;
    const [x, y] = [Math.round(tiles(e.x)), Math.round(tiles(e.y))];
    this.note({ player: p, kind: 'combat-en-inferiorite', tick: w.tick, x, y, detail: `${Math.round(f.own)} contre ${Math.round(f.enemy)} (${Math.round((100 * f.own) / f.enemy)} %)` });
    this.groups.push({ player: p, tick: w.tick, ids: f.ids, worth: f.own, x, y });
  }

  /**
   * Each tick: a group killed whole before its fight could be judged (`fightJudge` seconds in, on its survivors) is
   * judged on its dead: a Créature killed at the first volley by twelve Auxiliaires far from home went unseen.
   */
  private wipedOut(): void {
    const w = this.world;
    // By player and by place: two groups wiped at once far apart are two fights (Codex, 2026-11-26: the second went unseen).
    const dead: { p: number; x: number; y: number; worth: number }[] = [];
    for (const d of w.deaths) {
      const def = DEFS[d.type] as UnitDef | undefined;
      if (d.owner < 0 || def?.kind !== 'unit' || def.worker || !(def.attack || def.heal || def.weapons)) continue;
      const at = dead.find((c) => c.p === d.owner && Math.hypot(d.x - c.x, d.y - c.y) <= T.fightRadius * FP);
      if (at) at.worth += def.cost.minerals + def.cost.energy;
      else dead.push({ p: d.owner, x: d.x, y: d.y, worth: def.cost.minerals + def.cost.energy });
    }
    for (const now of dead) {
      const p = now.p;
      // The dead of the last `fightJudge` seconds at that place count together (a group killed over a few ticks).
      const windows = (this.fallen[p] ??= []).filter((f) => w.tick - f.tick <= sec(T.fightJudge));
      const prev = windows.find((f) => Math.hypot(now.x - f.x, now.y - f.y) <= T.fightRadius * FP);
      const d = prev ? Object.assign(prev, { worth: prev.worth + now.worth }) : { x: now.x, y: now.y, worth: now.worth, tick: w.tick };
      if (!prev) windows.push(d);
      this.fallen[p] = windows;
      const g = this.engaged[p];
      const [x, y] = [tiles(d.x), tiles(d.y)];
      // A group wiped out is one place as the dead are grouped (fightRadius), not a fight's wider reach: two wiped
      // 15 tiles apart in one tick are two (Codex, 2026-11-26).
      if (g?.judged && w.tick - g.seen <= sec(T.fightEnd) && Math.hypot(g.x - x, g.y - y) <= (g.wiped ? 1 : 2) * T.fightRadius) continue;
      const foes = w.players.filter((q) => q.id !== p && w.hostile(p, q.id)).map((q) => q.id);
      const f = this.forces(p, foes, d.x, d.y, T.fightRadius);
      // Survivors there: the fight goes on, judged as usual.
      if (f.ids.length) continue;
      if ([...w.entities.values()].some((b) => b.owner === p && b.def.kind === 'building' && Math.abs(b.x - d.x) <= T.homeRadius * FP && Math.abs(b.y - d.y) <= T.homeRadius * FP)) continue;
      if (f.enemy < T.fightFloor || d.worth >= T.outnumbered * f.enemy) continue;
      this.engaged[p] = { x, y, start: w.tick, seen: w.tick, judged: true, wiped: true };
      this.fallen[p] = windows.filter((f) => f !== d);
      const [tx, ty] = [Math.round(x), Math.round(y)];
      this.note({ player: p, kind: 'combat-en-inferiorite', tick: w.tick, x: tx, y: ty, detail: `${Math.round(d.worth)} contre ${Math.round(f.enemy)} (${Math.round((100 * d.worth) / f.enemy)} %), tous tués d’emblée` });
      this.note({ player: p, kind: 'pas-de-repli', tick: w.tick, endTick: w.tick, x: tx, y: ty, detail: 'groupe engagé en infériorité, 100 % perdus d’emblée' });
    }
  }

  private fallen: { x: number; y: number; worth: number; tick: number }[][] = [];

  /** Each tick: combat units just killed with hardly any of theirs round them, in front of a real enemy force. */
  private lonely(): void {
    const w = this.world;
    for (const d of w.deaths) {
      const def = DEFS[d.type] as UnitDef | undefined;
      if (d.owner < 0 || def?.kind !== 'unit' || def.worker || !(def.attack || def.heal || def.weapons)) continue;
      const foes = w.players.filter((q) => q.id !== d.owner && w.hostile(d.owner, q.id)).map((q) => q.id);
      const f = this.forces(d.owner, foes, d.x, d.y, T.fightRadius);
      if (f.enemy < T.fightFloor || f.ids.length > T.trickleAlone) continue;
      const lone = (this.lone[d.owner] ??= []);
      lone.push(w.tick);
      while (lone.length && w.tick - lone[0] > sec(T.trickleWindow)) lone.shift();
      const t = this.trickle[d.owner];
      if (t && w.tick - t.last <= sec(T.trickleWindow)) {
        t.last = w.tick;
        t.count++;
      } else {
        this.closeTrickle(d.owner);
        if (lone.length >= T.trickleDeaths && w.tick - lone[0] >= sec(T.trickleSpread)) this.trickle[d.owner] = { from: lone[0], last: w.tick, count: lone.length, noted: false };
      }
    }
    for (let p = 0; p < w.players.length; p++) if (this.trickle[p] && w.tick - this.trickle[p]!.last > sec(T.trickleWindow)) this.closeTrickle(p);
  }

  private closeTrickle(p: number): void {
    const t = this.trickle[p];
    if (!t) return;
    this.trickle[p] = undefined;
    this.lone[p] = [];
    this.note({ player: p, kind: 'renforts-goutte-a-goutte', tick: t.from, endTick: t.last, detail: `${t.count} unités tuées isolées (au plus ${T.trickleAlone} des leurs autour) en ${clock(t.last - t.from)}` });
  }

  /** Own base under attack while most of the army is, or was within `raceWindow`, at the enemy's: a race, told as a
   * neutral note (the army often dies over there before the base is hit, so its share is the highest of the window). */
  private race(p: number, army: Entity[], foes: number[], worth: number): void {
    const w = this.world;
    const buildings = [...w.entities.values()].filter((e) => e.def.kind === 'building' && (e.owner === p || foes.includes(e.owner)));
    // Away: nearer an enemy building than any of its own.
    const nearest = (e: Entity) => buildings.reduce<Entity | null>((n, b) => (!n || Math.hypot(b.x - e.x, b.y - e.y) < Math.hypot(n.x - e.x, n.y - e.y) ? b : n), null);
    const away = worth > 0 ? army.filter((e) => nearest(e)?.owner !== p).reduce((s, e) => s + strength(e), 0) / worth : 0;
    const seen = (this.away[p] ??= []);
    seen.push([w.tick, away]);
    while (w.tick - seen[0][0] > sec(T.raceWindow)) seen.shift();
    const key = `race:${p}`;
    if (w.tick - (this.lastNoted.get(key) ?? -Infinity) < sec(T.raceGap)) return;
    const hit = [...w.entities.values()].some((e) => e.owner === p && w.tick - e.lastHit < TICK_RATE && e.lastHit > 0 && (e.def.kind === 'building' || (e.def as UnitDef).worker));
    const most = Math.max(...seen.map(([, a]) => a));
    if (!hit || most < T.raceAway) return;
    this.lastNoted.set(key, w.tick);
    this.notes.push({ player: p, kind: 'echange-de-bases', tick: w.tick, detail: `base attaquée alors que ${Math.round(100 * most)} % de l’armée était chez l’adversaire` });
  }

  private away: [number, number][][] = [];

  /** Fights and key units noted earlier: did the group get wiped, did the key unit die? */
  private followUp(): void {
    const w = this.world;
    const alive = (id: number) => {
      const e = w.entities.get(id);
      return e && e.hp > 0 ? strength(e) : 0;
    };
    this.groups = this.groups.filter((g) => {
      if (w.tick - g.tick < sec(T.wipeTime)) return true;
      const left = g.ids.reduce((s, id) => s + alive(id), 0);
      if (g.worth > 0 && left <= (1 - T.wiped) * g.worth) this.note({ player: g.player, kind: 'pas-de-repli', tick: g.tick, endTick: w.tick, x: g.x, y: g.y, detail: `groupe engagé en infériorité, ${Math.round((100 * (g.worth - left)) / g.worth)} % perdus en ${T.wipeTime} s` });
      return false;
    });
    this.keys = this.keys.filter((k) => {
      if (!alive(k.id)) return void (k.fault.detail += ' : perdu');
      return w.tick < k.until;
    });
  }

  private scattered(p: number, army: Entity[]): void {
    const w = this.world;
    const homes = [...w.entities.values()].filter((e) => e.owner === p && e.def.kind === 'building');
    const near = (a: Entity, b: Entity, r: number) => Math.abs(a.x - b.x) <= r * FP && Math.abs(a.y - b.y) <= r * FP;
    const field = army.filter((e) => !homes.some((h) => near(e, h, T.homeRadius)));
    let out = 0;
    let total = 0;
    if (field.length >= T.scatterCount) {
      // The main group: the units round the one with most neighbours.
      let best: Entity[] = [];
      for (const e of field) {
        const g = field.filter((o) => near(e, o, T.groupRadius));
        if (g.length > best.length) best = g;
      }
      total = field.reduce((s, e) => s + strength(e), 0);
      out = total - best.reduce((s, e) => s + strength(e), 0);
      if (field.length - best.length < 3) out = 0;
    }
    const share = total ? Math.round((100 * out) / total) : 0;
    this.span(p, 'armee-eparpillee', total > 0 && out > T.scatterShare * total, share, T.scatterTime, (peak) => `jusqu’à ${peak} % de l’armée hors du groupe principal`);
  }

  private composition(p: number, army: Entity[], foeArmy: Entity[], own: number, enemy: number): void {
    const w = this.world;
    const key = `comp:${p}`;
    if (own < T.compositionFloor || enemy < T.compositionFloor) return;
    if (w.tick - (this.lastNoted.get(key) ?? -Infinity) < sec(T.compositionGap)) return;
    const mix: [Entity, number][] = foeArmy.map((e) => [e, strength(e)]);
    const total = mix.reduce((s, [, v]) => s + v, 0);
    const air = mix.reduce((s, [e, v]) => s + ((e.def as UnitDef).flying || e.airborne ? v : 0), 0);
    const armed = army.filter((e) => w.weapon(e));
    const antiAir = armed.filter((e) => mix.some(([t]) => ((t.def as UnitDef).flying || t.airborne) && hits(w.weapon(e)!, t))).reduce((s, e) => s + strength(e), 0);
    let why = '';
    if (air >= T.airShare * total && antiAir < T.antiAir * own) why = `${Math.round((100 * air) / total)} % de l’armée adverse vole, ${Math.round((100 * antiAir) / own)} % de la sienne peut la toucher`;
    else {
      // The army's damage per cost against the enemy's mix, next to the faction's usual roster's.
      const mine = armed.reduce((s, e) => s + strength(e) * fit(w.weapon(e), value(e), mix), 0) / Math.max(1, armed.reduce((s, e) => s + strength(e), 0));
      const roster = FACTIONS[w.players[p].faction].army.map(([t]) => DEFS[t] as UnitDef).filter((d) => d?.attack);
      const usual = roster.reduce((s, d) => s + fit(d.attack, d.cost.minerals + d.cost.energy, mix), 0) / Math.max(1, roster.length);
      if (armed.length && usual > 0 && mine < T.compositionRoster * usual) why = `dégâts par coût contre l’armée adverse à ${Math.round((100 * mine) / usual)} % de ceux de ses unités habituelles`;
    }
    if (!why) return;
    this.lastNoted.set(key, w.tick);
    this.note({ player: p, kind: 'composition-inadaptee', tick: w.tick, detail: why });
  }
}

/** A replay with no end recorded is played on after its last order, as the game's player does, this long at most. */
export const REPLAY_TAIL = 10 * 60;

/**
 * Plays a replay again without rendering, up to its end (or `maxTicks`), and analyses it. An older replay with no end
 * recorded goes on after its last order until someone wins, REPLAY_TAIL seconds at most (`truncated` if no one has):
 * cut at its last order, a game won 111 ticks later read as one without a winner (Codex review, point 5).
 */
export function analyzeReplay(r: Replay, maxTicks = Infinity): Analysis {
  // A replay's own map first: the page's registry may not have it, or have another under its id (Codex, 2026-11-26).
  const w = createMatch([...r.factions], r.teams, r.carte ?? r.map ?? DEFAULT_MAP, r.biome);
  r.handicap.forEach((h, i) => (w.players[i].handicap = h));
  const a = new Analyzer(w);
  const orders = new Map<number, Command[]>(r.ticks);
  const last = r.endTick ?? (r.ticks.length ? r.ticks[r.ticks.length - 1][0] + 1 + sec(REPLAY_TAIL) : 0);
  while (w.tick < Math.min(last, maxTicks) && w.winner === null) {
    w.step(orders.get(w.tick) ?? []);
    a.observe();
  }
  const done = a.finish();
  return r.endTick === undefined && w.winner === null && w.tick >= last && last > 0 ? { ...done, truncated: true } : done;
}

/** The analysis as a report to read. */
export function reportMarkdown(a: Analysis): string {
  const name = (p: number) => `J${p + 1} (${FACTIONS[a.factions[p] as keyof typeof FACTIONS]?.name ?? a.factions[p]})`;
  const out = [`# Analyse de partie`, '', `${a.factions.map((_, i) => name(i)).join(' contre ')}, ${clock(a.ticks)}${a.winner !== null && a.winner >= 0 ? `, victoire de ${name(a.winner)}` : ''}.`, ''];
  if (a.truncated) out.push(`Replay sans fin enregistrée, lu ${clock(sec(REPLAY_TAIL))} après son dernier ordre sans vainqueur : analyse tronquée.`, '');
  for (let p = 0; p < a.factions.length; p++) {
    out.push(`## ${name(p)}`, '');
    for (const family of ['economie', 'tactique'] as Family[]) {
      const list = a.faults.filter((f) => f.player === p && FAULTS[f.kind].family === family);
      out.push(`### ${family === 'economie' ? 'Économie' : 'Tactique et stratégie'}`, '');
      if (!list.length) out.push('Rien de relevé.', '');
      for (const f of list) out.push(`- ${clock(f.tick)}${f.endTick !== undefined ? `–${clock(f.endTick)}` : ''} · ${FAULTS[f.kind].label} : ${f.detail}${f.x !== undefined ? ` (case ${f.x}, ${f.y})` : ''}`);
      if (list.length) out.push('');
    }
    const notes = a.notes.filter((n) => n.player === p);
    if (notes.length) {
      out.push('### Chronologie (sans pénalité)', '');
      for (const n of notes) out.push(`- ${clock(n.tick)} · Échange de bases : ${n.detail}`);
      out.push('');
    }
  }
  return out.join('\n');
}
