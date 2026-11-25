/**
 * A map's triggers, as docs/declencheurs.md recommends: a declarative table (when, if, do) with integer
 * mini-expressions. The model, its reader and checks, and the expressions' evaluator: pure and bounded, shared by the
 * map editor (which writes the table) and the simulation (scenario.ts, which runs it). No rendering here.
 */
import { DEFS } from '../data';

/** A rectangle of tiles: [x, y, w, h]. */
export interface Region {
  id: string;
  rect: [number, number, number, number];
}
export interface Variable {
  id: string;
  value: number;
}
export type When =
  | { time: number }
  | { every: number }
  | { enter: string; owner?: number }
  | { leave: string; owner?: number }
  | { killed: string; owner?: number }
  | { built: string; owner?: number }
  | { check: string };
export type Action =
  | { message: string; to: 'all' | number; seconds: number }
  | { spawn: string; count: string; owner: number; in: string; attack?: string }
  | { set: string; value: string }
  | { add: string; value: string }
  | { give: number; minerals: string; energy: string }
  | { forbid: string; player: number }
  | { allow: string; player: number }
  | { victory: number }
  | { defeat: number }
  | { enable: string }
  | { disable: string };
export interface Trigger {
  id: string;
  folder: string;
  enabled: boolean;
  once: boolean;
  when: When;
  if?: string;
  do: Action[];
}
export interface Triggers {
  regions: Region[];
  vars: Variable[];
  triggers: Trigger[];
}

export const LIMITS = { triggers: 200, actions: 30, regions: 64, vars: 64, text: 200, expr: 200, seconds: 36_000, value: 1_000_000 };
/** Names of regions and variables: they appear in expressions. */
export const NAME = /^[a-z_][a-z0-9_]{0,23}$/;
/** Words an expression keeps for itself. */
export const RESERVED = new Set(['and', 'or', 'not', 'time', ...Object.keys({ units: 0, buildings: 0, minerals: 0, energy: 0, alive: 0 })]);
export const WHEN_KINDS = ['time', 'every', 'enter', 'leave', 'killed', 'built', 'check'] as const;
export const ACTION_KINDS = ['message', 'spawn', 'set', 'add', 'give', 'forbid', 'allow', 'victory', 'defeat', 'enable', 'disable'] as const;
export const kindOf = <T extends object>(x: T) => Object.keys(x)[0] as keyof T & string;

// ---- expressions ----
export type Expr =
  | { n: number }
  | { v: string }
  | { s: string }
  | { op: string; a: Expr; b?: Expr }
  | { f: string; args: Expr[] };
/** Functions an expression may call: their argument counts. Players are numbered from 1 in expressions, as on screen. */
export const FUNCS: Record<string, [number, number]> = { units: [1, 2], buildings: [1, 2], minerals: [1, 1], energy: [1, 1], alive: [1, 1] };

