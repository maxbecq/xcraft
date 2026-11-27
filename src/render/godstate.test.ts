import { describe, expect, it } from 'vitest';
import { spell } from '../data';
import { FP, ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import { godState } from './godstate';

describe('the gods\' state icon (provisional)', () => {
  it('reads production, attack and a spell from the simulation, a spell first, then production, then attack', () => {
    const w = createMatch(['dieux', 'humains']);
    const thor = w.spawn('thor', 0, 30 * FP, 30 * FP);
    const nain = w.spawn('nain', 0, 40 * FP, 40 * FP);
    expect(godState(w, thor)).toBeNull();
    expect(godState(w, nain)).toBeNull();
    const foe = w.spawn('legionnaire', 1, 33 * FP, 30 * FP);
    w.setOrder(thor, { kind: 'attack', target: foe.id, auto: false, lx: thor.x, ly: thor.y });
    expect(godState(w, thor)).toBe('attaque');
    thor.queue.push('nain');
    expect(godState(w, thor)).toBe('production');
    // A spell just cast shows a while; one cast long ago does not.
    const cd = ticks(spell('foudre', thor.lvl).cooldown);
    thor.spellCd.foudre = w.tick + cd;
    expect(godState(w, thor)).toBe('sort');
    thor.spellCd.foudre = w.tick + cd - ticks(5);
    expect(godState(w, thor)).toBe('production');
    thor.spellCd = {};
    thor.queue = [];
    w.setOrder(thor, { kind: 'cast', ability: 'foudre', x: foe.x, y: foe.y });
    expect(godState(w, thor)).toBe('sort');
  });
});
