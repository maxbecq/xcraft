import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { kitLevel } from './combat';
import { noRegen } from './noregen';
import { FP, dist, ticks } from './fixed';
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

describe('équilibreur 24/11, the Isdaris construction zone', () => {
  const isd = () => {
    const w = createMatch(['isdaris', 'humains']);
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    w.players[0].minerals = w.players[0].energy = 99999;
    return { w, ob };
  };

  it('15 round an Obélisque or an Émetteur', () => {
    expect([(DEFS.obelisque as BuildingDef).power, (DEFS.emetteur as BuildingDef).power]).toEqual([15, 15]);
  });

  it('only the Obélisque has the Bouclier de plasma, cast on a building of the zone; enemies turn away from it', () => {
    const { w, ob } = isd();
    for (const t of ['portail', 'nanoassembleur', 'orbecommandement', 'trone']) expect((DEFS[t] as BuildingDef).abilities ?? []).not.toContain('bouclierplasma');
    const portail = w.spawn('portail', 0, ob.x + 6 * FP, ob.y);
    w.step([{ player: 0, kind: 'ability', ids: [ob.id], name: 'bouclierplasma', x: portail.x, y: portail.y }]);
    expect(portail.phased).toBeGreaterThan(0);
    expect(ob.phased).toBe(0);
    expect(ob.plasmaCd).toBeGreaterThan(0);
    const foe = w.spawn('legionnaire', 1, portail.x + 3 * FP, portail.y);
    expect(w.enemyNear(foe, 4 * FP)?.id).not.toBe(portail.id);
  });

  it('a Récepteur draws a quarter with each robot inside', () => {
    expect((DEFS.recepteur as BuildingDef).bunker).toBe(4);
    expect((DEFS.recepteurarme as BuildingDef).bunker).toBe(4);
  });

  it('a site whose zone is lost is gone, nothing paid back', () => {
    const { w, ob } = isd();
    const site = w.site('portail', 0, Math.floor(ob.x / FP) + 6, Math.floor(ob.y / FP));
    w.remove(ob);
    const m = w.players[0].minerals;
    run(w, 1);
    expect(w.entities.has(site.id)).toBe(false);
    expect(w.players[0].minerals).toBe(m);
  });
});

describe('équilibreur 24/11, Isdaris powers', () => {
  const isd = () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].minerals = w.players[0].energy = 99999;
    return w;
  };

  it('Concentration énergétique: a disc of 3 no one walks through for 15 s, shots go by', () => {
    const w = isd();
    const d = Object.assign(w.spawn('druide', 0, 40 * FP, 40 * FP), { mana: 1 << 30 });
    expect((DEFS.druide as UnitDef).abilities).toEqual(['double', 'concentration', 'silence']);
    expect(w.castAt(d, 'concentration', 44 * FP, 40 * FP)).not.toBe(false);
    expect(w.grid.blocked[40 * w.grid.width + 44]).toBeGreaterThan(0);
    expect(w.grid.blocked[40 * w.grid.width + 46]).toBeGreaterThan(0);
    expect(w.walled(40 * FP, 40 * FP, 48 * FP, 40 * FP)).toBeUndefined();
    run(w, 15.1);
    expect(w.grid.blocked[40 * w.grid.width + 44]).toBe(0);
  });

  it('Ciblage: the enemies of the zone take 10 % more for 30 s, even once out of it', () => {
    const w = isd();
    const spy = Object.assign(w.spawn('espion', 0, 40 * FP, 40 * FP), { mana: 1 << 30 });
    const foe = w.spawn('legionnaire', 1, 44 * FP, 40 * FP);
    const away = w.spawn('legionnaire', 1, 50 * FP, 40 * FP);
    w.castAt(spy, 'ciblage', foe.x, foe.y);
    expect(foe.marked).toBe(ticks(30));
    expect(away.marked).toBe(0);
    foe.shield = 0;
    const hp = foe.hp;
    w.hurt(foe, 100);
    expect(hp - foe.hp).toBe(110 - (DEFS.legionnaire as UnitDef).armor);
  });

  it('a Drone protecteur takes 2 off every blow to its allies round it, itself too', () => {
    const w = isd();
    expect((DEFS.nanoassembleur as BuildingDef).trains).toContain('droneprotecteur');
    const g = w.spawn('droneprotecteur', 0, 40 * FP, 40 * FP);
    const ally = w.spawn('archer', 0, 42 * FP, 40 * FP);
    const far = w.spawn('archer', 0, 50 * FP, 40 * FP);
    for (const u of [g, ally, far]) u.shield = 0;
    const [a0, f0] = [ally.hp, far.hp];
    w.hurt(ally, 10);
    w.hurt(far, 10);
    expect(a0 - ally.hp).toBe(8);
    expect(f0 - far.hp).toBe(10);
  });

  it('Disque tournoyant: after its research, 15 % of the blow to the enemies round the target', () => {
    const w = isd();
    const disc = w.spawn('discobole', 0, 40 * FP, 40 * FP);
    const t = w.spawn('legionnaire', 1, 45 * FP, 40 * FP);
    const by = w.spawn('legionnaire', 1, 46 * FP, 40 * FP);
    w.hit(disc, t, w.weapon(disc)!);
    expect(by.hp).toBe(by.maxHp);
    w.players[0].upgrades.disque = 1;
    const before = t.hp;
    w.hit(disc, t, w.weapon(disc)!);
    expect(by.maxHp - by.hp).toBe(Math.max(1, Math.floor(((before - t.hp) * 15) / 100) - (DEFS.legionnaire as UnitDef).armor));
  });

  it('Attaque de singularité: the Druide drains as much energy as it takes hit points', () => {
    const w = isd();
    const d = w.spawn('druide', 0, 40 * FP, 40 * FP);
    const foe = Object.assign(w.spawn('alchimiste', 1, 44 * FP, 40 * FP), { mana: 200 * FP });
    const hp = foe.hp;
    w.hit(d, foe, w.weapon(d)!);
    expect(200 * FP - foe.mana).toBe((hp - foe.hp) * FP);
  });

  it('Couloir temporel: Espion to Espion, a right click through, closed after 5 crossings', () => {
    const w = isd();
    w.players[0].upgrades.couloir = 1;
    const a = Object.assign(w.spawn('espion', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const b = w.spawn('espion', 0, 80 * FP, 80 * FP);
    w.castAt(a, 'couloir', b.x, b.y);
    expect(w.tunnelOf(a)).toBeDefined();
    const u = w.spawn('creature', 0, 31 * FP, 30 * FP);
    for (let k = 0; k < 5; k++) {
      const [from] = k % 2 ? [b] : [a];
      w.step([{ player: 0, kind: 'smart', ids: [u.id], x: from.x, y: from.y, target: from.id }]);
      run(w, 3);
      expect(dist(u.x, u.y, (k % 2 ? a : b).x, (k % 2 ? a : b).y)).toBeLessThan(3 * FP);
    }
    run(w, 0.1);
    expect(w.tunnelOf(a)).toBeUndefined();
  });

  it('Recharge de bouclier switches off and on; Laboratoire: a unit and a research at once', () => {
    const w = isd();
    const r = w.spawn('reservepsy', 0, 30 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [r.id], name: 'autorecharge' }]);
    expect(r.autoOff).toBe(true);
    const portail = w.spawn('portail', 0, 40 * FP, 30 * FP);
    portail.exts.push('laboratoire');
    portail.queue.push('creature', 'portailatk1');
    portail.trainLeft = w.trainTime(portail, 'creature');
    w.step([]);
    expect(portail.trainLeft2).toBeGreaterThan(0);
  });
});

