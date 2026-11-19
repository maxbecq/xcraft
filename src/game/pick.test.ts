import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/world';
import { type Catch, nearestCatch } from './pick';

const thing = (id: number, kind: 'unit' | 'resource') => ({ id, def: { kind } }) as unknown as Entity;
const unit = (e: Entity, x0: number, y0: number, x1: number, y1: number): Catch => ({ e, r: { x0, y0, x1, y1 }, margin: 10, min: 34 });
const field = (e: Entity, x0: number, y0: number, x1: number, y1: number): Catch => ({ e, r: { x0, y0, x1, y1 }, margin: 18, min: 48 });

describe('what a click catches among units and resources', () => {
  const ore = thing(1, 'resource');
  const serf = thing(2, 'unit');
  // A field 60×30 px; a Serf standing just right of it, 20×40 px, its margin reaching over the field's right end.
  const catches = [field(ore, 100, 100, 160, 130), unit(serf, 165, 90, 185, 130)];

  it('a click on the field itself beats a worker that only reaches it by its margin', () => {
    expect(nearestCatch(158, 120, catches)).toBe(ore);
    expect(nearestCatch(130, 115, catches)).toBe(ore);
  });

  it('a click on the worker takes the worker', () => {
    expect(nearestCatch(175, 100, catches)).toBe(serf);
  });

  it('between them, the nearer outline wins', () => {
    expect(nearestCatch(163, 125, catches)).toBe(serf); // 2 px from the Serf, 3 from the field
    expect(nearestCatch(162, 125, catches)).toBe(ore); // 2 px from the field, 3 from the Serf
  });

  it('a field is caught well outside its outline, further than a unit is', () => {
    expect(nearestCatch(100, 145, catches)).toBe(ore); // 15 px below the field
    expect(nearestCatch(175, 145, [unit(serf, 165, 90, 185, 130)])).toBeUndefined(); // 15 px below the Serf
  });

  it('inside both outlines, the nearer middle', () => {
    const over = [field(ore, 100, 100, 160, 130), unit(serf, 140, 90, 160, 130)];
    expect(nearestCatch(152, 112, over)).toBe(serf);
    expect(nearestCatch(118, 112, over)).toBe(ore);
  });
});
