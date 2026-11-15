import { describe, expect, it } from 'vitest';
import { SUB, createMap } from '../map';
import { FP, tileOf, ticks } from './fixed';
import { createMatch } from './setup';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;

// Bugs found by the code review of the first playable version.
describe('regressions', () => {
  it('refunds a cancelled site once, even if its id is repeated', () => {
    const w = createMatch();
    w.players[0].minerals = 1000;
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'grenier', tx: 18, ty: 18 }]);
    for (let i = 0; i < 60; i++) w.step([]);
    const site = [...w.entities.values()].find((e) => e.type === 'grenier')!;
    const before = w.players[0].minerals;
    w.step([{ player: 0, kind: 'cancel', ids: [site.id, site.id] }]);
    expect(w.players[0].minerals - before).toBe(200);
    expect(w.grid.blocked[18 * w.grid.width + 18]).toBe(0);
  });

  it('never heals a unit that just died', () => {
    // Try every tick phase, since healers look for patients every 4 ticks.
    for (let phase = 0; phase < 4; phase++) {
      const w = new World(createMap());
      const ally = w.spawn('auxiliaire', 0, ...at(40, 60));
      const medic = w.spawn('soigneur', 0, ...at(41, 60));
      w.step([{ player: 0, kind: 'attack', ids: [medic.id], x: 70 * FP, y: 60 * FP }]);
      for (let i = 0; i < phase; i++) w.step([]);
      ally.hp = 0;
      w.step([]);
      expect(w.entities.has(ally.id)).toBe(false);
    }
  });

  it('walks units out from under a new building without crossing a cliff', () => {
    const w = new World(createMap());
    // Main plateau (level 2): a unit with an order sits in the middle of a future caserne.
    const u = w.spawn('serf', 0, ...at(19, 19));
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: 12 * FP, y: 20 * FP }]);
    w.spawn('caserne', 0, 18 * FP, 18 * FP);
    for (let i = 0; i < ticks(20); i++) w.step([]);
    expect(w.grid.open(tileOf(u.x), tileOf(u.y))).toBe(true);
    expect(w.grid.level(tileOf(u.x), tileOf(u.y))).toBe(2 * SUB);
  });

  it('ignores attack orders on enemies hidden in the fog', () => {
    const w = new World(createMap());
    const [x, y] = at(40, 60);
    const mine = w.spawn('auxiliaire', 0, x, y);
    const hidden = w.spawn('auxiliaire', 1, ...at(80, 20));
    w.step([]);
    w.step([{ player: 0, kind: 'attack', ids: [mine.id], x: hidden.x, y: hidden.y, target: hidden.id }]);
    expect(mine.order?.kind).toBe('attackMove');
  });

  it('rejects commands with malformed coordinates', () => {
    const w = new World(createMap());
    const u = w.spawn('auxiliaire', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'move', ids: [u.id], x: Number.NaN, y: 5 }]);
    expect(u.order).toBeNull();
  });
});
