import { describe, expect, it } from 'vitest';
import { FP } from './fixed';
import { createMatch } from './setup';
import { fingerprint } from './fingerprint';
import { commandOk } from './validate';
import type { Faction } from '../data';

// Quality control, lot A: simulation faults found by the probes (each one reproduced here first).
describe('quality control, lot A', () => {
  it('a building power with no energy cost, sent without its name, leaves the energy as it was (never NaN)', () => {
    for (const [f, type] of [['humains', 'casernevolante'], ['isdaris', 'orbe'], ['z', 'intelligence'], ['dieux', 'branche']] as [Faction, string][]) {
      const w = createMatch([f, 'humains']);
      const b = w.spawn(type, 0, 40 * FP, 40 * FP);
      const before = w.players[0].energy;
      w.step([{ player: 0, kind: 'ability', ids: [b.id], x: 0, y: 0 }]);
      expect(w.players[0].energy, type).toBe(before);
    }
  });

  it('Fusion of N Élémentaires: N/2 Golems, two Élémentaires each (camp-dieux.md: « deux élémentaires fusionnent en Golem »)', () => {
    for (const n of [2, 3, 4, 5]) {
      const w = createMatch(['dieux', 'humains']);
      const ids = Array.from({ length: n }, (_, i) => w.spawn('elembase', 0, (40 + (i % 2) * 0.5) * FP, (40 + Math.floor(i / 2) * 0.5) * FP).id);
      w.step([{ player: 0, kind: 'ability', ids, name: 'fusion' }]);
      const of = (t: string) => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === t).length;
      expect([of('golem'), of('elembase')], `${n}`).toEqual([Math.floor(n / 2), n % 2]);
    }
  });

  it('a unit charmed then boarded onto a Drake gets out when the charm ends, back to its player', () => {
    const w = createMatch(['dieux', 'humains']);
    w.players[0].upgrades.drakegeant = 1;
    const drake = w.spawn('drake', 0, 40 * FP, 40 * FP);
    const frigg = w.spawn('frigg', 0, 40 * FP, 41 * FP);
    const foe = w.spawn('legionnaire', 1, 41 * FP, 41 * FP);
    frigg.mana = 999 * FP;
    w.players[0].energy = 9999;
    w.step([{ player: 0, kind: 'ability', ids: [frigg.id], name: 'soumission', x: foe.x, y: foe.y }]);
    for (let i = 0; i < 40 && foe.owner !== 0; i++) w.step([]);
    expect(foe.owner).toBe(0);
    w.step([{ player: 0, kind: 'smart', ids: [foe.id], x: drake.x, y: drake.y, target: drake.id }]);
    for (let i = 0; i < 200 && !foe.inside; i++) w.step([]);
    expect(foe.inside).toBe(drake.id);
    for (let i = 0; i < 3000 && foe.owner !== 1; i++) w.step([]);
    expect(foe.owner).toBe(1);
    expect(foe.inside).toBe(0);
  });

  it('a spell aimed off the map lands on it: a teleported flyer stays on the map, a Vacarme beacon on a tile of its own row', () => {
    const w = createMatch(['dieux', 'z']);
    const W = w.grid.width;
    const dragon = w.spawn('chimere', 0, 3 * FP, 3 * FP);
    w.castAt(dragon, 'teleport', -2 * FP, 3 * FP);
    expect(dragon.x).toBeGreaterThanOrEqual(0);
    const spy = w.spawn('zespion', 1, 2 * FP, 5 * FP);
    w.castAt(spy, 'vacarme', -FP / 4, 6 * FP + FP / 2);
    const v = [...w.entities.values()].find((e) => e.type === 'vacarme')!;
    expect([v.tx, v.ty]).toEqual([0, 6]);
    expect(v.tx).toBeLessThan(W);
  });

  it('an order the network or a replay accepts is the one the simulation applies, and the other way round', () => {
    // Sent over the wire, an undefined field is gone: the same order with or without it, the same game.
    const play = (c: Record<string, unknown>) => {
      const w = createMatch(['z', 'humains']);
      const hq = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'intelligence')!;
      w.step([{ player: 0, ids: [hq.id], ...c } as never]);
      for (let i = 0; i < 40; i++) w.step([]);
      return fingerprint(w);
    };
    const refuge = { kind: 'ability', name: 'refuge' };
    expect(play({ ...refuge, x: undefined, y: undefined })).toBe(play(refuge));
    expect(play(refuge)).not.toBe(play({ kind: 'stop' }));
    // A fractional position: refused by both, never half-applied.
    expect(commandOk({ kind: 'move', ids: [1], x: 1.5, y: 2 })).toBe(false);
    const w = createMatch(['humains', 'z']);
    const serf = [...w.entities.values()].find((e) => e.owner === 0 && e.type === 'serf')!;
    w.step([{ player: 0, kind: 'move', ids: [serf.id], x: 1.5, y: 2 } as never]);
    expect(serf.order).toBeNull();
  });
});
