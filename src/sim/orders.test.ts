import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { type Entity, World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};
const tiles = (e: Entity) => [Math.round(e.x / FP), Math.round(e.y / FP)];

describe('hold position', () => {
  it('stays put when an enemy shows up beyond reach, and shoots one within reach', () => {
    const w = new World(createMap());
    const guard = w.spawn('auxiliaire', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'hold', ids: [guard.id] }]);
    const start = [guard.x, guard.y];
    // In sight (8) but out of reach (4): a plain idle soldier would walk up to it.
    const far = w.spawn('serf', 1, ...at(46, 60));
    run(w, 4);
    expect([guard.x, guard.y]).toEqual(start);
    expect(far.hp).toBe(far.maxHp);
    // Within reach: it fires, still without moving.
    const near = w.spawn('serf', 1, ...at(43, 60));
    run(w, 4);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect([guard.x, guard.y]).toEqual(start);
  });

  it('ends with the next move', () => {
    const w = new World(createMap());
    const guard = w.spawn('auxiliaire', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'hold', ids: [guard.id] }]);
    expect(guard.stand).toBe(true);
    w.step([{ player: 0, kind: 'move', ids: [guard.id], x: at(44, 60)[0], y: at(44, 60)[1] }]);
    expect(guard.stand).toBe(false);
  });
});

describe('patrol', () => {
  it('walks back and forth between where it stood and the point', () => {
    const w = new World(createMap());
    const scout = w.spawn('auxiliaire', 0, ...at(40, 60));
    const [x, y] = at(48, 60);
    w.step([{ player: 0, kind: 'patrol', ids: [scout.id], x, y }]);
    let far = 0;
    let back = 0;
    for (let i = 0; i < ticks(30); i++) {
      w.step([]);
      const [tx] = tiles(scout);
      if (tx >= 47) far++;
      if (far && tx <= 41) back++;
    }
    expect(far).toBeGreaterThan(0);
    expect(back).toBeGreaterThan(0);
    expect(scout.order?.kind).toBe('attackMove'); // still patrolling
  });
});

describe('group arrival', () => {
  it('a spread-out group fans out round the point instead of piling onto it', () => {
    const w = new World(createMap());
    const group = [w.spawn('auxiliaire', 0, ...at(30, 52)), w.spawn('auxiliaire', 0, ...at(30, 60)), w.spawn('auxiliaire', 0, ...at(30, 68)), w.spawn('auxiliaire', 0, ...at(36, 60))];
    const [x, y] = at(50, 60);
    w.step([{ player: 0, kind: 'move', ids: group.map((e) => e.id), x, y }]);
    run(w, 20);
    for (const e of group) expect(e.order).toBeNull();
    // Each stands on its own spot: no two closer than a body width.
    for (const a of group) for (const b of group) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.radius + b.radius - FP / 8);
    // And they keep their north-to-south order.
    const ys = [group[0].y, group[1].y, group[2].y];
    expect(ys[0]).toBeLessThan(ys[2]);
  });

  it('is the same for the same orders (no hidden randomness)', () => {
    const play = () => {
      const w = new World(createMap());
      const ids = [w.spawn('auxiliaire', 0, ...at(30, 52)), w.spawn('auxiliaire', 0, ...at(31, 66)), w.spawn('legionnaire', 0, ...at(35, 58))].map((e) => e.id);
      w.step([{ player: 0, kind: 'move', ids, x: at(50, 60)[0], y: at(50, 60)[1] }]);
      run(w, 15);
      return ids.map((id) => [w.entities.get(id)!.x, w.entities.get(id)!.y]);
    };
    expect(play()).toEqual(play());
  });
});
