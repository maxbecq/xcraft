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

describe('équilibreur 23-24/11, Humains', () => {
  it('Gaz euphorisants takes a tenth of full health, never the last point', () => {
    const w = createMatch(['humains', 'isdaris']);
    const cuve = Object.assign(w.spawn('cuve', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const aux = w.spawn('auxiliaire', 0, 34 * FP, 30 * FP);
    const weak = w.spawn('auxiliaire', 0, 34 * FP, 31 * FP);
    weak.hp = 2;
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'gazeuphorisants', x: aux.x, y: aux.y }]);
    expect(aux.hp).toBe(aux.maxHp - Math.floor(aux.maxHp / 10));
    expect(weak.hp).toBe(1);
  });

  it('a Dirigeable takes Serfs, by their supply; the Plésiosaure detects at 10', () => {
    const w = createMatch(['humains', 'isdaris']);
    const d = w.spawn('dirigeable', 0, 30 * FP, 30 * FP);
    const serf = w.spawn('serf', 0, 31 * FP, 30 * FP);
    expect(w.boards(serf, d)).toBe(true);
    expect(w.room(d)).toBe(8);
    expect((DEFS.plesiosaure as UnitDef).detector).toBe(10);
  });
});

describe('équilibreur 24/11, Isdaris numbers and tree', () => {
  it('the units as he set them', () => {
    const u = (t: string) => DEFS[t] as UnitDef;
    expect([u('creature').attack!.cooldown, u('archer').attack!.cooldown, u('druide').attack!.cooldown, u('assassin').attack!.cooldown, u('chimere').attack!.cooldown]).toEqual([1.1, 1.3, 2.2, 2.1, 1.4]);
    expect([u('archer').buildTime, u('archer').requires]).toEqual([30, { miniportail: 1 }]);
    expect([u('discobole').attack!.cooldown, u('discobole').attack!.range, u('discobole').attack!.air]).toEqual([2.5, 7, false]);
    expect([u('dragon').speed, u('dragon').attack!.cooldown, u('dragon').attack!.range, u('dragon').ability]).toEqual([2.4, 2.7, 10, undefined]);
    expect([u('behemoth').sight, u('behemoth').attack!.range, u('behemoth').speed, u('behemoth').attack!.cooldown]).toEqual([11, 6, 1.9, 2]);
    expect(u('voyageur').mana![0]).toBe(250);
    expect((DEFS.miniportail as UnitDef).cost).toEqual({ minerals: 250, energy: 0 });
    expect((DEFS.renvoi as UnitDef).requires).toEqual({ pyramide: 1 });
    expect((DEFS.obelisque as BuildingDef).researches).toEqual(['cercle1', 'cercle2']);
    expect((DEFS.nanoassembleur as BuildingDef).researches).not.toContain('teleportation');
  });

  it('a boosted Créature strikes every 0.9 s', () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].upgrades.boostgenetique = 1;
    const c = w.spawn('creature', 0, 30 * FP, 30 * FP);
    const foe = w.spawn('legionnaire', 1, 30 * FP + FP / 2, 30 * FP);
    foe.hp = foe.maxHp = 100000;
    w.hit(c, foe, (DEFS.creature as UnitDef).attack!);
    w.step([{ player: 0, kind: 'attack', ids: [c.id], x: foe.x, y: foe.y, target: foe.id }]);
    run(w, 1);
    expect(c.cooldown).toBeLessThanOrEqual(ticks(0.9));
  });
});
