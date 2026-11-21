import { describe, expect, it } from 'vitest';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';
import type { Entity } from './world';

/**
 * On L'Anneau the AI's workers stood for good on a field's corner, out of its reach (twenty Dieux esprits from minute
 * 16, eleven Z drones from minute 18): below the cliff of the field's plateau, or on a tile whose diagonal step into
 * the field the terrain forbids. Each one, sent from where they stood, must start mining within a few seconds.
 */
describe('a worker sent to a field it cannot step into from where it stands', () => {
  // Worker tile, field tile, and the point where they were found standing (in tiles).
  const cases: [string, number, number, number, number][] = [
    ['below the cliff, at its corner', 26.999, 34.001, 27, 33],
    ['on the plateau, diagonal to it', 43.001, 16.001, 42, 15],
    ['below the cliff, under it', 52.999, 79.999, 53, 80],
    ['below the cliff, at its other corner', 69.001, 61.999, 68, 62],
  ];
  for (const [what, x, y, fx, fy] of cases) {
    it(`${what}: mines it, never standing still on its way`, () => {
      const w = createMatch(['dieux', 'z'], undefined, 'l-anneau');
      const field = [...w.entities.values()].find((e) => e.type === 'minerai' && e.tx === fx && e.ty === fy)!;
      const esprit = w.spawn('esprit', 0, Math.round(x * FP), Math.round(y * FP));
      w.step([{ player: 0, kind: 'smart', ids: [esprit.id], x: field.x, y: field.y, target: field.id }]);
      let still = 0;
      let longest = 0;
      let [px, py] = [esprit.x, esprit.y];
      while (w.tick < ticks(30) && !(esprit.order?.kind === 'gather' && esprit.order.phase !== 'go')) {
        w.step([]);
        still = esprit.x === px && esprit.y === py ? still + 1 : 0;
        longest = Math.max(longest, still);
        [px, py] = [esprit.x, esprit.y];
      }
      expect(esprit.order?.kind).toBe('gather');
      expect(esprit.order?.kind === 'gather' && esprit.order.phase).not.toBe('go');
      expect(longest).toBeLessThan(ticks(3));
    });
  }
});

describe('a worker sent to a field no path reaches', () => {
  it('goes to another field within a few seconds', () => {
    const w = createMatch();
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const fields = [...w.entities.values()].filter((e) => e.type === 'minerai');
    const field = fields.sort((a, b) => Math.hypot(a.x - serf.x, a.y - serf.y) - Math.hypot(b.x - serf.x, b.y - serf.y))[0];
    // A wall two tiles round the field: the tiles beside it stay open, but nothing gets to them.
    const g = w.grid as unknown as { blocked: Uint8Array; width: number };
    for (let y = field.ty - 2; y <= field.ty + 2; y++) for (let x = field.tx - 2; x <= field.tx + 2; x++) if (Math.max(Math.abs(x - field.tx), Math.abs(y - field.ty)) === 2) g.blocked[y * g.width + x] = 1;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: field.x, y: field.y, target: field.id }]);
    while (w.tick < ticks(8) && serf.order?.kind === 'gather' && serf.order.target === field.id) w.step([]);
    expect(serf.order?.kind).toBe('gather');
    expect(serf.order?.kind === 'gather' && serf.order.target).not.toBe(field.id);
    expect(w.tick).toBeLessThan(ticks(8));
  });
});

describe('a door on the far side', () => {
  it('a serf repairs a building whose near side is walled off, from its far side', () => {
    const w = createMatch();
    let site: [number, number] | undefined;
    for (let ty = 30; ty < 70 && !site; ty++) for (let tx = 30; tx < 70 && !site; tx++) if (w.canPlace('caserne', tx - 6, ty - 2, 0) && w.canPlace('caserne', tx, ty, 0)) site = [tx, ty];
    const b = w.spawn('caserne', 0, site![0] * FP + (3 * FP) / 2, site![1] * FP + (3 * FP) / 2);
    const [tx, ty] = [b.tx, b.ty];
    b.hp = b.maxHp >> 1;
    // The west side's tiles shut in: its three doors (the nearest to the serf) are out of reach.
    const g = w.grid as unknown as { blocked: Uint8Array; width: number };
    const wall = (x: number, y: number) => (g.blocked[y * g.width + x] = 1);
    wall(tx - 1, ty - 1);
    wall(tx - 1, ty + 3);
    for (let y = ty - 1; y <= ty + 3; y++) wall(tx - 2, y);
    const serf = w.spawn('serf', 0, (tx - 5) * FP + FP / 2, ty * FP + (3 * FP) / 2);
    w.players[0].minerals = 1000;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: b.x, y: b.y, target: b.id }]);
    const hp = b.hp;
    while (w.tick < ticks(20) && b.hp === hp) w.step([]);
    expect(b.hp).toBeGreaterThan(hp);
  });
});

