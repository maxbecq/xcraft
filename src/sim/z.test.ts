import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { type BuildingDef, DEFS, KIT, type UnitDef, type UpgradeDef, WEAPONS } from '../data';
import { FP, ticks, tileOf } from './fixed';
import { addonSlots } from './buildings';
import { commandOk } from './validate';
import { createMatch } from './setup';
import { type Entity, World } from './world';
import { noRegen } from './noregen';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('Z', () => {
  it('start with an Intelligence centrale and drones', () => {
    const w = createMatch(['z', 'humains']);
    expect(of(w, 0, 'intelligence')).toHaveLength(1);
    expect(of(w, 0, 'drone')).toHaveLength(6);
    expect(w.supply(0).max).toBe(10);
  });

  it('a drone merges into the building it raises anywhere (no creep needed), which then assembles itself', () => {
    const w = createMatch(['z', 'humains']);
    w.players[0].minerals = 2000;
    const drone = of(w, 0, 'drone')[0];
    // Add-ons and morphs never come from a drone.
    w.step([{ player: 0, kind: 'build', ids: [drone.id], type: 'plateforme', tx: 30, ty: 30 }]);
    expect(drone.order).toBeNull();
    w.step([{ player: 0, kind: 'build', ids: [drone.id], type: 'pod', tx: 30, ty: 30 }]);
    run(w, 15);
    const [pod] = of(w, 0, 'pod');
    expect(pod).toBeDefined();
    expect(w.entities.has(drone.id)).toBe(false);
    run(w, 40);
    expect(pod.buildLeft).toBe(0);
    expect(pod.hp).toBe(pod.maxHp);
    expect(w.supply(0).max).toBe(25); // Z.doc: 10 + 15
  });

  it('a Pod raises add-ons beside it, no drone spent; the socles wait for the Centre de socles', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 2000;
    const [ic] = of(w, 0, 'intelligence');
    const pod = w.spawn('pod', 0, ic.x + 8 * FP, ic.y);
    const drones = of(w, 0, 'drone').length;
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'plateforme' }]);
    const [pf] = of(w, 0, 'plateforme');
    expect(pf.host).toBe(pod.id);
    // Against one of its sides.
    expect([[pod.tx + 2, pod.ty], [pod.tx - 3, pod.ty], [pod.tx, pod.ty + 2], [pod.tx, pod.ty - 3]]).toContainEqual([pf.tx, pf.ty]);
    expect(of(w, 0, 'drone')).toHaveLength(drones);
    expect(p.minerals).toBe(2000 - 200);
    run(w, 41);
    expect(pf.buildLeft).toBe(0);
    w.step([{ player: 0, kind: 'train', ids: [pf.id], type: 'quadripode' }]);
    expect(pf.queue).toHaveLength(0);
    expect(w.lacks(0, 'quadripode')).toBe('Requiert : Socle du Quadripode');
    expect(w.lacks(0, 'centresocles')).toBe('');
    p.upgrades.rquadripode = 1;
    w.step([{ player: 0, kind: 'train', ids: [pf.id], type: 'quadripode' }]);
    expect(pf.queue).toEqual(['quadripode']);
  });

  it('the Intelligence suprême: needs the Centres d\'armement, de recherche and de socles (équilibreur 22/11), drones in 75 % of the time', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const [ic] = of(w, 0, 'intelligence');
    w.step([{ player: 0, kind: 'train', ids: [ic.id], type: 'supreme' }]);
    expect(ic.queue).toHaveLength(0);
    w.spawn('armement', 0, ic.x + 8 * FP, ic.y);
    w.spawn('centrerecherche', 0, ic.x - 8 * FP, ic.y);
    w.step([{ player: 0, kind: 'train', ids: [ic.id], type: 'supreme' }]);
    expect(ic.queue).toHaveLength(0);
    w.spawn('centresocles', 0, ic.x, ic.y + 8 * FP);
    w.step([{ player: 0, kind: 'train', ids: [ic.id], type: 'supreme' }]);
    expect(ic.queue).toEqual(['supreme']);
    run(w, 71);
    expect(ic.type).toBe('supreme');
    expect(w.supply(0).max).toBe(15);
    expect(w.trainTime(ic, 'drone')).toBe(ticks(15));
  });

  it('a socle evolves in the field into its next tier once researched: paid, standing still, stronger', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    p.energy = 1000;
    const quad = w.spawn('quadripode', 0, 20 * FP, 20 * FP);
    quad.hp = 100;
    const evolve = () => w.step([{ player: 0, kind: 'evolve', ids: [quad.id] }]);
    evolve();
    expect(quad.evolving).toBe(0); // T2 not researched
    p.upgrades.rquadripode = 2;
    evolve();
    expect(p.minerals).toBe(1000 - 85);
    expect(quad.held).toBeGreaterThan(0);
    run(w, 9);
    expect(quad.tier).toBe(2);
    expect(quad.maxHp).toBe(180);
    expect(quad.hp).toBeGreaterThanOrEqual(140); // its 40 hp of wounds kept (and some repair)
    expect(w.weapon(quad)!.damage).toBe(17); // machine gun N2
    evolve();
    expect(quad.evolving).toBe(0); // T3 not researched
    // Optimisation perfectionnée: 50 % faster.
    p.upgrades.rquadripode = 3;
    p.upgrades.optimisationp = 1;
    evolve();
    expect(quad.evolving).toBe(Math.floor((ticks(10) * 100) / 150) - 1); // counted down once in the step
    run(w, 7);
    expect(quad.tier).toBe(3);
    evolve();
    expect(quad.evolving).toBe(0); // no T4
    const hexa = w.spawn('hexapode', 0, 22 * FP, 20 * FP);
    p.upgrades.rhexapode = 2;
    w.step([{ player: 0, kind: 'evolve', ids: [hexa.id] }]);
    run(w, 8);
    expect(hexa.tier).toBe(2);
    expect(w.armorBonus(hexa)).toBe(1); // armour 1 -> 2
    expect(w.weapon(hexa)!.damage).toBe(19); // N3
  });

  it('the Tourelle and the Assimilateur take a weapon bought for them, at level 2', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    const turret = w.spawn('tourelle', 0, 30 * FP, 30 * FP);
    const assim = w.spawn('assimilateur', 0, 34 * FP, 30 * FP);
    expect(w.weapon(turret)).toEqual({ damage: 17, vs: [17, 13, 13, 9, 4, 9], range: 4, cooldown: 1 }); // machine gun N2
    expect(w.weapon(assim)).toBeUndefined();
    w.step([{ player: 0, kind: 'arm', ids: [assim.id], weapon: 'laser' }]);
    expect(assim.kit).toBe(''); // not researched
    p.upgrades.laser = 1;
    w.step([{ player: 0, kind: 'arm', ids: [assim.id, turret.id], weapon: 'laser' }]);
    expect(assim.kit).toBe('laser');
    expect(w.weapon(assim)!.damage).toBe(23); // Laser N2
    expect(p.minerals).toBe(1000 - 2 * 70);
    w.step([{ player: 0, kind: 'arm', ids: [turret.id], weapon: 'roquettes' }]);
    expect(turret.kit).toBe('laser'); // once
  });

  it('the Centre K fits support kits on a socle anywhere, and its Canon IEM takes an enemy machine for 50 s', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    // On the Intelligence's creep (4x4 since the balancer, 2026-11-22: its middle half a tile nearer the corner).
    const k = w.spawn('centrek', 0, 19 * FP, 19 * FP);
    const quad = w.spawn('quadripode', 0, 50 * FP, 50 * FP);
    const ability = (name: string, x: number, y: number) => w.step([{ player: 0, kind: 'ability', ids: [k.id], name, x, y }]);
    ability('kitinvisibilite', quad.x, quad.y);
    expect(quad.support).toBe(KIT.invisibilite);
    expect(w.hidden(quad)).toBe(true);
    expect(p.minerals).toBe(5000 - 50);
    ability('kitreparateur', quad.x, quad.y);
    expect(quad.support).toBe(KIT.invisibilite); // the Centre K recharges 10 s
    run(w, 10);
    ability('kitreparateur', quad.x, quad.y);
    quad.hp = 100;
    run(w, 3);
    expect(quad.hp).toBeGreaterThanOrEqual(106); // 3 hp a second, away from any creep
    run(w, 10);
    // Patte ultramécanique in place of the Balise offensive (équilibreur 22/11).
    expect((DEFS.centrek as BuildingDef).abilities).not.toContain('kitbalise');
    ability('kitpatte', quad.x, quad.y);
    expect(quad.support & KIT.patte).toBeTruthy();
    expect(w.weapon(quad)!.splash).toBeUndefined();
    // Its Canon IEM is gone (équilibreur 22/11).
    expect((DEFS.centrek as BuildingDef).abilities).not.toContain('canoniem');
    expect(DEFS.canoniem).toBeUndefined();
  });

  it('a drone repairs a Z building or machine, 4 hp a second, a quarter of its worth for a full repair', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    p.energy = 0;
    const drone = of(w, 0, 'drone')[0];
    // Away from the creep (a Centre de socles there works not, but is repaired all the same).
    const site = w.spawn('centresocles', 0, 40 * FP, 40 * FP);
    const def = DEFS.centresocles as BuildingDef;
    site.hp = 100;
    w.step([{ player: 0, kind: 'smart', ids: [drone.id], x: site.x, y: site.y, target: site.id }]);
    expect(drone.order?.kind).toBe('repair');
    run(w, 40);
    expect(site.hp).toBeGreaterThan(100);
    const healed = site.hp - 100;
    // At 25 % of its worth for a full repair.
    expect(1000 - p.minerals).toBe(Math.floor((healed * def.cost.minerals * 25) / 100 / def.hp));
  });

  it("the Espion: trained at the Intelligence, detects, holds units with its Impulsion, hides, grows with Mega-Espion", () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 2000;
    p.energy = 2000;
    const [ic] = of(w, 0, 'intelligence');
    w.spawn('pod', 0, ic.x + 8 * FP, ic.y);
    w.step([{ player: 0, kind: 'train', ids: [ic.id], type: 'zespion' }]);
    expect(ic.queue).toEqual(['zespion']);
    const spy = Object.assign(w.spawn('zespion', 0, 30 * FP, 30 * FP), { mana: 1 << 30 });
    expect(spy.maxHp).toBe(140);
    const foe = w.spawn('auxiliaire', 1, 32 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [spy.id], name: 'impulsion', x: foe.x, y: foe.y }]);
    run(w, 1);
    expect(foe.held).toBe(0); // not researched
    p.upgrades.impulsion = 1;
    w.step([{ player: 0, kind: 'ability', ids: [spy.id], name: 'impulsion', x: foe.x, y: foe.y }]);
    run(w, 1);
    expect(foe.held).toBeGreaterThan(0);
    // Invisibilité du métal (équilibreur 22/11): 300/300, every Espion invisible for good once researched.
    expect(w.hidden(spy)).toBe(false);
    expect((DEFS.invistemp as UpgradeDef).cost).toEqual({ minerals: 300, energy: 300 });
    p.upgrades.invistemp = 1;
    expect(w.hidden(spy)).toBe(true);
    run(w, 60);
    expect(w.hidden(spy)).toBe(true);
    expect((DEFS.zespion as UnitDef).abilities).not.toContain('invistemp');
    p.upgrades.megaespion = 1;
    expect(w.spawn('zespion', 0, 34 * FP, 30 * FP).maxHp).toBe(200);
  });

  it("Z.doc's other weapons: Déchiqueteur, Jet sonique, Arc électrique, Canon X-04, Réparateur, Accumulateur", () => {
    const w = createMatch(['z', 'humains']);
    const at = (type: string, owner: number, x: number, y: number, kit = '') => {
      const u = w.spawn(type, owner, x * FP, y * FP);
      u.kit = kit;
      u.mana = 1 << 30; // plenty of its own energy (fiches 2010), the spell under test aside
      return u;
    };
    // Déchiqueteur: melee, against flyers when a flyer carries it.
    expect(w.weapon(at('quadripode', 0, 20, 20, 'dechiqueteur'))).toMatchObject({ damage: 48, range: 0.1, air: false });
    expect(w.weapon(at('coleoptere', 0, 20, 22, 'dechiqueteur'))).toMatchObject({ air: true, ground: false });
    // Jet sonique: the auxiliaire between the shooter and its target is hit too.
    const jet = at('hexapode', 0, 30, 30, 'jetsonique');
    const between = at('auxiliaire', 1, 31.5, 30);
    const target = at('auxiliaire', 1, 33, 30);
    const hp = between.hp;
    w.strike(jet, target);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(between.hp).toBeLessThan(hp);
    // Arc électrique: up to three targets in front.
    const arc = at('quadripode', 0, 40, 40, 'arc');
    const foes = [at('auxiliaire', 1, 43, 40), at('auxiliaire', 1, 43, 41), at('auxiliaire', 1, 43, 39), at('auxiliaire', 1, 37, 40)];
    w.step([]); // vision
    for (const f of foes) f.hp = f.maxHp;
    arc.cooldown = 0;
    w.strike(arc, foes[0]);
    expect(foes.filter((f) => f.hp < f.maxHp)).toHaveLength(3);
    expect(foes[3].hp).toBe(foes[3].maxHp); // behind it
    // Canon X-04: a blast in contact hurts the shooter too; no Coléoptère takes it.
    const cannon = at('quadripode', 0, 50, 50, 'canonx04');
    w.strike(cannon, at('auxiliaire', 1, 50.8, 50));
    expect(cannon.hp).toBeLessThan(cannon.maxHp);
    expect(DEFS.coleoptere as UnitDef).toMatchObject({ weapons: expect.not.arrayContaining(['canonx04']) });
    // Réparateur: no attack, mends machines (2 hp a second on a level 1 socle, équilibreur 22/11).
    const medic = at('quadripode', 0, 60, 60, 'reparateur');
    expect(w.weapon(medic)).toBeUndefined();
    const hurt = at('hexapode', 0, 61, 60);
    hurt.hp = 100;
    run(w, 2);
    expect(hurt.hp).toBeGreaterThanOrEqual(103);
    // Accumulateur: Nuage de nanites (équilibreur 22/11): allied machines within 6 of the caster take half the damage,
    // living allies none of it off; two clouds over the same spot do not add up.
    const acc = at('quadripode', 0, 70, 70, 'accumulateur');
    expect(w.abilitiesFor(acc)).toEqual(['gel', 'vacarme', 'cone', 'gravite']);
    const guarded = at('hexapode', 0, 75, 70);
    const bare = at('hexapode', 0, 90, 90);
    const living = w.spawn('auxiliaire', 0, 74 * FP, 71 * FP);
    const lone = w.spawn('auxiliaire', 0, 92 * FP, 90 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'cone' }]);
    const loss = (u: Entity) => {
      u.hp = u.maxHp;
      w.hurt(u, 60);
      return u.maxHp - u.hp;
    };
    const armor = (DEFS.hexapode as UnitDef).armor + w.armorBonus(bare);
    expect(loss(bare)).toBe(60 - armor);
    expect(loss(guarded)).toBe(30 - armor);
    expect(loss(living)).toBe(loss(lone));
    const acc2 = at('quadripode', 0, 72, 70, 'accumulateur');
    acc2.mana = 1 << 30;
    w.step([{ player: 0, kind: 'ability', ids: [acc2.id], name: 'cone' }]);
    expect(w.cones).toBe(2);
    expect(loss(guarded)).toBe(30 - armor);
    acc2.hp = 0;
    w.step([]);
    // Killed with its cone still up, the count of live cones comes back to 0.
    expect(w.cones).toBe(1);
    acc.hp = 0;
    w.step([]);
    expect(w.entities.has(acc.id)).toBe(false);
    expect(w.cones).toBe(0);
  });

  it('the large socles: Octopode and Mastodonte at weapon level 4 (équilibreur 23/11, socles of XC), the Barge carries 8 then 12 of supply', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const octo = w.spawn('octopode', 0, 20 * FP, 20 * FP);
    expect(w.weapon(octo)!.damage).toBe(22); // machine gun N4
    p.upgrades.roctopode = 2;
    w.step([{ player: 0, kind: 'evolve', ids: [octo.id] }]);
    run(w, 18);
    expect(octo.tier).toBe(2);
    expect(w.weapon(octo)!.damage).toBe(22); // socle level 5: the machine gun's table stops at N4
    expect((DEFS.mastodonte as UnitDef).weapons).not.toContain('canonx04');
    const barge = w.spawn('barge', 0, 30 * FP, 30 * FP);
    expect(w.weapon(barge)).toBeUndefined();
    const hexas = [0, 1, 2, 3, 4].map((i) => w.spawn('hexapode', 0, (28 + i) * FP, 32 * FP)); // supply 2 each
    w.step([{ player: 0, kind: 'smart', ids: hexas.map((h) => h.id), x: barge.x, y: barge.y, target: barge.id }]);
    run(w, 6);
    expect(hexas.filter((h) => h.inside === barge.id)).toHaveLength(4); // 8 of supply
    w.step([{ player: 0, kind: 'unload', ids: [barge.id] }]);
    p.upgrades.rbarge = 2;
    w.step([{ player: 0, kind: 'evolve', ids: [barge.id] }]);
    run(w, 10);
    expect(barge.tier).toBe(2);
    expect(w.room(barge)).toBe(12);
  });

  it('the Intelligence, the Pod (2 round it) and the Pod supérieur spread creep, which repairs units and buildings 1 hp a second', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    const pod = w.spawn('pod', 0, 40 * FP, 40 * FP);
    expect(w.powered(0, pod.x, pod.y)).toBe(true);
    expect(w.powered(0, pod.x + 4 * FP, pod.y)).toBe(false);
    const near = w.spawn('armement', 0, ic.x + 6 * FP, ic.y);
    near.hp = 1000;
    run(w, 3);
    expect(near.hp).toBe(1003);
    pod.type = 'podsup';
    w.morph(pod, 'podsup');
    expect(w.powered(0, pod.x, pod.y)).toBe(true); // not linked to the Intelligence: its own creep
  });

  it('Blindage de titane, Déploiement rapide and Sonde robuste', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    const [ic] = of(w, 0, 'intelligence');
    expect(w.armorBonus(ic)).toBe(0);
    p.upgrades.titane = 1;
    expect(w.armorBonus(ic)).toBe(2);
    const drone = of(w, 0, 'drone')[0];
    expect(w.armorBonus(drone)).toBe(0);
    const pod = w.spawn('pod', 0, 30 * FP, 30 * FP);
    expect(w.buildTicks(pod)).toBe(ticks(40));
    p.upgrades.deploiement = 1;
    expect(w.buildTicks(pod)).toBe(Math.floor((ticks(40) * 100) / 120));
    p.upgrades.sonderobuste = 1;
    expect(w.spawn('drone', 0, 20 * FP, 20 * FP).maxHp).toBe(100);
  });

  it("chooses a socle's weapon when it is queued: paid on top, researched first, for good", () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 2000;
    p.energy = 2000;
    const [ic] = of(w, 0, 'intelligence');
    p.upgrades.rquadripode = 1;
    p.upgrades.rcoleoptere = 1;
    const pf = w.spawn('plateforme', 0, ic.x + 8 * FP, ic.y);
    const train = (type: string, weapon?: string) => w.step([{ player: 0, kind: 'train', ids: [pf.id], type, weapon }]);
    train('quadripode', 'roquettes');
    expect(pf.queue).toHaveLength(0); // not researched
    p.upgrades.lanceroquettes = 1;
    p.upgrades.lanceflammes = 1;
    train('dronecombat', 'roquettes');
    expect(pf.queue).toHaveLength(0); // the drone de combat keeps its machine gun
    train('quadripode', 'roquettes');
    expect(pf.kits).toEqual(['roquettes']);
    expect(p.minerals).toBe(2000 - (DEFS.quadripode as UnitDef).cost.minerals - WEAPONS.roquettes.cost.minerals);
    expect(p.energy).toBe(2000 - WEAPONS.roquettes.cost.energy);
    // Cancelled: both paid back.
    w.step([{ player: 0, kind: 'cancel', ids: [pf.id] }]);
    expect(p.minerals).toBe(2000);
    expect(p.energy).toBe(2000);
    // The notice: the Lance-flammes is « uniquement terrestre », refused on a flying socle.
    train('coleoptere', 'flammes');
    expect(pf.queue).toHaveLength(0);
    train('quadripode', 'flammes');
    train('quadripode');
    expect(pf.kits).toEqual(['flammes', '']);
    run(w, (DEFS.quadripode as { buildTime: number }).buildTime + 1);
    const burner = of(w, 0, 'quadripode').find((q) => q.kit === 'flammes')!;
    expect(w.weapon(burner)).toEqual(WEAPONS.flammes.attack);
  });

  it("a weapon is as strong as its socle's level (Z.doc), with Z.doc's damage", () => {
    const w = createMatch(['z', 'humains']);
    const quad = w.spawn('quadripode', 0, 20 * FP, 20 * FP);
    const hexa = w.spawn('hexapode', 0, 22 * FP, 20 * FP);
    expect(w.weapon(quad)).toEqual({ damage: 14, vs: [14, 11, 11, 7, 4, 7], range: 4, cooldown: 1 }); // machine gun N1
    expect(w.weapon(hexa)!.damage).toBe(17); // N2
    hexa.kit = 'roquettes';
    expect(w.weapon(hexa)).toEqual({ damage: 11, vs: [11, 22, 43, 65, 65, 22], range: 5, cooldown: 2 }); // N2, range 5
    quad.kit = 'laser';
    expect(w.weapon(quad)!.damage).toBe(20); // N1
  });

  it('the creep repairs Z units standing on it', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    const hexa = w.spawn('hexapode', 0, ic.x + 4 * FP, ic.y);
    hexa.hp = 100;
    run(w, 5);
    expect(hexa.hp).toBeGreaterThan(100);
    const far = w.spawn('hexapode', 0, 40 * FP, 40 * FP);
    far.hp = 100;
    run(w, 5);
    expect(far.hp).toBe(100);
  });

  it('the AI builds socles with the researched weapons', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 20000;
    p.energy = 20000;
    for (const r of ['laser', 'lanceflammes', 'lanceroquettes', 'rquadripode', 'rhexapode']) p.upgrades[r] = 1;
    const [ic] = of(w, 0, 'intelligence');
    for (let i = 0; i < 4; i++) w.spawn('pod', 0, ic.x + (i - 2) * 3 * FP, ic.y + 6 * FP);
    w.spawn('plateforme', 0, ic.x + 8 * FP, ic.y);
    const ai = new AI(w, 0);
    for (let i = 0; i < ticks(240); i++) w.step(ai.think());
    const kits = new Set([...w.entities.values()].filter((e) => e.owner === 0 && DEFS[e.type].kind === 'unit' && (DEFS[e.type] as { weapons?: string[] }).weapons).map((s) => s.kit));
    expect(kits).toContain('flammes');
    expect(kits).toContain('roquettes');
    expect(kits).toContain('laser');
  }, 60_000);

  it('the AI builds a Z base and an armed army', () => {
    const w = createMatch(['z', 'humains']);
    const ai = new AI(w, 0);
    while (w.tick < ticks(9 * 60)) w.step(ai.think());
    expect(of(w, 0, 'plateforme').length).toBeGreaterThan(0);
    expect(of(w, 0, 'assimilateur').length).toBeGreaterThan(0);
    const army = [...w.entities.values()].filter((e) => e.owner === 0 && ['dronecombat', 'quadripode', 'hexapode', 'coleoptere'].includes(e.type));
    expect(army.length).toBeGreaterThan(5);
  }, 60_000);
});