/** Reads an expression; throws a message in French. */
export function parseExpr(src: string): Expr {
  if (src.length > LIMITS.expr) throw new Error(`Expression trop longue (${LIMITS.expr} caractères au plus).`);
  const toks = src.match(/\s*(\d+|[a-z_][a-z0-9_]*|'[^']*'|==|!=|<=|>=|[-+*/%<>(),]|\S)/gi)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const peek = () => toks[i];
  const eat = (t?: string) => {
    const x = toks[i++];
    if (t !== undefined && x !== t) throw new Error(`« ${t} » attendu${x === undefined ? ' à la fin' : ` au lieu de « ${x} »`}.`);
    return x;
  };
  const bin = (next: () => Expr, ops: string[]) => () => {
    let a = next();
    while (ops.includes(peek())) {
      const op = eat();
      a = { op, a, b: next() };
    }
    return a;
  };
  const atom = (): Expr => {
    const t = eat();
    if (t === undefined) throw new Error('Expression incomplète.');
    if (t === '(') {
      const e = or();
      eat(')');
      return e;
    }
    if (t === '-') return { op: 'neg', a: atom() };
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n > LIMITS.value) throw new Error(`Nombre trop grand (${LIMITS.value} au plus).`);
      return { n };
    }
    if (/^'[^']*'$/.test(t)) return { s: t.slice(1, -1) };
    if (/^[a-z_][a-z0-9_]*$/i.test(t)) {
      if (peek() !== '(') return { v: t };
      eat('(');
      const args: Expr[] = [];
      if (peek() !== ')') {
        args.push(or());
        while (peek() === ',') (eat(), args.push(or()));
      }
      eat(')');
      return { f: t, args };
    }
    throw new Error(`Signe inattendu : « ${t} ».`);
  };
  const prod = bin(atom, ['*', '/', '%']);
  const sum = bin(prod, ['+', '-']);
  const cmp = bin(sum, ['==', '!=', '<=', '>=', '<', '>']);
  const not = (): Expr => (peek() === 'not' ? (eat(), { op: 'not', a: not() }) : cmp());
  const and = bin(not, ['and']);
  const or = bin(and, ['or']);
  if (!toks.length) throw new Error('Expression vide.');
  const e = or();
  if (i < toks.length) throw new Error(`Suite inattendue : « ${toks.slice(i).join(' ')} ».`);
  return e;
}

/** The names an expression reads and the problems with it (unknown variable, function, unit type), in French. */
export function checkExpr(e: Expr, vars: Set<string>, players: number): string[] {
  const out: string[] = [];
  const walk = (x: Expr, arg = false): void => {
    if ('v' in x) {
      if (x.v !== 'time' && !vars.has(x.v)) out.push(`variable inconnue « ${x.v} »`);
    } else if ('s' in x) {
      if (!arg) out.push(`texte « ${x.s} » hors d'un appel de fonction`);
      else if (!Object.hasOwn(DEFS, x.s) || DEFS[x.s].kind === 'upgrade' || DEFS[x.s].kind === 'resource') out.push(`type inconnu « ${x.s} »`);
    } else if ('f' in x) {
      const ar = FUNCS[x.f];
      if (!ar) out.push(`fonction inconnue « ${x.f} » (${Object.keys(FUNCS).join(', ')})`);
      else if (x.args.length < ar[0] || x.args.length > ar[1]) out.push(`« ${x.f} » prend ${ar[0] === ar[1] ? ar[0] : `${ar[0]} ou ${ar[1]}`} argument${ar[1] > 1 ? 's' : ''}`);
      else {
        const p = x.args[0];
        if ('n' in p && (p.n < 1 || p.n > players)) out.push(`joueur ${p.n} inexistant (1 à ${players})`);
        x.args.forEach((a, k) => walk(a, k > 0));
      }
    } else if ('op' in x) {
      walk(x.a);
      if (x.b) walk(x.b);
    }
  };
  walk(e);
  return out;
}

/** What an expression reads from the game: players 1… as on screen. */
export interface Env {
  vars: Record<string, number>;
  time: number;
  units(player: number, type?: string): number;
  buildings(player: number, type?: string): number;
  minerals(player: number): number;
  energy(player: number): number;
  alive(player: number): number;
}
/** Integer arithmetic only (division towards zero, by zero gives 0); comparisons and logic give 1 or 0. */
export function evaluate(e: Expr, env: Env): number {
  const ev = (x: Expr): number => {
    if ('n' in x) return x.n;
    if ('v' in x) return x.v === 'time' ? env.time : (env.vars[x.v] ?? 0);
    if ('s' in x) return 0;
    if ('f' in x) {
      const [p, t] = [ev(x.args[0]), x.args[1] && 's' in x.args[1] ? x.args[1].s : undefined];
      return (env[x.f as 'units'] as (p: number, t?: string) => number)(p, t);
    }
    const a = ev(x.a);
    if (x.op === 'neg') return -a;
    if (x.op === 'not') return a ? 0 : 1;
    if (x.op === 'and') return a && ev(x.b!) ? 1 : 0;
    if (x.op === 'or') return a || ev(x.b!) ? 1 : 0;
    const b = ev(x.b!);
    switch (x.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': return b ? Math.trunc(a / b) : 0;
      case '%': return b ? a % b : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
    }
    return 0;
  };
  return ev(e);
}

