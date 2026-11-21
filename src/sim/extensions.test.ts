import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { DEFS, type UnitDef, type UpgradeDef } from '../data';
import { FP } from './fixed';
import { createMatch } from './setup';
import type { World } from './world';

// Isdaris extensions (notice): built onto one major building, that building's own.
const of = (w: World, type: string) => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === type);
const setup = () => {
  const w = createMatch(['isdaris', 'humains']);
  const p = w.players[0];
  p.minerals = p.energy = 99999;
  const a = w.spawn('portail', 0, 14 * FP, 24 * FP);
  const b = w.spawn('portail', 0, 22 * FP, 24 * FP);
  return { w, a, b };
};
const step = (w: World, n: number) => {
  for (let i = 0; i < n; i++) w.step([]);
};

describe('Isdaris extensions, one building each', () => {
  it('a Miniportail bought for Portail A goes onto A only: B still trains one unit at a time', () => {
    const { w, a, b } = setup();
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'miniportail' }]);
    step(w, w.trainTime(a, 'miniportail') + 1);
    expect(a.exts).toEqual(['miniportail']);
    expect(b.exts).toEqual([]);
    expect(w.players[0].upgrades.miniportail).toBeUndefined();
    const before = of(w, 'archer').length;
    w.step([{ player: 0, kind: 'train', ids: [b.id], type: 'archer' }, { player: 0, kind: 'train', ids: [b.id], type: 'archer' }]);
    step(w, w.trainTime(b, 'archer') + 1);
    expect(of(w, 'archer').length - before).toBe(1);
    expect(b.queue).toHaveLength(1);
  });

  it('the same extension twice on one building is refused; the second command takes the other building', () => {
    const { w, a, b } = setup();
    w.step([{ player: 0, kind: 'train', ids: [a.id, b.id], type: 'laboratoire' }]);
    w.step([{ player: 0, kind: 'train', ids: [a.id, b.id], type: 'laboratoire' }]);
    w.step([{ player: 0, kind: 'train', ids: [a.id, b.id], type: 'laboratoire' }]);
    expect([a.queue, b.queue].flat().filter((t) => t === 'laboratoire')).toHaveLength(2);
    expect(a.queue.filter((t) => t === 'laboratoire')).toHaveLength(1);
  });

  it('a Druide needs the Laboratoire on the Portail that trains it; the order goes to the one that has it', () => {
    const { w, a, b } = setup();
    b.exts.push('laboratoire');
    expect(w.lacks(0, 'druide', undefined, a)).toContain('Laboratoire');
    expect(w.lacks(0, 'druide', undefined, b)).toBe('');
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'druide' }]);
    expect(a.queue).toEqual([]);
    w.step([{ player: 0, kind: 'train', ids: [a.id, b.id], type: 'druide' }]);
    expect(b.queue).toEqual(['druide']);
    // The infantry research behind the Laboratoire: launched there only.
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'portailatk1' }]);
    expect(a.queue).toEqual([]);
  });

  it('an extension from another building unlocks where the notice says: the Autel lets every Portail train Assassins', () => {
    const { w, a } = setup();
    expect(w.lacks(0, 'assassin', undefined, a)).toContain('Autel');
    const orbe = w.spawn('orbecommandement', 0, 30 * FP, 24 * FP);
    orbe.exts.push('autel');
    expect(w.lacks(0, 'assassin', undefined, a)).toBe('');
  });

  it('the extension goes with its building', () => {
    const { w, a, b } = setup();
    b.exts.push('laboratoire');
    expect(w.hasExt(0, 'laboratoire')).toBe(true);
    w.remove(b);
    expect(w.hasExt(0, 'laboratoire')).toBe(false);
    expect(w.lacks(0, 'druide', undefined, a)).toContain('Laboratoire');
  });

  it('the Orbe\'s Observatoire is its own power', () => {
    const { w } = setup();
    const [o1, o2] = [w.spawn('orbecommandement', 0, 30 * FP, 24 * FP), w.spawn('orbecommandement', 0, 36 * FP, 24 * FP)];
    o2.exts.push('observatoire');
    expect(w.needs(0, 'observatoire', o1)).toContain('Observatoire');
    expect(w.needs(0, 'observatoire', o2)).toBeUndefined();
    w.step([{ player: 0, kind: 'ability', ids: [o1.id, o2.id], name: 'observatoire', x: 50 * FP, y: 50 * FP }]);
    expect(o2.abilityCd).toBeGreaterThan(0);
    expect(o1.abilityCd).toBe(0);
  });

  it('every extension names its host, one of the building types that lists it', () => {
    for (const [k, d] of Object.entries(DEFS)) {
      const host = (d as UpgradeDef).host;
      if (host) expect((DEFS[host] as { researches?: string[] }).researches).toContain(k);
    }
  });

  it("the AI picks a Portail's unit by that Portail's own extensions: no Druide where there is no Laboratoire", () => {
    const { w, a, b } = setup();
    b.exts.push('laboratoire');
    const ai = new AI(w, 0) as unknown as { trained: number; nextUnit(e: number, own: unknown[], m: number, at?: unknown): string };
    const at = (gate: typeof a) => Array.from({ length: 40 }, (_, i) => ((ai.trained = i), ai.nextUnit(500, [], 500, gate)));
    expect(at(a)).not.toContain('druide');
    expect(at(b)).toContain('druide');
  });

  it('a Cuve génétique gives the second Créature only if the supply has room for it', () => {
    const { w, a } = setup();
    a.exts.push('cuvegenetique');
    const s = w.supply(0);
    // Fill the supply but for one Créature.
    for (let i = 0; i < s.max - s.used - (DEFS.creature as UnitDef).supply; i++) w.spawn('creature', 0, 40 * FP, 40 * FP);
    const before = of(w, 'creature').length;
    w.step([{ player: 0, kind: 'train', ids: [a.id], type: 'creature' }]);
    step(w, w.trainTime(a, 'creature') + 1);
    expect(of(w, 'creature').length - before).toBe(1);
    expect(w.supply(0).used).toBeLessThanOrEqual(w.supply(0).max);
  });
});