describe('Z Intelligence without Refuge (équilibreur 22/11)', () => {
  it('neither Intelligence shelters the drones any more', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    expect((DEFS.intelligence as BuildingDef).abilities ?? []).not.toContain('refuge');
    expect((DEFS.supreme as BuildingDef).abilities ?? []).not.toContain('refuge');
    const drones = of(w, 0, 'drone');
    w.step([{ player: 0, kind: 'ability', ids: [ic.id], name: 'refuge' }]);
    run(w, 8);
    expect(drones.filter((d) => d.inside).length).toBe(0);
    expect(w.room(ic)).toBe(0);
  });
});

describe('Z Réparateur (notice: « véhicules et bâtiments »; équilibreur 22/11)', () => {
  it('mends a damaged building of its side, not one being raised', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    const medic = w.spawn('quadripode', 0, ic.x + 4 * FP, ic.y);
    medic.kit = 'reparateur';
    ic.hp = 1000;
    run(w, 3);
    expect(ic.hp).toBeGreaterThan(1006); // 2 a second, the creep's 1 a second on top
    const site = w.spawn('pod', 0, ic.x + 6 * FP, ic.y + 6 * FP);
    site.buildLeft = 100;
    expect(w.patient(medic)).toBe(ic);
  });

  it('heals by the level of its socle, 2 4 8 16 hp a second within 2 3 4 5, for no energy of its own', () => {
    const w = createMatch(['z', 'humains']);
    const at = (type: string, x: number, tier = 1) => Object.assign(w.spawn(type, 0, x * FP, 60 * FP), { kit: 'reparateur', tier });
    const levels = [at('quadripode', 20), at('quadripode', 30, 2), at('hexapode', 40, 2), at('octopode', 50, 2)];
    expect(levels.map((m) => w.healRate(m))).toEqual([2, 4, 8, 16]);
    expect(levels.map((m) => w.healReach(m) / FP)).toEqual([2, 3, 4, 5]);
    expect(w.manaOf(levels[0])).toBeUndefined();
  });

  it('fits on the Tourelle (not on the Assimilateur), which mends machines in its reach once a second', () => {
    expect((DEFS.tourelle as BuildingDef).weapons).toContain('reparateur');
    expect((DEFS.assimilateur as BuildingDef).weapons).not.toContain('reparateur');
    const w = createMatch(['z', 'humains']);
    const t = w.spawn('tourelle', 0, 60 * FP, 60 * FP);
    t.host = w.spawn('pod', 0, 58 * FP, 60 * FP).id;
    t.kit = 'reparateur';
    expect(w.weapon(t)).toBeUndefined();
    const near = w.spawn('hexapode', 0, 62 * FP, 60 * FP);
    const far = w.spawn('hexapode', 0, 70 * FP, 60 * FP);
    near.hp = far.hp = 100;
    run(w, 5);
    expect(w.healRate(t)).toBe(4); // a level 2 weapon
    expect(near.hp).toBeGreaterThanOrEqual(116);
    expect(far.hp).toBe(100);
  });
});

