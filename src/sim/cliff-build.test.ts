import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS } from '../data';
import { FP, tileOf } from './fixed';
import { createMatch } from './setup';

describe('building from below a cliff', () => {
  it('a worker at the foot of a cliff walks up to the site on the plateau before raising it', () => {
    const w = createMatch(['humains', 'humains']);
    const size = (DEFS.grenier as BuildingDef).size;
    const g = w.grid;
    // A site on a plateau whose southern edge falls to an open tile below.
    let site: [number, number, number] | null = null;
    for (let ty = 2; ty < w.map.height - size - 2 && !site; ty++) {
      for (let tx = 2; tx < w.map.width - size - 2 && !site; tx++) {
        if (!w.canPlace('grenier', tx, ty, 0)) continue;
        const level = g.flatLevel(tx, ty);
        const [bx, by] = [tx + 1, ty + size];
        if (g.open(bx, by) && g.flatLevel(bx, by) >= 0 && g.flatLevel(bx, by) < level) site = [tx, ty, level];
      }
    }
    expect(site).not.toBeNull();
    const [tx, ty, level] = site!;
    const serf = w.spawn('serf', 0, (tx + 1) * FP + FP / 2, (ty + size) * FP + FP / 2);
    w.players[0].minerals = 1000;
    w.step([{ player: 0, kind: 'build', ids: [serf.id], type: 'grenier', tx, ty }]);
    const raised = () => [...w.entities.values()].find((e) => e.type === 'grenier' && e.tx === tx && e.ty === ty);
    for (let i = 0; i < 20 * 90 && !raised() && serf.order; i++) w.step([]);
    expect(raised()).toBeDefined();
    // Raised from the plateau, not across the cliff.
    expect(g.level(tileOf(serf.x), tileOf(serf.y))).toBe(level);
  });
});
