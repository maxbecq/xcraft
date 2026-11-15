import { it } from 'vitest';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
import { AI } from '../src/ai/ai';

it.skipIf(!process.env.REPORT)('report', () => {
  const w = createMatch();
  const ais = [new AI(w, 0), new AI(w, 1)];
  const limit = ticks(30 * 60);
  const lines: string[] = [];
  while (w.winner === null && w.tick < limit) {
    w.step(ais.flatMap((a) => a.think()));
    if (w.tick % ticks(60) === 0) {
      const row = [0, 1].map((p) => {
        const es = [...w.entities.values()].filter((e) => e.owner === p);
        const n = (t: string) => es.filter((e) => e.type === t).length;
        return `P${p} min${w.players[p].minerals} nrg${w.players[p].energy} serf${n('serf')} aux${n('auxiliaire')} leg${n('legionnaire')} soi${n('soigneur')} cas${n('caserne')} gre${n('grenier')} mine${n('mine')} sup${w.supply(p).used}/${w.supply(p).max} q[${es.filter((e) => e.type === 'caserne').map((c) => `${c.queue.length}${c.buildLeft ? 'b' : ''}`).join(',')}]`;
      });
      lines.push(`${(w.tick / ticks(60)).toFixed(0).padStart(2)}m ${row.join(' | ')}`);
    }
  }
  console.log(lines.join('\n') + `\nwinner ${w.winner} at ${(w.tick / ticks(60)).toFixed(1)}m`);
});