// ---- the table, checked ----
/**
 * Every problem of a triggers table for a map of `size` tiles and `players` seats, in French, one per line (empty:
 * all is well). `strict` (an import) also refuses what is malformed rather than merely wrong.
 */
export function triggerProblems(t: Triggers, size: number, players: number): string[] {
  return problems(t, size, players).all;
}
/**
 * The problems an import refuses: all but the broken references (a region, variable or trigger named but gone,
 * a trigger with no action), which the editor shows and the file may keep while one works.
 */
export function triggerFaults(t: Triggers, size: number, players: number): string[] {
  const p = problems(t, size, players);
  return p.all.filter((x) => !p.soft.has(x));
}
function problems(t: Triggers, size: number, players: number): { all: string[]; soft: Set<string> } {
  const out: string[] = [];
  const soft = new Set<string>();
  const ref = (s: string) => (soft.add(s), out.push(s));
  const regions = new Set(t.regions.map((r) => r.id));
  const vars = new Set(t.vars.map((v) => v.id));
  const ids = new Set(t.triggers.map((x) => x.id));
  if (regions.size !== t.regions.length) out.push('Deux régions ont le même nom.');
  if (vars.size !== t.vars.length) out.push('Deux variables ont le même nom.');
  if (ids.size !== t.triggers.length) out.push('Deux déclencheurs ont le même nom.');
  for (const x of [...t.regions, ...t.vars]) if (!NAME.test(x.id) || RESERVED.has(x.id)) out.push(`Nom « ${x.id} » refusé : minuscules, chiffres et _, pas un mot réservé (${[...RESERVED].join(', ')}).`);
  for (const r of t.regions) {
    const [x, y, w, h] = r.rect;
    if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > size || y + h > size) out.push(`Région « ${r.id} » hors de la carte.`);
  }
  const player = (p: number, what: string, neutral = false) => {
    if (!Number.isInteger(p) || p < (neutral ? -1 : 0) || p >= players) out.push(`${what} : joueur inexistant.`);
  };
  const expr = (src: string | undefined, what: string) => {
    if (src === undefined || src === '') return;
    try {
      for (const m of checkExpr(parseExpr(src), vars, players)) (m.startsWith('variable inconnue') ? ref : (s: string) => out.push(s))(`${what} : ${m}.`);
    } catch (e) {
      out.push(`${what} : ${(e as Error).message}`);
    }
  };
  const type = (s: string, kinds: string[], what: string) => {
    if (!Object.hasOwn(DEFS, s) || !kinds.includes(DEFS[s].kind)) out.push(`${what} : type « ${s} » inconnu.`);
  };
  const region = (r: string | undefined, what: string) => {
    if (r !== undefined && !regions.has(r)) ref(`${what} : région « ${r} » inconnue.`);
  };
  const variable = (v: string, what: string) => {
    if (!vars.has(v)) ref(`${what} : variable « ${v} » inconnue.`);
  };
  for (const tr of t.triggers) {
    const w = `« ${tr.id} »`;
    const when = tr.when as Record<string, unknown>;
    const k = kindOf(tr.when);
    if ('owner' in when && when.owner !== undefined) player(when.owner as number, `${w}, quand`);
    if (k === 'time' || k === 'every') {
      const s = (when[k] as number);
      if (!Number.isInteger(s) || s < (k === 'every' ? 1 : 0) || s > LIMITS.seconds) out.push(`${w}, quand : durée hors bornes (${k === 'every' ? 1 : 0} à ${LIMITS.seconds} s).`);
    }
    if (k === 'enter' || k === 'leave') region(when[k] as string, `${w}, quand`);
    if (k === 'killed' && when.killed !== '') type(when.killed as string, ['unit', 'building'], `${w}, quand`);
    if (k === 'built') type(when.built as string, ['building'], `${w}, quand`);
    if (k === 'check') expr(when.check as string, `${w}, quand`);
    expr(tr.if, `${w}, si`);
    if (!tr.do.length) ref(`${w} : aucune action.`);
    tr.do.forEach((a, n) => {
      const at = `${w}, action ${n + 1}`;
      const x = a as Record<string, unknown>;
      switch (kindOf(a)) {
        case 'message': if (x.to !== 'all') player(x.to as number, at); break;
        case 'spawn':
          type(x.spawn as string, ['unit'], at);
          expr(x.count as string, at);
          player(x.owner as number, at, true);
          region(x.in as string, at);
          region(x.attack as string | undefined, at);
          break;
        case 'set': case 'add':
          variable((x.set ?? x.add) as string, at);
          expr(x.value as string, at);
          break;
        case 'give':
          player(x.give as number, at);
          expr(x.minerals as string, at);
          expr(x.energy as string, at);
          break;
        case 'forbid': case 'allow':
          type((x.forbid ?? x.allow) as string, ['unit', 'building', 'upgrade'], at);
          player(x.player as number, at);
          break;
        case 'victory': case 'defeat': player((x.victory ?? x.defeat) as number, at); break;
        case 'enable': case 'disable': if (!ids.has((x.enable ?? x.disable) as string)) ref(`${at} : déclencheur « ${x.enable ?? x.disable} » inconnu.`); break;
      }
    });
  }
  return { all: out, soft };
}

