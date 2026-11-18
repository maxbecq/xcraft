import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { DEFS, type UnitDef, WEAPONS } from '../data';
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

  it('a Pod raises one add-on beside it, no drone spent; the socles wait for the Centre de socles', () => {
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
    w.step([{ player: 0, kind: 'train', ids: [pod.id], type: 'tourelle' }]);
    expect(of(w, 0, 'tourelle')).toHaveLength(0); // one per Pod
    run(w, 41);
    expect(pf.buildLeft).toBe(0);
    w.step([{ player: 0, kind: 'train', ids: [pf.id], type: 'quadripode' }]);
    expect(pf.queue).toHaveLength(0);
    expect(w.lacks(0, 'quadripode')).toBe('Requiert : Quadripode');
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
    // Z.doc: every socle takes any weapon, the Coléoptère a flame thrower too.
    train('coleoptere', 'flammes');
    train('quadripode');
    expect(pf.kits).toEqual(['flammes', '']);
    run(w, (DEFS.coleoptere as { buildTime: number }).buildTime + 1);
    const [beetle] = of(w, 0, 'coleoptere');
    expect(beetle.kit).toBe('flammes');
    expect(w.weapon(beetle)).toEqual(WEAPONS.flammes.attack);
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
