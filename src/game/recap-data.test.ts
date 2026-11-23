import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP, TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { Recorder } from './recap-data';

describe('end-of-game analysis data', () => {
  it('samples every 5 s; a unit made counts as produced and a first of its kind, then as lost once gone', () => {
    const w = createMatch(['humains', 'z'], [0, 1]);
    const rec = new Recorder(w);
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        w.step([]);
        rec.observe([]);
      }
    };
    step(5 * TICK_RATE);
    expect(rec.timeline.length).toBe(1);
    expect(rec.timeline[0].players[0].produced).toBe(0);
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'building')!;
    const type = Object.keys(DEFS).find((t) => DEFS[t].kind === 'unit' && !(DEFS[t] as UnitDef).worker && (DEFS[t] as UnitDef).cost.minerals > 0)!;
    const u = w.spawn(type, 0, hq.x + 6 * FP, hq.y);
    step(5 * TICK_RATE);
    const cost = (DEFS[type] as UnitDef).cost;
    expect(rec.timeline.at(-1)!.players[0].produced).toBe(cost.minerals + cost.energy);
    expect(rec.moments.some((m) => m.player === 0 && m.kind === 'unite')).toBe(true);
    w.remove(u);
    step(5 * TICK_RATE);
    expect(rec.timeline.at(-1)!.players[0].lost).toBe(cost.minerals + cost.energy);
  });
});
