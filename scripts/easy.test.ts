import { it } from 'vitest';
import { AI, DIFFICULTY } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// Easy AI against a normal AI, every pair of factions, each on both sides, with the menu's harvest handicaps.
// Prints the easy AI's wins, the minute of its first attack wave and the size of its waves.
// Run: EASY=1 npx vitest run scripts/easy.test.ts --silent=false
it.skipIf(!process.env.EASY)('easy', () => {
  const factions: Faction[] = ['humains', 'isdaris', 'z', 'dieux'];
  let games = 0;
  let easyWins = 0;
  const firsts: number[] = [];
  const sizes: number[] = [];
  for (const easy of factions) {
    let won = 0;
    for (const normal of factions) {
      for (const side of [0, 1]) {
        const w = createMatch(side ? [normal, easy] : [easy, normal]);
        const ais = [0, 1].map((i) => new AI(w, i, undefined, i === side ? 'easy' : 'normal'));
        w.players.forEach((p, i) => (p.handicap = DIFFICULTY[i === side ? 'easy' : 'normal']));
        const ai = ais[side] as unknown as { waves: number; wave: Set<number> };
        let waves = 0;
        while (w.winner === null && w.tick < ticks(35 * 60)) {
          const before = ai.wave.size;
          w.step(ais.flatMap((a) => a.think()));
          if (ai.waves > waves) {
            if (waves === 0) firsts.push(w.tick / ticks(60));
            sizes.push(ai.wave.size - before); // the units sent now, not the survivors of earlier waves
            waves = ai.waves;
          }
        }
        games++;
        if (w.winner === side) won++;
      }
    }
    easyWins += won;
    console.log('EASY', easy, `${won}/8 wins`);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN).toFixed(1);
  console.log('EASY', `wins ${easyWins}/${games}`, `first attack ${avg(firsts)} min (${firsts.length} games)`, `wave ${avg(sizes)} (${sizes.length} waves)`);
}, 3_600_000);
