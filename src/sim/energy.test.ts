import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../data';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { World } from './world';
import { noRegen } from './noregen';

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

  it("a Z socle's Accumulateur holds 100 to 250 by the socle's level (Z.doc); the Réparateur needs no energy (équilibreur 22/11)", () => {
    const w = new World(createMap());
    const quad = w.spawn('quadripode', 0, ...at(40, 60));
    quad.kit = 'accumulateur';
    const hexa = w.spawn('hexapode', 0, ...at(44, 60));
    hexa.kit = 'accumulateur';
    expect(w.manaOf(quad)![0]).toBe(100);
    expect(w.manaOf(hexa)![0]).toBe(150);
    const medic = w.spawn('quadripode', 0, ...at(50, 60));
    medic.kit = 'reparateur';
    expect(w.manaOf(medic)).toBeUndefined();
    const hurt = w.spawn('hexapode', 0, ...at(51, 60));
    hurt.hp = 100;
    run(w, 10);
    // 2 a second on a level 1 socle, all the time.
    expect(hurt.hp).toBeGreaterThanOrEqual(100 + 18);
    expect(hurt.hp).toBeLessThanOrEqual(100 + 22);
  });
});

describe('Soins (fiche 2010)', () => {
  it('the Soigneur gives 25 PV at a time, every 2.5 s, from 5 tiles', () => {
    noRegen();
    const w = new World(createMap());
    const s = w.spawn('soigneur', 0, ...at(40, 60));
    const hurt = w.spawn('legionnaire', 0, ...at(44, 60));
    hurt.hp = 20;
    let first = -1;
    for (let i = 0; i < ticks(4) && first < 0; i++) {
      w.step([]);
      if (hurt.hp > 20) first = w.tick;
    }
    expect(hurt.hp).toBe(45);
    expect(Math.hypot(s.x - hurt.x, s.y - hurt.y)).toBeGreaterThan(3 * FP); // healed from where it stood
    run(w, 2.4);
    expect(hurt.hp).toBe(45);
    run(w, 0.2);
    expect(hurt.hp).toBe(70);
  });
});

describe('Recharge des boucliers (fiche 2010, mod)', () => {
  it('a Voyageur gives 20 shield to a drained ally within 3 tiles, once a second, 10 energy each time', () => {
    const w = new World(createMap());
    const v = w.spawn('voyageur', 0, ...at(40, 60));
    const archer = w.spawn('archer', 0, ...at(42, 60));
    archer.shield = 0;
    archer.lastHit = w.tick; // no natural recharge for a while
    const m0 = v.mana;
    w.step([]);
    expect(archer.shield).toBe(20);
    expect(v.mana).toBeLessThan(m0 - 9 * FP);
    run(w, 1.05);
    expect(archer.shield).toBe(40);
    // Dry: nothing more.
    v.mana = 0;
    const s = archer.shield;
    run(w, 2);
    expect(archer.shield).toBe(s);
    // A Réserve psy does the same; out of 3 tiles, nobody.
    const far = w.spawn('archer', 0, ...at(63, 60));
    far.shield = 0;
    far.lastHit = w.tick;
    const r = w.spawn('reservepsy', 0, ...at(56, 60));
    r.buildLeft = 0;
    run(w, 1);
    expect(far.shield).toBe(0);
    far.x = far.px = r.x + 2 * FP;
    run(w, 1);
    expect(far.shield).toBeGreaterThanOrEqual(20);
  });
});

describe('Sphère de renvoi (fiche 2010, mod)', () => {
  it('half of each blow goes back, half is taken, until 300 points have gone back', () => {
    const w = new World(createMap());
    const v = w.spawn('voyageur', 0, ...at(40, 60));
    v.mana = 1 << 30;
    w.players[0].upgrades.renvoi = 1;
    const ally = w.spawn('archer', 0, ...at(41, 60));
    w.step([{ player: 0, kind: 'ability', ids: [v.id], name: 'renvoi', x: ally.x, y: ally.y }]);
    run(w, 0.3);
    expect(ally.reflect).toBeGreaterThan(ticks(39));
    const foe = w.spawn('allosaure', 1, ...at(43, 60));
    foe.hp = foe.maxHp = 10000;
    const [h0, s0] = [ally.hp + ally.shield, foe.hp];
    w.hit(foe, ally, { damage: 60, range: 0.1, cooldown: 1 });
    expect(h0 - (ally.hp + ally.shield)).toBe(30);
    expect(s0 - foe.hp).toBe(30 - (foe.def as { armor: number }).armor);
    // The cap: once 300 have gone back, the Sphère is spent.
    for (let i = 0; i < 10 && ally.reflect > 0; i++) {
      ally.hp = ally.maxHp;
      w.hit(foe, ally, { damage: 60, range: 0.1, cooldown: 1 });
    }
    expect(ally.reflect).toBe(0);
    expect(ally.reflectLeft).toBe(0);
  });
});

describe('mana of the gods (XC.doc 2008)', () => {
  it('every god holds 150 to 200 by its level, regains 1.5 a second (balance designer 2026-11-22), and pays its spells by level; ultimates are free', () => {
    const w = new World(createMap());
    const apollon = w.spawn('apollon', 0, ...at(40, 60));
    expect(w.manaOf(apollon)![0]).toBe(150);
    expect(points(apollon)).toBe(75);
    apollon.lvl = 3;
    expect(w.manaOf(apollon)![0]).toBe(200);
    apollon.lvl = 1;
    // Pluie de feu: 125 at level 1, more than it holds at its summoning.
    expect(w.ready(apollon, 'pluiedefeu')).toBe(false);
    run(w, 32);
    expect(w.ready(apollon, 'pluiedefeu')).toBe(false);
    run(w, 2); // 75 + 34 × 1.5
    expect(w.ready(apollon, 'pluiedefeu')).toBe(true);
    const foe = w.spawn('serf', 1, ...at(44, 60));
    w.step([{ player: 0, kind: 'ability', ids: [apollon.id], name: 'pluiedefeu', x: foe.x, y: foe.y }]);
    run(w, 3);
    expect(points(apollon)).toBeLessThan(20);
    // Its own cooldown (20 s) on top.
    expect(apollon.spellCd.pluiedefeu).toBeGreaterThan(w.tick);
    expect(ABILITIES.tempetezeus.mana).toBeUndefined();
  });
});

describe('Sphère de renvoi against a shooter in a Fortin', () => {
  it('sends its half back to the real passenger', () => {
    const w = new World(createMap());
    const fort = w.spawn('fortin', 1, 40 * FP, 60 * FP);
    const shooter = w.spawn('auxiliaire', 1, ...at(40, 60));
    shooter.inside = fort.id;
    const ally = w.spawn('legionnaire', 0, ...at(44, 60));
    ally.reflect = ticks(40);
    ally.reflectLeft = 300;
    ally.hp = ally.maxHp = 5000;
    for (let i = 0; i < ticks(5) && shooter.hp === shooter.maxHp; i++) w.step([]);
    expect(shooter.hp).toBeLessThan(shooter.maxHp);
    expect(ally.reflectLeft).toBeLessThan(300);
  });
});
