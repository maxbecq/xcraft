import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};
const points = (e: { mana: number }) => Math.floor(e.mana / FP);

/** Casters' own energy (fiches 2010, Z.doc), in place of the cooldowns the game used to stand in for it. */
describe('energy of the casters', () => {
  it('the Alchimiste is born half full (mod), regains 1.5 a second (fiche) and pays its Cocktail 125 (fiche)', () => {
    const w = new World(createMap());
    w.players[0].upgrades.cocktail = 1;
    const a = w.spawn('alchimiste', 0, ...at(40, 60));
    expect(points(a)).toBe(100);
    expect(w.manaOf(a)![0]).toBe(200);
    const foe = w.spawn('serf', 1, ...at(43, 60)); // a worker: it does not fight back
    const cocktail = { player: 0, kind: 'ability' as const, ids: [a.id], name: 'explosiftoxique', x: foe.x, y: foe.y };
    w.step([cocktail]);
    expect(w.ready(a, 'explosiftoxique')).toBe(false);
    expect(w.events.some((e) => /énergie/.test(e.text))).toBe(true);
    run(w, 17); // 25 points at 1.5 a second
    expect(points(a)).toBeGreaterThanOrEqual(125);
    w.step([cocktail]);
    run(w, 1);
    expect(points(a)).toBeLessThan(10);
  });

  it('a spell with a cooldown of its own (Sphère de renvoi, 75 s) waits for it even with energy to spare', () => {
    const w = new World(createMap());
    w.players[0].upgrades.renvoi = 1;
    const v = w.spawn('voyageur', 0, ...at(40, 60));
    v.mana = 1 << 30;
    const ally = w.spawn('archer', 0, ...at(41, 60));
    const cast = { player: 0, kind: 'ability' as const, ids: [v.id], name: 'renvoi', x: ally.x, y: ally.y };
    w.step([cast]);
    run(w, 0.5);
    expect(ally.reflect).toBeGreaterThan(0);
    run(w, 2);
    expect(w.ready(v, 'renvoi')).toBe(false);
    run(w, ABILITIES.renvoi.cooldown);
    expect(w.ready(v, 'renvoi')).toBe(true);
  });

  it("a Z socle's Accumulateur holds 100 to 250 by the socle's level (Z.doc); the Réparateur spends 5 a second repairing", () => {
    const w = new World(createMap());
    const quad = w.spawn('quadripode', 0, ...at(40, 60));
    quad.kit = 'accumulateur';
    const hexa = w.spawn('hexapode', 0, ...at(44, 60));
    hexa.kit = 'accumulateur';
    expect(w.manaOf(quad)![0]).toBe(100);
    expect(w.manaOf(hexa)![0]).toBe(150);
    const medic = w.spawn('quadripode', 0, ...at(50, 60));
    medic.kit = 'reparateur';
    medic.mana = 20 * FP;
    const hurt = w.spawn('hexapode', 0, ...at(51, 60));
    hurt.hp = 100;
    run(w, 10);
    // 20 points (and the little regained meanwhile) mend about 40 PV, then it waits for more.
    expect(hurt.hp).toBeGreaterThan(130);
    expect(hurt.hp).toBeLessThan(100 + 40 + 2 * 10 * 2 + 5);
    expect(points(medic)).toBeLessThan(2);
  });
});
