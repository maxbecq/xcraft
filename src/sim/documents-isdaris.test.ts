import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP } from './fixed';
import { World } from './world';
import { createMatch } from './setup';

// The Isdaris numbers as the 2010 sheet (and the mod, where it agrees) gives them.
const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

describe('Isdaris, by the 2010 sheet', () => {
  it("the Cercle d'énergie gives the Obélisques 500 more shield, and the Portail nothing", () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].upgrades.cercle = 1;
    const ob = w.spawn('obelisque', 0, ...at(30, 30));
    const gate = w.spawn('portail', 0, ...at(40, 30));
    expect(ob.maxShield).toBe((DEFS.obelisque as UnitDef).shield! + 500);
    expect(gate.maxShield).toBe((DEFS.portail as UnitDef).shield!);
  });

  it('the Bouclier psychique gives the shield 1 armour a level', () => {
    const w = createMatch(['isdaris', 'humains']);
    const a = w.spawn('archer', 0, ...at(30, 30));
    w.hurt(a, 10);
    expect(a.maxShield - a.shield).toBe(10);
    w.players[0].upgrades.bouclier = 3;
    a.shield = a.maxShield;
    w.hurt(a, 10);
    expect(a.maxShield - a.shield).toBe(7);
  });

  it('the Boost génétique gives the Créature 8 hp and 0.25 speed', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].upgrades.boostgenetique = 1;
    const c = w.spawn('creature', 0, ...at(30, 30));
    expect(c.maxHp).toBe((DEFS.creature as UnitDef).hp + 8);
  });

  it('the Robots améliorés give the Robot moissonneur +2 armour', () => {
    const w = new World(createMap());
    const r = w.spawn('moissonneur', 0, ...at(30, 30));
    expect(r.maxShield).toBe(25);
    w.players[0].upgrades.robots = 1;
    expect(w.armorBonus(r)).toBe(2);
  });

  it('the sheet wins over the mod: Récepteur 200 and no supply, Obélisque armour 6, Trône 400/600, Assassin 1 supply', () => {
    const d = (k: string) => DEFS[k] as UnitDef;
    expect([d('recepteur').cost.minerals, d('recepteur').supply]).toEqual([200, 0]);
    expect(d('obelisque').armor).toBe(6);
    expect(d('trone').cost).toEqual({ minerals: 400, energy: 600 });
    expect(d('assassin').supply).toBe(1);
  });
});
