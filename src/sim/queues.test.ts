import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import type { Entity, World } from './world';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};

/** Production queues and the commands a peer sends: nothing comes out early, twice or for free. */
describe('queues', () => {
  it('a building raised by a level-3 Gaïa summons at the usual speed', () => {
    const w = createMatch(['dieux', 'humains']);
    const p = w.players[0]; p.minerals = 99999; p.energy = 99999;
    const [gaia] = of(w, 0, 'gaia');
    gaia.lvl = 3;
    let spot: [number, number] | undefined;
    for (let r = 4; r < 40 && !spot; r++) for (let dx = -r; dx <= r && !spot; dx++) for (const dy of [-r, r]) if (!spot && w.canPlace('asgaard', 22 + dx, 18 + dy, 0)) spot = [22 + dx, 18 + dy];
    w.step([{ player: 0, kind: 'build', ids: [gaia.id], type: 'asgaard', tx: spot![0], ty: spot![1] }]);
    run(w, 120);
    const portes = of(w, 0, 'asgaard');
    const nouv = portes.find((b) => b.tx === spot![0])!;
    expect(nouv.buildLeft).toBe(0);
    w.spawn('branche', 0, 40 * FP, 14 * FP);
    w.step([{ player: 0, kind: 'train', ids: [nouv.id], type: 'thor' }]);
    expect(nouv.lvl).toBe(3);
    expect(nouv.trainLeft).toBeGreaterThanOrEqual(ticks((DEFS.thor as UnitDef).buildTime) - 1);
  });

  it('what is queued behind a morph takes its own time', () => {
    const w = createMatch(['humains', 'isdaris']);
    const p = w.players[0]; p.minerals = 99999; p.energy = 99999;
    const [conseil] = of(w, 0, 'conseil');
    for (const t of Object.keys((DEFS.grandconseil as any).requires ?? {})) w.spawn(t, 0, 60 * FP, 60 * FP);
    w.step([{ player: 0, kind: 'train', ids: [conseil.id], type: 'grandconseil' }]);
    w.step([{ player: 0, kind: 'train', ids: [conseil.id], type: 'serf' }]);
    expect(conseil.queue).toEqual(['grandconseil', 'serf']);
    const serfs = () => of(w, 0, 'serf').length;
    const n0 = serfs();
    let t = 0;
    while (conseil.type !== 'grandconseil' && t < 10000) { w.step([]); t++; }
    w.step([]); w.step([]);
    expect(serfs() - n0).toBe(0);
    expect(conseil.trainLeft).toBeGreaterThan(ticks((DEFS.serf as UnitDef).buildTime) / 2);
  });

  it('two drones ordered at once raise only one Centre K', () => {
    const w = createMatch(['z', 'humains']);
    const p = w.players[0]; p.minerals = 99999; p.energy = 99999;
    w.spawn('optimisation', 0, 60 * FP, 60 * FP);
    const [d1, d2] = of(w, 0, 'drone');
    w.step([
      { player: 0, kind: 'build', ids: [d1.id], type: 'centrek', tx: 24, ty: 30 },
      { player: 0, kind: 'build', ids: [d2.id], type: 'centrek', tx: 30, ty: 24 },
    ]);
    run(w, 20);
    expect(of(w, 0, 'centrek').length).toBe(1);
  });

  it('a trade with an unknown resource gives nothing', () => {
    const w = createMatch(['humains', 'humains']);
    const p = w.players[0]; p.minerals = 0; p.energy = 0;
    const m = w.spawn('marche', 0, 40 * FP, 40 * FP);
    for (let i = 0; i < 5; i++) w.step([{ player: 0, kind: 'trade', ids: [m.id], sell: 'foo' as any }]);
    expect(p.minerals).toBe(0);
    expect(p.energy).toBe(0);
  });

  it('a stop sent for an enemy unit leaves its queued orders', () => {
    const w = createMatch(['humains', 'humains']);
    const [s] = of(w, 1, 'serf');
    w.step([{ player: 1, kind: 'move', ids: [s.id], x: 40 * FP, y: 40 * FP }, { player: 1, kind: 'move', ids: [s.id], x: 50 * FP, y: 50 * FP, queue: true }]);
    const before = s.next.length;
    w.step([{ player: 0, kind: 'stop', ids: [s.id] }]);
    expect(before).toBe(1);
    expect(s.next.length).toBe(1);
  });
});

describe('Miniportail', () => {
  const gate = (mini: boolean) => {
    const w = createMatch(['isdaris', 'humains']);
    const p = w.players[0]; p.minerals = 99999; p.energy = 99999;
    const robot = of(w, 0, 'moissonneur')[0];
    w.step([{ player: 0, kind: 'build', ids: [robot.id], type: 'portail', tx: 18, ty: 18 }]);
    run(w, 70);
    const b = of(w, 0, 'portail')[0];
    expect(b.buildLeft).toBe(0);
    if (mini) p.upgrades.miniportail = 1;
    return { w, b };
  };

  it('the Portail with its Miniportail trains the first two of its queue at once', () => {
    for (const mini of [false, true]) {
      const { w, b } = gate(mini);
      const n0 = of(w, 0, 'archer').length;
      w.step([{ player: 0, kind: 'train', ids: [b.id], type: 'archer' }, { player: 0, kind: 'train', ids: [b.id], type: 'archer' }]);
      const t = w.trainTime(b, 'archer');
      for (let i = 0; i < t + 1; i++) w.step([]);
      expect(of(w, 0, 'archer').length - n0).toBe(mini ? 2 : 1);
      expect(b.queue.length).toBe(mini ? 0 : 1);
    }
  });

  it('the third in the queue takes up the line freed, and a cancelled second loses its progress', () => {
    const { w, b } = gate(true);
    const t = w.trainTime(b, 'archer');
    w.step([0, 1, 2].map(() => ({ player: 0, kind: 'train' as const, ids: [b.id], type: 'archer' })));
    for (let i = 0; i < t / 2; i++) w.step([]);
    expect(b.trainLeft2).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'cancel', ids: [b.id], slot: 1 }]);
    // The archer that was third now runs on the second line, from the start.
    expect(b.queue.length).toBe(2);
    expect(b.trainLeft2).toBe(t - 1);
    expect(b.trainLeft).toBeLessThan(t / 2 + 2);
  });
});