describe('équilibreur 24/11, defences aimed by hand', () => {
  it('a defence fires at what it is pointed at, an ally too; Stop gives it back its own choice', () => {
    const w = createMatch(['isdaris', 'humains']);
    const orbe = w.site('orbe', 0, 40, 40);
    orbe.buildLeft = 0;
    const friend = w.spawn('archer', 0, 43 * FP, 41 * FP);
    const foe = w.spawn('legionnaire', 1, 44 * FP, 41 * FP);
    w.step([{ player: 0, kind: 'attack', ids: [orbe.id], x: friend.x, y: friend.y, target: friend.id }]);
    expect(orbe.focus).toBe(friend.id);
    friend.shield = 0;
    const hp = friend.hp;
    foe.held = 1 << 20;
    run(w, 1.2);
    expect(friend.hp).toBeLessThan(hp);
    w.step([{ player: 0, kind: 'stop', ids: [orbe.id] }]);
    expect(orbe.focus).toBe(0);
  });
});

describe('équilibreur 24/11, every side', () => {
  it('an energy well holds 7500, then its extractor gives nothing', () => {
    const w = createMatch(['humains', 'isdaris']);
    const well = [...w.entities.values()].find((e) => e.type === 'puits')!;
    expect(well.amount).toBe(7500);
    const mine = w.spawn('mine', 0, well.x, well.y);
    Object.assign(mine, { tx: well.tx, ty: well.ty, buildLeft: 0 });
    for (let i = 0; i < 4; i++) Object.assign(w.spawn('serf', 0, mine.x, mine.y), { inside: mine.id });
    well.amount = 3;
    const e0 = w.players[0].energy;
    run(w, 10);
    expect(w.players[0].energy - e0).toBe(3);
    expect(well.amount).toBe(0);
  });
});

