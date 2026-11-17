import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Faction balance: 98 games per pairing (harvest handicaps 88 to 112 on both sides, each faction on both sides).
// Pairings: BIG_MATCH=humains-isdaris,z-humains,z-isdaris (the default: all three). Wins are counted per pairing.
// Run: npm run balance:big, or BIG=1 BIG_MATCH=z-humains npx vitest run scripts/big.test.ts --silent=false --reporter=verbose
it.skipIf(!process.env.BIG)('big', () => {
  const pairs = (process.env.BIG_MATCH ?? 'humains-isdaris,z-humains,z-isdaris').split(',').map((m) => m.split('-') as [Faction, Faction]);
  const wins: Record<string, number> = {};
  // Units each faction made, by type, over all games.
  const made: Record<string, Set<string>> = {};
  // Upgrade lines each faction had researched at the end, summed over the games.
  const researched: Record<string, Record<string, number>> = { humains: {}, isdaris: {}, z: {} };
  // Abilities cast, by name, over all games.
  const casts: Record<string, number> = {};
  let minutes = 0;
  let games = 0;
  for (const [a, b] of pairs) {
    for (const k of [`${a} (contre ${b})`, `${b} (contre ${a})`, `nul (${a}-${b})`]) wins[k] = 0;
    for (const order of [[a, b], [b, a]] as [Faction, Faction][]) {
      const hs = process.env.QUICK ? [92, 100, 108] : [88, 92, 96, 100, 104, 108, 112];
      for (const h0 of hs) for (const h1 of hs) {
        const w = createMatch(order);
        w.players[0].handicap = h0;
        w.players[1].handicap = h1;
        const ais = [new AI(w, 0), new AI(w, 1)];
        while (w.winner === null && w.tick < ticks(35 * 60)) {
          w.step(ais.flatMap((ai) => ai.think()));
          for (const c of w.casts) casts[c.kind] = (casts[c.kind] ?? 0) + 1;
          if (w.tick % 100 === 0) for (const e of w.entities.values()) if (e.def.kind === 'unit') (made[e.type] ??= new Set()).add(`${a}${b}${h0}${h1}${order[0]}:${e.id}`);
        }
        minutes += w.tick / ticks(60);
        games++;
        for (const p of w.players) for (const [line, n] of Object.entries(p.upgrades)) if (n) researched[p.faction][line] = (researched[p.faction][line] ?? 0) + n;
        const won = w.winner === null || w.winner < 0 ? null : order[w.winner];
        wins[won ? `${won} (contre ${won === a ? b : a})` : `nul (${a}-${b})`]++;
      }
    }
    console.log('BIG', `${a}-${b}`, JSON.stringify(Object.fromEntries(Object.entries(wins).filter(([k]) => k.includes(a) && k.includes(b)))));
  }
  const units = Object.fromEntries(Object.entries(made).map(([t, ids]) => [t, ids.size]));
  console.log('BIG', JSON.stringify(wins), JSON.stringify(units));
  if (process.env.BIG_OUT) writeFileSync(process.env.BIG_OUT, JSON.stringify({ wins, units, researched, casts, minutes: Math.round(minutes / games), games }));
}, 5_400_000);
