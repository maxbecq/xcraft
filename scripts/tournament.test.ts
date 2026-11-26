import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AI } from '../src/ai/ai';
import { DOCTRINE, ON_BY_DEFAULT, STRATEGIES } from '../src/ai/strategy';
import { type Analysis, Analyzer, clock, FAULTS, type FaultKind } from '../src/analysis/analyze';
import { FACTIONS, type Faction } from '../src/data';
import { TICK_RATE } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
import BALANCE from '../src/balance.json';

type Row = { games: Analysis[]; seats: number[]; wins: number; strategies: Record<string, [number, number]>; foes: Record<string, [number, number]> };

/** A camp's part of the report; with « après » only (TOURNEY_AFTER), no « avant » column (it showed NaN: Codex review, point 8). */
export function campReport(camp: Faction, rows: Record<'avant' | 'apres', Row>, n: number): string[] {
  const { avant, apres } = rows;
  const both = avant.games.length > 0;
  const per = (r: Row, kind: FaultKind) => r.games.reduce((s, g, i) => s + g.faults.filter((f) => f.player === r.seats[i] && f.kind === kind).length, 0) / r.games.length;
  const share = (r: Row, kind: FaultKind) => r.games.filter((g, i) => g.faults.some((f) => f.player === r.seats[i] && f.kind === kind)).length / r.games.length;
  const total = (r: Row) => r.games.reduce((s, g, i) => s + g.faults.filter((f) => f.player === r.seats[i]).length, 0) / r.games.length;
  const out = [`## ${FACTIONS[camp].name}`, ''];
  if (both) out.push(`${avant.games.length} parties par colonne. Victoires contre l’IA actuelle : avant ${avant.wins}, après ${apres.wins}. Fautes par partie : avant ${total(avant).toFixed(1)}, après ${total(apres).toFixed(1)}.`, '');
  else out.push(`${apres.games.length} parties, après seulement. Victoires contre l’IA actuelle : ${apres.wins}. Fautes par partie : ${total(apres).toFixed(1)}.`, '');
  out.push(both ? `Victoires par adversaire (avant / après, sur ${2 * n} parties) : ${Object.keys(apres.foes).map((f) => `${FACTIONS[f as Faction].name} ${avant.foes[f]?.[1] ?? '–'} / ${apres.foes[f][1]}`).join(', ')}.` : `Victoires par adversaire (sur ${2 * n} parties) : ${Object.keys(apres.foes).map((f) => `${FACTIONS[f as Faction].name} ${apres.foes[f][1]}`).join(', ')}.`, '');
  out.push(`Stratégies (parties, victoires) : ${Object.entries(apres.strategies).map(([k, [g, v]]) => `${k} ${g}/${v}`).join(', ')}.`, '');
  if (both) {
    out.push('| Faute | Parties avant | Parties après | Par partie avant | Par partie après |', '|---|---|---|---|---|');
    for (const kind of Object.keys(FAULTS) as FaultKind[]) out.push(`| ${FAULTS[kind].label} | ${Math.round(100 * share(avant, kind))} % | ${Math.round(100 * share(apres, kind))} % | ${per(avant, kind).toFixed(1)} | ${per(apres, kind).toFixed(1)} |`);
  } else {
    out.push('| Faute | Parties | Par partie |', '|---|---|---|');
    for (const kind of Object.keys(FAULTS) as FaultKind[]) out.push(`| ${FAULTS[kind].label} | ${Math.round(100 * share(apres, kind))} % | ${per(apres, kind).toFixed(1)} |`);
  }
  out.push('');
  return out;
}

