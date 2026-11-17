import { it } from 'vitest';
import { AI, DIFFICULTY } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Each difficulty level against the normal AI, Humains and Isdaris on both sides. Run: LEVELS=1 npx vitest run scripts/levels.test.ts
// LEVELS_HANDICAP=0 plays every side at 100 % harvest, to see the behaviour alone.
it.skipIf(!process.env.LEVELS)('levels', () => {
  const handicap = process.env.LEVELS_HANDICAP !== '0';
  for (const level of ['easy', 'hard']) {
    let won = 0;
    let lost = 0;
    let minutes = 0;
    let games = 0;
    for (const pair of [['humains', 'isdaris'], ['isdaris', 'humains'], ['humains', 'humains'], ['isdaris', 'isdaris']] as [Faction, Faction][]) {
      for (const side of [0, 1]) {
        const w = createMatch(pair);
        if (handicap) w.players[side].handicap = DIFFICULTY[level];
        const ais = [0, 1].map((p) => new AI(w, p, undefined, p === side ? level : 'normal'));
        while (w.winner === null && w.tick < ticks(35 * 60)) w.step(ais.flatMap((a) => a.think()));
        games++;
        minutes += w.tick / ticks(60);
        if (w.winner === side) won++;
        else if (w.winner !== null && w.winner >= 0) lost++;
      }
    }
    process.stdout.write(`\nLEVEL ${level}${handicap ? '' : ' (no handicap)'} vs normal: won ${won}, lost ${lost}, draws ${games - won - lost}, ${(minutes / games).toFixed(0)} min\n`);
  }
}, 900_000);
