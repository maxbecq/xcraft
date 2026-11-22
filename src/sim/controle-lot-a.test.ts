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

  it('Fusion of N Élémentaires: N/2 Golems, two Élémentaires each (camp-dieux.md: « deux élémentaires fusionnent en Golem »)', () => {
    for (const n of [2, 3, 4, 5]) {
      const w = createMatch(['dieux', 'humains']);
      const ids = Array.from({ length: n }, (_, i) => w.spawn('elembase', 0, (40 + (i % 2) * 0.5) * FP, (40 + Math.floor(i / 2) * 0.5) * FP).id);
      w.step([{ player: 0, kind: 'ability', ids, name: 'fusion' }]);
      const of = (t: string) => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === t).length;
      expect([of('golem'), of('elembase')], `${n}`).toEqual([Math.floor(n / 2), n % 2]);
    }
  });
});
