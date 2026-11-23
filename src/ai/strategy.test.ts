import { describe, expect, it } from 'vitest';
import { DEFS, type Faction, FACTIONS, type UnitDef } from '../data';
import { TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { AI } from './ai';
import { counter, LEGACY, pickStrategy, STRATEGIES, USUAL_GODS } from './strategy';

describe('stratégies', () => {
  it('se tirent de façon déterministe, toutes possibles', () => {
    for (const f of Object.keys(STRATEGIES) as Faction[]) {
      expect(pickStrategy(f, 42, 0).id).toBe(pickStrategy(f, 42, 0).id);
      const drawn = new Set(Array.from({ length: 200 }, (_, s) => pickStrategy(f, s, 0).id));
      expect(drawn.size).toBe(STRATEGIES[f].length);
    }
  });

  it('ne nomment que des unités, dieux et recherches du camp, dans un ordre possible', () => {
    for (const [f, list] of Object.entries(STRATEGIES) as [Faction, (typeof STRATEGIES)['dieux']][]) {
      for (const s of list) {
        for (const t of Object.keys(s.army ?? {})) expect((DEFS[t] as UnitDef).faction, `${s.id} ${t}`).toBe(f);
        for (const t of s.research ?? []) expect(DEFS[t]?.kind, `${s.id} ${t}`).toBe('upgrade');
        // Each god's prerequisites come before it in the order.
        const before = new Set<string>();
        for (const [g] of s.gods ?? []) {
          const r = (DEFS[g] as UnitDef).requiresAny;
          if (r) expect(r.of.filter((o) => before.has(o)).length, `${s.id} ${g}`).toBeGreaterThanOrEqual(r.count);
          before.add(g);
        }
        // Every unit of the army has a god in the order that summons it.
        for (const t of Object.keys(s.army ?? {})) if (f === 'dieux') expect((s.gods ?? USUAL_GODS).some(([g]) => (DEFS[g] as UnitDef).trains?.includes(t)), `${s.id} ${t}`).toBe(true);
      }
    }
  });

  it('contre les volants, poussent les unités qui les touchent', () => {
    const army: [string, number][] = [['nain', 4], ['drake', 1]];
    const bent = new Map(counter(army, new Map([['drake', 6]])));
    expect(bent.get('drake')! / bent.get('nain')!).toBeGreaterThan(1 / 4);
  });

  it('les Dieux font sortir les dieux et les unités de leur stratégie', () => {
    for (const s of STRATEGIES.dieux) {
      const w = createMatch(['dieux', 'humains']);
      const ai = new AI(w, 0, undefined, 'normal', { strategy: s.id });
      const foe = new AI(w, 1, undefined, 'normal', { legacy: true });
      expect(ai.strategy.id).toBe(s.id);
      const made = new Set<string>();
      while (w.tick < 14 * 60 * TICK_RATE && w.winner === null) {
        w.step([...ai.think(), ...foe.think()]);
        for (const e of w.entities.values()) if (e.owner === 0) made.add(e.type);
      }
      const gods = (s.gods ?? USUAL_GODS).filter(([, m]) => m <= 9).map(([g]) => g);
      expect(gods.filter((g) => made.has(g)).length, `${s.id}: ${[...made].join(' ')}`).toBeGreaterThanOrEqual(gods.length - 1);
      const units = Object.keys(s.army!).filter((t) => made.has(t) || (t === 'elembase' && FACTIONS.dieux.army.length && [...made].some((m) => m.startsWith('elem') || m === 'golem')));
      expect(units.length, `${s.id}: ${[...made].join(' ')}`).toBeGreaterThanOrEqual(2);
    }
  }, 240_000);

  it('l’IA « legacy » garde l’ancienne doctrine', () => {
    const w = createMatch(['dieux', 'z']);
    expect(new AI(w, 0, undefined, 'normal', { legacy: true }).doctrine).toBe(LEGACY);
  });
});
