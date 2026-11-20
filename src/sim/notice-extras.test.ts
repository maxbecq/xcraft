import { describe, expect, it } from 'vitest';
import { FP, ticks, tileOf } from './fixed';
import { createMatch } from './setup';

describe('Caserne volante', () => {
  it('takes off as a flyer, frees its ground, and lands elsewhere as a building', () => {
    const w = createMatch(['humains', 'humains']);
    w.spawn('marche', 0, 40 * FP, 40 * FP);
    const c = w.spawn('caserne', 0, 30 * FP, 30 * FP);
    w.players[0].minerals = w.players[0].energy = 1000;
    w.step([{ player: 0, kind: 'train', ids: [c.id], type: 'casernevolante' }]);
    for (let i = 0; i < ticks(41); i++) w.step([]);
    expect(c.type).toBe('casernevolante');
    const tile = c.ty * w.grid.width + c.tx;
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'envol' }]);
    expect(c.type).toBe('casernevol');
    expect(w.grid.blocked[tile]).toBe(0);
    w.step([{ player: 0, kind: 'ability', ids: [c.id], name: 'atterrissage', x: 34 * FP + FP / 2, y: 20 * FP + FP / 2 }]);
    for (let i = 0; i < ticks(15) && c.type !== 'casernevolante'; i++) w.step([]);
    expect(c.type).toBe('casernevolante');
    expect([c.tx, c.ty]).toEqual([33, 19]);
    expect(w.grid.blocked[c.ty * w.grid.width + c.tx]).toBe(1);
  });
});

describe('Concentrateur énergétique', () => {
  it("raises a Mur d'énergie that blocks tiles and shots, then fades", () => {
    const w = createMatch(['isdaris', 'humains']);
    const trone = w.spawn('trone', 0, 20 * FP, 30 * FP);
    w.players[0].upgrades.concentrateur = 1;
    w.players[0].energy = 1000;
    const shooter = w.spawn('auxiliaire', 1, 31 * FP, 32 * FP);
    const target = w.spawn('archer', 0, 27 * FP, 32 * FP);
    // From the Trône towards x = 29: the wall runs north-south through x = 29.
    w.step([{ player: 0, kind: 'ability', ids: [trone.id], name: 'murenergie', x: 29 * FP + FP / 2, y: 32 * FP + FP / 2 }]);
    expect(w.walls).toHaveLength(1);
    expect(w.grid.open(29, 32)).toBe(false);
    let flares = 0;
    for (let i = 0; i < ticks(3); i++) {
      w.step([]);
      flares += w.shots.filter((s) => s.type === 'auxiliaire' && tileOf(s.x2) === 29).length;
    }
    expect(flares).toBeGreaterThan(0);
    expect(target.hp + target.shield).toBe(target.maxHp + target.maxShield);
    for (let i = 0; i < ticks(12); i++) w.step([]);
    expect(w.walls).toHaveLength(0);
    expect(w.grid.open(29, 32)).toBe(true);
    expect(tileOf(shooter.x)).toBeGreaterThan(29);
    // Wall gone: the same shots now land.
    for (let i = 0; i < ticks(3); i++) w.step([]);
    expect(target.hp + target.shield).toBeLessThan(target.maxHp + target.maxShield);
  });
});
