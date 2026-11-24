import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { AI } from '../src/ai/ai';
import type { Doctrine, Strategy } from '../src/ai/strategy';
import { FACTIONS, type Faction } from '../src/data';
import { TICK_RATE } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Local search of one camp's AI settings (coordinate descent), only those that live in src/ai: the doctrine, the
// strategies' attack minute and wave size. Not the plan (balance.json, ai.plan): the balancer's. Each setting is played against a frozen group of opponents (the 0.9.143 AI,
// the AI as it was, the AI at the start of the search), on several maps, both seats, the same games every time.
// Kept only if it wins more than TUNE_MARGIN games over the best so far. A journal line per try (TUNE_OUT, JSON lines).
// Needs a frozen copy of the opponents' AI (TUNE_BASE, by default src/ai/v143, not in the repository).
// Run: TUNE=1 TUNE_CAMP=z TUNE_AI=../src/ai/cand-b0 TUNE_OUT=tune-z.jsonl npx vitest run scripts/tune.test.ts
it.skipIf(!process.env.TUNE)('tune', async () => {
  const dir = process.env.TUNE_AI ?? '../src/ai';
  const mod = await import(/* @vite-ignore */ `${dir}/ai`);
  const smod = await import(/* @vite-ignore */ `${dir}/strategy`);
  const Cand = mod.AI as typeof AI;
  const Old = (await import(/* @vite-ignore */ process.env.TUNE_BASE ?? '../src/ai/v143/ai')).AI as typeof AI;
  const STRATEGIES = smod.STRATEGIES as Record<Faction, Strategy[]>;
  const DOCTRINE = smod.DOCTRINE as Doctrine;
  const LEGACY = smod.LEGACY as Doctrine;
  const camp = process.env.TUNE_CAMP as Faction;
  const maps = (process.env.TUNE_MAPS ?? 'origine,carrefour,le-col').split(',');
  const k = Number(process.env.TUNE_K ?? 3);
  const margin = Number(process.env.TUNE_MARGIN ?? 2);
  const passes = Number(process.env.TUNE_PASSES ?? 3);
  const minutes = 30;
  const out = process.env.TUNE_OUT!;
  const humans = camp === 'humains';
  const pristine = structuredClone(STRATEGIES[camp]);
  // The settings searched: name, start, step, bounds.
  type P = { name: string; v: number; step: number; min: number; max: number };
  const start = humans ? LEGACY : DOCTRINE;
  const params: P[] = [
    { name: 'engage', v: start.engage, step: 0.25, min: 0, max: 2.5 },
    { name: 'retreat', v: start.retreat, step: 0.25, min: 0.75, max: 3 },
    { name: 'regroup', v: start.regroup, step: 1, min: 1, max: 10 },
    { name: 'escort', v: start.escort, step: 0.25, min: 0, max: 1.5 },
    // The strategies' own (the Humans play the AI as it was, without them).
    ...(humans
      ? []
      : [
          { name: 'attackShift', v: 0, step: 1, min: -4, max: 4 },
          { name: 'waveScale', v: 1, step: 0.2, min: 0.4, max: 2 },
          { name: 'waveGrowthShift', v: 0, step: 2, min: -6, max: 8 },
        ]),
    ...(camp === 'dieux'
      ? [
          { name: 'godQueue', v: DOCTRINE.godQueue, step: 1, min: 1, max: 6 },
          { name: 'godLevel', v: DOCTRINE.godLevel, step: 1, min: 1, max: 3 },
          { name: 'dieuxExpand', v: DOCTRINE.dieuxExpand, step: 1, min: 2, max: 10 },
        ]
      : []),
    ...(camp === 'isdaris' ? [{ name: 'extensionShift', v: 0, step: 1, min: -3, max: 4 }] : []),
  ];
  // A journal already there: start from its best setting (a search resumed).
  if (existsSync(out)) {
    const lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const best = lines.filter((l) => l.kept).at(-1);
    if (best) for (const p of params) if (best.setting[p.name] !== undefined) p.v = best.setting[p.name];
  }
  const setting = () => Object.fromEntries(params.map((p) => [p.name, p.v]));
  // Applies a setting: the strategies of the camp rewritten from their pristine copy, the doctrine returned.
  const apply = (s: Record<string, number>) => {
    STRATEGIES[camp].forEach((st, i) => {
      const o = pristine[i];
      Object.assign(st, structuredClone(o));
      if (humans) return;
      st.attackMinute = Math.max(0, (o.attackMinute ?? 0) + s.attackShift);
      if (o.wave !== undefined) st.wave = Math.max(2, Math.round(o.wave * s.waveScale));
      if (o.waveGrowth !== undefined) st.waveGrowth = Math.max(0, o.waveGrowth + s.waveGrowthShift);
      if (s.extensionShift !== undefined) st.extensionMinute = Math.max(1, (o.extensionMinute ?? 6) + s.extensionShift);
    });
    const doctrine: Doctrine = { ...start, engage: s.engage, retreat: s.retreat, regroup: Math.round(s.regroup), escort: s.escort };
    if (camp === 'dieux') Object.assign(doctrine, { godQueue: s.godQueue, godLevel: s.godLevel, dieuxExpand: s.dieuxExpand });
    return { doctrine };
  };
  const foes = (['z', 'dieux', 'isdaris', 'humains'] as Faction[]).filter((f) => f !== camp);
  // Plays every game of the group with a setting: wins, and by map.
  const play = (s: Record<string, number>) => {
    const { doctrine } = apply(s);
    const byMap: Record<string, number> = {};
    let wins = 0;
    let games = 0;
    for (const map of maps) {
      for (const foe of foes) {
        for (const seat of [0, 1]) {
          for (let j = 0; j < k; j++) {
            const order = (seat === 0 ? [camp, foe] : [foe, camp]) as [Faction, Faction];
            const w = createMatch(order, undefined, map);
            const hs = [100, 90, 110];
            w.players[0].handicap = hs[j % 3];
            w.players[1].handicap = hs[(j + 1) % 3];
            const pick = (f: Faction) => (STRATEGIES[f].length ? { strategy: STRATEGIES[f][j % STRATEGIES[f].length].id } : {});
            // The opponent: the 0.9.143 AI, the AI as it was (legacy), the AI at the start of the search, in turn.
            const kind = j % 3;
            const ais = [0, 1].map((p) =>
              p === seat
                ? new Cand(w, p, undefined, 'normal', humans ? { legacy: true, doctrine } : { ...pick(camp), doctrine })
                : kind === 0
                  ? new Old(w, p, undefined, 'normal', foe === 'humains' ? {} : pick(foe))
                  : kind === 1
                    ? new Cand(w, p, undefined, 'normal', { legacy: true })
                    : new Cand(w, p, undefined, 'normal', foe === 'humains' ? {} : pick(foe)),
            );
            const delay = [j * 10, ((j * 3) % 5) * 10];
            while (w.winner === null && w.tick < minutes * 60 * TICK_RATE) w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
            const won = w.winner === seat ? 1 : 0;
            wins += won;
            byMap[map] = (byMap[map] ?? 0) + won;
            games++;
          }
        }
      }
    }
    return { wins, games, byMap };
  };
  const log = (o: object) => appendFileSync(out, JSON.stringify({ at: new Date().toISOString(), camp, ...o }) + '\n');
  let best = play(setting());
  log({ kind: 'start', setting: setting(), ...best, kept: true });
  for (let pass = 0; pass < passes; pass++) {
    let gained = 0;
    for (const p of params) {
      for (const dir of [1, -1]) {
        const v = Math.round((p.v + dir * p.step) * 1000) / 1000;
        if (v < p.min || v > p.max) continue;
        const was = p.v;
        p.v = v;
        const r = play(setting());
        const kept = r.wins >= best.wins + margin;
        log({ kind: 'try', pass, param: p.name, from: was, to: v, setting: setting(), ...r, best: best.wins, kept });
        if (kept) {
          gained += r.wins - best.wins;
          best = r;
          break;
        }
        p.v = was;
      }
    }
    log({ kind: 'pass', pass, gained, best: best.wins, setting: setting() });
    if (gained < margin) break;
  }
  writeFileSync(`${out}.best.json`, JSON.stringify({ camp, setting: setting(), ...best, faction: FACTIONS[camp].name }, null, 2));
}, 24 * 3600_000);