/** Reads an untrusted triggers table (an import): its shape, field by field; throws a message in French. */
export function readTriggers(v: unknown, size: number, players: number): Triggers {
  const bad = (what: string): never => {
    throw new Error(`Déclencheurs : ${what}.`);
  };
  const rec = (x: unknown, what: string) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : bad(`${what} : un objet est attendu`));
  const only = (x: Record<string, unknown>, keys: string[], what: string) => Object.keys(x).forEach((k) => keys.includes(k) || bad(`${what} : champ inconnu « ${k} »`));
  const arr = (x: unknown, max: number, what: string) => (Array.isArray(x) && x.length <= max ? x : bad(`${what} : une liste de ${max} au plus est attendue`));
  const int = (x: unknown, lo: number, hi: number, what: string) => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : bad(`${what} : un entier de ${lo} à ${hi} est attendu`));
  const str = (x: unknown, max: number, what: string) => (typeof x === 'string' && x.length <= max ? x : bad(`${what} : un texte de ${max} caractères au plus est attendu`));
  const name = (x: unknown, what: string) => (typeof x === 'string' && NAME.test(x) && !RESERVED.has(x) ? x : bad(`${what} : un nom en minuscules, chiffres et _ est attendu (pas un mot réservé)`));
  const t = rec(v, 'la table');
  only(t, ['regions', 'vars', 'triggers'], 'la table');
  const regions = arr(t.regions ?? [], LIMITS.regions, 'regions').map((r, i) => {
    const o = rec(r, `région ${i + 1}`);
    only(o, ['id', 'rect'], `région ${i + 1}`);
    const rect = arr(o.rect, 4, `région ${i + 1}, rect`);
    if (rect.length !== 4) bad(`région ${i + 1}, rect : quatre entiers`);
    return { id: name(o.id, `région ${i + 1}`), rect: rect.map((n, k) => int(n, k < 2 ? 0 : 1, size, `région ${i + 1}, rect`)) as Region['rect'] };
  });
  const vars = arr(t.vars ?? [], LIMITS.vars, 'vars').map((x, i) => {
    const o = rec(x, `variable ${i + 1}`);
    only(o, ['id', 'value'], `variable ${i + 1}`);
    return { id: name(o.id, `variable ${i + 1}`), value: int(o.value, -LIMITS.value, LIMITS.value, `variable ${i + 1}`) };
  });
  const P = (x: unknown, what: string, neutral = false) => int(x, neutral ? -1 : 0, players - 1, what);
  const triggers = arr(t.triggers ?? [], LIMITS.triggers, 'triggers').map((x, i): Trigger => {
    const w = `déclencheur ${i + 1}`;
    const o = rec(x, w);
    only(o, ['id', 'folder', 'enabled', 'once', 'when', 'if', 'do'], w);
    const wh = rec(o.when, `${w}, when`);
    const k = Object.keys(wh).find((x) => (WHEN_KINDS as readonly string[]).includes(x)) ?? Object.keys(wh)[0];
    let when: When;
    switch (k) {
      case 'time': case 'every':
        only(wh, [k], `${w}, when`);
        when = { [k]: int(wh[k], 0, LIMITS.seconds, `${w}, when`) } as When;
        break;
      case 'enter': case 'leave': case 'killed': case 'built':
        only(wh, [k, 'owner'], `${w}, when`);
        when = { [k]: k === 'enter' || k === 'leave' ? name(wh[k], `${w}, when`) : str(wh[k], 40, `${w}, when`), ...(wh.owner === undefined ? {} : { owner: P(wh.owner, `${w}, owner`) }) } as When;
        break;
      case 'check':
        only(wh, ['check'], `${w}, when`);
        when = { check: str(wh.check, LIMITS.expr, `${w}, when`) };
        break;
      default:
        return bad(`${w} : événement inconnu « ${k} »`);
    }
    const acts = arr(o.do, LIMITS.actions, `${w}, do`).map((y, n): Action => {
      const at = `${w}, action ${n + 1}`;
      const a = rec(y, at);
      const ak = Object.keys(a).find((x) => (ACTION_KINDS as readonly string[]).includes(x)) ?? Object.keys(a)[0];
      const e = (z: unknown) => str(z, LIMITS.expr, at);
      switch (ak) {
        case 'message': only(a, ['message', 'to', 'seconds'], at); return { message: str(a.message, LIMITS.text, at), to: a.to === 'all' ? 'all' : P(a.to, at), seconds: int(a.seconds, 1, 120, at) };
        case 'spawn': only(a, ['spawn', 'count', 'owner', 'in', 'attack'], at); return { spawn: str(a.spawn, 40, at), count: e(a.count), owner: P(a.owner, at, true), in: name(a.in, at), ...(a.attack === undefined ? {} : { attack: name(a.attack, at) }) };
        case 'set': only(a, ['set', 'value'], at); return { set: name(a.set, at), value: e(a.value) };
        case 'add': only(a, ['add', 'value'], at); return { add: name(a.add, at), value: e(a.value) };
        case 'give': only(a, ['give', 'minerals', 'energy'], at); return { give: P(a.give, at), minerals: e(a.minerals), energy: e(a.energy) };
        case 'forbid': only(a, ['forbid', 'player'], at); return { forbid: str(a.forbid, 40, at), player: P(a.player, at) };
        case 'allow': only(a, ['allow', 'player'], at); return { allow: str(a.allow, 40, at), player: P(a.player, at) };
        case 'victory': only(a, ['victory'], at); return { victory: P(a.victory, at) };
        case 'defeat': only(a, ['defeat'], at); return { defeat: P(a.defeat, at) };
        case 'enable': only(a, ['enable'], at); return { enable: str(a.enable, 40, at) };
        case 'disable': only(a, ['disable'], at); return { disable: str(a.disable, 40, at) };
        default: return bad(`${at} : action inconnue « ${ak} »`);
      }
    });
    return {
      id: str(o.id, 40, w) || bad(`${w} : nom vide`),
      folder: o.folder === undefined ? '' : str(o.folder, 40, w),
      enabled: o.enabled !== false,
      once: o.once === true,
      when,
      ...(o.if === undefined || o.if === '' ? {} : { if: str(o.if, LIMITS.expr, w) }),
      do: acts,
    };
  });
  const out = { regions, vars, triggers };
  const faults = triggerFaults(out, size, players);
  if (faults.length) bad(faults[0].replace(/\.$/, ''));
  return out;
}

