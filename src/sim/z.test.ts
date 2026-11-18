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

  it('a drone merges into the building it raises, which then assembles itself, on the creep only', () => {
    const w = createMatch(['z', 'humains']);
    w.players[0].minerals = 2000;
    const drone = of(w, 0, 'drone')[0];
    expect(w.canPlace('plateforme', 30, 30, 0)).toBe(false); // off the creep
    w.step([{ player: 0, kind: 'build', ids: [drone.id], type: 'plateforme', tx: 30, ty: 30 }]);
    expect(w.events.some((e) => e.text === 'Hors du creep.')).toBe(true);
    w.step([{ player: 0, kind: 'build', ids: [drone.id], type: 'pod', tx: 18, ty: 18 }]);
    run(w, 8);
    const [pod] = of(w, 0, 'pod');
    expect(pod).toBeDefined();
    expect(w.entities.has(drone.id)).toBe(false);
    run(w, 25);
    expect(pod.buildLeft).toBe(0);
    expect(pod.hp).toBe(pod.maxHp);
    expect(w.supply(0).max).toBe(20);
  });

  it("chooses a socle's weapon when it is queued: paid on top, researched first, for good", () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 2000;
    p.energy = 2000;
    const [ic] = of(w, 0, 'intelligence');
    w.spawn('pod', 0, ic.x + 6 * FP, ic.y + 6 * FP);
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
    w.spawn('armement', 0, ic.x - 8 * FP, ic.y);
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
    p.upgrades.laser = 1;
    p.upgrades.lanceflammes = 1;
    p.upgrades.lanceroquettes = 1;
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