describe('Z Assimilateur (notice)', () => {
  it('runs at 25 % once built, and fully with 3 drones inside', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    const puits = [...w.entities.values()].find((e) => e.type === 'puits')!;
    const a = w.spawn('assimilateur', 0, puits.x - FP, puits.y - FP);
    const gain = (s: number) => {
      const e0 = p.energy;
      run(w, s);
      return p.energy - e0;
    };
    const alone = gain(20);
    const drones = of(w, 0, 'drone').slice(0, 4);
    w.step([{ player: 0, kind: 'smart', ids: drones.map((d) => d.id), x: a.x, y: a.y, target: a.id }]);
    run(w, 15);
    expect(drones.filter((d) => d.inside === a.id)).toHaveLength(3);
    const full = gain(20);
    expect(full).toBeGreaterThan(alone * 3.5);
    expect(full).toBeLessThan(alone * 4.5);
  });
});

describe('Z Lance-flammes (équilibreur 22/11: range 2, a line through and past the target)', () => {
  it('reaches 2 and follows the Attaque de proximité upgrades', () => {
    const w = createMatch(['z', 'humains']);
    const burner = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    burner.kit = 'flammes';
    expect(w.weapon(burner)!.range).toBe(2);
    expect(w.attackLine(burner, w.weapon(burner)!)).toBe('zproxi');
  });

  it('burns the enemy between it and its target, and the one behind in the line', () => {
    const w = createMatch(['z', 'humains']);
    const burner = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    burner.kit = 'flammes';
    const between = w.spawn('legionnaire', 1, 31 * FP, 30 * FP);
    const target = w.spawn('legionnaire', 1, 31.8 * FP, 30 * FP);
    const behind = w.spawn('legionnaire', 1, 32.6 * FP, 30 * FP);
    const ally = w.spawn('quadripode', 0, 31.4 * FP, 30.2 * FP);
    w.hit(burner, target, w.weapon(burner)!);
    for (const u of [between, target, behind]) expect(u.hp).toBeLessThan(u.maxHp);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('hits the enemy right behind its target in the line, not one beside nor one far behind', () => {
    const w = createMatch(['z', 'humains']);
    const burner = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    burner.kit = 'flammes';
    const target = w.spawn('legionnaire', 1, 31.5 * FP, 30 * FP);
    const behind = w.spawn('legionnaire', 1, 32.7 * FP, 30 * FP);
    const beside = w.spawn('legionnaire', 1, 31.5 * FP, 31.5 * FP);
    const far = w.spawn('legionnaire', 1, 35 * FP, 30 * FP);
    w.hit(burner, target, w.weapon(burner)!);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(behind.hp).toBeLessThan(behind.maxHp);
    expect(beside.hp).toBe(beside.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('each one behind takes the value against its own class', () => {
    const w = createMatch(['z', 'humains']);
    const burner = w.spawn('quadripode', 0, 30 * FP, 30 * FP);
    burner.kit = 'flammes';
    const a = w.weapon(burner)!;
    const target = w.spawn('legionnaire', 1, 31.5 * FP, 30 * FP); // BL
    const tank = w.spawn('pegase', 1, 33 * FP, 30 * FP); // MM
    const [t0, k0] = [target.hp, tank.hp];
    w.hit(burner, target, a);
    const armor = (e: Entity) => (e.def as UnitDef).armor ?? 0;
    expect(t0 - target.hp + armor(target)).toBe(a.vs![0]);
    expect(k0 - tank.hp + armor(tank)).toBe(a.vs![3]);
  });
});

describe('Z, équilibreur 22/11: figures', () => {
  it('Assimilateur at 200 minerals; Espion and Accumulateur get 1.5 mana a second', () => {
    expect((DEFS.assimilateur as BuildingDef).cost.minerals).toBe(200);
    expect((DEFS.zespion as UnitDef).mana![2]).toBe(1.5);
    const w = createMatch(['z', 'humains']);
    const spy = w.spawn('zespion', 0, 30 * FP, 30 * FP);
    spy.mana = 0;
    run(w, 10);
    expect(Math.round(spy.mana / FP)).toBe(15); // 10 s at 1.5 (2 before)
    const acc = w.spawn('quadripode', 0, 32 * FP, 30 * FP);
    acc.kit = 'accumulateur';
    expect(w.manaOf(acc)![2]).toBe(1.5);
  });

  it('Blindage de titane: +2 armour on Z buildings, taken off each blow', () => {
    const w = createMatch(['z', 'humains']);
    const pod = w.spawn('pod', 0, 30 * FP, 30 * FP);
    pod.hp = 1000;
    w.hurt(pod, 20);
    const plain = 1000 - pod.hp;
    w.players[0].upgrades.titane = 1;
    pod.hp = 1000;
    w.hurt(pod, 20);
    expect(1000 - pod.hp).toBe(plain - 2);
  });
});

describe('Z Pod: 8 places for its add-ons, and the creep (équilibreur 22/11)', () => {
  const setup = () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = p.energy = 5000;
    const pod = w.spawn('pod', 0, 40.5 * FP, 40.5 * FP);
    return { w, p, pod };
  };

  it('the 8 places round the Pod, like a noughts-and-crosses grid, each the add-on\'s own size', () => {
    expect(addonSlots(10, 10, 2, 2)).toEqual([[8, 8], [10, 8], [12, 8], [8, 10], [12, 10], [8, 12], [10, 12], [12, 12]]);
    expect(addonSlots(10, 10, 2, 3)).toEqual([[7, 7], [9, 7], [12, 7], [7, 9], [12, 9], [7, 12], [9, 12], [12, 12]]);
  });

  it('raises the add-on in the place chosen; a taken place is refused', () => {
    const { w, pod } = setup();
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle', slot: 2 }]);
    const t = [...w.entities.values()].find((e) => e.type === 'tourelle' && e.host === pod.id)!;
    expect([t.tx, t.ty]).toEqual(addonSlots(pod.tx, pod.ty, 2, 2)[2]);
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle', slot: 2 }]);
    expect(w.addonsOf(pod)).toBe(1);
    // A building over a place: that place is unavailable, the others not.
    const [x, y] = addonSlots(pod.tx, pod.ty, 2, 3)[6];
    w.spawn('armement', 0, (x + 1.5) * FP, (y + 1.5) * FP);
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'plateforme', slot: 6 }]);
    expect(w.addonsOf(pod)).toBe(1);
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'plateforme', slot: 1 }]);
    expect(w.addonsOf(pod)).toBe(2);
  });

  it('the Pod spreads a creep 1 round it (équilibreur 23/11), the Pod supérieur 13', () => {
    expect((DEFS.pod as BuildingDef).power).toBe(2); // from its centre: 1 past its edge
    expect((DEFS.podsup as BuildingDef).power).toBe(13);
  });

  it('other Z buildings go only on the creep (not the Intelligence nor the Pod), the Assimilateur too', () => {
    const { w, pod } = setup();
    // Open ground off any creep: the Pod goes there, a Centre d'armement not.
    let open: [number, number] = [0, 0];
    for (let i = 0; i < 400 && !open[0]; i++) {
      const [x, y] = [60 + (i % 20), 60 + Math.floor(i / 20)];
      if (w.canPlace('armement', x, y) && w.canPlace('pod', x, y, 0)) open = [x, y];
    }
    expect(open[0]).toBeGreaterThan(0);
    expect(w.canPlace('armement', ...open, 0)).toBe(false);
    expect(w.misplaced(DEFS.armement as BuildingDef, ...open, 0)).toBe('Hors du creep.');
    const [ic] = of(w, 0, 'intelligence');
    const spots: [number, number][] = [];
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) spots.push([ic.tx + dx, ic.ty + dy]);
    expect(spots.some(([x, y]) => w.canPlace('armement', x, y, 0))).toBe(true); // on its creep
    expect(w.canPlace('armement', pod.tx + 2, pod.ty, 0)).toBe(false); // a 3×3 centre 2.5 off: past the Pod's creep
    const far = [...w.entities.values()].filter((e) => e.type === 'puits').sort((a, b) => b.x - a.x)[0];
    expect(w.canPlace('assimilateur', far.tx, far.ty, 0)).toBe(true); // anywhere (équilibreur 23/11)
  });

  it('a Z building off its creep stops working; a Pod\'s add-on stops when its Pod falls', () => {
    noRegen();
    const { w, p, pod } = setup();
    const t = w.spawn('tourelle', 0, 43 * FP, 41 * FP);
    t.host = pod.id;
    const foe = w.spawn('legionnaire', 1, 46 * FP, 41 * FP);
    foe.hp = foe.maxHp = 100000;
    run(w, 3);
    expect(foe.hp).toBeLessThan(100000);
    pod.hp = 0;
    run(w, 1);
    const hp = foe.hp;
    run(w, 3);
    expect(foe.hp).toBe(hp);
    // A Centre de recherche off any creep researches nothing.
    const cr = w.spawn('centrerecherche', 0, 70 * FP, 70 * FP);
    w.step([{ player: 0, kind: 'train', ids: [cr.id], type: 'titane' }]);
    run(w, 80);
    expect(p.upgrades.titane ?? 0).toBe(0);
  });
});

