import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

function army(w: World, owner: number, type: string, tx: number, ty: number, n: number): Entity[] {
  return Array.from({ length: n }, (_, i) => w.spawn(type, owner, ...at(tx + (i % 3), ty + Math.floor(i / 3))));
}

function run(w: World, seconds: number): void {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
}

const alive = (w: World, owner: number) => [...w.entities.values()].filter((e) => e.owner === owner && e.def.kind === 'unit');

describe('combat', () => {
  it('lets idle armies in sight of each other fight to the end', () => {
    const w = new World(createMap());
    army(w, 0, 'auxiliaire', 40, 60, 6);
    army(w, 1, 'auxiliaire', 46, 60, 4);
    run(w, 40);
    expect(alive(w, 1)).toHaveLength(0);
    expect(alive(w, 0).length).toBeGreaterThan(0);
  });

  it('leaves a building for a worker, and a worker for a soldier, that come into sight', () => {
    const w = new World(createMap());
    const [aux] = army(w, 0, 'auxiliaire', 40, 60, 1);
    const depot = w.spawn('grenier', 1, ...at(42, 60));
    w.step([{ player: 0, kind: 'attack', ids: [aux.id], x: depot.x, y: depot.y }]);
    run(w, 3);
    expect(aux.order).toMatchObject({ target: depot.id });
    const [serf] = army(w, 1, 'serf', 39, 63, 1);
    run(w, 1);
    expect(aux.order).toMatchObject({ target: serf.id });
    const [soldier] = army(w, 1, 'auxiliaire', 38, 64, 1);
    run(w, 1);
    expect(aux.order).toMatchObject({ target: soldier.id });
  });

  it('attack-moves into an enemy base and razes a building', () => {
    const w = new World(createMap());
    const squad = army(w, 0, 'legionnaire', 40, 60, 6);
    const target = w.spawn('grenier', 1, 60 * FP, 60 * FP);
    w.step([{ player: 0, kind: 'attack', ids: squad.map((e) => e.id), x: 61 * FP, y: 61 * FP }]);
    run(w, 60);
    expect(w.entities.has(target.id)).toBe(false);
  });

  it('fights back when shot while attack-moving, even when walking on past an unreachable target', () => {
    const w = new World(createMap());
    const aux = w.spawn('auxiliaire', 0, ...at(40, 60));
    const archer = w.spawn('archer', 1, ...at(44, 60));
    w.step([{ player: 0, kind: 'attack', ids: [aux.id], x: 40 * FP, y: 30 * FP }]);
    aux.calmUntil = w.tick + ticks(60); // as after giving up on a target out of reach
    run(w, 2);
    expect(aux.order).toMatchObject({ kind: 'attackMove', target: archer.id });
  });

  it('heals wounded allies with a soigneur', () => {
    const w = new World(createMap());
    const [hurt] = army(w, 0, 'auxiliaire', 40, 60, 1);
    army(w, 0, 'soigneur', 43, 60, 1);
    hurt.hp = 20;
    run(w, 15);
    expect(hurt.hp).toBe(hurt.maxHp);
  });

  it('cannot see, so cannot shoot, up a cliff', () => {
    const w = new World(createMap());
    // Main plateau (level 2) edge at x=29; low ground (level 1) right below at x=31.
    const [high] = army(w, 0, 'auxiliaire', 28, 17, 1);
    const [low] = army(w, 1, 'auxiliaire', 31, 17, 1);
    run(w, 5);
    expect(w.sees(1, high)).toBe(false);
    expect(w.sees(0, low)).toBe(true);
    expect(high.hp).toBe(high.maxHp);
    expect(low.hp).toBeLessThan(low.maxHp);
  });

  it('declares a winner when a player has no buildings left', () => {
    const w = createMatch();
    for (const e of [...w.entities.values()]) if (e.owner === 1 && e.def.kind === 'building') e.hp = 0;
    run(w, 2);
    expect(w.winner).toBe(0);
  });

  it('stays deterministic through a battle', () => {
    const play = () => {
      const w = new World(createMap());
      const a = [...army(w, 0, 'auxiliaire', 30, 60, 6), ...army(w, 0, 'soigneur', 30, 63, 2)];
      const b = army(w, 1, 'legionnaire', 60, 60, 6);
      w.step([
        { player: 0, kind: 'attack', ids: a.map((e) => e.id), x: 60 * FP, y: 60 * FP },
        { player: 1, kind: 'attack', ids: b.map((e) => e.id), x: 30 * FP, y: 60 * FP },
      ]);
      run(w, 60);
      return w.hash();
    };
    expect(play()).toBe(play());
  });
});

describe('attacking one\'s own side (explicit order only)', () => {
  it('hits an own or allied unit on an attack order, never on its own, and the victim does not strike back', () => {
    const w = new World(createMap(), 3);
    w.setTeams([0, 0, 1]);
    const [a] = army(w, 0, 'auxiliaire', 40, 60, 1);
    const [mine] = army(w, 0, 'auxiliaire', 42, 60, 1);
    const [ally] = army(w, 1, 'auxiliaire', 40, 63, 1);
    // Side by side, nobody fights on their own.
    run(w, 3);
    expect([mine.hp, ally.hp]).toEqual([mine.maxHp, ally.maxHp]);
    expect(a.order).toBeNull();
    // A plain right-click (smart) on one's own unit follows it.
    w.step([{ player: 0, kind: 'smart', ids: [a.id], x: mine.x, y: mine.y, target: mine.id }]);
    run(w, 2);
    expect(mine.hp).toBe(mine.maxHp);
    // The attack command, then a click on it: it is struck, and stays put.
    w.step([{ player: 0, kind: 'attack', ids: [a.id], x: mine.x, y: mine.y, target: mine.id }]);
    run(w, 4);
    expect(mine.hp).toBeLessThan(mine.maxHp);
    expect(mine.order).toBeNull();
    // An ally's unit too.
    w.step([{ player: 0, kind: 'attack', ids: [a.id], x: ally.x, y: ally.y, target: ally.id }]);
    run(w, 4);
    expect(ally.hp).toBeLessThan(ally.maxHp);
    expect(ally.order).toBeNull();
    // A unit told to attack itself does not.
    const hp = a.hp;
    w.step([{ player: 0, kind: 'attack', ids: [a.id], x: a.x, y: a.y, target: a.id }]);
    run(w, 2);
    expect(a.hp).toBe(hp);
  });

  it('a Sphère de renvoi sends friendly fire back too, by design, and still nobody strikes back', () => {
    const w = new World(createMap(), 2);
    const [a] = army(w, 0, 'auxiliaire', 40, 60, 1);
    const [mine] = army(w, 0, 'auxiliaire', 41, 60, 1);
    mine.reflect = ticks(30);
    w.step([{ player: 0, kind: 'attack', ids: [a.id], x: mine.x, y: mine.y, target: mine.id }]);
    run(w, 4);
    expect(mine.hp).toBeLessThan(mine.maxHp);
    expect(a.hp).toBeLessThan(a.maxHp); // the Sphère answers any blow, whoever strikes (rule 47 exception)
    expect(mine.order).toBeNull();
  });
});
