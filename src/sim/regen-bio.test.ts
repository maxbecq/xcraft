import { describe, expect, it } from 'vitest';
import { DEFS, type UnitDef } from '../data';

describe('équilibreur 23-24/11: living units heal by themselves', () => {
  it('Dieux and Humains living units 0.5 hp/s, the Golem and machines none, the Isdaris 1 every 8 s', () => {
    const regen = (t: string) => (DEFS[t] as UnitDef).regen;
    expect(regen('nain')).toBe(0.5);
    expect(regen('thor')).toBe(0.5);
    expect(regen('legionnaire')).toBe(0.5);
    expect(regen('allosaure')).toBe(0.5);
    expect(regen('golem')).toBeUndefined();
    expect(regen('pegase')).toBeUndefined();
    expect(regen('archer')).toBe(0.125);
    expect(regen('moissonneur')).toBeUndefined();
  });
});
