import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

/** The six target classes of the 2010 sheets: each attack has a value against each. */
describe('damage classes (fiches 2010)', () => {
  it('a Légionnaire deals 20 to light biological targets, 15 to armoured ones and machines, 10 to buildings', () => {
    const w = new World(createMap());
    const leg = w.spawn('legionnaire', 0, ...at(40, 60));
    const a = w.weapon(leg)!;
    const loss = (type: string) => {
      const t = w.spawn(type, 1, ...at(42, 60));
      const armor = (t.def as UnitDef).armor ?? 0;
      const before = t.hp;
      w.hit(leg, t, a);
      return before - t.hp + armor;
    };
    expect([DEFS.serf, DEFS.phalangiste, DEFS.bourdon, DEFS.caserne].map((d) => (d as UnitDef).cls)).toEqual(['BL', 'BA', 'M', 'S']);
    expect(loss('serf')).toBe(20);
    expect(loss('phalangiste')).toBe(15);
    expect(loss('bourdon')).toBe(15);
    expect(loss('caserne')).toBe(10);
  });

  it("a Z weapon's six values follow its level, scaled as the socles' were", () => {
    const w = new World(createMap());
    const quad = w.spawn('quadripode', 0, ...at(40, 60));
    quad.kit = 'roquettes';
    const a = w.weapon(quad)!;
    // Z.doc Lance-roquettes N1: 9 / 18 / 37 / 56 / 56 / 18, ×86 %.
    expect(a.vs).toEqual([8, 15, 32, 48, 48, 15]);
  });
});
