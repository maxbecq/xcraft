import { it } from 'vitest';
import { type Plan, BIOBALL } from '../src/ai/ai';
import { AI } from '../src/ai/ai';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';

// Round robin between AI plans, each pair played from both sides. Run: SWEEP=1 npx vitest run scripts/sweep.test.ts --silent=false
const CANDIDATES: Record<string, Plan> = {
  normal: BIOBALL,
  hard2: { serfs: 18, casernes: [[9, 1], [12, 2], [15, 3], [18, 4]], mineAfter: 2, wave: 12, waveGrowth: 4, healerEvery: 4, legionShare: 0.3 },
  hard3: { serfs: 20, casernes: [[9, 1], [12, 2], [15, 3], [18, 5]], mineAfter: 2, wave: 16, waveGrowth: 4, healerEvery: 3, legionShare: 0.25 },
  turtle: { serfs: 16, casernes: [[9, 1], [12, 2], [15, 3]], mineAfter: 2, wave: 18, waveGrowth: 2, healerEvery: 4, legionShare: 0.3 },
};

it.skipIf(!process.env.SWEEP)('sweep', () => {
  const names = Object.keys(CANDIDATES);
  const wins: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  const lines: string[] = [];
  for (const a of names) {
    for (const b of names) {
      if (a === b) continue;
      const w = createMatch();
      const ais = [new AI(w, 0, CANDIDATES[a]), new AI(w, 1, CANDIDATES[b])];
      while (w.winner === null && w.tick < ticks(35 * 60)) w.step(ais.flatMap((x) => x.think()));
      const winner = w.winner === 0 ? a : w.winner === 1 ? b : 'draw';
      if (winner !== 'draw') wins[winner]++;
      lines.push(`${a} vs ${b}: ${winner} (${(w.tick / ticks(60)).toFixed(1)}m)`);
    }
  }
  console.log(lines.join('\n') + '\nWINS ' + JSON.stringify(wins));
});