describe('revue Codex du 26/11', () => {
  const isd = () => {
    const w = createMatch(['isdaris', 'humains']);
    w.players[0].minerals = w.players[0].energy = 99999;
    const ob = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'obelisque')!;
    return { w, ob };
  };

  it('1. no Obélisque raises an Obélisque out of the zone: the AI leaves it to a robot', () => {
    const { w, ob } = isd();
    const [tx, ty] = [Math.floor(ob.x / FP), Math.floor(ob.y / FP)];
    expect(w.materialisable(0, 'obelisque', tx + 30, ty)).toBe(false);
    expect(w.materialisable(0, 'obelisque', tx + 8, ty)).toBe(true);
    expect(w.materialisable(0, 'portail', tx + 30, ty)).toBe(true); // canPlace refuses it there anyway
  });

  it('2. the Couloir temporel lets no more than 8 of supply through, and never by a dead Espion', () => {
    const { w } = isd();
    w.players[0].upgrades.couloir = 1;
    const a = Object.assign(w.spawn('espion', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    const b = w.spawn('espion', 0, 70 * FP, 70 * FP);
    w.castAt(a, 'couloir', b.x, b.y);
    const [one, two] = [w.spawn('behemoth', 0, 31 * FP, 30 * FP), w.spawn('behemoth', 0, 30 * FP, 31 * FP)];
    w.step([{ player: 0, kind: 'smart', ids: [one.id], x: a.x, y: a.y, target: a.id }]);
    run(w, 2);
    expect(w.tunnelOf(a)!.supply).toBe(5);
    w.step([{ player: 0, kind: 'smart', ids: [two.id], x: a.x, y: a.y, target: a.id }]);
    run(w, 2);
    expect(dist(one.x, one.y, b.x, b.y)).toBeLessThan(8 * FP);
    expect(dist(two.x, two.y, a.x, a.y)).toBeLessThan(8 * FP); // refused: 5 + 5 > 8
    expect(w.tunnelOf(a)!.crossed).toBe(1);
    b.hp = 0;
    expect(w.tunnelOf(a)).toBeUndefined();
  });

  it('3. a site one tick from done, its zone gone between two checks, is lost', () => {
    const { w, ob } = isd();
    const site = w.site('portail', 0, Math.floor(ob.x / FP) + 6, Math.floor(ob.y / FP));
    while (w.tick % 10 !== 4) w.step([]);
    site.buildLeft = 1;
    ob.hp = 0;
    w.step([]);
    expect(site.buildLeft).toBeGreaterThan(0);
    expect(site.hp).toBeLessThanOrEqual(0);
  });

  it('4. a defence drops a target it no longer sees, or under a Bouclier de plasma, for another', () => {
    noRegen();
    const { w } = isd();
    const r = w.site('recepteurarme', 0, 40, 40);
    r.buildLeft = 0;
    const foe = w.spawn('legionnaire', 1, 44 * FP, 41 * FP);
    const other = w.spawn('legionnaire', 1, 45 * FP, 39 * FP);
    for (const u of [foe, other]) u.held = 1 << 20;
    w.step([{ player: 0, kind: 'attack', ids: [r.id], x: foe.x, y: foe.y, target: foe.id }]);
    foe.camo = 1 << 20; // hidden, no detector near
    const hp = foe.hp;
    run(w, 2);
    expect(foe.hp).toBe(hp);
    expect(other.hp).toBeLessThan(other.maxHp);
    const gate = w.site('portail', 1, 44, 43);
    gate.buildLeft = 0;
    gate.phased = 1 << 20;
    w.step([{ player: 0, kind: 'attack', ids: [r.id], x: gate.x, y: gate.y, target: gate.id }]);
    const h2 = other.hp;
    run(w, 2);
    expect(other.hp).toBeLessThan(h2);
  });

  it('6. an Esprit right-clicked on a Drake géant goes in', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].upgrades.drakegeant = 1;
    const drake = w.spawn('drake', 0, 40 * FP, 40 * FP);
    drake.held = 1 << 20;
    const esprit = w.spawn('esprit', 0, 42 * FP, 40 * FP);
    w.step([{ player: 0, kind: 'smart', ids: [esprit.id], x: drake.x, y: drake.y, target: drake.id }]);
    run(w, 4);
    expect(esprit.inside).toBe(drake.id);
  });

  it('7. the Attaque de singularité drains no energy for a blow the shield took, as much as the hit points lost otherwise', () => {
    const { w } = isd();
    const d = w.spawn('druide', 0, 40 * FP, 40 * FP);
    const v = Object.assign(w.spawn('voyageur', 1, 44 * FP, 40 * FP), { mana: 200 * FP });
    w.hit(d, v, w.weapon(d)!);
    expect(v.mana).toBe(200 * FP);
    v.shield = 0;
    const hp = v.hp;
    w.hit(d, v, w.weapon(d)!);
    expect(200 * FP - v.mana).toBe((hp - v.hp) * FP);
  });

  it('8. a unit killed by its poison is not healed back the same tick', () => {
    const w = createMatch(['humains', 'isdaris']);
    const s = w.spawn('serf', 0, 40 * FP, 40 * FP);
    s.hp = 5;
    s.poison = ticks(1) + 1;
    let k = 0;
    while (s.hp > 0 && k++ < ticks(3)) w.regenerate(s);
    expect(s.hp).toBeLessThanOrEqual(0);
  });
});
