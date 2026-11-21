import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { DEFS, KIT, type UnitDef, WEAPONS } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

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

  it('the Intelligence suprême: needs the Centre d\'armement and the Centre de recherche, drones in 75 % of the time', () => {
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
    expect(w.weapon(quad)!.damage).toBe(15); // machine gun N2
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
    expect(w.weapon(hexa)!.damage).toBe(16); // N3: 19
  });

  it('the Tourelle and the Assimilateur take a weapon bought for them, at level 2', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    const turret = w.spawn('tourelle', 0, 30 * FP, 30 * FP);
    const assim = w.spawn('assimilateur', 0, 34 * FP, 30 * FP);
    expect(w.weapon(turret)).toEqual({ damage: 15, vs: [15, 11, 11, 8, 3, 8], range: 4, cooldown: 1 }); // machine gun N2, ×86 %
    expect(w.weapon(assim)).toBeUndefined();
    w.step([{ player: 0, kind: 'arm', ids: [assim.id], weapon: 'laser' }]);
    expect(assim.kit).toBe(''); // not researched
    p.upgrades.laser = 1;
    w.step([{ player: 0, kind: 'arm', ids: [assim.id, turret.id], weapon: 'laser' }]);
    expect(assim.kit).toBe('laser');
    expect(w.weapon(assim)!.damage).toBe(20); // Laser N2: 23
    expect(p.minerals).toBe(1000 - 2 * 70);
    w.step([{ player: 0, kind: 'arm', ids: [turret.id], weapon: 'roquettes' }]);
    expect(turret.kit).toBe('laser'); // once
  });

  it('the Centre K fits support kits on a socle anywhere, and its Canon IEM takes an enemy machine for 50 s', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const k = w.spawn('centrek', 0, 20 * FP, 20 * FP);
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
    ability('kitbalise', quad.x, quad.y);
    expect(w.weapon(quad)!.splash).toBe(3);
    expect(w.beacon(0)).toBe(true);
    // Canon IEM: researched first, on an enemy machine in sight.
    const foe = w.spawn('drone', 1, 22 * FP, 22 * FP);
    run(w, 10);
    ability('canoniem', foe.x, foe.y);
    expect(foe.owner).toBe(1);
    p.upgrades.canoniem = 1;
    ability('canoniem', foe.x, foe.y);
    expect(foe.owner).toBe(0);
    run(w, 51);
    expect(foe.owner).toBe(1);
    // Back at once when the Centre K falls.
    k.iemCd = 0;
    ability('canoniem', foe.x, foe.y);
    expect(foe.owner).toBe(0);
    k.hp = 0;
    run(w, 1);
    expect(foe.owner).toBe(1);
  });

  it('a drone repairs a Z building or machine, 4 hp a second, a quarter of its worth for a full repair', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 1000;
    p.energy = 0;
    const drone = of(w, 0, 'drone')[0];
    const pod = w.spawn('pod', 0, 40 * FP, 40 * FP); // away from the creep
    pod.hp = 1000;
    w.step([{ player: 0, kind: 'smart', ids: [drone.id], x: pod.x, y: pod.y, target: pod.id }]);
    expect(drone.order?.kind).toBe('repair');
    run(w, 40);
    expect(pod.hp).toBeGreaterThan(1000);
    const healed = pod.hp - 1000;
    // 300 minerals for 1500 hp at 25 %: a mineral every 20 hp.
    expect(1000 - p.minerals).toBe(Math.floor((healed * 300 * 25) / 100 / 1500));
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
    p.upgrades.invistemp = 1;
    spy.abilityCd = 0; // one cooldown for all its abilities (in place of Z.doc's energy)
    w.step([{ player: 0, kind: 'ability', ids: [spy.id], name: 'invistemp' }]);
    expect(w.hidden(spy)).toBe(true);
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
    expect(w.weapon(at('quadripode', 0, 20, 20, 'dechiqueteur'))).toMatchObject({ damage: 41, range: 0.1, air: false });
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
    // Réparateur: no attack, mends machines.
    const medic = at('quadripode', 0, 60, 60, 'reparateur');
    expect(w.weapon(medic)).toBeUndefined();
    const hurt = at('hexapode', 0, 61, 60);
    hurt.hp = 100;
    run(w, 2);
    expect(hurt.hp).toBeGreaterThan(110);
    // Accumulateur: Cône de protection keeps the allies round the caster unhurt.
    const acc = at('quadripode', 0, 70, 70, 'accumulateur');
    expect(w.abilitiesFor(acc)).toEqual(['gel', 'vacarme', 'cone', 'gravite']);
    const guarded = at('hexapode', 0, 71, 70);
    w.step([{ player: 0, kind: 'ability', ids: [acc.id], name: 'cone' }]);
    const before = guarded.hp;
    w.hurt(guarded, 50);
    expect(guarded.hp).toBe(before);
    // Killed with its cone still up, the count of live cones comes back to 0.
    expect(w.cones).toBe(1);
    acc.hp = 0;
    w.step([]);
    expect(w.entities.has(acc.id)).toBe(false);
    expect(w.cones).toBe(0);
  });

  it('the large socles: Octopode and Mastodonte at weapon level 3, the Barge carries 8 then 12 of supply', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const octo = w.spawn('octopode', 0, 20 * FP, 20 * FP);
    expect(w.weapon(octo)!.damage).toBe(16); // machine gun N3: 19
    p.upgrades.roctopode = 2;
    w.step([{ player: 0, kind: 'evolve', ids: [octo.id] }]);
    run(w, 18);
    expect(octo.tier).toBe(2);
    expect(w.weapon(octo)!.damage).toBe(19); // N4: 22
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

  it('only the Intelligence and the Pod supérieur spread creep, which repairs units and buildings 1 hp a second', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    const pod = w.spawn('pod', 0, 40 * FP, 40 * FP);
    expect(w.powered(0, pod.x, pod.y)).toBe(false);
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

  it("a weapon is as strong as its socle's level (Z.doc), damage scaled as the socles' was", () => {
    const w = createMatch(['z', 'humains']);
    const quad = w.spawn('quadripode', 0, 20 * FP, 20 * FP);
    const hexa = w.spawn('hexapode', 0, 22 * FP, 20 * FP);
    expect(w.weapon(quad)).toEqual({ damage: 12, vs: [12, 9, 9, 6, 3, 6], range: 4, cooldown: 1 }); // machine gun N1 (14 / 11 / 11 / 7 / 4 / 7), ×86 %
    expect(w.weapon(hexa)!.damage).toBe(15); // N2: 17
    hexa.kit = 'roquettes';
    expect(w.weapon(hexa)).toEqual({ damage: 9, vs: [9, 19, 37, 56, 56, 19], range: 5, cooldown: 2 }); // N2: 11 / 22 / 43 / 65 / 65 / 22, range 5
    quad.kit = 'laser';
    expect(w.weapon(quad)!.damage).toBe(17); // N1: 20
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

describe('Z Refuge (notice)', () => {
  it('the drones round the Intelligence shelter inside, five at most, out of reach, and come out on Débarquer', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    for (let i = 0; i < 2; i++) w.spawn('drone', 0, ic.x + 4 * FP, ic.y + i * FP);
    const drones = of(w, 0, 'drone');
    expect(drones.length).toBe(8);
    w.step([{ player: 0, kind: 'ability', ids: [ic.id], name: 'refuge' }]);
    run(w, 8);
    const inside = drones.filter((d) => d.inside === ic.id);
    expect(inside.length).toBe(5);
    // Soldiers stay out.
    expect(w.boards(w.spawn('auxiliaire', 0, ic.x, ic.y + 5 * FP), ic)).toBe(false);
    w.step([{ player: 0, kind: 'unload', ids: [ic.id] }]);
    expect(drones.filter((d) => d.inside).length).toBe(0);
  });
});

describe('Z Réparateur (notice: « véhicules et bâtiments »)', () => {
  it('mends a damaged building of its side, not one being raised', () => {
    const w = createMatch(['z', 'humains']);
    const [ic] = of(w, 0, 'intelligence');
    const medic = w.spawn('quadripode', 0, ic.x + 4 * FP, ic.y);
    medic.kit = 'reparateur';
    medic.mana = 1 << 30;
    ic.hp = 1000;
    run(w, 3);
    expect(ic.hp).toBeGreaterThan(1030); // the creep alone gives back 3 in that time
    const site = w.spawn('pod', 0, ic.x + 6 * FP, ic.y + 6 * FP);
    site.buildLeft = 100;
    expect(w.patient(medic)).toBe(ic);
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

describe('Z Lance-flammes (fiche « Double attaque »)', () => {
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
