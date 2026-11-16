import { expect, it } from 'vitest';
import BALANCE from './balance.json';
import { DEFS } from './data';

// Catches a typo or a missing number in balance.json before it reaches a game.
it('balance.json gives every thing its numbers, and names only things that exist', () => {
  for (const type of Object.keys(BALANCE.units)) expect(DEFS, `balance.json: unknown "${type}"`).toHaveProperty(type);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  for (const [type, d] of Object.entries(DEFS)) {
    const need = d.kind === 'unit' ? ['hp', 'armor', 'speed', 'sight', 'supply', 'buildTime'] : d.kind === 'building' ? ['hp', 'armor', 'sight', 'supply', 'buildTime'] : d.kind === 'upgrade' ? ['buildTime'] : [];
    for (const k of need) expect(num((d as unknown as Record<string, unknown>)[k]), `${type}.${k}`).toBe(true);
    if ('cost' in d || d.kind !== 'resource') expect(num((d as { cost?: { minerals: unknown } }).cost?.minerals), `${type}.cost`).toBe(true);
    if ('attack' in d && d.attack) for (const k of ['damage', 'range', 'cooldown'] as const) expect(num(d.attack[k]), `${type}.attack.${k}`).toBe(true);
  }
});
