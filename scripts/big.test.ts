import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Faction balance: 98 games per pairing, each faction on both sides. The simulation has no randomness, so the games
// differ by each AI's start delay (0 to 3 s, 7 values each side) and harvest handicap (90, 100 or 110 %: 9, 10 or 11
// minerals a trip; a trip carries 10 and rounds down, so finer handicaps replay the same game). `distinct` counts the
// games that ended differently, by a hash of the final state; it should be close to `games`.
// Pairings: BIG_MATCH=humains-isdaris,z-humains,z-isdaris (the default: all three). Wins are counted per pairing.
// Map: BIG_MAP=le-col (an id from public/maps/; default the original map).
// Run: npm run balance:big, or BIG=1 BIG_MATCH=z-humains npx vitest run scripts/big.test.ts --silent=false --reporter=verbose
it.skipIf(!process.env.BIG)('big', () => {
  const pairs = (process.env.BIG_MATCH ?? 'humains-isdaris,z-humains,z-isdaris').split(',').map((m) => m.split('-') as [Faction, Faction]);
  const wins: Record<string, number> = {};
  // Units each faction made, by type, over all games.
  const made: Record<string, Set<string>> = {};
  // Upgrade lines each faction had researched at the end, summed over the games.
  const researched: Record<string, Record<string, number>> = { humains: {}, isdaris: {}, z: {}, dieux: {} };
  // Abilities cast, by name, over all games.
  const casts: Record<string, number> = {};
  // Wins by start position, per pairing: p0 starts top left (player 1 in the map file), p1 opposite.
  const sides: Record<string, { p0: number; p1: number }> = {};
  // Final-state hash of each game, to count the distinct ones.
  const finals = new Set<string>();
  let minutes = 0;
  let games = 0;
  for (const [a, b] of pairs) {
    for (const k of [`${a} (contre ${b})`, `${b} (contre ${a})`, `nul (${a}-${b})`]) wins[k] = 0;
    for (const order of [[a, b], [b, a]] as [Faction, Faction][]) {
      const n = process.env.QUICK ? 3 : 7;
      const hs = [90, 100, 110];
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        // The AI thinks every 10 ticks, so delays come in steps of 10.
        const delay = [i * 10, j * 10];
        const h0 = hs[(i + 2 * j) % 3];
        const h1 = hs[(2 * i + j) % 3];
        const w = createMatch(order, undefined, process.env.BIG_MAP);
        w.players[0].handicap = h0;
        w.players[1].handicap = h1;
        const ais = [new AI(w, 0), new AI(w, 1)];
        while (w.winner === null && w.tick < ticks(35 * 60)) {
          w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
          for (const c of w.casts) casts[c.kind] = (casts[c.kind] ?? 0) + 1;
          if (w.tick % 100 === 0) for (const e of w.entities.values()) if (e.def.kind === 'unit') (made[e.type] ??= new Set()).add(`${a}${b}${h0}${h1}${order[0]}:${e.id}`);
        }
        let hash = `${w.tick}:${w.winner}`;
        for (const e of w.entities.values()) hash += `|${e.id},${e.type},${e.owner},${e.hp},${e.x},${e.y}`;
        finals.add(`${order}:${hash}`);
        minutes += w.tick / ticks(60);
        games++;
        for (const p of w.players) for (const [line, n] of Object.entries(p.upgrades)) if (n) researched[p.faction][line] = (researched[p.faction][line] ?? 0) + n;
        const won = w.winner === null || w.winner < 0 ? null : order[w.winner];
        wins[won ? `${won} (contre ${won === a ? b : a})` : `nul (${a}-${b})`]++;
        const side = (sides[`${a}-${b}`] ??= { p0: 0, p1: 0 });
        if (won) side[w.winner === 0 ? 'p0' : 'p1']++;
      }
    }
    console.log('BIG', `${a}-${b}`, JSON.stringify(Object.fromEntries(Object.entries(wins).filter(([k]) => k.includes(a) && k.includes(b)))));
  }
  const units = Object.fromEntries(Object.entries(made).map(([t, ids]) => [t, ids.size]));
  console.log('BIG', JSON.stringify(wins), JSON.stringify(units), `distinct ${finals.size}/${games}`);
  if (process.env.BIG_OUT) writeFileSync(process.env.BIG_OUT, JSON.stringify({ wins, sides, units, researched, casts, minutes: Math.round(minutes / games), games, distinct: finals.size }));
}, 5_400_000);
