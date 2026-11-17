import { describe, expect, it } from 'vitest';
import { pickQuality } from './quality';

describe('graphics quality', () => {
  it('takes the URL first, then the menu choice, then the detected level', () => {
    expect(pickQuality(new URLSearchParams('quality=moyenne'), 'haute', 'basse')).toBe('moyenne');
    expect(pickQuality(new URLSearchParams('lowfx'), 'haute', 'haute')).toBe('basse');
    expect(pickQuality(new URLSearchParams(''), 'haute', 'basse')).toBe('haute');
    expect(pickQuality(new URLSearchParams(''), null, 'basse')).toBe('basse');
    expect(pickQuality(new URLSearchParams('quality=ultra'), 'nimporte', 'moyenne')).toBe('moyenne');
  });
});
