import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Faction balance on 98 games (harvest handicaps 88 to 112 on both sides). Run: npm run balance:big, or BIG=1 npx vitest run scripts/big.test.ts --silent=false --reporter=verbose
it.skipIf(!process.env.BIG)('big', () => {
  const wins: Record<string, number> = { humains: 0, isdaris: 0, draw: 0 };
  // Units each faction made, by type, over all games.
  const made: Record<string, Set<string>> = {};
  let minutes = 0;
  for (const order of [['humains', 'isdaris'], ['isdaris', 'humains']] as [Faction, Faction][]) {
    for (const h0 of [88, 92, 96, 100, 104, 108, 112]) for (const h1 of [88, 92, 96, 100, 104, 108, 112]) {
      const w = createMatch(order);
      w.players[0].handicap = h0;
      w.players[1].handicap = h1;
      const ais = [new AI(w, 0), new AI(w, 1)];
      while (w.winner === null && w.tick < ticks(35 * 60)) {
        w.step(ais.flatMap((a) => a.think()));
        if (w.tick % 100 === 0) for (const e of w.entities.values()) if (e.def.kind === 'unit') (made[e.type] ??= new Set()).add(`${w.players.length}${h0}${h1}${order[0]}:${e.id}`);
      }
      minutes += w.tick / ticks(60);
      wins[w.winner === null || w.winner < 0 ? 'draw' : order[w.winner]]++;
    }
  }
  const units = Object.fromEntries(Object.entries(made).map(([t, ids]) => [t, ids.size]));
  console.log('BIG', JSON.stringify(wins), JSON.stringify(units));
  if (process.env.BIG_OUT) writeFileSync(process.env.BIG_OUT, JSON.stringify({ wins, units, minutes: Math.round(minutes / 98) }));
}, 1_800_000);