describe('a field shut off, workers sent there together', () => {
  it('searches the way once, not once per worker', () => {
    const w = createMatch();
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const field = [...w.entities.values()].filter((e) => e.type === 'minerai').sort((a, b) => Math.hypot(a.x - serf.x, a.y - serf.y) - Math.hypot(b.x - serf.x, b.y - serf.y))[0];
    const g = w.grid as unknown as { blocked: Uint8Array; width: number };
    for (let y = field.ty - 2; y <= field.ty + 2; y++) for (let x = field.tx - 2; x <= field.tx + 2; x++) if (Math.max(Math.abs(x - field.tx), Math.abs(y - field.ty)) === 2) g.blocked[y * g.width + x] = 1;
    const crowd = Array.from({ length: 20 }, () => w.spawn('serf', 0, serf.x, serf.y));
    let searches = 0;
    const [findPath, nearestDoors] = [w.grid.findPath, w.grid.nearestDoors];
    w.grid.findPath = (...a) => (searches++, findPath.apply(w.grid, a));
    w.grid.nearestDoors = (...a) => (searches++, nearestDoors.apply(w.grid, a));
    w.step([{ player: 0, kind: 'smart', ids: crowd.map((s) => s.id), x: field.x, y: field.y, target: field.id }]);
    expect(crowd.every((s) => s.order?.kind === 'gather' && s.order.target === field.id)).toBe(true);
    expect(searches).toBeLessThanOrEqual(2);
  });
});

describe('fields given up on', () => {
  /** A serf whose way to every field but `open` gets nowhere: goNear counts it stuck each tick. */
  function stage(open: (fields: Entity[]) => Entity | undefined) {
    const w = createMatch();
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const fields = [...w.entities.values()].filter((e) => e.type === 'minerai').sort((a, b) => Math.hypot(a.x - serf.x, a.y - serf.y) - Math.hypot(b.x - serf.x, b.y - serf.y)).slice(0, 3);
    const reach = open(fields);
    w.reachRect = (_e, tx, ty, size) => size === 1 && !!reach && tx === reach.tx && ty === reach.ty;
    w.goNear = (e) => void e.stuck++;
    return { w, serf, fields };
  }

  it('tries a third field when two are out of reach, never going back and forth between them', () => {
    const { w, serf, fields } = stage((f) => f[2]);
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: fields[0].x, y: fields[0].y, target: fields[0].id }]);
    while (w.tick < ticks(5) && !(serf.order?.kind === 'gather' && serf.order.phase !== 'go')) w.step([]);
    expect(serf.order?.kind === 'gather' && serf.order.target).toBe(fields[2].id);
    expect(serf.order?.kind === 'gather' && serf.order.phase).not.toBe('go');
  });

  it('with no field left to try, looks again only now and then', () => {
    const { w, serf, fields } = stage(() => undefined);
    for (const f of [...w.entities.values()]) if (f.type === 'minerai' && f !== fields[0]) w.remove(f);
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: fields[0].x, y: fields[0].y, target: fields[0].id }]);
    let looks = 0;
    const nearestField = w.nearestField;
    w.nearestField = (...a) => (looks++, nearestField.apply(w, a));
    for (let i = 0; i < 60; i++) w.step([]);
    expect(serf.order?.kind).toBe('gather');
    expect(looks).toBeLessThanOrEqual(60 / 3 + 1);
  });
});

describe('fields given up on, later', () => {
  it('come back into the choice after a while: the way may have opened', () => {
    const w = createMatch();
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const fields = [...w.entities.values()].filter((e) => e.type === 'minerai').sort((a, b) => Math.hypot(a.x - serf.x, a.y - serf.y) - Math.hypot(b.x - serf.x, b.y - serf.y)).slice(0, 2);
    for (const f of [...w.entities.values()]) if (f.type === 'minerai' && !fields.includes(f)) w.remove(f);
    let open: Entity | undefined;
    w.reachRect = (_e, tx, ty, size) => size === 1 && !!open && tx === open.tx && ty === open.ty;
    w.goNear = (e) => void e.stuck++;
    w.step([{ player: 0, kind: 'smart', ids: [serf.id], x: fields[0].x, y: fields[0].y, target: fields[0].id }]);
    for (let i = 0; i < 30; i++) w.step([]);
    // Both given up on; then the first one's way opens (a building in it destroyed).
    expect(serf.order?.kind === 'gather' && serf.order.skip?.length).toBe(2);
    open = fields[0];
    while (w.tick < ticks(40) && !(serf.order?.kind === 'gather' && serf.order.phase !== 'go')) w.step([]);
    expect(serf.order?.kind === 'gather' && serf.order.target).toBe(fields[0].id);
    expect(serf.order?.kind === 'gather' && serf.order.phase).not.toBe('go');
  });
});

describe('World.hash and the fields given up on', () => {
  it('sees them', () => {
    const base = createMatch();
    const serf = (w: ReturnType<typeof createMatch>) => [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    const a = createMatch();
    const b = createMatch();
    for (const w of [base, a, b]) serf(w).order = { kind: 'gather', target: 1, phase: 'go', timer: 0 };
    Object.assign(serf(a).order!, { skip: [5], skipped: 0 });
    Object.assign(serf(b).order!, { skip: [6], skipped: 0 });
    expect(new Set([base.hash(), a.hash(), b.hash()]).size).toBe(3);
  });
});
