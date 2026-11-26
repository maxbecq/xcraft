import { onTestFinished } from 'vitest';
import { DEFS, type UnitDef } from '../data';

/** Tests only: no unit heals by itself until the current test ends (équilibreur 23-24/11 made living units heal), so a
 * test counting hit points sees only what it measures. */
export function noRegen(): void {
  const kept = Object.entries(DEFS).filter(([, d]) => (d as UnitDef).regen !== undefined).map(([t, d]) => [t, (d as UnitDef).regen] as const);
  for (const [t] of kept) delete (DEFS[t] as UnitDef).regen;
  onTestFinished(() => {
    for (const [t, r] of kept) (DEFS[t] as UnitDef).regen = r;
  });
}
