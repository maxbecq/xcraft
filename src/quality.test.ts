import { describe, expect, it } from 'vitest';
import { pickQuality, pixelRatioFor } from './quality';

describe('graphics quality', () => {
  it('takes the URL first, then the menu choice, then the detected level', () => {
    expect(pickQuality(new URLSearchParams('quality=moyenne'), 'haute', 'basse')).toBe('moyenne');
    expect(pickQuality(new URLSearchParams('lowfx'), 'haute', 'haute')).toBe('basse');
    expect(pickQuality(new URLSearchParams(''), 'haute', 'basse')).toBe('haute');
    expect(pickQuality(new URLSearchParams(''), null, 'basse')).toBe('basse');
    expect(pickQuality(new URLSearchParams('quality=ultra'), 'nimporte', 'moyenne')).toBe('moyenne');
  });

  it('caps the 3D picture of the basse level in a large window, and only there', () => {
    // 1920 x 1200 on an Intel HD: 2.3 million pixels brought down to 1.3.
    const r = pixelRatioFor('basse', 1920, 1200, 1);
    expect(r).toBeCloseTo(0.751, 2);
    expect(1920 * 1200 * r * r).toBeLessThanOrEqual(1_300_001);
    expect(pixelRatioFor('basse', 1366, 768, 1)).toBe(1); // a small laptop screen is left alone
    expect(pixelRatioFor('basse', 3840, 2160, 1)).toBe(0.6); // never under 0.6
    expect(pixelRatioFor('moyenne', 402, 812, 3)).toBe(1.25);
    expect(pixelRatioFor('haute', 1728, 1117, 2)).toBe(1.5);
    expect(pixelRatioFor('haute', 1920, 1080, 1)).toBe(1); // never over the screen's own
  });
});
