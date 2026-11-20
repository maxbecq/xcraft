import { describe, expect, it } from 'vitest';
import { fan } from './fan';

describe('marking menu fan', () => {
  it('puts every button above the finger, none overlapping', () => {
    for (const n of [1, 3, 5, 9, 13, 20]) {
      const { at } = fan(n, -Math.PI / 2, Math.PI);
      expect(at).toHaveLength(n);
      for (const [, dy] of at) expect(dy).toBeLessThanOrEqual(1e-9);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(Math.hypot(at[i][0] - at[j][0], at[i][1] - at[j][1])).toBeGreaterThanOrEqual(54);
    }
  });
  it('beside the finger: on that side only', () => {
    for (const [dx] of fan(8, 0, Math.PI).at) expect(dx).toBeGreaterThanOrEqual(-1e-9);
  });
});
