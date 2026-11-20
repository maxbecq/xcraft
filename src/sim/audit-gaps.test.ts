// Mechanics added after the audit of 20 November 2026 (docs/audit-mecaniques-2026-11-20.md).
import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { type Entity, World } from './world';

const of = (w: World, owner: number, type: string): Entity[] => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('audit gaps', () => {
  it('the Serf repairs buildings and machines, the Esprit buildings only (notice)', () => {
    const w = createMatch(['humains', 'dieux']);
    w.players[0].minerals = 1000;
    const serf = of(w, 0, 'serf')[0];
    const grenier = w.spawn('grenier', 0, 40 * FP, 40 * FP);
    grenier.hp = Math.floor(grenier.maxHp / 2);
    const before = grenier.hp;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: grenier.x, y: grenier.y, target: grenier.id }]);
    expect(serf.order?.kind).toBe('repair');
    run(w, 30);
    expect(grenier.hp).toBeGreaterThan(before);
    const tank = w.spawn('pegase', 0, 30 * FP, 30 * FP);
    tank.hp = 10;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: tank.x, y: tank.y, target: tank.id }]);
    expect(serf.order?.kind).toBe('repair');

    w.players[1].minerals = 1000;
    const esprit = of(w, 1, 'esprit')[0];
    const [porte] = of(w, 1, 'asgaard');
    porte.hp -= 100;
    w.step([{ player: 1, kind: 'smart', ids: [esprit.id], x: porte.x, y: porte.y, target: porte.id }]);
    expect(esprit.order?.kind).toBe('repair');
    run(w, 30);
    expect(porte.hp).toBe(porte.maxHp);
    expect(BALANCE.rules.repair.esprit.hp).toBe(8); // XC.doc 2008
  });
});
