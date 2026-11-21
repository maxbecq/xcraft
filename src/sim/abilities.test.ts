import { describe, expect, it } from 'vitest';
import { ABILITIES, DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};

describe('Human abilities (notice 1.2-1)', () => {
  it("the Belluaire's Coup circulaire hits every enemy around; Camouflage hides it from enemies", () => {
    const w = new World(createMap());
    const b = w.spawn('belluaire', 0, ...at(40, 60));
    const foes = [w.spawn('archer', 1, ...at(41, 60)), w.spawn('archer', 1, ...at(39, 60))];
    const far = w.spawn('archer', 1, ...at(46, 60));
    w.step([{ player: 0, kind: 'ability', ids: [b.id], name: 'coupcirculaire' }]);
    expect(foes.every((f) => f.shield < f.maxShield)).toBe(true);
    expect(far.shield).toBe(far.maxShield);
    const c = w.spawn('belluaire', 0, ...at(44, 66));
    run(w, 0.1);
    expect(w.sees(1, c)).toBe(true);
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'camouflage' }]);
    run(w, 0.1);
    expect(w.sees(1, c)).toBe(false);
  });

  it("the Alchimiste walks into range to poison a zone, only once researched", () => {
    const w = new World(createMap());
    const a = Object.assign(w.spawn('alchimiste', 0, ...at(30, 60)), { mana: 1 << 30 });
    const foe = w.spawn('creature', 1, ...at(45, 60));
    foe.order = { kind: 'move', x: foe.x, y: foe.y, arrive: 0 };
    const cmd = { player: 0, kind: 'ability' as const, ids: [a.id], name: 'explosiftoxique', x: foe.x, y: foe.y };
    w.step([cmd]);
    expect(a.order).toBeNull();
    w.players[0].upgrades.cocktail = 1;
    w.step([cmd]);
    expect(a.order?.kind).toBe('cast');
    run(w, 6);
    expect(foe.poison > 0 || foe.hp < foe.maxHp).toBe(true);
  });

  it('Régénérant: the ally takes no damage, then is left at 1 hp', () => {
    const w = new World(createMap());
    w.players[0].upgrades.regenerant = 1;
    const a = Object.assign(w.spawn('alchimiste', 0, ...at(40, 60)), { mana: 1 << 30 });
    const ally = w.spawn('legionnaire', 0, ...at(41, 60));
    w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'regenerant', x: ally.x, y: ally.y }]);
    run(w, 0.2);
    expect(ally.invuln).toBeGreaterThan(0);
    w.spawn('archer', 1, ...at(44, 60));
    run(w, ABILITIES.regenerant.duration - 1);
    expect(ally.hp).toBe(ally.maxHp);
    run(w, 1.5);
    expect(ally.hp).toBe(1);
  });

  it('Réanimation raises a fallen living unit for a while', () => {
    const w = new World(createMap());
    const a = Object.assign(w.spawn('alchimiste', 0, ...at(40, 60)), { mana: 1 << 30 });
    const victim = w.spawn('archer', 1, ...at(42, 60));
    victim.hp = 0;
    run(w, 0.1);
    w.step([{ player: 0, kind: 'ability', ids: [a.id], name: 'reanimation', x: victim.x, y: victim.y }]);
    run(w, 0.2);
    const raised = [...w.entities.values()].find((e) => e.type === 'cadavre');
    expect(raised?.owner).toBe(0);
    run(w, ABILITIES.reanimation.duration + 1);
    expect(w.entities.has(raised!.id)).toBe(false);
  });

  it('Charge de napalm stops and burns an enemy vehicle, repairs an allied one', () => {
    const w = new World(createMap());
    w.players[0].upgrades.chargenapalm = 1;
    const p = w.spawn('phalangiste', 0, ...at(40, 60));
    const tank = w.spawn('discobole', 1, ...at(44, 60));
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'napalm', x: tank.x, y: tank.y }]);
    run(w, 0.2);
    expect(tank.held).toBeGreaterThan(0);
    const mine = w.spawn('pegase', 0, ...at(40, 64));
    mine.hp = 100;
    p.abilityCd = 0;
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'napalm', x: mine.x, y: mine.y }]);
    run(w, 0.5);
    expect(mine.hp).toBe(100 + 2 * ABILITIES.napalm.damage!);
  });

  it('the Grand Conseil is unique and speeds production up', () => {
    const w = new World(createMap());
    const c = w.spawn('conseil', 0, 20 * FP, 20 * FP);
    w.spawn('forge', 0, 30 * FP, 20 * FP);
    w.players[0].minerals = w.players[0].energy = 2000;
    w.step([{ player: 0, kind: 'train', ids: [c.id], type: 'grandconseil' }]);
    expect(w.lacks(0, 'grandconseil')).toBe('Un seul par joueur.');
    run(w, (DEFS.grandconseil as UnitDef).buildTime + 1);
    const g = [...w.entities.values()].find((e) => e.type === 'grandconseil')!;
    w.step([{ player: 0, kind: 'train', ids: [g.id], type: 'serf' }]);
    expect(g.trainLeft).toBeLessThan(ticks((DEFS.serf as UnitDef).buildTime));
  });
});

