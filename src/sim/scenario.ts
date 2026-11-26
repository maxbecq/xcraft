/**
 * A map's triggers, run by the simulation (docs/declencheurs.md, step 2): each tick, after the dead are buried and
 * before the match is judged, every trigger whose event happened and whose condition holds does its actions, in the
 * table's order. Integers only, the entities in their (id) order: the same commands give the same match on every
 * machine, and a replay plays it again. A match without triggers has no Scenario and is untouched.
 *
 * Everything is read once, when the match is made (a table that does not read fails there, never in a tick); each
 * tick looks at the entities once at most for the counts, and once for the regions.
 */
import { DEFS } from '../data';
import { FP, ticks } from './fixed';
import { type Action, BOUND, type Env, evaluate, type Expr, kindOf, parseExpr, type Triggers, WHEN_KINDS } from './triggers';
import type { World } from './world';

/** Most units the triggers make in one tick, all actions together (a runaway table cannot flood the match). */
export const MAX_SPAWNS_PER_TICK = 200;
/** Most units one « spawn » makes. */
export const MAX_SPAWN = 50;
const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

/** A trigger as read when the match is made: its event's kind, its region by place, its expressions parsed. */
interface Compiled {
  kind: (typeof WHEN_KINDS)[number];
  /** time, every: the tick (or period) in ticks. */
  at: number;
  region: number;
  owner: number | undefined;
  /** killed, built: the type ('' any). */
  type: string;
  check: Expr | null;
  cond: Expr | null;
  actions: { a: Action; exprs: Record<string, Expr> }[];
}

/** « Normal » seconds of play at a tick: the most seconds whose ticks() has come (the `time` of expressions). */
export function secondsAt(tick: number): number {
  let s = Math.floor((tick * 7) / 100); // ticks() is seconds × 20 / 1.4, rounded: s is at most one short
  while (ticks(s + 1) <= tick) s++;
  return s;
}

export class Scenario {
  private readonly compiled: Compiled[];
  /** Variables by name, with no inherited keys (`__proto__` is refused as a name anyway). */
  private readonly vars: Record<string, number> = Object.create(null);
  private readonly enabled: boolean[];
  /** Triggers « once » that have fired. */
  private readonly done: boolean[];
  /** A « check » event's condition at the last tick it was looked at: it fires when it becomes true. */
  private readonly was: boolean[];
  /** For « enter » and « leave »: ids of the matching units in the region at the last tick, in id order. */
  private readonly inside: number[][];
  /** Buildings already finished (not « built » again), once the first tick has listed those there at the start. */
  private finished: Set<number> | null = null;
  /** The first tick: what stands in the regions then is not « entering ». */
  private started = false;
  private spawned = 0;
  /** This tick's counts, made at the first expression that asks: `owner|kind|type` and `owner|kind|`. */
  private counts: Map<string, number> | null = null;
  private standing: Set<number> | null = null;

