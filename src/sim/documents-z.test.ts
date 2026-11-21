import { describe, expect, it } from 'vitest';
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
});
