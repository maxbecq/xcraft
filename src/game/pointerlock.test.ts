import { describe, expect, it } from 'vitest';
import { despike, MoveScale } from './pointerlock';

describe('held cursor', () => {
  it('learns how movement counts compare with the system cursor', () => {
    const s = new MoveScale();
    expect(s.value).toBe(1);
    for (let i = 0; i < 40; i++) s.add(10, 20); // device pixels on a 2× screen: half a pixel per count
    expect(s.value).toBeCloseTo(0.5, 5);
    s.add(500, 1); // a jump, ignored
    s.add(10, 0); // no movement given, ignored
    expect(s.value).toBeCloseTo(0.5, 5);
  });

  it('keeps steady moves whole and cuts a lone spike down', () => {
    const recent: number[] = [];
    for (const size of [3, 5, 8, 12, 20, 30]) expect(despike(size, recent)).toBe(1);
    expect(despike(80, recent)).toBe(1); // within four times the last moves: a real flick
    expect(despike(900, recent)).toBeCloseTo(320 / 900, 5); // a stray spike: down to 4 × the largest recent
  });

  it('lets a first move from rest through up to 60 px', () => {
    expect(despike(50, [])).toBe(1);
    expect(despike(120, [])).toBe(0.5);
  });
});
