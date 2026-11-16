import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};
const finished = (w: World, type: string, owner: number, tx: number, ty: number) => {
  const b = w.spawn(type, owner, tx * FP, ty * FP);
  b.buildLeft = 0;
  return b;
};

describe('Human research (notice 1.2-1)', () => {
  it('Croissance économique gives serfs and Caserne soldiers 10 % more hp, old and new', () => {
    const w = new World(createMap());
    const old = w.spawn('auxiliaire', 0, ...at(40, 60));
    old.hp -= 20;
    const marche = finished(w, 'marche', 0, 30, 60);
    w.players[0].minerals = 1000;
    w.step([{ player: 0, kind: 'train', ids: [marche.id], type: 'croissance' }]);
    run(w, (DEFS.croissance as UnitDef).buildTime + 1);
    expect(old.maxHp).toBe(88);
    expect(old.hp).toBe(68);
    expect(w.spawn('serf', 0, ...at(41, 60)).maxHp).toBe(82);
    expect(w.spawn('archer', 1, ...at(42, 60)).maxHp).toBe((DEFS.archer as UnitDef).hp);
  });

  it('the Marché trades minerals for energy at its rate, and only when standing', () => {
    const w = new World(createMap());
    const m = w.spawn('marche', 0, 30 * FP, 60 * FP);
    m.buildLeft = 100;
    w.players[0].minerals = 300;
    w.step([{ player: 0, kind: 'trade', ids: [m.id], sell: 'minerals' }]);
    expect(w.players[0].minerals).toBe(300); // still being built
    m.buildLeft = 0;
    w.step([{ player: 0, kind: 'trade', ids: [m.id], sell: 'minerals' }]);
    expect(w.players[0].minerals).toBe(300 - BALANCE.rules.trade.give);
    expect(w.players[0].energy).toBe(BALANCE.rules.trade.get);
  });

  it('Allosaures need their research; Blindage véhicules armours machines only', () => {
    const w = new World(createMap());
    finished(w, 'creaturium', 0, 30, 60);
    expect(w.lacks(0, 'allosaure')).toContain("Dressage d'allosaures");
    w.players[0].upgrades.dressageallosaures = 1;
    expect(w.lacks(0, 'allosaure')).toBe('');
    w.players[1].upgrades.vehicles = 3;
    const tank = w.spawn('pegase', 1, ...at(44, 60));
    const aux = w.spawn('auxiliaire', 1, ...at(44, 62));
    const shooter = w.spawn('archer', 0, ...at(40, 61));
    shooter.order = { kind: 'attack', target: tank.id, auto: false, lx: shooter.x, ly: shooter.y };
    run(w, 1.2);
    const tankLoss = tank.maxHp - tank.hp;
    shooter.order = { kind: 'attack', target: aux.id, auto: false, lx: shooter.x, ly: shooter.y };
    run(w, 1.2);
    expect(tankLoss).toBeLessThan(aux.maxHp - aux.hp);
  });

  it('Pillage pays a share of a building brought down', () => {
    const w = new World(createMap());
    w.players[0].upgrades.pillage = 1;
    const g = finished(w, 'grenier', 1, 44, 60);
    g.hp = 5;
    w.spawn('legionnaire', 0, ...at(43, 59));
    run(w, 3);
    expect(w.entities.has(g.id)).toBe(false);
    expect(w.players[0].minerals).toBe(Math.floor(((DEFS.grenier as UnitDef).cost.minerals * BALANCE.rules.upgrades.pillageShare) / 100));
  });
});
