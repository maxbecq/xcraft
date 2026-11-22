import { describe, expect, it } from 'vitest';
import { DEFS, spell, type UnitDef } from '../data';
import { FP } from './fixed';
import { createMatch } from './setup';

// The Dieux numbers XC.doc (2008) gives, distances and speeds divided by 100; three levels only (balance designer 2026-11-22).
describe('Dieux, by XC.doc 2008', () => {
  it('the gods: prices, armour and speed by level', () => {
    const athena = DEFS.athena as UnitDef;
    expect(athena.cost).toEqual({ minerals: 450, energy: 300 });
    expect(athena.buildTime).toBe(80);
    expect(athena.levels!.hp).toEqual([1500, 1650, 1950]);
    expect(athena.levels!.armor).toEqual([3, 4, 5]);
    expect(athena.levels!.speed).toEqual([2.15, 2.2, 2.3]);
    expect((DEFS.gaia as UnitDef).levels!.cost!.map((c) => c.minerals)).toEqual([690, 805]);
    // The balance designer's Thor (the « Odin » row of XC.doc, swapped back).
    expect((DEFS.thor as UnitDef).levels!.speed).toEqual([1, 1.1, 1.2]);
    expect((DEFS.thor as UnitDef).levels!.hp).toEqual([1600, 1700, 1800]);
  });

  it('the spells grow with the god: Marteau de Thor reach and stun, Pluie de feu damage', () => {
    expect([1, 2, 3].map((l) => spell('foudre', l).range)).toEqual([5, 5.75, 6.5]);
    expect([1, 2, 3].map((l) => spell('foudre', l).duration)).toEqual([3, 4, 5]);
    expect(spell('pluiedefeu', 3).damage).toBe(210);
  });

  it('the units: Drake, Walkyrie, Titan', () => {
    expect((DEFS.drake as UnitDef).cost).toEqual({ minerals: 850, energy: 50 });
    expect((DEFS.walkyrie as UnitDef).armor).toBe(4);
    expect((DEFS.titan as UnitDef).buildTime).toBe(66);
  });

  it("Seth's blow on a wounded unit: no cruel bonus any more (équilibreur 2026-11-22), the Artefacterie's Force only", () => {
    const w = createMatch(['dieux', 'humains']);
    const seth = w.spawn('seth', 0, 30 * FP, 30 * FP);
    seth.arts = ['artforce'];
    const serf = w.spawn('serf', 1, 31 * FP, 30 * FP);
    const a = (DEFS.seth as UnitDef).attack!;
    let d = w.blow(seth, serf, a);
    d += Math.floor((d * 20) / 100); // Force
    serf.hp = 1000;
    serf.maxHp = 3000; // still under half
    w.hit(seth, serf, a);
    expect(1000 - serf.hp).toBe(d);
  });

  it("an old replay's « camouflage » for a Walkyrie still hides her", () => {
    const w = createMatch(['dieux', 'humains']);
    const v = w.spawn('walkyrie', 0, 30 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [v.id], name: 'camouflage' }]);
    expect(v.camo).toBeGreaterThan(0);
  });
});
