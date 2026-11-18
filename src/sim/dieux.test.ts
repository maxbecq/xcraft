import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { ABILITIES, DEFS, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Command, type Entity, World } from './world';

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

  it('a fallen god can be summoned again at once, back at level 1; Gaïa comes back by herself', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    p.energy = 5000;
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    thor.lvl = 3;
    thor.hp = 0;
    const [gaia] = of(w, 0, 'gaia');
    gaia.hp = 0;
    run(w, 1);
    expect(w.lacks(0, 'thor')).toBe('');
    const [porte] = of(w, 0, 'asgaard');
    w.step([{ player: 0, kind: 'train', ids: [porte.id], type: 'thor' }]);
    run(w, (DEFS.thor as UnitDef).buildTime + 1);
    expect(of(w, 0, 'thor')[0].lvl).toBe(1);
    run(w, 46);
    expect(of(w, 0, 'gaia')).toHaveLength(1);
  });

  it('a god bought up a level gains its stats and summons that many times faster', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0];
    p.minerals = 5000;
    w.spawn('branche', 0, 36 * FP, 14 * FP);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    const lv = (DEFS.thor as UnitDef).levels!;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    expect(thor.queue).toEqual(['niveau']); // one at a time
    expect(p.minerals).toBe(5000 - lv.cost[0].minerals);
    run(w, lv.time[0] + 1);
    expect(thor.lvl).toBe(2);
    expect(thor.maxHp).toBe(lv.hp[1]);
    expect(w.weapon(thor)!.damage).toBe(lv.damage![1]);
    expect(w.armorBonus(thor)).toBe(lv.armor[1] - (DEFS.thor as UnitDef).armor);
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'nain' }]);
    run(w, (DEFS.nain as UnitDef).buildTime / 2 + 1);
    expect(of(w, 0, 'nain')).toHaveLength(1);
    // Cancelling a level gives its price back.
    const before = p.minerals;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    w.step([{ player: 0, kind: 'cancel', ids: [thor.id] }]);
    expect(p.minerals).toBe(before);
  });

  it('Offrandes: the gods stop counting in the supply (a queued level never counts)', () => {
    const w = createMatch(['dieux', 'humains']);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    w.players[0].minerals = 5000;
    w.step([{ player: 0, kind: 'train', ids: [thor.id], type: 'niveau' }]);
    const before = w.supply(0).used;
    expect(before).toBe(6 + (DEFS.gaia as UnitDef).supply + (DEFS.thor as UnitDef).supply);
    w.players[0].upgrades.offrandes = 1;
    expect(w.supply(0).used).toBe(6);
  });

  it('a building Gaïa calls down at level 2 materialises twice as fast', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].minerals = 2000;
    const [gaia] = of(w, 0, 'gaia');
    gaia.lvl = 2;
    w.step([{ player: 0, kind: 'build', ids: [gaia.id], type: 'branche', tx: 22, ty: 18 }]);
    run(w, 10);
    const [branche] = of(w, 0, 'branche');
    run(w, (DEFS.branche as UnitDef).buildTime / 2);
    expect(branche.buildLeft).toBe(0);
    expect(branche.hp).toBeGreaterThan(branche.maxHp * 0.85);
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

  it('two gods standing close do not overlap, even a few tiles apart', () => {
    const w = new World(createMatch(['dieux', 'humains']).map);
    // 2.2 tiles apart, closer than their radii add up (2.5), in separation buckets two apart.
    const thor = w.spawn('thor', 0, Math.round(31.9 * FP), 40 * FP);
    const gaia = w.spawn('gaia', 0, Math.round(34.1 * FP), 40 * FP);
    run(w, 3);
    expect(Math.hypot(thor.x - gaia.x, thor.y - gaia.y)).toBeGreaterThanOrEqual(thor.radius + gaia.radius - FP / 16);
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

  it('gods bought up by the AI replay the same from the recorded commands (levels in the hash)', () => {
    const record: [number, Command[]][] = [];
    const live = createMatch(['dieux', 'humains']);
    const ais = [new AI(live, 0), new AI(live, 1)];
    while (live.tick < ticks(17 * 60)) {
      const cmds = ais.flatMap((ai) => ai.think());
      if (cmds.length) record.push([live.tick, cmds]);
      live.step(cmds);
    }
    expect([...live.entities.values()].some((e) => e.owner === 0 && e.lvl > 1)).toBe(true);
    const played = new Map<number, Command[]>(JSON.parse(JSON.stringify(record)));
    const again = createMatch(['dieux', 'humains']);
    while (again.tick < live.tick) again.step(played.get(again.tick) ?? []);
    expect(again.hash()).toBe(live.hash());
    expect([...again.entities.values()].map((e) => e.lvl)).toEqual([...live.entities.values()].map((e) => e.lvl));
  }, 60_000);
});
