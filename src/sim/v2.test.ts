import { describe, expect, it } from 'vitest';
import { createMap } from '../map';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { World } from './world';

const at = (tx: number, ty: number) => [tx * FP + FP / 2, ty * FP + FP / 2] as const;
const run = (w: World, seconds: number) => {
  for (let i = 0; i < ticks(seconds); i++) w.step([]);
};

describe('Forge upgrades', () => {
  it('researches the three levels in order through the queue, paying each', () => {
    const w = new World(createMap());
    const forge = w.spawn('forge', 0, 40 * FP, 60 * FP);
    w.spawn('caserne', 0, 30 * FP, 60 * FP);
    w.spawn('caserne', 0, 30 * FP, 64 * FP);
    const p = w.players[0];
    p.minerals = p.energy = 2000;
    // Level 2 cannot be skipped to.
    w.step([{ player: 0, kind: 'train', ids: [forge.id], type: 'ranged2' }]);
    expect(forge.queue).toHaveLength(0);
    w.step([{ player: 0, kind: 'train', ids: [forge.id], type: 'ranged1' }]);
    w.step([{ player: 0, kind: 'train', ids: [forge.id], type: 'ranged2' }]);
    w.step([{ player: 0, kind: 'train', ids: [forge.id], type: 'ranged2' }]); // already queued
    expect(forge.queue).toEqual(['ranged1', 'ranged2']);
    expect(p.minerals).toBe(2000 - 250 - 350);
    expect(p.energy).toBe(2000 - 250 - 350);
    expect(w.supply(0).used).toBe(0);
    run(w, 81);
    expect(p.upgrades.ranged).toBe(1);
    w.step([{ player: 0, kind: 'cancel', ids: [forge.id] }]);
    expect(p.minerals).toBe(2000 - 250);
    expect(w.researchable(0, 'ranged2')).toBe(true);
  });

  it('level 2 needs nothing more (the balancer, 2026-11-22: no second Caserne), level 3 a Tour alchimistique', () => {
    const w = new World(createMap());
    const forge = w.spawn('forge', 0, 40 * FP, 60 * FP);
    w.spawn('caserne', 0, 30 * FP, 60 * FP);
    const p = w.players[0];
    p.minerals = p.energy = 5000;
    p.upgrades.armor = 1;
    expect(w.lacks(0, 'armor2')).toBe('');
    w.step([{ player: 0, kind: 'train', ids: [forge.id], type: 'armor2' }]);
    expect(forge.queue).toEqual(['armor2']);
    p.upgrades.armor = 2;
    forge.queue = [];
    expect(w.lacks(0, 'armor3')).toBe('Requiert : Tour alchimistique');
    w.spawn('tour', 0, 36 * FP, 66 * FP);
    expect(w.lacks(0, 'armor3')).toBe('');
  });

  it('adds damage per level to the right weapons, and armour to soldiers', () => {
    const hit = (attacker: string, target: string, setup: (w: World) => void) => {
      const w = new World(createMap());
      setup(w);
      w.spawn(attacker, 0, ...at(40, 60));
      const t = w.spawn(target, 1, ...at(41, 60));
      const hp = t.hp;
      while (t.hp === hp) w.step([]);
      return hp - t.hp;
    };
    expect(hit('legionnaire', 'serf', () => {})).toBe(20);
    expect(hit('legionnaire', 'serf', (w) => (w.players[0].upgrades.melee = 2))).toBe(24); // +10 % per level
    expect(hit('legionnaire', 'serf', (w) => (w.players[0].upgrades.ranged = 3))).toBe(20); // wrong line
    expect(hit('auxiliaire', 'serf', (w) => (w.players[0].upgrades.ranged = 1))).toBe(17); // fiche 2010: 15 against BL, +10 % per level
    expect(hit('legionnaire', 'serf', (w) => (w.players[1].upgrades.armor = 3))).toBe(17);
  });
});

