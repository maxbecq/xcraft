import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { kitLevel } from './combat';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

export const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('équilibreur 23-24/11, Dieux', () => {
  it("Athéna's aura reaches 4, 8 then 12", () => {
    expect(BALANCE.rules.upgrades.auraprotection.radius).toEqual([4, 8, 12]);
  });

  it('the gods take nothing from the units\' armour and weapon research', () => {
    const w = createMatch(['dieux', 'humains']);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    const nain = w.spawn('nain', 0, 60 * FP, 60 * FP);
    const [godArmour, nainArmour] = [w.armorBonus(thor), w.armorBonus(nain)];
    w.players[0].upgrades.armor = 3;
    w.players[0].upgrades.melee = 3;
    expect(w.armorBonus(thor)).toBe(godArmour);
    expect(w.armorBonus(nain)).toBe(nainArmour + 3);
    expect(w.researched(thor, (DEFS.thor as UnitDef).attack!, 30)).toBe(0);
    expect(w.researched(nain, (DEFS.nain as UnitDef).attack!, 18)).toBeGreaterThan(0);
  });

  it('a god summoning stays where it is when a unit walks into it', () => {
    const w = createMatch(['dieux', 'humains']);
    const god = Object.assign(w.spawn('isis', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    w.players[0].minerals = w.players[0].energy = 10000;
    w.enqueue(god, 'sphinx');
    const [x, y] = [god.x, god.y];
    const walker: Entity = w.spawn('nain', 0, 30 * FP, 30 * FP + FP / 4);
    w.pushApart(walker, god);
    w.pushApart(god, walker);
    expect([god.x, god.y]).toEqual([x, y]);
  });
});

describe('équilibreur 23-24/11, Z', () => {
  it("the Pod's creep reaches 1 past its edge", () => {
    expect((DEFS.pod as BuildingDef).power).toBe(1 + (DEFS.pod as BuildingDef).size / 2);
  });

  it('five levels of socle: the Octopode 4 then 5; the Laser lourd as strong as its socle, the Réparateur stops at its fourth', () => {
    const w = createMatch(['z', 'humains']);
    const octo = w.spawn('octopode', 0, 20 * FP, 20 * FP);
    expect(kitLevel(octo)).toBe(4);
    octo.tier = 2;
    expect(kitLevel(octo)).toBe(5);
    octo.kit = 'laserlourd';
    expect(w.weapon(octo)!.damage).toBe(101);
    expect(w.weapon(octo)!.range).toBe(8);
    octo.kit = 'reparateur';
    expect(w.healRate(octo)).toBe(16);
    expect((DEFS.rlaserlourd as UnitDef).requires).toEqual({ supreme: 1 });
  });

  it('a Pod supérieur stands for a Pod in the tree; the Pod supérieur research is named as a research', () => {
    const w = createMatch(['z', 'humains']);
    for (const e of [...w.entities.values()]) if (e.owner === 0 && e.type === 'pod') w.remove(e);
    expect(w.lacks(0, 'armement')).toBe('Requiert : Pod');
    const ps = w.spawn('podsup', 0, 20 * FP, 20 * FP);
    ps.buildLeft = 0;
    expect(w.lacks(0, 'armement')).toBe('');
    expect(w.lacks(0, 'podsup')).toBe('Requiert : recherche Pod supérieur');
  });

  it('off its creep a Z building still extracts', () => {
    expect(BALANCE.rules.z.offCreep).toEqual({ shoots: false, produces: false, energy: true });
  });
});
