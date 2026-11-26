import { describe, expect, it } from 'vitest';
import BALANCE from '../balance.json';
import { FP, ticks } from './fixed';
import { createMatch } from './setup';

// Codex, 2026-11-26 (third final review): what a map forbids a player (MapFile.seats forbid) was still had through
// some spells: a Char Pégase's mine, a forbidden unit raised by Isis, and Jörmungand's call emptied the charge for nothing.
describe('spells and what a map forbids', () => {
  const of = (w: ReturnType<typeof createMatch>, type: string) => [...w.entities.values()].filter((e) => e.owner === 0 && e.type === type);

  it('a Char Pégase lays no chemical mine the map forbids, and keeps its stock', () => {
    const w = createMatch(['humains', 'dieux']);
    w.players[0].forbid = ['minechimique'];
    const p = Object.assign(w.spawn('pegase', 0, 40 * FP, 40 * FP), { charges: 3 });
    w.cast(p, 'posermine');
    expect(of(w, 'minechimique')).toHaveLength(0);
    expect(p.charges).toBe(3);
  });

  it('Isis raises no unit the map has forbidden since it fell', () => {
    const w = createMatch(['dieux', 'humains']);
    const isis = Object.assign(w.spawn('isis', 0, 70 * FP, 50 * FP), { mana: 1 << 30 });
    const nain = w.spawn('nain', 0, 71 * FP, 50 * FP);
    nain.hp = 0;
    w.step([]);
    w.players[0].forbid = ['nain'];
    w.step([{ player: 0, kind: 'ability', ids: [isis.id], name: 'resurrection' }]);
    expect(of(w, 'nain')).toHaveLength(0);
  });

  it('a Jörmungand the map forbids is not called, and the charge is kept', () => {
    const w = createMatch(['dieux', 'humains']);
    const full = ticks(BALANCE.units.primordial.charge);
    w.players[0].ultimates = { scandinave: full };
    w.players[0].forbid = ['jormungandr'];
    const thor = Object.assign(w.spawn('thor', 0, 30 * FP, 50 * FP), { mana: 1 << 30 });
    w.step([{ player: 0, kind: 'ability', ids: [thor.id], name: 'jormungand', x: 33 * FP, y: 50 * FP }]);
    expect(of(w, 'jormungandr')).toHaveLength(0);
    expect(w.players[0].ultimates!.scandinave).toBe(full);
  });
});
