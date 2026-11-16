import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

function run(w: World, seconds: number): void {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
}

describe('flying units', () => {
  it('fly in a straight line over cliffs and buildings', () => {
    const w = new World(createMap());
    const t = w.spawn('bourdon', 0, ...at(8, 8));
    w.spawn('caserne', 0, ...at(20, 20));
    w.step([{ player: 0, kind: 'move', ids: [t.id], x: 60 * FP, y: 60 * FP }]);
    for (let i = 0; i < ticks(30) && t.order; i++) {
      w.step([]);
      expect(Math.abs(t.x - t.y)).toBeLessThan(FP / 4); // never leaves the diagonal
    }
    expect(t.order).toBeNull();
    expect(Math.hypot(t.x - 60 * FP, t.y - 60 * FP)).toBeLessThan(FP);
  });

  it('are out of reach of melee and ground-only weapons, and of nothing else', () => {
    const w = new World(createMap());
    const flyer = w.spawn('chimere', 1, ...at(40, 60));
    const legion = w.spawn('legionnaire', 0, ...at(41, 60));
    const phal = w.spawn('phalangiste', 0, ...at(42, 61));
    run(w, 3);
    expect(flyer.hp).toBe(flyer.maxHp);
    expect(flyer.shield).toBe(flyer.maxShield);
    expect(legion.hp + phal.hp).toBeLessThan(legion.maxHp + phal.maxHp);
    expect(legion.order).toBeNull();
    const aux = w.spawn('auxiliaire', 0, ...at(43, 60));
    run(w, 2);
    expect(aux.order).toMatchObject({ kind: 'attack', target: flyer.id });
  });

  it('are shot by the Tour alchimistique, which ignores ground units', () => {
    const w = new World(createMap());
    const tower = w.spawn('tour', 0, ...at(40, 60));
    tower.buildLeft = 0;
    const walker = w.spawn('archer', 1, ...at(44, 60));
    const flyer = w.spawn('chimere', 1, ...at(44, 62));
    run(w, 2);
    expect(walker.hp).toBe(walker.maxHp);
    expect(walker.shield).toBe(walker.maxShield);
    expect(flyer.shield).toBeLessThan(flyer.maxShield);
  });

  it('see over cliffs', () => {
    const w = new World(createMap());
    w.spawn('auxiliaire', 0, ...at(8, 8));
    w.spawn('bourdon', 1, ...at(8, 8));
    run(w, 1);
    const seen = (p: number) => [...Array(64 * 64).keys()].filter((i) => w.vision[p].visible(i % 64, Math.floor(i / 64))).length;
    expect(seen(1)).toBeGreaterThanOrEqual(seen(0));
  });
});
