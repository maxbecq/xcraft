import { describe, expect, it } from 'vitest';
import { FP } from '../sim/fixed';
import { createMatch } from '../sim/setup';

// hud-card.ts listens for keys as it loads: a bare window is enough without a page.
(globalThis as { window?: unknown }).window ??= { addEventListener() {} };
const { place } = await import('./hud-place');

describe('placing an extractor', () => {
  it('a Récepteur clicked on bare ground, far from any well: no order, and the player is told why', () => {
    const w = createMatch(['isdaris', 'z']);
    const robot = w.spawn('moissonneur', 0, 60 * FP, 60 * FP);
    const said: string[] = [];
    const issued: unknown[] = [];
    const hud = { world: w, player: 0, placing: 'recepteur', input: { selected: new Set() }, workers: () => [robot], issue: (c: unknown) => issued.push(c), notify: (e: { text: string }[]) => said.push(...e.map((x) => x.text)) };
    place(hud as never, { x: 60, y: 0, z: 60 } as never, false);
    expect(issued).toEqual([]);
    expect(said[0]).toContain('puits');
    // On a free well, the order goes.
    const well = [...w.entities.values()].find((e) => e.type === 'puits')!;
    place(hud as never, { x: well.x / FP, y: 0, z: well.y / FP } as never, false);
    expect(issued).toHaveLength(1);
  });
});

describe('free wells as the player knows them', () => {
  it('an enemy extractor under the fog does not take its well off the grid; once seen, it does, and stays so', async () => {
    const { takenAsSeen } = await import('./hud-place');
    const w = createMatch(['isdaris', 'z']);
    const hud = { world: w, player: 0, spectator: false };
    const look = () => { for (let i = 0; i < 4; i++) w.step([]); }; // vision: every 4 ticks
    look();
    const wells = [...w.entities.values()].filter((e) => e.type === 'puits');
    const far = wells.find((e) => !w.sees(0, e))!;
    const enemy = Object.assign(w.spawn('recepteur', 1, far.x, far.y), { tx: far.tx, ty: far.ty }); // right on the well
    look();
    expect(w.canPlace('recepteur', far.tx, far.ty, 0)).toBe(false); // the simulation knows
    expect(takenAsSeen(hud as never).get(far.id)).toBeFalsy(); // the player does not
    const scout = w.spawn('moissonneur', 0, far.x, far.y);
    look();
    expect(takenAsSeen(hud as never).get(far.id)).toBe(true);
    w.remove(scout);
    look();
    expect(w.sees(0, enemy)).toBe(false);
    expect(takenAsSeen(hud as never).get(far.id)).toBe(true); // as last seen
  });
});