describe('Z Patte ultramécanique (équilibreur 22/11, in place of the Balise offensive)', () => {
  it('a socle fitted with it climbs a cliff straight up and down; one without walks round', () => {
    const w = createMatch(['z', 'humains']);
    const g = w.grid;
    // A cliff's foot and top side by side, both open ground and flat, away from the edges.
    let pair: [number, number, number, number] | undefined;
    for (let y = 10; y < g.height - 10 && !pair; y++)
      for (let x = 10; x < g.width - 10 && !pair; x++)
        if (g.open(x - 1, y) && g.open(x + 2, y) && g.flatLevel(x - 1, y) >= 0 && g.flatLevel(x + 2, y) > g.flatLevel(x - 1, y) && g.findPath(x - 1, y, x + 2, y).length >= 15 && g.findPath(x - 1, y, x + 2, y, true).length <= 4) pair = [x - 1, y, x + 2, y];
    expect(pair).toBeDefined();
    const [ax, ay, bx, by] = pair!;
    const go = (patte: boolean) => {
      const u = w.spawn('quadripode', 0, ax * FP + FP / 2, ay * FP + FP / 2);
      if (patte) u.support |= KIT.patte;
      w.step([{ player: 0, kind: 'move', ids: [u.id], x: bx * FP + FP / 2, y: by * FP + FP / 2 }]);
      let t = 0;
      while (t < ticks(60) && (tileOf(u.x) !== bx || tileOf(u.y) !== by)) {
        w.step([]);
        t++;
      }
      w.remove(u);
      return t;
    };
    const climbing = go(true);
    const walking = go(false);
    expect(climbing).toBeLessThan(ticks(3));
    expect(walking).toBeGreaterThan(climbing * 2);
    // And down again.
    expect(g.findPath(bx, by, ax, ay, true).length).toBeLessThanOrEqual(4);
  });

  it('only on a walking socle, sold at the Centre K', () => {
    const w = createMatch(['z', 'humains']);
    const k = w.spawn('centrek', 0, 30 * FP, 30 * FP);
    const flyer = w.spawn('coleoptere', 0, 31 * FP, 30 * FP);
    w.centreK(k, 'kitpatte', flyer.x, flyer.y);
    expect(flyer.support & KIT.patte).toBe(0);
  });
});

