import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';
import { FP } from './fixed';
import { createMatch } from './setup';
import type { World } from './world';

// The balancer's answer of 2026-11-22, section « 1. Humains »: followed to the letter.
const humans = () => {
  const w = createMatch(['humains', 'z']);
  w.players[0].minerals = w.players[0].energy = 99999;
  return w;
};
let at = 20;
const put = (w: World, type: string) => w.spawn(type, 0, (at += 6) * FP, 40 * FP);

describe('the balancer, Humains', () => {
  it('the tech tree', () => {
    const w = humans();
    const lacks = (t: string) => w.lacks(0, t);
    // Nothing but the Conseil: the Forge and the Alchimisterie wait for a Caserne; the Caserne volante needs nothing.
    expect(lacks('forge')).toContain('Caserne');
    expect(lacks('alchimisterie')).toContain('Caserne');
    expect(lacks('casernevolante')).toBe('');
    expect(lacks('tour')).not.toBe('');
    put(w, 'caserne');
    expect(lacks('forge')).toBe('');
    expect(lacks('alchimisterie')).toBe('');
    // Tour alchimistique, Grand Conseil: the Forge OR the Alchimisterie.
    expect(lacks('tour')).not.toBe('');
    expect(lacks('grandconseil')).not.toBe('');
    const alch = put(w, 'alchimisterie');
    expect(lacks('tour')).toBe('');
    expect(lacks('grandconseil')).toBe('');
    // Créaturium, Soigneur, Belluaire: the Alchimisterie.
    for (const t of ['creaturium', 'soigneur', 'belluaire']) expect(lacks(t), t).toBe('');
    // Marché, Grande Alchimisterie, Dressage d'Allosaurus, Décollage: the Grand Conseil.
    for (const t of ['marche', 'grandealchimisterie', 'dressageallosaures', 'decollage']) expect(lacks(t), t).toContain('Grand Conseil');
    put(w, 'grandconseil');
    for (const t of ['marche', 'grandealchimisterie', 'dressageallosaures', 'decollage']) expect(lacks(t), t).toBe('');
    // Grown into a Grande Alchimisterie, it still is the Alchimisterie the others need.
    w.remove(alch);
    put(w, 'grandealchimisterie');
    expect(lacks('creaturium')).toBe('');
    // Métallurgie: the Forge.
    expect(lacks('metallurgie')).toContain('Forge');
  });

  it('the Forge: levels 2 and 3 no longer need two Casernes (level 3 still the Tour)', () => {
    const w = humans();
    put(w, 'caserne');
    put(w, 'forge');
    w.players[0].upgrades.ranged = 1;
    expect(w.lacks(0, 'ranged2')).toBe('');
    w.players[0].upgrades.ranged = 2;
    expect(w.lacks(0, 'ranged3')).toContain('Tour');
  });

  it('numbers: supply 12 (Conseil, Grand Conseil), Grand Conseil armour 7, Légionnaire 22 s at 1.1, Soigneur 50 mana, Belluaire 2.9, Plésiosaure 2 / 3 / 2.5', () => {
    const d = (t: string) => DEFS[t] as UnitDef;
    expect([d('conseil').supply, d('grandconseil').supply, d('grandconseil').armor]).toEqual([12, 12, 7]);
    expect([d('legionnaire').buildTime, d('legionnaire').attack!.cooldown]).toEqual([22, 1.1]);
    expect(d('soigneur').mana![0]).toBe(50);
    expect(d('belluaire').speed).toBe(2.9);
    expect([d('plesiosaure').supply, d('plesiosaure').attack!.range, d('plesiosaure').attack!.cooldown]).toEqual([2, 3, 2.5]);
    expect([d('alchimisterie').cost.energy, d('grandealchimisterie').cost.energy]).toEqual([150, 500]);
    expect(d('scieassaut').cost).toEqual({ minerals: 200, energy: 200 });
  });

  it('Planification industrielle: a Grand Conseil makes every unit 10 % faster, but not the Serf', () => {
    const w = humans();
    const c = put(w, 'caserne');
    const conseil = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'conseil')!;
    const [aux, serf] = [w.trainTime(c, 'auxiliaire'), w.trainTime(conseil, 'serf')];
    put(w, 'grandconseil');
    expect(w.trainTime(c, 'auxiliaire')).toBe(Math.floor((aux * 100) / 110));
    expect(w.trainTime(conseil, 'serf')).toBe(serf);
  });

  it('Scie d\'assaut: +15 against buildings; the Auxiliaire gains +1 a level of ranged attack', () => {
    const w = humans();
    const leg = put(w, 'legionnaire');
    const store = w.spawn('grenier', 1, leg.x + FP, leg.y);
    const blow = () => w.blow(leg, store, w.weapon(leg)!);
    const before = blow();
    w.players[0].upgrades.scieassaut = 1;
    expect(blow() - before).toBe(15);
    const aux = put(w, 'auxiliaire');
    const foe = w.spawn('serf', 1, aux.x + 2 * FP, aux.y);
    const a = w.weapon(aux)!;
    const base = w.blow(aux, foe, a);
    w.players[0].upgrades.ranged = 2;
    expect(w.blow(aux, foe, a) - base).toBe(2);
  });

  it('Armes chimiques: the Tour alchimistique hits a zone of radius 1 round the flyer it shoots, allies too', () => {
    const w = humans();
    const tour = put(w, 'tour');
    const target = w.spawn('bourdon', 1, tour.x + 3 * FP, tour.y);
    const ally = w.spawn('bourdon', 0, tour.x + 3 * FP, tour.y + FP / 2);
    const far = w.spawn('bourdon', 1, tour.x + 3 * FP, tour.y + 2 * FP);
    w.hit(tour, target, w.weapon(tour)!);
    expect(ally.hp).toBe(ally.maxHp);
    w.players[0].upgrades.armeschimiques = 1;
    w.hit(tour, target, w.weapon(tour)!);
    expect(ally.hp).toBeLessThan(ally.maxHp);
    expect(far.hp).toBe(far.maxHp);
  });

  it('Scientisme: +25 mana for the Soigneur, +50 for the Alchimiste and the Réservoir', () => {
    const w = humans();
    const [s, a, c] = ['soigneur', 'alchimiste', 'cuve'].map((t) => put(w, t));
    const max = () => [s, a, c].map((e) => w.manaOf(e)![0]);
    expect(max()).toEqual([50, 200, 200]);
    w.players[0].upgrades.scientisme = 1;
    expect(max()).toEqual([75, 250, 250]);
    expect(w.lacks(0, 'scientisme')).toBe('');
    expect((DEFS.alchimisterie as { researches: string[] }).researches).toContain('scientisme');
  });
});
