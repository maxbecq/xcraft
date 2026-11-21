import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// A light check that the night city's map plays (not balance): AI against AI on it, every pair of factions both ways
// and some mirrors, staggered starts. For each game: who won and when, how many bases each side ended with, the
// furthest it got from its start, and whether it ended at all (a game still running at 35 minutes is a stall).
// Run: VILLENUIT=1 npx vitest run scripts/villenuit.test.ts   (VILLENUIT_OUT=file for the report)
it.skipIf(!process.env.VILLENUIT)('ville-nuit', () => {
  const F: Faction[] = ['humains', 'isdaris', 'z', 'dieux'];
  const pairs: [Faction, Faction][] = [];
  for (const a of F) for (const b of F) if (a !== b) pairs.push([a, b]);
  pairs.push(['humains', 'humains'], ['z', 'z'], ['isdaris', 'isdaris'], ['dieux', 'dieux'], ['humains', 'z'], ['dieux', 'isdaris'], ['z', 'dieux'], ['isdaris', 'humains']);
  const lines: string[] = [];
  let stalls = 0;
  pairs.slice(0, 20).forEach(([a, b], i) => {
    const w = createMatch([a, b], undefined, 'ville-nuit', 'villenuit');
    const ais = [new AI(w, 0), new AI(w, 1)];
    const delay = [(i % 5) * 10, (4 - (i % 5)) * 10];
    const home = [0, 1].map((p) => [...w.entities.values()].find((e) => e.owner === p && e.def.kind === 'building')!);
    const far = [0, 0];
    while (w.winner === null && w.tick < ticks(35 * 60)) {
      w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
      if (w.tick % 100 === 0) {
        for (const e of w.entities.values()) {
          if (e.owner > 1 || e.def.kind !== 'unit') continue;
          const h = home[e.owner];
          far[e.owner] = Math.max(far[e.owner], Math.hypot(e.x - h.x, e.y - h.y) / 1024);
        }
      }
    }
    const bases = [0, 1].map((p) => [...w.entities.values()].filter((e) => e.owner === p && e.def.kind === 'building' && (e.def as { dropoff?: boolean }).dropoff).length);
    if (w.winner === null) stalls++;
    lines.push(`${i + 1}. ${a} contre ${b} : ${w.winner === null ? 'pas fini à 35 min' : `${w.winner === 0 ? a : b} gagne`} en ${(w.tick / ticks(60)).toFixed(1)} min ; bases ${bases[0]} / ${bases[1]} ; plus loin du départ ${far[0].toFixed(0)} / ${far[1].toFixed(0)} cases`);
    console.log(lines[lines.length - 1]);
  });
  lines.push(`parties non finies : ${stalls} sur ${Math.min(20, pairs.length)}`);
  if (process.env.VILLENUIT_OUT) writeFileSync(process.env.VILLENUIT_OUT, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}, 3_600_000);