/** A blank action of each kind (the editor's « ajouter une action »). */
export function blankAction(kind: (typeof ACTION_KINDS)[number], t: Triggers): Action {
  const reg = t.regions[0]?.id ?? 'zone';
  const v = t.vars[0]?.id ?? 'compteur';
  switch (kind) {
    case 'message': return { message: 'Message', to: 'all', seconds: 5 };
    case 'spawn': return { spawn: 'auxiliaire', count: '1', owner: 1, in: reg };
    case 'set': return { set: v, value: '0' };
    case 'add': return { add: v, value: '1' };
    case 'give': return { give: 0, minerals: '100', energy: '0' };
    case 'forbid': return { forbid: 'caserne', player: 0 };
    case 'allow': return { allow: 'caserne', player: 0 };
    case 'victory': return { victory: 0 };
    case 'defeat': return { defeat: 0 };
    case 'enable': return { enable: t.triggers[0]?.id ?? '' };
    case 'disable': return { disable: t.triggers[0]?.id ?? '' };
  }
}
export function blankWhen(kind: (typeof WHEN_KINDS)[number], t: Triggers): When {
  const reg = t.regions[0]?.id ?? 'zone';
  switch (kind) {
    case 'time': return { time: 0 };
    case 'every': return { every: 30 };
    case 'enter': return { enter: reg };
    case 'leave': return { leave: reg };
    case 'killed': return { killed: '' };
    case 'built': return { built: 'caserne' };
    case 'check': return { check: 'time >= 600' };
  }
}

