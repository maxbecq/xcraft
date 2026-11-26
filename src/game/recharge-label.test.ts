import { describe, expect, it } from 'vitest';
import { FP } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Entity, World } from '../sim/world';

// hud-card.ts listens for keys as it loads: a bare window is enough to read the cards without a page.
(globalThis as { window?: unknown }).window ??= { addEventListener() {} };
const { Hud } = await import('./hud');
const { buttonsFor } = await import('./hud-card');

const card = (w: World, selected: Entity[]) =>
  buttonsFor(Object.assign(Object.create(Hud.prototype), { world: w, player: 0, input: { own: () => selected }, activeType: null, buildMenu: false, placing: null, targeting: false, weaponMenu: null, issue: () => {} })) as { label: string; ability?: string }[];

describe('revue Codex du 26/11, 9', () => {
  it('a power short of energy says so, not « recharge 1 s »', () => {
    const w = createMatch(['isdaris', 'humains']);
    const d = Object.assign(w.spawn('druide', 0, 40 * FP, 40 * FP), { mana: 0 });
    const label = card(w, [d]).find((b) => b.ability === 'concentration')!.label;
    expect(label).toContain('énergie insuffisante');
    expect(label).not.toContain('recharge');
  });
});
