import { describe, expect, it } from 'vitest';
import { raises, type UnitDef } from '../data';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

describe('Isdaris defences', () => {
  it('a Récepteur turns into a Récepteur armé that shoots, keeping its energy', () => {
    const w = createMatch(['isdaris', 'humains']);
    const rec = w.spawn('recepteur', 0, 20 * FP, 30 * FP);
    w.players[0].minerals = 600;
    w.step([{ player: 0, kind: 'train', ids: [rec.id], type: 'recepteurarme' }]);
    expect(w.players[0].minerals).toBe(0);
    for (let i = 0; i < ticks(31); i++) w.step([]);
    expect(rec.type).toBe('recepteurarme');
    expect(rec.maxHp).toBe(700);
    const foe = w.spawn('auxiliaire', 1, 24 * FP, 31 * FP);
    for (let i = 0; i < ticks(4); i++) w.step([]);
    expect(foe.hp).toBeLessThan(foe.maxHp);
  });

  it('a Pylône sanglant needs an Orbe de commandement', () => {
    const w = createMatch(['isdaris', 'humains']);
    const em = w.spawn('emetteur', 0, 20 * FP, 30 * FP);
    w.players[0].minerals = 1000;
    w.players[0].energy = 1000;
    w.step([{ player: 0, kind: 'train', ids: [em.id], type: 'pylonesanglant' }]);
    expect(em.queue).toHaveLength(0);
    w.spawn('orbecommandement', 0, 30 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'train', ids: [em.id], type: 'pylonesanglant' }]);
    expect(em.queue).toEqual(['pylonesanglant']);
  });
});

describe('Fortin', () => {
  it('shelters four soldiers who shoot from inside, out of reach, and throws them out when it falls', () => {
    const w = createMatch(['humains', 'humains']);
    const fort = w.spawn('fortin', 0, 30 * FP, 30 * FP);
    const crew = [0, 1, 2, 3, 4].map((i) => w.spawn('auxiliaire', 0, (27 + i) * FP + FP / 2, 34 * FP + FP / 2));
    w.step([{ player: 0, kind: 'smart', ids: crew.map((u) => u.id), x: fort.x, y: fort.y, target: fort.id }]);
    for (let i = 0; i < ticks(6); i++) w.step([]);
    expect(crew.filter((u) => u.inside === fort.id)).toHaveLength(4);
    const foe = w.spawn('auxiliaire', 1, 35 * FP, 30 * FP); // 5 tiles from the centre: in reach from the bunker only
    for (let i = 0; i < ticks(3); i++) w.step([]);
    expect(foe.hp).toBeLessThan(foe.maxHp);
    const inside = crew.filter((u) => u.inside);
    expect(inside.every((u) => u.hp === u.maxHp)).toBe(true);
    fort.hp = 0; // destroyed
    for (let i = 0; i < 3; i++) w.step([]);
    expect(w.entities.has(fort.id)).toBe(false);
    expect(inside.every((u) => !u.inside)).toBe(true);
  });
});

describe('construction', () => {
  it('finishes a building at full health (Humans built by a worker, Isdaris materialised)', () => {
    for (const [faction, type] of [['humains', 'grenier'], ['isdaris', 'reservepsy']] as const) {
      const w = createMatch([faction, 'humains']);
      // The Humans' serf; the Isdaris Obélisque, which materialises their buildings.
      const worker = [...w.entities.values()].find((e) => e.owner === 0 && raises(e.def as UnitDef, type))!;
      w.players[0].minerals = 1000;
      const [tx, ty] = faction === 'isdaris' ? [17, 18] : [18, 18];
      w.step([{ player: 0, kind: 'build', ids: [worker.id], type, tx, ty }]);
      let b;
      for (let i = 0; i < ticks(60) && !(b && b.buildLeft === 0); i++) {
        w.step([]);
        b = [...w.entities.values()].find((e) => e.type === type && e.owner === 0);
      }
      expect(b?.buildLeft).toBe(0);
      expect(b!.hp).toBe(b!.maxHp);
    }
  });

  it('each Serf on a site cuts the time left by 10 % (fiche 2010)', () => {
    const took = (n: number) => {
      const w = createMatch(['humains', 'humains']);
      w.players[0].minerals = 1000;
      const serfs = [...w.entities.values()].filter((e) => e.owner === 0 && e.type === 'serf').slice(0, n);
      w.step([{ player: 0, kind: 'build', ids: serfs.map((s) => s.id), type: 'grenier', tx: 18, ty: 18 }]);
      const site = () => [...w.entities.values()].find((e) => e.type === 'grenier' && e.owner === 0);
      for (let i = 0; i < ticks(30) && !site(); i++) w.step([]);
      const b = site()!;
      if (n > 1) w.step([{ player: 0, kind: 'smart', ids: serfs.slice(1).map((s) => s.id), x: b.x, y: b.y, target: b.id }]);
      let t = 0;
      while (b.buildLeft > 0 && t < ticks(120)) { w.step([]); t++; }
      return b.buildLeft === 0 ? t : Infinity;
    };
    const one = took(1);
    const three = took(3);
    // (9/10)^2 of the time once all three are there; a little more, as the helpers walk up first.
    expect(three).toBeLessThan(one * 0.88);
    expect(three).toBeGreaterThan(one * 0.78);
  });
});