describe('abilities', () => {
  it('stimulant costs 10 hp, makes the auxiliaire faster, then wears off and recharges', () => {
    const w = new World(createMap());
    const a = w.spawn('auxiliaire', 0, ...at(40, 60));
    const speed = a.speed;
    w.step([{ player: 0, kind: 'ability', ids: [a.id] }]);
    expect(a.hp).toBe(70);
    expect(a.speed).toBeGreaterThan(speed);
    w.step([{ player: 0, kind: 'ability', ids: [a.id] }]); // on cooldown
    expect(a.hp).toBe(70);
    run(w, 9);
    expect(a.speed).toBe(speed);
    run(w, 7);
    w.step([{ player: 0, kind: 'ability', ids: [a.id] }]);
    expect(a.hp).toBe(60);
  });

  it('stimulated auxiliaires attack faster', () => {
    const shots = (stim: boolean) => {
      const w = new World(createMap());
      const a = w.spawn('auxiliaire', 0, ...at(40, 60));
      const t = w.spawn('conseil', 1, 43 * FP, 58 * FP);
      if (stim) w.step([{ player: 0, kind: 'ability', ids: [a.id] }]);
      w.step([{ player: 0, kind: 'attack', ids: [a.id], x: t.x, y: t.y, target: t.id }]);
      const hp = t.hp;
      run(w, 5);
      return hp - t.hp;
    };
    expect(shots(true)).toBeGreaterThan(shots(false) * 1.3);
  });

  it('charge doubles the légionnaire’s speed for a moment', () => {
    const w = new World(createMap());
    const l = w.spawn('legionnaire', 0, ...at(40, 60));
    const speed = l.speed;
    w.step([{ player: 0, kind: 'ability', ids: [l.id] }]);
    expect(l.speed).toBeGreaterThanOrEqual(2 * speed - 1);
    run(w, 4);
    expect(l.speed).toBe(speed);
  });

  it('peau de roc protects the most wounded ally in range', () => {
    const w = new World(createMap());
    const medic = w.spawn('soigneur', 0, ...at(40, 60));
    const fine = w.spawn('auxiliaire', 0, ...at(41, 60));
    const hurt = w.spawn('auxiliaire', 0, ...at(40, 61));
    hurt.hp = 30;
    w.spawn('auxiliaire', 0, ...at(50, 60)).hp = 10; // out of range
    w.step([{ player: 0, kind: 'ability', ids: [medic.id] }]);
    expect(hurt.skin).toBeGreaterThan(0);
    expect(fine.skin).toBe(0);
    // A légionnaire's 20 damage drops to 15.
    w.remove(medic); // no healing during the measure
    const foe = w.spawn('legionnaire', 1, ...at(39, 61));
    w.step([{ player: 1, kind: 'attack', ids: [foe.id], x: hurt.x, y: hurt.y, target: hurt.id }]);
    const hp = hurt.hp;
    while (hurt.hp >= hp) w.step([]);
    expect(hp - hurt.hp).toBe(15);
  });
});