  constructor(private readonly table: Triggers) {
    const parse = (src: string) => parseExpr(src); // throws on a table that does not read: createMatch refuses it
    this.compiled = table.triggers.map((t): Compiled => {
      const w = t.when as Record<string, unknown>;
      const kind = kindOf(t.when) as Compiled['kind'];
      const exprs = (a: Action) => {
        const x = a as Record<string, unknown>;
        const out: Record<string, Expr> = {};
        for (const k of ['count', 'value', 'minerals', 'energy']) if (typeof x[k] === 'string') out[k] = parse(x[k] as string);
        return out;
      };
      return {
        kind,
        // time 0: the very first tick, before the first judgement (ticks(0) is 1).
        at: kind === 'time' ? ((w.time as number) === 0 ? 0 : ticks(w.time as number)) : kind === 'every' ? ticks(w.every as number) : 0,
        region: kind === 'enter' || kind === 'leave' ? table.regions.findIndex((g) => g.id === w[kind]) : -1,
        owner: w.owner as number | undefined,
        type: kind === 'killed' ? (w.killed as string) : kind === 'built' ? (w.built as string) : '',
        check: kind === 'check' ? parse(w.check as string) : null,
        cond: t.if && t.if.trim() ? parse(t.if) : null,
        actions: t.do.map((a) => ({ a, exprs: exprs(a) })),
      };
    });
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
      started: this.started,
    };
  }

  /** The counts of this tick, in one look at the entities. */
  private count(w: World): Map<string, number> {
    if (this.counts) return this.counts;
    const c = new Map<string, number>();
    const standing = new Set<number>();
    const add = (k: string) => c.set(k, (c.get(k) ?? 0) + 1);
    for (const e of w.entities.values()) {
      if (e.hp <= 0 || e.owner < 0) continue;
      if (e.def.kind === 'building') standing.add(e.owner); // as the judge sees a side (world.ts judge)
      // Units: not the illusions; buildings: the finished ones.
      if ((e.def.kind === 'unit' && !e.illusion) || (e.def.kind === 'building' && e.buildLeft === 0)) {
        add(`${e.owner}|${e.def.kind}|`);
        add(`${e.owner}|${e.def.kind}|${e.type}`);
      }
    }
    this.standing = standing;
    return (this.counts = c);
  }
  private env(w: World): Env {
    const player = (p: number) => (Number.isInteger(p) && p >= 1 && p <= w.players.length ? w.players[p - 1] : undefined);
    const n = (kind: string) => (p: number, type?: string) => this.count(w).get(`${p - 1}|${kind}|${type ?? ''}`) ?? 0;
    return {
      vars: this.vars,
      time: secondsAt(w.tick),
      units: n('unit'),
      buildings: n('building'),
      minerals: (p) => Math.floor(player(p)?.minerals ?? 0),
      energy: (p) => Math.floor(player(p)?.energy ?? 0),
      alive: (p) => {
        this.count(w);
        const q = player(p);
        return q && !q.resigned && this.standing!.has(p - 1) ? 1 : 0;
      },
    };
  }

  /** One tick of the table. */
  step(w: World): void {
    this.spawned = 0;
    this.counts = null;
    this.standing = null;
    const env = this.env(w);
    const value = (e: Expr) => clamp(evaluate(e, env), -BOUND, BOUND);
    const built = this.newlyBuilt(w);
    const regions = this.regionsNow(w);
    this.compiled.forEach((c, i) => {
      // The event first, even for a trigger off or spent: « enter » and « leave » keep track of what they saw.
      const fires = this.happened(w, c, i, built, regions, value);
      if (!fires || !this.enabled[i] || this.done[i]) return;
      if (c.cond && !value(c.cond)) return;
      if (this.table.triggers[i].once) this.done[i] = true;
      for (const a of c.actions) {
        this.act(w, a.a, a.exprs, value);
        this.counts = null; // what an action made or changed is counted again by the next expression
      }
    });
    this.started = true;
  }

  /** Buildings finished since the last tick (none on the first: those the map starts with are not « built »). */
  private newlyBuilt(w: World): { type: string; owner: number }[] {
    if (!this.compiled.some((c) => c.kind === 'built')) return [];
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

  /** For each region an « enter » or « leave » watches: the living units in it now, in id order, with their owners. */
  private regionsNow(w: World): Map<number, { id: number; owner: number }[]> {
    const out = new Map<number, { id: number; owner: number }[]>();
    for (const c of this.compiled) if ((c.kind === 'enter' || c.kind === 'leave') && c.region >= 0) out.set(c.region, []);
    if (!out.size) return out;
    const watched = [...out.keys()].map((r) => [r, this.table.regions[r].rect, out.get(r)!] as const);
    for (const e of w.entities.values()) {
      if (e.def.kind !== 'unit' || e.hp <= 0) continue;
      const [tx, ty] = [Math.floor(e.x / FP), Math.floor(e.y / FP)];
      for (const [, [x, y, rw, rh], list] of watched) if (tx >= x && ty >= y && tx < x + rw && ty < y + rh) list.push({ id: e.id, owner: e.owner });
    }
    return out;
  }

  private happened(w: World, c: Compiled, i: number, built: { type: string; owner: number }[], regions: Map<number, { id: number; owner: number }[]>, value: (e: Expr) => number): boolean {
    switch (c.kind) {
      case 'time': return w.tick === c.at;
      case 'every': return w.tick > 0 && w.tick % c.at === 0;
      case 'enter': case 'leave': {
        if (c.region < 0) return false;
        // Where units stand, whoever owns them: a unit taken where it stands neither enters nor leaves. The owner
        // the trigger names is looked at only for those that came or went (any player's if none, never a neutral).
        const all = regions.get(c.region)!;
        const now = all.map((u) => u.id);
        const before = this.inside[i];
        this.inside[i] = now;
        // Those there at the first tick did not « enter ».
        if (!this.started) return false;
        const named = (owner: number | undefined) => owner !== undefined && (c.owner === undefined ? owner >= 0 : owner === c.owner);
        // Both lists in id order: one walk tells who came and who went.
        let [a, b, came, went] = [0, 0, false, false];
        while (a < now.length || b < before.length) {
          if (b >= before.length || (a < now.length && now[a] < before[b])) {
            if (named(all[a].owner)) came = true;
            a++;
          } else if (a >= now.length || before[b] < now[a]) {
            // Leaving: still alive and out of the region (dying is not leaving; nor is a flying Caserne landing
            // where it is, gone from the units but still there: Codex, 2026-11-26).
            const e = w.entities.get(before[b++]);
            const [x, y, rw, rh] = this.table.regions[c.region].rect;
            const [tx, ty] = e ? [Math.floor(e.x / FP), Math.floor(e.y / FP)] : [0, 0];
            const there = tx >= x && ty >= y && tx < x + rw && ty < y + rh;
            if (e && e.hp > 0 && !there && named(e.owner)) went = true;
          } else (a++, b++);
        }
        return c.kind === 'enter' ? came : went;
      }
      case 'killed': return w.deaths.some((d) => !d.illusion && (c.type === '' ? DEFS[d.type]?.kind !== 'resource' : d.type === c.type) && (c.owner === undefined ? d.owner >= 0 : d.owner === c.owner));
      case 'built': return built.some((b) => b.type === c.type && (c.owner === undefined || b.owner === c.owner));
      case 'check': {
        // Looked at only while it may fire: a trigger off sees its condition anew when turned on.
        if (!this.enabled[i] || this.done[i]) {
          this.was[i] = false;
          return false;
        }
        const now = !!value(c.check!);
        const rose = now && !this.was[i];
        this.was[i] = now;
        return rose;
      }
    }
    return false;
  }

  private act(w: World, a: Action, exprs: Record<string, Expr>, value: (e: Expr) => number): void {
    const x = a as Record<string, unknown>;
    const seat = (p: unknown) => (typeof p === 'number' && p >= 0 && p < w.players.length ? w.players[p] : undefined);
    switch (kindOf(a)) {
      case 'message':
        for (const p of w.players) if (x.to === 'all' || x.to === p.id) w.events.push({ player: p.id, text: x.message as string, kind: 'info' });
        break;
      case 'spawn': {
        const owner = x.owner as number;
        if (owner >= w.players.length) break;
        const r = this.table.regions.find((g) => g.id === x.in);
        if (!r || DEFS[x.spawn as string]?.kind !== 'unit') break;
        const n = Math.min(clamp(value(exprs.count), 0, MAX_SPAWN), MAX_SPAWNS_PER_TICK - this.spawned);
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
      case 'set': this.vars[x.set as string] = value(exprs.value); break;
      case 'add': this.vars[x.add as string] = clamp((this.vars[x.add as string] ?? 0) + value(exprs.value), -BOUND, BOUND); break;
      case 'give': {
        const p = seat(x.give);
        if (!p) break;
        p.minerals = clamp(p.minerals + value(exprs.minerals), 0, BOUND);
        p.energy = clamp(p.energy + value(exprs.energy), 0, BOUND);
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
