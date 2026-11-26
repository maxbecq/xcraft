import { describe, expect, it } from 'vitest';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import { DEFS, type UnitDef } from '../data';

// Codex, 2026-11-26 (third final review): a map may place a neutral Gaïa (owner -1); killed, she was set to come back
// by players[-1]'s headquarters, and the step that looked for it threw.
describe('neutral units a map places', () => {
  it('a neutral god killed is gone for good, and the game goes on', () => {
    const w = createMatch(['humains', 'humains']);
    const gaia = w.spawn('gaia', -1, 40 * FP, 40 * FP);
    gaia.hp = 0;
    const respawn = (DEFS.gaia as UnitDef).respawn ?? 0;
    expect(() => {
      for (let i = 0; i < ticks(respawn) + 10; i++) w.step([]);
    }).not.toThrow();
    expect([...w.entities.values()].some((e) => e.type === 'gaia')).toBe(false);
  });
});