describe('Z Patte ultramécanique in a crowd at a cliff', () => {
  const scene = () => {
    const w = createMatch(['z', 'humains']);
    const g = w.grid;
    let pair: [number, number, number, number] | undefined;
    for (let y = 10; y < g.height - 10 && !pair; y++)
      for (let x = 10; x < g.width - 10 && !pair; x++)
        if (g.open(x - 1, y) && g.open(x + 2, y) && g.flatLevel(x - 1, y) >= 0 && g.flatLevel(x + 2, y) > g.flatLevel(x - 1, y) && g.findPath(x - 1, y, x + 2, y).length >= 15 && g.findPath(x - 1, y, x + 2, y, true).length <= 4) pair = [x - 1, y, x + 2, y];
    const [ax, ay, bx, by] = pair!;
    const climber = w.spawn('quadripode', 0, ax * FP + FP / 2, ay * FP + FP / 2);
    climber.support |= KIT.patte;
    // A crowd of socles round it at the cliff's foot, all sent to the same spot up top.
    const crowd = [-1, 0, 1].flatMap((dy) => [-2, -1, 0].map((dx) => w.spawn('quadripode', 0, (ax + dx) * FP + FP / 2, (ay + dy) * FP + FP / 3)));
    const all = [climber, ...crowd];
    w.step([{ player: 0, kind: 'move', ids: all.map((u) => u.id), x: bx * FP + FP / 2, y: by * FP + FP / 2 }]);
    return { w, g, climber, crowd, all, top: g.flatLevel(bx, by) };
  };

  it('the climber gets out of the crowd and up; none of the others is pushed up the cliff; no lasting overlap', () => {
    const { w, g, climber, crowd, all, top } = scene();
    let up = -1;
    const start = crowd.map((u) => g.level(tileOf(u.x), tileOf(u.y)));
    for (let t = 0; t < ticks(30); t++) {
      w.step([]);
      if (up < 0 && g.level(tileOf(climber.x), tileOf(climber.y)) === top) up = t;
      // A walker is never shoved up the cliff by the crowd: in the first seconds (its way round is long) it stays at
      // the level it started on.
      if (t < ticks(2)) crowd.forEach((u, i) => expect(g.level(tileOf(u.x), tileOf(u.y))).toBeLessThanOrEqual(start[i]));
    }
    expect(up).toBeGreaterThanOrEqual(0);
    expect(up).toBeLessThan(ticks(6));
    // Once settled, no two stand on each other.
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThan((all[i].radius + all[j].radius) * 0.5);
  });

  it('plays out the same every time', () => {
    const runs = [scene(), scene()].map(({ w, all }) => {
      for (let t = 0; t < ticks(10); t++) w.step([]);
      return all.map((u) => [u.x, u.y]);
    });
    expect(runs[0]).toEqual(runs[1]);
  });
});

