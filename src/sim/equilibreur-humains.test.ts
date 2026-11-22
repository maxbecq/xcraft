import { describe, expect, it } from 'vitest';
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
});
