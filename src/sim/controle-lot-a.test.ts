import { describe, expect, it } from 'vitest';
import { FP } from './fixed';
import { createMatch } from './setup';
import type { Faction } from '../data';

// Quality control, lot A: simulation faults found by the probes (each one reproduced here first).
describe('quality control, lot A', () => {
  it('a building power with no energy cost, sent without its name, leaves the energy as it was (never NaN)', () => {
    for (const [f, type] of [['humains', 'casernevolante'], ['isdaris', 'orbe'], ['z', 'intelligence'], ['dieux', 'branche']] as [Faction, string][]) {
      const w = createMatch([f, 'humains']);
      const b = w.spawn(type, 0, 40 * FP, 40 * FP);
      const before = w.players[0].energy;
      w.step([{ player: 0, kind: 'ability', ids: [b.id], x: 0, y: 0 }]);
      expect(w.players[0].energy, type).toBe(before);
    }
  });
});
