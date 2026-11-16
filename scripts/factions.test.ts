import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';

// Faction balance: many games with small harvest variations, both sides. Run: FACTIONS=1 npx vitest run scripts/factions.test.ts --silent=false
it.skipIf(!process.env.FACTIONS)('factions', () => {
  const wins: Record<string, number> = { humains: 0, isdaris: 0, draw: 0 };
  const minutes: number[] = [];
  for (const order of [['humains', 'isdaris'], ['isdaris', 'humains']] as [Faction, Faction][]) {
    for (const [h0, h1] of [[100, 100], [95, 100], [100, 95], [105, 100], [100, 105], [90, 100], [100, 90]]) {
      const w = createMatch(order);
      w.players[0].handicap = h0;
      w.players[1].handicap = h1;
      const ais = [new AI(w, 0), new AI(w, 1)];
      while (w.winner === null && w.tick < ticks(35 * 60)) w.step(ais.flatMap((a) => a.think()));
      wins[w.winner === null || w.winner < 0 ? 'draw' : order[w.winner]]++;
      minutes.push(Math.round(w.tick / ticks(60)));
    }
  }
  console.log('BALANCE', JSON.stringify(wins), 'minutes', minutes.join(','));
}, 600_000);
