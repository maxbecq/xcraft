import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};
const isdaris = () => {
  const w = new World(createMap());
  w.players[0].faction = 'isdaris';
  return w;
};

describe('Isdaris tree (notice 1.2-1)', () => {
  it('extensions unlock units: Druides need the Laboratoire, Dragons the Balise and the Pyramide', () => {
    const w = isdaris();
    w.spawn('portail', 0, 20 * FP, 20 * FP);
    expect(w.lacks(0, 'druide')).toContain('Laboratoire');
    w.players[0].upgrades.laboratoire = 1;
    expect(w.lacks(0, 'druide')).toBe('');
    w.players[0].upgrades.balise = 1;
    expect(w.lacks(0, 'dragon')).toContain('Pyramide');
  });

  it('a Cuve génétique makes Créatures come in pairs', () => {
    const w = isdaris();
    const p = w.spawn('portail', 0, 20 * FP, 20 * FP);
    w.spawn('obelisque', 0, 30 * FP, 20 * FP);
    w.players[0].upgrades.cuvegenetique = 1;
    w.players[0].minerals = 500;
    w.step([{ player: 0, kind: 'train', ids: [p.id], type: 'creature' }]);
    run(w, (DEFS.creature as UnitDef).buildTime + 1);
    expect([...w.entities.values()].filter((e) => e.type === 'creature')).toHaveLength(2);
  });

  it('a burrowed Créature is unseen, and bursts out when an enemy walks by', () => {
    const w = isdaris();
    w.players[0].upgrades.enfouissement = 1;
    const c = w.spawn('creature', 0, ...at(40, 60));
    w.spawn('auxiliaire', 1, ...at(46, 60));
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'enfouissement' }]);
    run(w, 0.2);
    expect(c.burrowed).toBe(true);
    expect(w.sees(1, c)).toBe(false);
    const passer = w.spawn('serf', 1, ...at(41, 60));
    passer.order = { kind: 'move', x: passer.x, y: passer.y, arrive: 0 };
    run(w, 1);
    expect(c.burrowed).toBe(false);
  });

  it('a Porte-disques teleports; a Déflecteur hides the walkers round it', () => {
    const w = isdaris();
    w.players[0].upgrades.assembleur = 1;
    const d = w.spawn('discobole', 0, ...at(40, 60));
    w.step([{ player: 0, kind: 'ability', ids: [d.id], name: 'teleport', x: 46 * FP + FP / 2, y: 60 * FP + FP / 2 }]);
    run(w, 0.2);
    expect(Math.round(d.x / FP)).toBeGreaterThanOrEqual(45);
    const def = w.spawn('deflecteur', 0, 30 * FP, 70 * FP);
    const a = w.spawn('archer', 0, def.x + FP, def.y + FP);
    w.spawn('auxiliaire', 1, a.x + 3 * FP, a.y);
    run(w, 0.2);
    expect(w.sees(1, a)).toBe(false);
  });

  it("the Trône's orbital cannon needs an Espion watching the spot", () => {
    const w = isdaris();
    w.players[0].upgrades.relais = 1;
    w.players[0].energy = 1000;
    const t = w.spawn('trone', 0, 20 * FP, 20 * FP);
    const target = w.spawn('legionnaire', 1, ...at(60, 60));
    w.step([{ player: 0, kind: 'ability', ids: [t.id], name: 'canonorbital', x: target.x, y: target.y }]);
    expect(target.hp).toBe(target.maxHp);
    w.spawn('espion', 0, ...at(58, 60));
    w.step([{ player: 0, kind: 'ability', ids: [t.id], name: 'canonorbital', x: target.x, y: target.y }]);
    run(w, 5.5);
    expect(target.hp).toBe(target.maxHp); // the beam strikes 6 s after the order, time to flee
    run(w, 1);
    expect(w.entities.has(target.id)).toBe(false);
  });

  it('the orbital cannon strikes what stands under it when it lands, not what stood there at the order', () => {
    const w = isdaris();
    w.players[0].upgrades.relais = 1;
    w.players[0].energy = 1000;
    const t = w.spawn('trone', 0, 20 * FP, 20 * FP);
    w.spawn('espion', 0, ...at(58, 60));
    const leaver = w.spawn('legionnaire', 1, ...at(60, 60));
    const comer = w.spawn('legionnaire', 1, ...at(60, 80));
    leaver.frozen = comer.frozen = ticks(30); // they stay where they are put
    const [x, y] = [leaver.x, leaver.y];
    w.step([{ player: 0, kind: 'ability', ids: [t.id], name: 'canonorbital', x, y }]);
    run(w, 2);
    [leaver.x, leaver.y] = [x, y + 20 * FP];
    [comer.x, comer.y] = [x, y];
    run(w, 5);
    expect(leaver.hp).toBe(leaver.maxHp);
    expect(w.entities.has(comer.id)).toBe(false);
  });
});