describe('Human carriers and machines (notice 1.2-1)', () => {
  it('soldiers board a Scarabée, ride along, shoot from inside and get out', () => {
    const w = new World(createMap());
    const s = w.spawn('scarabee', 0, ...at(40, 60));
    const aux = w.spawn('auxiliaire', 0, ...at(42, 60));
    const leg = w.spawn('legionnaire', 0, ...at(42, 61));
    w.step([{ player: 0, kind: 'smart', ids: [aux.id, leg.id], x: s.x, y: s.y, target: s.id }]);
    run(w, 2);
    expect(aux.inside).toBe(s.id);
    expect(leg.inside).toBe(0); // melee: not a shooter
    w.step([{ player: 0, kind: 'move', ids: [s.id], x: 50 * FP, y: 60 * FP }]);
    run(w, 6);
    expect(Math.abs(aux.x - s.x)).toBeLessThan(FP / 10);
    const foe = w.spawn('creature', 1, ...at(54, 60));
    foe.order = { kind: 'move', x: foe.x, y: foe.y, arrive: 0 };
    run(w, 2);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    w.step([{ player: 0, kind: 'unload', ids: [s.id] }]);
    expect(aux.inside).toBe(0);
  });

  it('one passenger out at a click on its portrait, the others staying aboard', () => {
    const w = new World(createMap());
    const s = w.spawn('scarabee', 0, ...at(40, 60));
    const a = w.spawn('auxiliaire', 0, ...at(42, 60));
    const b = w.spawn('auxiliaire', 0, ...at(42, 61));
    w.step([{ player: 0, kind: 'smart', ids: [a.id, b.id], x: s.x, y: s.y, target: s.id }]);
    run(w, 2);
    expect([a.inside, b.inside]).toEqual([s.id, s.id]);
    w.step([{ player: 0, kind: 'unload', ids: [s.id], unit: b.id }]);
    expect([a.inside, b.inside]).toEqual([s.id, 0]);
  });

  it('a Char Pégase takes off once researched, then shoots only at flyers', () => {
    const w = new World(createMap());
    const p = w.spawn('pegase', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'decollage' }]);
    expect(p.airborne).toBe(false);
    w.players[0].upgrades.decollage = 1;
    w.step([{ player: 0, kind: 'ability', ids: [p.id], name: 'decollage' }]);
    expect(p.airborne).toBe(true);
    expect(w.weapon(p)).toMatchObject({ air: true, ground: false });
  });
});

describe('Double énergétique (fiche « Hallucination », mod)', () => {
  it('makes a decoy of the ally with its hit points, which never hurts the enemy and fades after its time', () => {
    const w = new World(createMap());
    const d = w.spawn('druide', 0, ...at(40, 60));
    const ally = w.spawn('archer', 0, ...at(41, 60));
    w.step([{ player: 0, kind: 'ability', ids: [d.id], name: 'double', x: ally.x, y: ally.y }]);
    run(w, 0.2);
    const copy = [...w.entities.values()].find((e) => e.type === 'archer' && e.id !== ally.id)!;
    expect(copy.illusion).toBe(true);
    expect(copy.maxHp).toBe(ally.maxHp);
    // The enemy takes it for the real one when picking its target.
    expect(w.rank(copy)).toBe(w.rank(ally));
    w.remove(ally);
    w.remove(d);
    const foe = w.spawn('legionnaire', 1, copy.x + 2 * FP, copy.y);
    run(w, 10);
    expect(foe.hp).toBe(foe.maxHp);
    // The enemy, for its part, takes the decoy for a real one.
    expect(copy.hp).toBeLessThan(copy.maxHp);
  });

  it('makes no double of a worker', () => {
    const w = new World(createMap());
    const d = w.spawn('druide', 0, ...at(40, 60));
    const worker = w.spawn('moissonneur', 0, ...at(44, 60));
    const n = w.entities.size;
    w.step([{ player: 0, kind: 'ability', ids: [d.id], name: 'double', x: worker.x, y: worker.y }]);
    run(w, 0.2);
    expect(w.entities.size).toBe(n);
  });

  it('lasts 75 s', () => {
    const w = new World(createMap());
    const d = w.spawn('druide', 0, ...at(40, 60));
    const ally = w.spawn('archer', 0, ...at(41, 60));
    w.step([{ player: 0, kind: 'ability', ids: [d.id], name: 'double', x: ally.x, y: ally.y }]);
    const copy = () => [...w.entities.values()].find((e) => e.type === 'archer' && e.id !== ally.id);
    run(w, 74);
    expect(copy()).toBeDefined();
    run(w, 2);
    expect(copy()).toBeUndefined();
  });
});
