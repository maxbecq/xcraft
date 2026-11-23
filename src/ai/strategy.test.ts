import { describe, expect, it } from 'vitest';
import { DEFS, type Faction, FACTIONS, type UnitDef } from '../data';
import { TICK_RATE } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { AI, EXTENSIONS, RESEARCH } from './ai';
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

  it('ne visent que des unités dont tous les prérequis viendront, recherches comprises', () => {
    // The Z's late tech: an army unit behind it never came in the games of 23/11 (no Centre d'optimisation in 11 min).
    const late: Partial<Record<Faction, string[]>> = { z: ['supreme', 'optimisation', 'centrek'] };
    const chain = (t: string, seen = new Set<string>()): Set<string> => {
      const d = DEFS[t] as UnitDef;
      for (const r of [...Object.keys(d?.requires ?? {}), ...(d?.requiresAny?.of ?? [])]) if (!seen.has(r)) chain(r, seen.add(r));
      return seen;
    };
    for (const [f, list] of Object.entries(STRATEGIES) as [Faction, (typeof STRATEGIES)['dieux']][]) {
      for (const s of list) {
        const researched = new Set([...(s.research ?? []), ...(RESEARCH[f] ?? []), ...EXTENSIONS]);
        for (const [t, later] of [...Object.keys(s.army ?? {}).map((t) => [t, false] as const), ...Object.keys(s.later ?? {}).map((t) => [t, true] as const)]) {
          const needs = chain(t);
          for (const r of needs) if (DEFS[r]?.kind === 'upgrade') expect(researched.has(r), `${s.id} ${t}: ${r}`).toBe(true);
          if (!later) for (const r of late[f] ?? []) expect(needs.has(r), `${s.id} ${t} derrière ${r}: à mettre dans later`).toBe(false);
        }
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
      // Against the Z, whose early waves leave a game long enough to see the arsenal come.
      const w = createMatch(['dieux', 'z']);
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