describe('Z, revue du 23/11', () => {
  it('off its creep the Centre K fits no kit; back on it, it does', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = p.energy = 5000;
    const k = w.spawn('centrek', 0, 60 * FP, 60 * FP);
    const quad = w.spawn('quadripode', 0, 70 * FP, 70 * FP);
    expect(w.onCreep(k)).toBe(false);
    const patte = () => w.step([{ player: 0, kind: 'ability', ids: [k.id], name: 'kitpatte', x: quad.x, y: quad.y }]);
    patte();
    expect(quad.support & KIT.patte).toBe(0);
    expect(p.minerals).toBe(5000);
    w.spawn('pod', 0, 62 * FP, 60 * FP);
    expect(w.onCreep(k)).toBe(true);
    patte();
    expect(quad.support & KIT.patte).toBeTruthy();
  });

  it('a Pod whose 4 sides are taken raises its add-on in a corner, the same list as the player\'s 8 places', () => {
    const w = createMatch(['z', 'humains']);
    w.players[0].minerals = w.players[0].energy = 5000;
    const pod = w.spawn('pod', 0, 41 * FP, 41 * FP);
    const slots = addonSlots(pod.tx, pod.ty, 2, 2);
    for (const i of [1, 3, 4, 6]) w.spawn('pod', 0, (slots[i][0] + 1) * FP, (slots[i][1] + 1) * FP);
    const spot = w.addonSpot(pod, 'tourelle')!;
    expect([0, 2, 5, 7].map((i) => slots[i])).toContainEqual(spot);
    expect(w.addonSpotAt('tourelle', pod.tx, pod.ty, 2, 0)).toEqual(spot);
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle' }]);
    const t = [...w.entities.values()].find((e) => e.type === 'tourelle' && e.host === pod.id)!;
    expect([t.tx, t.ty]).toEqual(spot);
  });

  it('an add-on place is one of 8, and for an add-on only', () => {
    expect(commandOk({ kind: 'train', ids: [1], type: 'tourelle', slot: 7 })).toBe(true);
    expect(commandOk({ kind: 'train', ids: [1], type: 'tourelle', slot: 8 })).toBe(false);
    expect(commandOk({ kind: 'train', ids: [1], type: 'tourelle', slot: -1 })).toBe(false);
    const w = createMatch(['z', 'humains']);
    const hq = of(w, 0, 'intelligence')[0];
    w.step([{ player: 0, kind: 'train', ids: [hq.id], type: 'drone', slot: 0 }]);
    expect(hq.queue).toHaveLength(0);
    w.step([{ player: 0, kind: 'train', ids: [hq.id], type: 'drone' }]);
    expect(hq.queue).toHaveLength(1);
  });

  it('the Nuage de nanites guards a teammate\'s machines too, never an enemy\'s', () => {
    const w = createMatch(['z', 'z', 'humains']);
    w.setTeams([0, 0, 1]);
    const acc = Object.assign(w.spawn('quadripode', 0, 70 * FP, 70 * FP), { kit: 'accumulateur', mana: 1 << 30 });
    const mate = w.spawn('hexapode', 1, 73 * FP, 70 * FP);
    const foe = w.spawn('hexapode', 2, 70 * FP, 73 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'cone' }]);
    expect(w.coned(mate)).toBe(true);
    expect(w.coned(foe)).toBe(false);
  });

  it('a Tourelle réparatrice reaches from its edge: a machine 4.2 from its middle, under 3 from its edge, is mended', () => {
    const w = createMatch(['z', 'humains']);
    const t = w.spawn('tourelle', 0, 60 * FP, 60 * FP);
    t.host = w.spawn('pod', 0, 58 * FP, 60 * FP).id;
    t.kit = 'reparateur';
    const near = w.spawn('hexapode', 0, t.x + 4.2 * FP, t.y);
    const far = w.spawn('hexapode', 0, t.x + 6 * FP, t.y);
    expect(w.gap(t, near)).toBeLessThanOrEqual(w.healReach(t));
    near.hp = far.hp = 100;
    run(w, 3);
    expect(near.hp).toBeGreaterThan(100);
    expect(far.hp).toBe(100);
  });
});
