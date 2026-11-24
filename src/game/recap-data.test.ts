import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP, TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { Recorder } from './recap-data';

describe('end-of-game analysis data', () => {
  const setup = () => {
    const w = createMatch(['humains', 'z'], [0, 1]);
    const rec = new Recorder(w);
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        w.step([]);
        rec.observe([]);
      }
    };
    const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.def.kind === 'building')!;
    const type = Object.keys(DEFS).find((t) => DEFS[t].kind === 'unit' && !(DEFS[t] as UnitDef).worker && (DEFS[t] as UnitDef).cost.minerals > 0)!;
    const cost = (DEFS[type] as UnitDef).cost;
    return { w, rec, step, spawn: () => w.spawn(type, 0, hq.x + 6 * FP, hq.y), value: cost.minerals + cost.energy };
  };

  it('samples every 5 s; a unit made counts as produced and as a first of its kind', () => {
    const { rec, step, spawn, value } = setup();
    step(5 * TICK_RATE);
    expect(rec.timeline.length).toBe(1);
    expect(rec.timeline[0].players[0].produced).toBe(0);
    expect(rec.timeline[0].players[0].gathered).toBe(rec.totals[0].gotMinerals + rec.totals[0].gotEnergy);
    spawn();
    step(5 * TICK_RATE);
    expect(rec.timeline.at(-1)!.players[0].produced).toBe(value);
    expect(rec.totals[0].unitsMade).toBe(1);
    expect(rec.moments.some((m) => m.player === 0 && m.kind === 'unite')).toBe(true);
  });

  it('a unit killed by the enemy: lost for its owner, killed for the enemy', () => {
    const { rec, step, spawn, value } = setup();
    const u = spawn();
    step(1);
    u.lastHitBy = 1;
    step(1);
    u.hp = 0;
    step(5 * TICK_RATE);
    expect(rec.totals[0].unitsLost).toBe(1);
    expect(rec.totals[1].unitsKilled).toBe(1);
    expect(rec.timeline.at(-1)!.players[0].lost).toBe(value);
  });

  it('a unit taken off the map without dying (absorbed, consumed): neither lost nor killed', () => {
    const { w, rec, step, spawn } = setup();
    const u = spawn();
    step(1);
    u.lastHitBy = 1;
    step(1);
    w.remove(u);
    step(5 * TICK_RATE);
    expect(rec.totals[0].unitsLost).toBe(0);
    expect(rec.totals[1].unitsKilled).toBe(0);
    expect(rec.timeline.at(-1)!.players[0].lost).toBe(0);
  });
});
