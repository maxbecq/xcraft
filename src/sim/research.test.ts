import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';
import { noRegen } from './noregen';

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
  it('Croissance économique gives serfs and Caserne soldiers 5 more hp, old and new', () => {
    noRegen();
    const w = new World(createMap());
    const old = w.spawn('auxiliaire', 0, ...at(40, 60));
    old.hp -= 20;
    const marche = finished(w, 'marche', 0, 30, 60);
    w.players[0].minerals = 1000;
    w.step([{ player: 0, kind: 'train', ids: [marche.id], type: 'croissance' }]);
    run(w, (DEFS.croissance as UnitDef).buildTime + 1);
    expect(old.maxHp).toBe(85);
    expect(old.hp).toBe(65);
    expect(w.spawn('serf', 0, ...at(41, 60)).maxHp).toBe(80);
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
    // One shot of an Archer at a Pégase, with and without Blindage véhicules 3, and at an Auxiliaire with it.
    const shot = (target: string, vehicles: number) => {
      const v = new World(createMap());
      v.players[1].upgrades.vehicles = vehicles;
      const t = v.spawn(target, 1, ...at(44, 60));
      const shooter = v.spawn('archer', 0, ...at(40, 60));
      shooter.order = { kind: 'attack', target: t.id, auto: false, lx: shooter.x, ly: shooter.y };
      while (t.hp === t.maxHp) v.step([]);
      return t.maxHp - t.hp;
    };
    expect(shot('pegase', 3)).toBeLessThan(shot('pegase', 0));
    expect(shot('auxiliaire', 3)).toBe(shot('auxiliaire', 0));
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

describe('Scarabée amélioré (fiche 2010)', () => {
  it('gives the Scarabée 0.1 more speed and a turret with the six values of the sheet', () => {
    const w = new World(createMap());
    const s = w.spawn('scarabee', 0, ...at(40, 60));
    const before = s.speed;
    w.players[0].upgrades.scarabeassaut = 1;
    expect(w.baseSpeed(s)).toBeGreaterThan(before);
    expect(w.weapon(s)!.vs).toEqual([15, 11, 11, 8, 4, 8]);
    // One born after the research has it too.
    const late = w.spawn('scarabee', 0, ...at(44, 60));
    expect(late.speed).toBe(w.baseSpeed(late));
    expect(late.speed).toBeGreaterThan(before);
  });
});

describe('Scarabée (fiche 2010)', () => {
  it('takes 3 soldiers, the fourth is told it is full', () => {
    const w = new World(createMap());
    const s = w.spawn('scarabee', 0, ...at(40, 60));
    expect(w.room(s)).toBe(3);
    const men = [0, 1, 2, 3].map((i) => w.spawn('auxiliaire', 0, ...at(42, 58 + i)));
    w.step([{ player: 0, kind: 'smart', ids: men.map((m) => m.id), x: s.x, y: s.y, target: s.id }]);
    for (let i = 0; i < ticks(8); i++) w.step([]);
    expect(men.filter((m) => m.inside === s.id)).toHaveLength(3);
  });
});

describe('the Dirigeable (the balancer, 2026-11-22: its own unit, 4 of supply, no research)', () => {
  it('lifts a Char Pégase (4 of supply) alone, then nobody more; unloaded, the hold is free', () => {
    const w = new World(createMap());
    const b = w.spawn('dirigeable', 0, ...at(40, 60));
    const tank = w.spawn('pegase', 0, ...at(42, 60));
    const man = w.spawn('auxiliaire', 0, ...at(40, 62));
    w.step([{ player: 0, kind: 'smart', ids: [tank.id], x: b.x, y: b.y, target: b.id }]);
    for (let i = 0; i < ticks(8) && !tank.inside; i++) w.step([]);
    expect(tank.inside).toBe(b.id);
    w.step([{ player: 0, kind: 'smart', ids: [man.id], x: b.x, y: b.y, target: b.id }]);
    for (let i = 0; i < ticks(8); i++) w.step([]);
    expect(man.inside).toBe(0); // full
    w.step([{ player: 0, kind: 'unload', ids: [b.id] }]);
    expect(tank.inside).toBe(0);
  });
});

describe('no shelter within a carried shelter', () => {
  it('a Dirigeable lifts only an empty Scarabée, and a lifted Scarabée takes nobody', () => {
    const w = new World(createMap());
    const b = w.spawn('dirigeable', 0, ...at(40, 60));
    const s = w.spawn('scarabee', 0, ...at(42, 60));
    const man = w.spawn('auxiliaire', 0, ...at(44, 60));
    man.inside = s.id;
    expect(w.boards(s, b)).toBe(false);
    man.inside = 0;
    expect(w.boards(s, b)).toBe(true);
    s.inside = b.id;
    expect(w.boards(man, s)).toBe(false);
  });
});