describe('invisibility and detection', () => {
  it('assassins cannot be seen nor targeted without a detector', () => {
    const w = new World(createMap());
    w.players[1].faction = 'isdaris';
    const aux = w.spawn('auxiliaire', 0, ...at(40, 60));
    const sin = w.spawn('assassin', 1, ...at(43, 60));
    run(w, 1);
    expect(w.sees(0, sin)).toBe(false);
    expect(w.sees(1, sin)).toBe(true);
    w.step([{ player: 0, kind: 'attack', ids: [aux.id], x: sin.x, y: sin.y, target: sin.id }]);
    expect(aux.order?.kind).toBe('attackMove'); // the click found nothing
    run(w, 6);
    expect(w.entities.has(aux.id)).toBe(false); // killed without fighting back
    expect(sin.hp).toBe(sin.maxHp);
    expect(sin.shield).toBe(sin.maxShield);
  });

  it('a detector tower reveals them, and soldiers fight back', () => {
    const w = new World(createMap());
    const aux = Array.from({ length: 8 }, (_, i) => w.spawn('auxiliaire', 0, ...at(40 + (i % 2), 58 + (i >> 1))));
    w.spawn('tour', 0, 36 * FP, 60 * FP);
    const sin = w.spawn('assassin', 1, ...at(44, 60));
    run(w, 1);
    expect(w.sees(0, sin)).toBe(true);
    run(w, 20);
    expect(w.entities.has(sin.id)).toBe(false);
    expect(aux.some((a) => w.entities.has(a.id))).toBe(true);
  });

  // Danse du soldat (20 Nov 2026): the auxiliaires' shots deal two thirds; it took 5 of them before.
  it('a detected assassin loses to 6 auxiliaires but beats 5', () => {
    const fight = (n: number) => {
      const w = new World(createMap());
      w.players[1].faction = 'isdaris';
      const aux = Array.from({ length: n }, (_, i) => w.spawn('auxiliaire', 0, ...at(40 + (i % 2), 59 + (i >> 1))));
      w.spawn('tour', 0, 36 * FP, 60 * FP);
      const sin = w.spawn('assassin', 1, ...at(42, 60)); // already in contact
      w.step([{ player: 1, kind: 'attack', ids: [sin.id], x: aux[0].x, y: aux[0].y, target: aux[0].id }]);
      for (let i = 0; i < ticks(40) && w.entities.has(sin.id) && aux.some((a) => w.entities.has(a.id)); i++) w.step([]);
      return w.entities.has(sin.id);
    };
    expect(fight(6)).toBe(false);
    expect(fight(5)).toBe(true);
  });

  it('a tower under construction does not detect', () => {
    const w = new World(createMap());
    w.spawn('auxiliaire', 0, ...at(40, 60));
    w.spawn('tour', 0, 36 * FP, 60 * FP).buildLeft = 10;
    const sin = w.spawn('assassin', 1, ...at(44, 60));
    run(w, 0.5);
    expect(w.sees(0, sin)).toBe(false);
  });

  it('the Forge’s Observation céleste detects a zone for a while, for 50 energy', () => {
    const w = new World(createMap());
    const forge = w.spawn('forge', 0, 20 * FP, 60 * FP);
    w.spawn('auxiliaire', 0, ...at(40, 60));
    const sin = w.spawn('assassin', 1, ...at(44, 60));
    w.players[0].energy = 60;
    w.step([{ player: 0, kind: 'ability', ids: [forge.id], x: sin.x, y: sin.y }]);
    expect(w.scans).toHaveLength(0); // not researched yet
    w.players[0].upgrades.observation = 1;
    w.step([{ player: 0, kind: 'ability', ids: [forge.id], x: sin.x, y: sin.y }]);
    run(w, 0.5);
    expect(w.sees(0, sin)).toBe(true);
    expect(w.players[0].energy).toBe(10);
    w.step([{ player: 0, kind: 'ability', ids: [forge.id], x: sin.x, y: sin.y }]); // recharging
    expect(w.scans).toHaveLength(1);
    run(w, 11);
    expect(w.sees(0, sin)).toBe(false);
  });
});

describe('Orbe plasma', () => {
  it('shoots enemy units in range, not buildings, and detects assassins', () => {
    const w = new World(createMap());
    w.players[0].faction = 'isdaris';
    const orbe = w.spawn('orbe', 0, 40 * FP, 60 * FP);
    const far = w.spawn('auxiliaire', 1, ...at(52, 60));
    const near = w.spawn('auxiliaire', 1, ...at(46, 61));
    const house = w.spawn('grenier', 1, 44 * FP, 58 * FP);
    const sin = w.spawn('assassin', 1, ...at(30, 63));
    run(w, 0.3);
    expect(w.sees(0, sin)).toBe(false);
    sin.x = 41 * FP; // walks within detection range
    run(w, 0.3);
    expect(w.sees(0, sin)).toBe(true);
    w.remove(sin);
    run(w, 30);
    expect(w.entities.has(near.id)).toBe(false);
    expect(far.hp).toBe(far.maxHp);
    expect(house.hp).toBe(house.maxHp);
    expect(orbe.hp).toBeGreaterThan(0);
  });

  // Before the Danse du soldat (20 Nov 2026) the Orbe won; with it, the Assassin did. With the fiches' classes (21 Nov),
  // the Orbe hits the Assassin (BA) for 29 instead of 21 and wins again. For the balance owner.
  it('holds against a lone assassin that attacks it, even dodging two shots in three', () => {
    const w = new World(createMap());
    w.players[0].faction = w.players[1].faction = 'isdaris';
    const orbe = w.spawn('orbe', 0, 40 * FP, 60 * FP);
    const sin = w.spawn('assassin', 1, ...at(52, 61));
    w.step([{ player: 1, kind: 'attack', ids: [sin.id], x: orbe.x, y: orbe.y, target: orbe.id }]);
    run(w, 40);
    expect(w.entities.has(orbe.id)).toBe(true);
    expect(w.entities.has(sin.id)).toBe(false);
  });

  it('must be beamed down inside a power field', () => {
    const w = createMatch(['isdaris', 'humains']);
    expect(w.canPlace('orbe', 30, 30, 0)).toBe(false);
    expect(w.canPlace('orbe', 18, 18, 0)).toBe(true);
  });
});
