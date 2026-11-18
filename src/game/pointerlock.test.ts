import { describe, expect, it } from 'vitest';
import { pointerGain } from './pointerlock';

describe('held cursor acceleration', () => {
  it('crawls at the set speed, grows with the move speed up to a ceiling', () => {
    expect(pointerGain(1, 16, 1, 1)).toBeCloseTo(1, 2); // slow: about one pixel per count
    const mid = pointerGain(24, 16, 1, 1); // 1.5 counts/ms
    expect(mid).toBeGreaterThan(1.5);
    expect(mid).toBeLessThan(4);
    expect(pointerGain(80, 16, 1, 1)).toBeCloseTo(4, 5); // fast flick: the ceiling, 1 + 3 × accel
    expect(pointerGain(200, 16, 1, 1)).toBeCloseTo(4, 5);
  });

  it('scales with the speed setting, and is flat without acceleration', () => {
    expect(pointerGain(80, 16, 2, 1)).toBeCloseTo(8, 5);
    expect(pointerGain(1, 16, 1.5, 0)).toBe(1.5);
    expect(pointerGain(80, 16, 1.5, 0)).toBe(1.5);
  });

  it('a move after a pause counts as one frame long', () => {
    expect(pointerGain(24, 5000, 1, 1)).toBe(pointerGain(24, 16, 1, 1));
  });
});
