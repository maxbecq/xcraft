import { it } from 'vitest';
import { FP, dist, ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
import { expansion } from '../src/sim/setup';
// Group movement: 30 soldiers from the main down the ramp to the natural. Run: MARCH=1 npx vitest run scripts/march.test.ts
it.skipIf(!process.env.MARCH)('march', () => {
  for (const [kind, n] of [['move', 1], ['move', 30], ['attack', 30]] as const) {
    const w = createMatch(['humains', 'humains']);
    const army = Array.from({ length: n }, (_, i) => w.spawn('auxiliaire', 0, (17 + (i % 6)) * FP + FP / 2, (18 + Math.floor(i / 6)) * FP + FP / 2));
    const [nx, ny] = expansion(w, 0);
    const [gx, gy] = [(nx + 2.5) * FP, (ny + 2.5) * FP];
    w.step([{ player: 0, kind, ids: army.map((u) => u.id), x: gx, y: gy }]);
    const marks: Record<string, number> = {};
    let blocked = 0;
    let moved = 0;
    for (let t = 1; t < ticks(60); t++) {
      w.step([]);
      blocked += army.filter((u) => u.blockedTicks > 0).length;
      moved += army.filter((u) => u.order).length;
      const near = army.filter((u) => dist(u.x, u.y, gx, gy) < 5 * FP).length;
      for (const [k, m] of [['half', n / 2], ['most', n * 0.9], ['all', n]] as const) if (near >= m && !(k in marks)) marks[k] = +(t / ticks(1)).toFixed(1);
    }
    const spread = Math.max(...army.map((u) => dist(u.x, u.y, gx, gy))) / FP;
    process.stdout.write(`\nMARCH ${kind} ${n} ${JSON.stringify(marks)} farthest=${spread.toFixed(1)} idle=${army.filter((u) => !u.order).length} blocked%=${((100 * blocked) / Math.max(1, moved)).toFixed(0)}\n`);
  }
}, 120_000);
