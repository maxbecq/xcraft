import { describe, expect, it } from 'vitest';
import { PITCH, isoOffset } from './camera';

describe('isoOffset', () => {
  it('keeps the requested distance', () => {
    expect(isoOffset(100).length()).toBeCloseTo(100);
  });

  it('looks down at the configured pitch', () => {
    const o = isoOffset(1);
    expect(Math.asin(o.y)).toBeCloseTo(PITCH);
  });

  it('sits on the 45° diagonal', () => {
    const o = isoOffset(1);
    expect(o.x).toBeCloseTo(o.z);
  });
});
