/**
 * A map's triggers, run by the simulation (docs/declencheurs.md, step 2): each tick, after the dead are buried and
 * before the match is judged, every trigger whose event happened and whose condition holds does its actions, in the
 * table's order. Integers only, the entities in their (id) order: the same commands give the same match on every
 * machine, and a replay plays it again. A match without triggers has no Scenario and is untouched.
 */
import { DEFS } from '../data';
import { FP, GAME_SPEED, TICK_RATE, ticks } from './fixed';
import { type Action, type Expr, evaluate, type Env, kindOf, parseExpr, type Trigger, type Triggers } from './triggers';
import type { World } from './world';

/** Most units the triggers make in one tick, all actions together (a runaway table cannot flood the match). */
export const MAX_SPAWNS_PER_TICK = 200;
/** Most units one « spawn » makes. */
export const MAX_SPAWN = 50;
/** Variables stay within this, either side. */
const BOUND = 1_000_000_000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Scenario {
  /** Each expression read once, by its text. */
  private readonly parsed = new Map<string, Expr>();
  private readonly vars: Record<string, number> = {};
  private readonly enabled: boolean[];
  /** Triggers « once » that have fired. */
  private readonly done: boolean[];
  /** A « check » event's condition at the last tick: it fires when it becomes true. */
  private readonly was: boolean[];
  /** For « enter » and « leave »: ids of the matching units in the region at the last tick, in id order. */
  private readonly inside: number[][];
  /** Buildings already finished (not « built » again), once the first tick has listed those there at the start. */
  private finished: Set<number> | null = null;
  private spawned = 0;

  constructor(private readonly table: Triggers) {
    for (const v of table.vars) this.vars[v.id] = v.value;
    this.enabled = table.triggers.map((t) => t.enabled);
    this.done = table.triggers.map(() => false);
    this.was = table.triggers.map(() => false);
    this.inside = table.triggers.map(() => []);
  }

  /** What lasts from one tick to the next, for the match's fingerprint. */
  state(): unknown {
    return {
      vars: Object.keys(this.vars).sort().map((k) => [k, this.vars[k]]),
      enabled: this.enabled,
      done: this.done,
      was: this.was,
      inside: this.inside,
      finished: this.finished ? [...this.finished].sort((a, b) => a - b) : null,
    };
  }

  private expr(src: string): Expr {
    let e = this.parsed.get(src);
    if (!e) {
      e = parseExpr(src);
      this.parsed.set(src, e);
    }
    return e;
  }
  /** An expression's value now (the table was checked on import: it reads). */
  private value(w: World, src: string): number {
    return clamp(evaluate(this.expr(src), this.env(w)), -BOUND, BOUND);
  }
  private env(w: World): Env {
    const count = (kind: string) => (p: number, type?: string) => {
      let n = 0;
      for (const e of w.entities.values()) if (e.owner === p - 1 && e.hp > 0 && e.def.kind === kind && (type === undefined || e.type === type)) n++;
      return n;
    };
    const player = (p: number) => w.players[p - 1];
    return {
      vars: this.vars,
      time: Math.floor((w.tick * GAME_SPEED) / TICK_RATE + 1e-6),
      units: count('unit'),
      buildings: count('building'),
      minerals: (p) => Math.floor(player(p)?.minerals ?? 0),
      energy: (p) => Math.floor(player(p)?.energy ?? 0),
      alive: (p) => (player(p) && !player(p).resigned && [...w.entities.values()].some((e) => e.owner === p - 1 && e.def.kind === 'building') ? 1 : 0),
    };
  }

  /** One tick of the table. */
  step(w: World): void {
    this.spawned = 0;
    const built = this.newlyBuilt(w);
    this.table.triggers.forEach((t, i) => {
      // The event first, even for a trigger off or spent: « enter » and « check » keep track of what they saw.
      const fires = this.happened(w, t, i, built);
      if (!fires || !this.enabled[i] || this.done[i]) return;
      if (t.if && !this.value(w, t.if)) return;
      if (t.once) this.done[i] = true;
      for (const a of t.do) this.act(w, a);
    });
  }

  /** Buildings finished since the last tick (none on the first: those the map starts with are not « built »). */
  private newlyBuilt(w: World): { type: string; owner: number }[] {
    if (!this.table.triggers.some((t) => 'built' in t.when)) return [];
    const first = !this.finished;
    this.finished ??= new Set();
    const out: { type: string; owner: number }[] = [];
    for (const e of w.entities.values()) {
      if (e.def.kind !== 'building' || e.buildLeft > 0 || e.hp <= 0 || this.finished.has(e.id)) continue;
      this.finished.add(e.id);
      if (!first) out.push({ type: e.type, owner: e.owner });
    }
    // Ids of buildings gone are forgotten, so the list keeps the size of the buildings standing.
    for (const id of this.finished) if (!w.entities.has(id)) this.finished.delete(id);
    return out;
  }

  private happened(w: World, t: Trigger, i: number, built: { type: string; owner: number }[]): boolean {
    const when = t.when as Record<string, unknown>;
    const owner = when.owner as number | undefined;
    switch (kindOf(t.when)) {
      case 'time': return w.tick === ticks(when.time as number);
      case 'every': return w.tick > 0 && w.tick % ticks(when.every as number) === 0;
      case 'enter': case 'leave': {
        const r = this.table.regions.find((g) => g.id === (when.enter ?? when.leave));
        if (!r) return false;
        const [x, y, rw, rh] = r.rect;
        const now: number[] = [];
        for (const e of w.entities.values()) {
          if (e.def.kind !== 'unit' || e.hp <= 0 || (owner === undefined ? e.owner < 0 : e.owner !== owner)) continue;
          const [tx, ty] = [Math.floor(e.x / FP), Math.floor(e.y / FP)];
          if (tx >= x && ty >= y && tx < x + rw && ty < y + rh) now.push(e.id);
        }
        const before = this.inside[i];
        this.inside[i] = now;
        // Entering: inside now, not before. Leaving: inside before, still on the map, not inside now (dying is not leaving).
        if ('enter' in when) return now.some((id) => !before.includes(id));
        return before.some((id) => !now.includes(id) && (w.entities.get(id)?.hp ?? 0) > 0);
      }
      case 'killed': return w.deaths.some((d) => (when.killed === '' ? DEFS[d.type]?.kind !== 'resource' : d.type === when.killed) && (owner === undefined ? d.owner >= 0 : d.owner === owner));
      case 'built': return built.some((b) => b.type === when.built && (owner === undefined || b.owner === owner));
      case 'check': {
        const now = !!this.value(w, when.check as string);
        const rose = now && !this.was[i];
        this.was[i] = now;
        return rose;
      }
    }
    return false;
  }

  private act(w: World, a: Action): void {
    const x = a as Record<string, unknown>;
    const seat = (p: unknown) => (typeof p === 'number' && p >= 0 && p < w.players.length ? w.players[p] : undefined);
    switch (kindOf(a)) {
      case 'message':
        for (const p of w.players) if (x.to === 'all' || x.to === p.id) w.events.push({ player: p.id, text: x.message as string, kind: 'alert' });
        break;
      case 'spawn': {
        const owner = x.owner as number;
        if (owner >= w.players.length) break;
        const r = this.table.regions.find((g) => g.id === x.in);
        if (!r || DEFS[x.spawn as string]?.kind !== 'unit') break;
        const n = Math.min(clamp(this.value(w, x.count as string), 0, MAX_SPAWN), MAX_SPAWNS_PER_TICK - this.spawned);
        if (n <= 0) break;
        const [rx, ry, rw, rh] = r.rect;
        const spots: [number, number][] = [];
        for (let ty = ry; ty < ry + rh; ty++) for (let tx = rx; tx < rx + rw; tx++) if (w.grid.open(tx, ty)) spots.push([tx, ty]);
        if (!spots.length) break;
        const to = x.attack === undefined ? undefined : this.table.regions.find((g) => g.id === x.attack);
        for (let k = 0; k < n; k++) {
          const [tx, ty] = spots[k % spots.length];
          const e = w.spawn(x.spawn as string, owner, tx * FP + FP / 2, ty * FP + FP / 2);
          if (to) w.setOrder(e, { kind: 'attackMove', x: (to.rect[0] * 2 + to.rect[2]) * (FP / 2), y: (to.rect[1] * 2 + to.rect[3]) * (FP / 2), target: 0 });
        }
        this.spawned += n;
        break;
      }
      case 'set': this.vars[x.set as string] = this.value(w, x.value as string); break;
      case 'add': this.vars[x.add as string] = clamp((this.vars[x.add as string] ?? 0) + this.value(w, x.value as string), -BOUND, BOUND); break;
      case 'give': {
        const p = seat(x.give);
        if (!p) break;
        p.minerals = clamp(p.minerals + this.value(w, x.minerals as string), 0, BOUND);
        p.energy = clamp(p.energy + this.value(w, x.energy as string), 0, BOUND);
        break;
      }
      case 'forbid': case 'allow': {
        const p = seat(x.player);
        if (!p) break;
        const type = (x.forbid ?? x.allow) as string;
        const kept = (p.forbid ?? []).filter((t) => t !== type);
        if ('forbid' in x) kept.push(type);
        p.forbid = kept.length ? kept : undefined;
        break;
      }
      case 'victory':
        if (w.winner === null && seat(x.victory)) w.winner = x.victory as number;
        break;
      case 'defeat': {
        const p = seat(x.defeat);
        if (p) p.resigned = true; // out of the match, as one who gives up: the judge decides who is left
        break;
      }
      case 'enable': case 'disable': {
        const i = this.table.triggers.findIndex((t) => t.id === (x.enable ?? x.disable));
        if (i >= 0) this.enabled[i] = 'enable' in x;
        break;
      }
    }
  }
}
