import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import { type Analysis, Analyzer, clock, FAULTS, type FaultKind } from '../src/analysis/analyze';
import { FACTIONS, type Faction } from '../src/data';
import { TICK_RATE } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// The AIs' faults by faction: AI against AI games without rendering, each analysed (src/analysis/analyze.ts), the faults
// counted by how many games of a faction show them. To write the AI's strategies from, not a balance measure.
// Each pairing of the four factions, both sides, FAULTS_N games each (start delays of 0 to 4 AI turns and harvest
// handicaps of 90, 100 or 110 %, as in big.test.ts, so they differ; `distinct` in the report counts them).
// Run: FAULTS=1 FAULTS_OUT=report.md npx vitest run scripts/faults.test.ts; FAULTS_JSON=dir keeps each game's analysis.
it.skipIf(!process.env.FAULTS)('faults', () => {
  const all: Faction[] = ['z', 'dieux', 'isdaris', 'humains'];
  const n = Number(process.env.FAULTS_N ?? 3);
  const minutes = Number(process.env.FAULTS_MINUTES ?? 30);
  const games: Analysis[] = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    for (const order of [[all[i], all[j]], [all[j], all[i]]] as [Faction, Faction][]) {
      for (let k = 0; k < n; k++) {
        const w = createMatch(order, undefined, process.env.FAULTS_MAP);
        const ais = [new AI(w, 0), new AI(w, 1)];
        const delay = [k * 10, ((k * 3) % 5) * 10];
        const hs = [100, 90, 110];
        w.players[0].handicap = hs[k % 3];
        w.players[1].handicap = hs[(k + 1) % 3];
        const a = new Analyzer(w);
        while (w.winner === null && w.tick < minutes * 60 * TICK_RATE) {
          w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
          a.observe();
        }
        const g = a.finish();
        games.push(g);
        if (process.env.FAULTS_JSON) {
          mkdirSync(process.env.FAULTS_JSON, { recursive: true });
          writeFileSync(`${process.env.FAULTS_JSON}/${games.length}-${order.join('-')}.json`, JSON.stringify(g));
        }
        console.log('FAULTS', games.length, order.join('-'), clock(g.ticks), g.winner, g.faults.length);
      }
    }
  }
  if (process.env.FAULTS_OUT) writeFileSync(process.env.FAULTS_OUT, frequencies(games));
  console.log('FAULTS distinct', new Set(games.map((g) => `${g.factions}:${g.ticks}:${g.winner}:${g.faults.length}`)).size, '/', games.length);
}, 4 * 3600_000);

/** Per faction, each fault by the share of its games showing it, its count per game and when it first shows. */
export function frequencies(games: Analysis[]): string {
  const out = ['# Fautes des IA par camp', '', `${games.length} parties IA contre IA (${new Set(games.map((g) => `${g.factions}:${g.ticks}:${g.winner}:${g.faults.length}`)).size} différentes), sans rendu. Fréquence : part des parties du camp où la faute apparaît au moins une fois.`, 'Repérage à seuils fixes (src/analysis/analyze.ts, THRESHOLDS) : des indices à vérifier, pas une mesure d’équilibre.', ''];
  const factions = [...new Set(games.flatMap((g) => g.factions))];
  for (const f of factions) {
    const seats = games.flatMap((g) => g.factions.flatMap((x, p) => (x === f ? [{ g, p }] : [])));
    const rows = (Object.keys(FAULTS) as FaultKind[]).map((kind) => {
      const hits = seats.map(({ g, p }) => g.faults.filter((x) => x.player === p && x.kind === kind));
      const shown = hits.filter((h) => h.length);
      const firsts = shown.map((h) => h[0].tick).sort((a, b) => a - b);
      return { kind, share: shown.length / seats.length, per: hits.reduce((s, h) => s + h.length, 0) / seats.length, first: firsts.length ? firsts[Math.floor(firsts.length / 2)] : null };
    });
    rows.sort((a, b) => b.share - a.share || b.per - a.per);
    const won = seats.filter(({ g, p }) => g.winner === p).length;
    out.push(`## ${FACTIONS[f as Faction]?.name ?? f}`, '', `${seats.length} parties, ${won} gagnées (pour situer, pas une mesure).`, '', '| Faute | Famille | Parties | Par partie | Première (médiane) |', '|---|---|---|---|---|');
    for (const r of rows) out.push(`| ${FAULTS[r.kind].label} | ${FAULTS[r.kind].family === 'economie' ? 'économie' : 'tactique'} | ${Math.round(100 * r.share)} % | ${r.per.toFixed(1)} | ${r.first === null ? '–' : clock(r.first)} |`);
    out.push('');
    const races = seats.filter(({ g, p }) => g.notes.some((n) => n.player === p && n.kind === 'echange-de-bases')).length;
    out.push(`Échange de bases (événement neutre, pas une faute) : ${races} parties sur ${seats.length}.`, '');
  }
  return out.join('\n');
}
