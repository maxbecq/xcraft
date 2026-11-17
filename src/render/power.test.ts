import { describe, expect, it } from 'vitest';
import { offAxis } from './power';

describe('creep trace angles', () => {
  it('measures how far a texture direction runs from the screen axes', () => {
    expect(offAxis(Math.PI / 4)).toBeCloseTo(0); // canvas (1, 1): straight up the screen
    expect(offAxis(-Math.PI / 4)).toBeCloseTo(0); // canvas (1, -1): straight across
    expect(offAxis(0)).toBeCloseTo(29.9, 0); // the texture's own axes land on screen diagonals
    expect(offAxis(Math.PI / 2)).toBeCloseTo(29.9, 0);
  });
});
