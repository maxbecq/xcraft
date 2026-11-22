import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP } from './fixed';
import { createMatch } from './setup';

// Z.doc: the weapons at their full damage, and the attack upgrades follow the weapon, not the socle.
describe('Z, by Z.doc', () => {
  it('the Tourelle\'s machine gun gains +10 % a level of Attaque à distance, against the class it hits', () => {
    const w = createMatch(['z', 'humains']);
    const turret = w.spawn('tourelle', 0, 30 * FP, 30 * FP);
    const serf = w.spawn('serf', 1, 33 * FP, 30 * FP);
    const lost = () => {
      serf.hp = serf.maxHp;
      w.hit(turret, serf, w.weapon(turret)!);
      return serf.maxHp - serf.hp;
    };
    expect(lost()).toBe(17); // Mitrailleuse N2 against BL
    w.players[0].upgrades.zdist = 2;
    expect(lost()).toBe(17 + 2 * 2);
  });

  it('the Sonde gains Attaque de proximité', () => {
    const w = createMatch(['z', 'humains']);
    const drone = w.spawn('drone', 0, 30 * FP, 30 * FP);
    const serf = w.spawn('serf', 1, 30 * FP + FP / 2, 30 * FP);
    w.players[0].upgrades.zproxi = 1;
    w.hit(drone, serf, w.weapon(drone)!);
    expect(serf.maxHp - serf.hp).toBe(5 + 1);
  });

  it("the research bonus is 10 % of the value against the class hit, not of the plain damage", () => {
    const w = createMatch(['z', 'humains']);
    const turret = w.spawn('tourelle', 0, 30 * FP, 30 * FP);
    const store = w.spawn('grenier', 1, 33 * FP, 30 * FP); // class S: the machine gun N2 does 4 (17 against BL)
    w.players[0].upgrades.zdist = 2;
    const a = w.weapon(turret)!;
    const hp = store.hp;
    w.hit(turret, store, a);
    // 4 + 2 × max(1, round(0.4)) − armour 1; the old formula on 17 would give 4 + 4 − 1.
    expect(hp - store.hp).toBe(a.vs![4] + 2 - (DEFS.grenier as UnitDef).armor);
  });

  it('a Jet sonique hits the one on its line by that one\'s own class (a god: structure armour, S)', () => {
    const w = createMatch(['z', 'humains']);
    const hexa = w.spawn('hexapode', 0, 30 * FP, 30 * FP);
    hexa.kit = 'jetsonique';
    const a = w.weapon(hexa)!;
    const god = w.spawn('thor', 1, 31 * FP + FP / 2, 30 * FP);
    const serf = w.spawn('serf', 1, 33 * FP, 30 * FP);
    const hp = god.hp;
    w.hit(hexa, serf, a);
    expect(hp - god.hp).toBe(a.vs![4] - (DEFS.thor as UnitDef).armor);
  });
});
