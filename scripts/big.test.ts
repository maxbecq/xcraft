import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Faction balance on 50 games (harvest handicaps 90 to 110 on both sides). Run: BIG=1 npx vitest run scripts/big.test.ts --silent=false --reporter=verbose
it.skipIf(!process.env.BIG)('big', () => {
  const wins: Record<string, number> = { humains: 0, isdaris: 0, draw: 0 };
  for (const order of [['humains', 'isdaris'], ['isdaris', 'humains']] as [Faction, Faction][]) {
    for (const h0 of [90, 95, 100, 105, 110]) for (const h1 of [90, 95, 100, 105, 110]) {
      const w = createMatch(order);
      w.players[0].handicap = h0;
      w.players[1].handicap = h1;
      const ais = [new AI(w, 0), new AI(w, 1)];
      while (w.winner === null && w.tick < ticks(35 * 60)) w.step(ais.flatMap((a) => a.think()));
      wins[w.winner === null || w.winner < 0 ? 'draw' : order[w.winner]]++;
    }
  }
  console.log('BIG', JSON.stringify(wins));
}, 1_800_000);