// ---- renaming, references followed ----
/** Renames a region, in the triggers that name it too. */
export function renameRegion(t: Triggers, from: string, to: string): void {
  for (const r of t.regions) if (r.id === from) r.id = to;
  for (const tr of t.triggers) {
    const w = tr.when as Record<string, unknown>;
    for (const k of ['enter', 'leave']) if (w[k] === from) w[k] = to;
    for (const a of tr.do) {
      const x = a as Record<string, unknown>;
      for (const k of ['in', 'attack']) if (x[k] === from) x[k] = to;
    }
  }
}
/** An expression with one name changed (quoted texts left alone). */
const renamed = (src: string, from: string, to: string) => src.replace(/'[^']*'|[a-z_][a-z0-9_]*/gi, (m) => (m === from ? to : m));
/** Renames a variable, in every expression and action that uses it too. */
export function renameVar(t: Triggers, from: string, to: string): void {
  for (const v of t.vars) if (v.id === from) v.id = to;
  for (const tr of t.triggers) {
    const w = tr.when as Record<string, unknown>;
    if (typeof w.check === 'string') w.check = renamed(w.check, from, to);
    if (tr.if) tr.if = renamed(tr.if, from, to);
    for (const a of tr.do) {
      const x = a as Record<string, unknown>;
      for (const k of ['count', 'value', 'minerals', 'energy']) if (typeof x[k] === 'string') x[k] = renamed(x[k] as string, from, to);
      for (const k of ['set', 'add']) if (x[k] === from) x[k] = to;
    }
  }
}
/** Renames a trigger, in the actions that turn it on or off too. */
export function renameTrigger(t: Triggers, from: string, to: string): void {
  for (const tr of t.triggers) {
    if (tr.id === from) tr.id = to;
    for (const a of tr.do) {
      const x = a as Record<string, unknown>;
      for (const k of ['enable', 'disable']) if (x[k] === from) x[k] = to;
    }
  }
}
