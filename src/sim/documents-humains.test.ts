import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';
import { noRegen } from './noregen';

// The Humans' numbers as the 2010 sheet (and the mod, where it agrees) gives them.
const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};
const attack = (type: string) => (DEFS[type] as UnitDef).attack!;

describe('Humans, by the 2010 sheet', () => {
  it('the Belluaire poison burns 5 hp a second for 11 s', () => {
    noRegen();
    const w = new World(createMap());
    w.players[0].upgrades.lamesempoisonnees = 1;
    const b = w.spawn('belluaire', 0, ...at(40, 60));
    const t = w.spawn('serf', 1, ...at(41, 60));
    w.hit(b, t, attack('belluaire'));
    expect(t.poison).toBe(ticks(11));
    w.entities.delete(b.id);
    t.hp = t.maxHp;
    run(w, 12);
    // Once each whole second of the poison's ticks (the last one included).
    expect(t.maxHp - t.hp).toBe(5 * (Math.floor((ticks(11) - 1) / ticks(1)) + 1));
  });

  it('the Explosif toxique burns 37 a second for 4 s in a zone of 3, and two clouds add up', () => {
    noRegen();
    const w = new World(createMap());
    w.players[0].upgrades.cocktail = 1;
    const [one, two] = [w.spawn('legionnaire', 1, ...at(46, 60)), w.spawn('legionnaire', 1, ...at(46, 64))];
    for (const t of [one, two]) Object.assign(t, { hp: 1000, maxHp: 1000, held: ticks(30) });
    // Each Alchimiste throws its cloud and goes: only the clouds hurt.
    for (const y of [one.y, one.y + 3 * FP]) {
      const a = Object.assign(w.spawn('alchimiste', 0, ...at(40, 60)), { mana: 1 << 30 });
      w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'explosiftoxique', x: one.x, y }]);
      w.entities.delete(a.id);
    }
    run(w, 6);
    expect(1000 - one.hp).toBe(2 * 4 * 37);
    expect(1000 - two.hp).toBe(4 * 37);
  });

  it('the Char lourd makes the Pégase hit 29 on the light biologicals, on the ground', () => {
    const w = new World(createMap());
    const p = w.spawn('pegase', 0, ...at(40, 60));
    const t = w.spawn('serf', 1, ...at(42, 60));
    w.hit(p, t, attack('pegase'));
    expect(t.maxHp - t.hp).toBe(24);
    w.players[0].upgrades.charlourd = 1;
    t.hp = t.maxHp;
    w.hit(p, t, attack('pegase'));
    expect(t.maxHp - t.hp).toBe(29);
  });

  it("the Scie d'assaut adds 15 against heavy machines, nothing against the light biologicals", () => {
    const w = new World(createMap());
    const l = w.spawn('legionnaire', 0, ...at(40, 60));
    const [tank, serf] = [w.spawn('scarabee', 1, ...at(41, 60)), w.spawn('serf', 1, ...at(39, 60))];
    const lost = (t: typeof tank) => {
      t.hp = t.maxHp;
      w.hit(l, t, attack('legionnaire'));
      return t.maxHp - t.hp;
    };
    const [before, plain] = [lost(tank), lost(serf)];
    w.players[0].upgrades.scieassaut = 1;
    expect(lost(tank)).toBe(before + 15); // the balancer, 2026-11-22
    expect(lost(serf)).toBe(plain);
  });

  it('the Pégase takes 3 s to take off, then rests 5 s', () => {
    const w = new World(createMap());
    w.players[0].upgrades.decollage = 1;
    const p = w.spawn('pegase', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'decollage' }]);
    expect(p.airborne).toBe(true);
    expect(p.held).toBe(ticks(3) - 1);
    expect(p.abilityCd).toBe(ticks(5) - 1);
  });

  it('the sheet wins over the mod: building armour, Serf 75 hp, a chemical mine hits a zone of 2', () => {
    const d = (k: string) => DEFS[k] as UnitDef;
    expect(['conseil', 'caserne', 'fortin', 'forge', 'alchimisterie', 'creaturium', 'metallurgie'].map((k) => d(k).armor)).toEqual([6, 3, 4, 4, 2, 2, 4]);
    expect(d('serf').hp).toBe(75);
    const w = new World(createMap());
    const m = w.spawn('minechimique', 0, ...at(40, 60));
    const [near, side] = [w.spawn('legionnaire', 1, ...at(40, 60)), w.spawn('legionnaire', 1, ...at(41, 61))];
    for (const t of [near, side]) Object.assign(t, { hp: 1000, maxHp: 1000 });
    w.mineTrigger(m);
    expect([1000 - near.hp, 1000 - side.hp]).toEqual([160, 160]);
  });
});
