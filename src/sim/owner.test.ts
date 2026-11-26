import { describe, expect, it } from 'vitest';
import { FP, ticks } from './fixed';
import { noRegen } from './noregen';
import { createMatch } from './setup';
import type { World } from './world';

const run = (w: World, s: number) => {
  for (let i = 0; i < ticks(s); i++) w.step([]);
};

/** Units changing side for a while (Dieux Soumission) always go back to their player. */
describe('owner changes', () => {
  it('a charmed transport lets its passengers out', () => {
    const w = createMatch(['humains', 'dieux']);
    const scar = w.spawn('scarabee', 0, 32 * FP, 30 * FP);
    const m = w.spawn('auxiliaire', 0, 32 * FP, 31 * FP);
    w.step([{ player: 0, kind: 'smart', ids: [m.id], target: scar.id, x: scar.x, y: scar.y }]);
    run(w, 2);
    expect(m.inside).toBe(scar.id);
    const frigg = w.spawn('frigg', 1, 28 * FP, 30 * FP);
    w.castAt(frigg, 'soumission', scar.x, scar.y);
    expect(scar.owner).toBe(1);
    expect(m.inside).toBe(0);
  });

  it('a charmed unit drops its queued orders, and its new friends stop attacking it', () => {
    noRegen(); // hit points count blows only
    const w = createMatch(['dieux', 'humains']);
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    foe.hp = foe.maxHp = 100000;
    foe.held = ticks(100);
    const nain = w.spawn('nain', 0, 33 * FP, 30 * FP);
    w.step([{ player: 0, kind: 'attack', ids: [nain.id], target: foe.id, x: foe.x, y: foe.y }]);
    run(w, 1);
    foe.next = [{ kind: 'attack', target: nain.id, auto: false, lx: 0, ly: 0 }];
    const frigg = w.spawn('frigg', 0, 30 * FP, 32 * FP);
    w.castAt(frigg, 'soumission', foe.x, foe.y);
    expect(foe.owner).toBe(0);
    expect(foe.order).toBeNull();
    expect(foe.next).toEqual([]);
    expect(nain.order).toBeNull();
    const [hp, hit] = [foe.hp, foe.lastHit];
    run(w, 3);
    expect(foe.hp).toBe(hp);
    expect(foe.lastHit).toBe(hit);
  });

  it('a charmed unit dies its own player’s', () => {
    const w = createMatch(['dieux', 'humains']);
    const foe = w.spawn('legionnaire', 1, 34 * FP, 30 * FP);
    const frigg = w.spawn('frigg', 0, 30 * FP, 32 * FP);
    w.castAt(frigg, 'soumission', foe.x, foe.y);
    foe.hp = 0;
    w.step([]);
    expect(w.corpses.at(-1)?.owner).toBe(1);
  });
});
