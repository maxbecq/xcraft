import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { ABILITIES, DEFS, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('Dieux', () => {
  it('start with a Porte d’Asgaard, Esprits and Gaïa', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(of(w, 0, 'asgaard')).toHaveLength(1);
    expect(of(w, 0, 'esprit')).toHaveLength(6);
    expect(of(w, 0, 'gaia')).toHaveLength(1);
    expect(w.supply(0)).toEqual({ used: 6 + (DEFS.gaia as UnitDef).supply, max: 14 });
  });

  it('Gaïa calls a building down and it materialises by itself; Esprits cannot build', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 2000;
    const [gaia] = of(w, 0, 'gaia');
    const [esprit] = of(w, 0, 'esprit');
    w.step([{ player: 0, kind: 'build', ids: [esprit.id], type: 'branche', tx: 22, ty: 18 }]);
    expect(esprit.order).toBeNull();
    w.step([{ player: 0, kind: 'build', ids: [gaia.id], type: 'branche', tx: 22, ty: 18 }]);
    run(w, 10);
    const [branche] = of(w, 0, 'branche');
    expect(branche).toBeDefined();
    expect(gaia.order).toBeNull(); // free at once
    run(w, 30);
    expect(branche.buildLeft).toBe(0);
    expect(w.supply(0).max).toBe(24);
  });

  it('gods are summoned at the Porte, one of each, and summon their troops while standing still', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    w.spawn('branche', 0, 30 * FP, 14 * FP);
    const [porte] = of(w, 0, 'asgaard');
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    expect(porte.queue).toEqual(['thor']); // unique, queued ones counted
    run(w, (DEFS.thor as UnitDef).buildTime + 1);
    const [thor] = of(w, 0, 'thor');
    expect(thor).toBeDefined();
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }, { player: 0, kind: 'train', ids: [thor.id], type: 'minotaure' }]);
    expect(thor.queue).toEqual(['nain']); // only his own troops
    // Walking, he does not summon.
    w.step([{ player: 0, kind: 'move', ids: [thor.id], x: 40 * FP, y: 40 * FP }]);
    const left = thor.trainLeft;
    run(w, 2);
    expect(thor.trainLeft).toBe(left);
    w.step([{ player: 0, kind: 'stop', ids: [thor.id] }]);
    run(w, (DEFS.nain as UnitDef).buildTime + 1);
    const [nain] = of(w, 0, 'nain');
    expect(nain).toBeDefined();
    expect(Math.hypot(nain.x - thor.x, nain.y - thor.y)).toBeLessThan(4 * FP);
  });

  it('a fallen god can only come back after his mourning; Gaïa comes back by herself', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    thor.hp = 0;
    const [gaia] = of(w, 0, 'gaia');
    gaia.hp = 0;
    run(w, 1);
    expect(w.lacks(0, 'thor')).toMatch(/deuil/);
    run(w, 46);
    expect(of(w, 0, 'gaia')).toHaveLength(1);
    run(w, 20);
    expect(w.lacks(0, 'thor')).toBe('');
  });

  it('the Yggdrasill protecteur needs two first-rank gods', () => {
    const w = createMatch(['dieux', 'humains']);
    expect(w.lacks(0, 'protecteur')).toMatch(/2 parmi/);
    w.spawn('thor', 0, 30 * FP, 30 * FP);
    w.spawn('seth', 0, 32 * FP, 30 * FP);
    expect(w.lacks(0, 'protecteur')).toBe('');
  });

  it('Courroux du marteau triples the next blow; the Tempête de sable silences enemy shooters', () => {
    const w = createMatch(['dieux', 'humains']);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    const dummy = w.spawn('conseil', 1, 31 * FP, 28 * FP);
    const before = dummy.hp;
    w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'courroux' }]);
    expect(thor.charged).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'attack', ids: [thor.id], x: dummy.x, y: dummy.y, target: dummy.id }]);
    run(w, 3);
    expect(before - dummy.hp).toBeGreaterThanOrEqual(3 * (DEFS.thor as UnitDef).attack!.damage - 10);
    expect(thor.charged).toBe(0);

    const seth = w.spawn('seth', 0, 50 * FP, 50 * FP);
    const archer = w.spawn('auxiliaire', 1, 54 * FP, 50 * FP);
    run(w, 4); // both settle on open ground first
    w.step([{ player: 0, kind: 'ability', ids: [seth.id], name: 'tempete', x: archer.x, y: archer.y }]);
    run(w, 1);
    expect(w.storms).toHaveLength(1);
    const hp = seth.hp;
    w.step([{ player: 1, kind: 'attack', ids: [archer.id], x: seth.x, y: seth.y, target: seth.id }]);
    run(w, ABILITIES.tempete.duration - 2);
    expect(seth.hp).toBe(hp);
  });

  it('the AI plays the Dieux: Esprits, gods, an army', () => {
    const w = createMatch(['dieux', 'humains']);
    const ai = new AI(w, 0);
    for (let i = 0; i < ticks(9 * 60); i++) w.step(ai.think());
    expect(of(w, 0, 'esprit').length).toBeGreaterThan(10);
    expect(of(w, 0, 'thor')).toHaveLength(1);
    expect(of(w, 0, 'branche').length + of(w, 0, 'protecteur').length).toBeGreaterThan(0);
    expect(of(w, 0, 'nain').length + of(w, 0, 'minotaure').length + of(w, 0, 'sphinx').length).toBeGreaterThan(5);
  });
});
