import { describe, expect, it } from 'vitest';
import type { Intersection } from 'three';
import { cutHits } from './materialise';

const hit = (y: number) => ({ point: { y } }) as Intersection;

describe('a building materialising takes clicks only where it is built', () => {
  it('drops the hits above the marble front, keeps those under it, leaves earlier hits alone', () => {
    const hits = [hit(9), hit(0.5), hit(2.5), hit(1.2)];
    cutHits(hits, 1, 1.5, 0.3);
    expect(hits.map((h) => h.point.y)).toEqual([9, 0.5, 1.2]);
  });
  it('while only the skeleton stands, only the footing takes clicks', () => {
    const hits = [hit(0.2), hit(1.8)];
    cutHits(hits, 0, -1e3, 0.25);
    expect(hits.map((h) => h.point.y)).toEqual([0.2]);
  });
});
