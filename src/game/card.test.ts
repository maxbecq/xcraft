import { describe, expect, it } from 'vitest';
import { type BuildingDef, DEFS, FACTIONS, type Faction, type UnitDef } from '../data';
import { FP } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Entity, World } from '../sim/world';

// hud-card.ts listens for keys as it loads: a bare window is enough to read the cards without a page.
(globalThis as { window?: unknown }).window ??= { addEventListener() {} };
const { Hud } = await import('./hud');
const { buttonsFor } = await import('./hud-card');

type Card = { key: string; label: string }[];

/** The command card the HUD shows for this selection (its buttons as buttonsFor lists them), with these menus open. */
function card(w: World, selected: Entity[], menus: Record<string, unknown> = {}): Card {
  const hud = Object.assign(Object.create(Hud.prototype), {
    world: w, player: 0, input: { own: () => selected }, activeType: null, buildMenu: false, placing: null, targeting: false,
    weaponMenu: null, issue: () => {}, ...menus,
  });
  return buttonsFor(hud);
}

const twice = (c: Card) => {
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const b of c) {
    if (seen.has(b.key)) out.push(`${b.key}: ${seen.get(b.key)} / ${b.label}`);
    else seen.set(b.key, b.label);
  }
  return out;
};

describe('command cards', () => {
  it('no card shows two buttons on the same key, in any faction', () => {
    const clashes: string[] = [];
    for (const f of Object.keys(FACTIONS) as Faction[]) {
      const w = createMatch([f, f]);
      const at = (i: number) => [(20 + (i % 10) * 6) * FP, (20 + Math.floor(i / 10) * 6) * FP] as const;
      // An Artefacterie stands, so the gods' cards show its improvements.
      if (f === 'dieux') w.spawn('artefacterie', 0, ...at(99));
      const types = Object.keys(DEFS).filter((t) => (DEFS[t] as { faction?: string }).faction === f && (DEFS[t].kind === 'unit' || DEFS[t].kind === 'building'));
      types.forEach((t, i) => {
        const e = w.spawn(t, 0, ...at(i));
        const check = (what: string, c: Card) => twice(c).forEach((x) => clashes.push(`${f} ${t}${what} — ${x}`));
        check('', card(w, [e]));
        if ((e.def as UnitDef).worker || (e.def as UnitDef).builder) {
          check(' (Construire)', card(w, [e], { buildMenu: 'basic' }));
          check(' (Avancé)', card(w, [e], { buildMenu: 'advanced' }));
        }
        for (const u of (e.def as BuildingDef).trains ?? []) if ((DEFS[u] as UnitDef).weapons) check(` (armes : ${u})`, card(w, [e], { weaponMenu: u }));
      });
    }
    expect(clashes).toEqual([]);
  });
});