it('le rapport d’un tournoi « après » seulement n’a pas de colonne « avant » ni de NaN', () => {
  const empty = (): Row => ({ games: [], seats: [], wins: 0, strategies: {}, foes: {} });
  const apres: Row = { games: [{ factions: ['z', 'dieux'], ticks: 100, winner: 0, faults: [], notes: [], timeline: [] }], seats: [0], wins: 1, strategies: { essaim: [1, 1] }, foes: { dieux: [1, 1] } };
  const md = campReport('z', { avant: empty(), apres }, 1).join('\n');
  expect(md).not.toContain('NaN');
  expect(md).not.toContain('avant');
  expect(md).toContain('Victoires contre l’IA actuelle : 1');
});
// Before and after the strategies, on the same games: each camp of TOURNEY_CAMPS against each other camp played by
// the AI as it was (legacy), both seats, TOURNEY_N games each (start delays and harvest handicaps as in faults.test.ts;
// the strategies taken in turn). « Avant »: the camp plays legacy too; « après »: strategies and doctrine. The analyser
// judges: the camp's faults per game, and its wins against the legacy AI. Not a balance measure.
// TOURNEY_DOCTRINE='{"engage":0}' changes the doctrine of « après », TOURNEY_STRATEGIES=marteau,sables plays only those,
// TOURNEY_AFTER=1 plays « après » only (to try settings against an « avant » already known).
// Run: TOURNEY=1 TOURNEY_CAMPS=dieux TOURNEY_OUT=report.md npx vitest run scripts/tournament.test.ts
it.skipIf(!process.env.TOURNEY)('tournament', async () => {
  // TOURNEY_BASE=1: the opponents, and the camp « avant », play a frozen copy of an earlier AI (src/ai/v143, not in git)
  // instead of the legacy doctrine.
  // TOURNEY_AFTER_PATH: « après » plays that copy of the AI instead (several candidates side by side).
  const After: typeof AI = process.env.TOURNEY_AFTER_PATH ? ((await import(/* @vite-ignore */ process.env.TOURNEY_AFTER_PATH)).AI as typeof AI) : AI;
  const Base: typeof AI = process.env.TOURNEY_BASE ? ((await import(/* @vite-ignore */ process.env.TOURNEY_BASE_PATH ?? '../src/ai/v143/ai')).AI as typeof AI) : AI;
    const all: Faction[] = ['z', 'dieux', 'isdaris', 'humains'];
  const camps = (process.env.TOURNEY_CAMPS ?? all.join(',')).split(',') as Faction[];
  const n = Number(process.env.TOURNEY_N ?? 3);
  const minutes = Number(process.env.TOURNEY_MINUTES ?? 30);
  // Both sides at this level (TOURNEY_LEVEL: easy, normal, hard), their income its handicap's share as in a game.
  const level = process.env.TOURNEY_LEVEL ?? 'normal';
  const income = (BALANCE.ai.difficulty as Record<string, number>)[level] ?? 100;
  const doctrine = { ...DOCTRINE, ...JSON.parse(process.env.TOURNEY_DOCTRINE ?? '{}') };
  const out = ['# Tournoi avant/après les stratégies', '', 'Chaque camp contre l’IA actuelle (avant les stratégies) de chaque autre camp, aux deux places. Avant : le camp joue aussi l’IA actuelle. Après : stratégies et doctrine commune. Juge : l’analyseur. Ce n’est pas une mesure d’équilibre.', '', `Doctrine après : ${JSON.stringify(doctrine)}.`, ''];
  for (const camp of camps) {
    const rows: Record<'avant' | 'apres', Row> = {
      avant: { games: [], seats: [], wins: 0, strategies: {}, foes: {} },
      apres: { games: [], seats: [], wins: 0, strategies: {}, foes: {} },
    };
    const foes = process.env.TOURNEY_FOES ? (process.env.TOURNEY_FOES.split(',') as Faction[]) : all;
    for (const foe of foes.filter((f) => f !== camp)) {
      for (const seat of [0, 1]) {
        for (let k = 0; k < n; k++) {
          for (const mode of (process.env.TOURNEY_AFTER ? ['apres'] : ['avant', 'apres']) as ('avant' | 'apres')[]) {
            const order = (seat === 0 ? [camp, foe] : [foe, camp]) as [Faction, Faction];
            const w = createMatch(order, undefined, process.env.TOURNEY_MAP);
            const hs = [100, 90, 110];
            w.players[0].handicap = Math.round((hs[k % 3] * income) / 100);
            w.players[1].handicap = Math.round((hs[(k + 1) % 3] * income) / 100);
            const only = process.env.TOURNEY_STRATEGIES ? process.env.TOURNEY_STRATEGIES.split(',') : undefined;
            const list = only?.includes('classique') ? [{ id: 'classique' }] : STRATEGIES[camp].filter((s) => !only || only.includes(s.id));
            const strategy = list[k % list.length].id;
            // With TOURNEY_BASE, each side plays its default (the Humans their old AI), the strategies of the camps that
            // have them taken in turn, on both sides.
            const turn = (f: Faction) => (ON_BY_DEFAULT.includes(f) ? { strategy: STRATEGIES[f][k % STRATEGIES[f].length].id } : {});
            const ais = [0, 1].map((p) =>
              process.env.TOURNEY_BASE
                ? p === seat
                  ? new (mode === 'apres' ? After : Base)(w, p, undefined, level, process.env.TOURNEY_STRATEGIES ? { strategy } : turn(camp))
                  : new Base(w, p, undefined, level, turn(foe))
                : new AI(w, p, undefined, 'normal', p === seat && mode === 'apres' ? { strategy, doctrine } : { legacy: true }),
            );
            const delay = [k * 10, ((k * 3) % 5) * 10];
            const a = new Analyzer(w);
            while (w.winner === null && w.tick < minutes * 60 * TICK_RATE) {
              w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
              a.observe();
            }
            const g = a.finish();
            const r = rows[mode];
            r.games.push(g);
            r.seats.push(seat);
            const won = g.winner === seat ? 1 : 0;
            r.wins += won;
            const vs = (r.foes[foe] ??= [0, 0]);
            vs[0]++;
            vs[1] += won;
            const s = (r.strategies[process.env.TOURNEY_BASE ? (ais[seat] as AI).strategy.id : mode === 'apres' ? strategy : 'classique'] ??= [0, 0]);
            s[0]++;
            s[1] += won;
            console.log('TOURNEY', camp, foe, seat, k, mode, clock(g.ticks), g.winner === seat ? 'gagne' : g.winner === null ? 'nul' : 'perd');
          }
        }
      }
    }
    out.push(...campReport(camp, rows, n));
  }
  if (process.env.TOURNEY_OUT) writeFileSync(process.env.TOURNEY_OUT, out.join('\n'));
}, 8 * 3600_000);
