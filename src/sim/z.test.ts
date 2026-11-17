import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { WEAPONS } from '../data';
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

  it('fits a weapon kit on a socle: paid, needs a Plate-forme and the research, replaces the light machine gun', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0];
    p.minerals = 2000;
    p.energy = 2000;
    const hexa = w.spawn('hexapode', 0, 20 * FP, 20 * FP);
    const equip = (weapon: string) => w.step([{ player: 0, kind: 'equip', ids: [hexa.id], weapon }]);
    equip('lourde');
    expect(hexa.kit).toBe(''); // no Plate-forme yet
    w.spawn('plateforme', 0, 22 * FP, 14 * FP);
    equip('roquettes');
    expect(hexa.kit).toBe(''); // not researched
    equip('lourde');
    expect(hexa.kit).toBe('lourde');
    expect(p.minerals).toBe(2000 - WEAPONS.lourde.cost.minerals);
    expect(w.weapon(hexa)).toEqual(WEAPONS.lourde.attack);
    expect(hexa.held).toBeGreaterThan(0);
    // The drone de combat is too small for kits.
    const small = w.spawn('dronecombat', 0, 21 * FP, 20 * FP);
    w.step([{ player: 0, kind: 'equip', ids: [small.id], weapon: 'lourde' }]);
    expect(small.kit).toBe('');
    // Flame throwers are ground weapons: a Coléoptère cannot take one.
    p.upgrades.lanceflammes = 1;
    const beetle = w.spawn('coleoptere', 0, 21 * FP, 21 * FP);
    w.step([{ player: 0, kind: 'equip', ids: [beetle.id], weapon: 'flammes' }]);
    expect(beetle.kit).toBe('');
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

  it('the AI builds a Z base and an armed army', () => {
    const w = createMatch(['z', 'humains']);
    const ai = new AI(w, 0);
    while (w.tick < ticks(9 * 60)) w.step(ai.think());
    expect(of(w, 0, 'plateforme').length).toBeGreaterThan(0);
    expect(of(w, 0, 'assimilateur').length).toBeGreaterThan(0);
    const army = [...w.entities.values()].filter((e) => e.owner === 0 && ['dronecombat', 'quadripode', 'hexapode', 'coleoptere'].includes(e.type));
    expect(army.length).toBeGreaterThan(5);
    expect(army.some((u) => u.kit)).toBe(true);
  }, 60_000);
});
