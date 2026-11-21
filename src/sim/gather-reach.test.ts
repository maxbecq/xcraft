import { describe, expect, it } from 'vitest';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

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
