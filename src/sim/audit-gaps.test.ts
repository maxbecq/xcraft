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

  it('the Réservoir de substances: Gaz euphorisants, Acide dissolvant after its research, Explosion suicidaire', () => {
    const w = createMatch(['humains', 'isdaris']);
    const cuve = w.spawn('cuve', 0, 30 * FP, 30 * FP);
    const aux = w.spawn('auxiliaire', 0, 34 * FP, 30 * FP);
    const speed = aux.speed;
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'gazeuphorisants', x: aux.x, y: aux.y }]);
    run(w, 1);
    expect(aux.pace).toBeGreaterThan(0);
    expect(aux.speed).toBeGreaterThan(speed);
    expect(aux.paceAtk).toBe(80); // 25 % faster: 1 / 1.25
    run(w, 31);
    expect(aux.speed).toBe(speed);

    const foe = w.spawn('portail', 1, 40 * FP, 30 * FP);
    foe.buildLeft = 0;
    const hp = foe.hp + foe.shield;
    cuve.abilityCd = 0;
    cuve.frozen = aux.frozen = ticks(60); // their guns quiet, to count the acid alone
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'acidedissolvant', x: foe.x, y: foe.y }]);
    run(w, 10);
    expect(foe.hp + foe.shield).toBe(hp); // no research yet
    w.players[0].upgrades.acide = 1;
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'acidedissolvant', x: foe.x, y: foe.y }]);
    expect(cuve.order?.kind).toBe('cast');
    run(w, 10);
    expect(hp - foe.hp - foe.shield).toBe(400);

    cuve.frozen = 0;
    const near = w.spawn('archer', 1, cuve.x + 2 * FP, cuve.y);
    const far = w.spawn('archer', 1, cuve.x + 8 * FP, cuve.y);
    const [nearHp, farHp] = [near.hp + near.shield, far.hp + far.shield];
    w.step([{ player: 0, kind: 'ability', ids: [cuve.id], name: 'explosioncuve' }]);
    run(w, 1);
    expect(w.entities.has(cuve.id)).toBe(false);
    expect(w.entities.has(near.id) ? nearHp - near.hp - near.shield : nearHp).toBeGreaterThanOrEqual(Math.min(nearHp, 356));
    expect(far.hp + far.shield).toBe(farHp);
  });

  it('the Régénérant covers every living ally of its zone', () => {
    const w = createMatch(['humains', 'isdaris']);
    w.players[0].upgrades.regenerant = 1;
    const alch = w.spawn('alchimiste', 0, 30 * FP, 30 * FP);
    const a = w.spawn('auxiliaire', 0, 33 * FP, 30 * FP);
    const b = w.spawn('auxiliaire', 0, 33 * FP, 31 * FP);
    w.step([{ player: 0, kind: 'ability', ids: [alch.id], name: 'regenerant', x: a.x, y: (a.y + b.y) / 2 }]);
    run(w, 1);
    expect(a.invuln).toBeGreaterThan(0);
    expect(b.invuln).toBeGreaterThan(0);
  });

  it('the Allosaure feasts on a corpse nearby to heal (notice), half its health (mod)', () => {
    const w = createMatch(['humains', 'isdaris']);
    const allo = w.spawn('allosaure', 0, 30 * FP, 30 * FP);
    allo.hp = 100;
    w.step([{ player: 0, kind: 'ability', ids: [allo.id], name: 'festin' }]);
    expect(allo.hp).toBe(100); // no corpse
    const prey = w.spawn('archer', 1, 32 * FP, 30 * FP);
    prey.hp = 0;
    w.step([]);
    expect(w.corpses.length).toBeGreaterThan(0);
    w.step([{ player: 0, kind: 'ability', ids: [allo.id], name: 'festin' }]);
    expect(allo.hp).toBe(100 + Math.floor(allo.maxHp / 2));
    expect(allo.abilityCd).toBeGreaterThan(0);
  });
});
