import { describe, expect, it } from 'vitest';
import type { Entity } from '../sim/world';
import { type Catch, nearestCatch, pickAt } from './pick';

const thing = (id: number, kind: 'unit' | 'resource' | 'building') => ({ id, def: { kind } }) as unknown as Entity;
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

describe('what the ray under the cursor picks', () => {
  const centre = thing(10, 'building');
  const well = thing(11, 'resource');
  const deck = thing(12, 'building');
  const quadripode = thing(13, 'unit');
  const drone = thing(14, 'unit');
  const none = () => undefined;

  it('the front of a building standing before a well takes the building, whatever the wider zones say', () => {
    const hits = [{ e: centre, seen: true }, { e: well, seen: true }];
    expect(pickAt(hits, () => well, () => well)).toBe(centre);
  });

  it("a Plate-forme's deck over a Quadripode takes the Plate-forme", () => {
    expect(pickAt([{ e: deck, seen: true }, { e: quadripode, seen: true }], () => quadripode, none)).toBe(deck);
  });

  it('a unit standing in front of a building is still the one picked', () => {
    expect(pickAt([{ e: quadripode, seen: true }, { e: deck, seen: true }], none, none)).toBe(quadripode);
  });

  it('a lone small drone missed by the ray is still caught by its wider zone', () => {
    expect(pickAt([], () => drone, none)).toBe(drone);
  });

  it('a unit the fog hides is passed over for what lies behind it', () => {
    expect(pickAt([{ e: drone, seen: false }, { e: centre, seen: true }], none, none)).toBe(centre);
  });

  it('a unit behind a building, its model met by the ray and shown as a silhouette, is clicked through to', () => {
    expect(pickAt([{ e: centre, seen: true }, { e: drone, seen: true, xray: true }], none, none)).toBe(drone);
  });

  it('the same unit the fog hides (no silhouette) is not: the building', () => {
    expect(pickAt([{ e: centre, seen: true }, { e: drone, seen: false, xray: true }], none, none)).toBe(centre);
  });

  it("the Plate-forme's deck over a Quadripode whose model the ray does not meet stays the Plate-forme", () => {
    expect(pickAt([{ e: deck, seen: true }], () => quadripode, none)).toBe(deck);
  });

  it('a well behind a building has no silhouette: the building', () => {
    expect(pickAt([{ e: centre, seen: true }, { e: well, seen: true }], () => well, () => well)).toBe(centre);
  });

  it('a well an extractor stands on is that extractor, whichever the ray meets first', () => {
    const extractor = thing(15, 'building');
    const on = (e: Entity) => (e === well ? extractor : undefined);
    expect(pickAt([{ e: well, seen: true }, { e: extractor, seen: true }], none, none, on)).toBe(extractor);
    expect(pickAt([{ e: extractor, seen: true }, { e: well, seen: true }], none, none, on)).toBe(extractor);
  });

  it('a unit at the edge of a well, the ray meeting only the well, takes the unit by its own catch zone', () => {
    expect(pickAt([{ e: well, seen: true }], () => well, none, () => undefined, () => drone)).toBe(drone);
  });

  it('a harvest order (workers selected: no unit catch given) keeps the well the ray meets, not a worker beside it', () => {
    const worker = thing(16, 'unit');
    const harvest = () => undefined; // entityAt passes no unit catch when ours include workers
    expect(pickAt([{ e: well, seen: true }], () => worker, none, () => undefined, harvest)).toBe(well);
  });

  it('a harvest order keeps the resource the ray meets first, the worker behind it or not', () => {
    const worker = thing(17, 'unit');
    expect(pickAt([{ e: well, seen: true }, { e: worker, seen: true }], none, none, () => undefined, none, none)).toBe(well);
  });

  it('a harvest order through a gap between geodes takes the field whose zone holds it before a worker nearby', () => {
    const worker = thing(18, 'unit');
    expect(pickAt([], () => worker, none, () => undefined, none, () => well)).toBe(well);
    expect(pickAt([], () => worker, none, () => undefined, none, none)).toBe(worker); // out of every field's zone
  });

  it('a harvest order still takes a unit the ray meets first, and an extractor on its well', () => {
    const extractor = thing(19, 'building');
    expect(pickAt([{ e: drone, seen: true }, { e: well, seen: true }], none, none, () => undefined, none, () => well)).toBe(drone);
    expect(pickAt([{ e: well, seen: true }], none, none, (w) => (w === well ? extractor : undefined), none, () => well)).toBe(extractor);
  });

  it('a unit the ray meets behind a resource takes it over the resource', () => {
    expect(pickAt([{ e: well, seen: true }, { e: drone, seen: true }], none, none)).toBe(drone);
  });

  it('a unit the fog hides behind a resource does not', () => {
    expect(pickAt([{ e: well, seen: true }, { e: drone, seen: false }], none, none)).toBe(well);
  });

  it('a free well is still picked', () => {
    expect(pickAt([{ e: well, seen: true }], none, none, () => undefined)).toBe(well);
  });

  it('nothing on the ray nor in a zone: the nearest resource', () => {
    expect(pickAt([], none, () => well)).toBe(well);
  });
});
