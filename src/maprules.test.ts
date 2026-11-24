import { describe, expect, it } from 'vitest';
import { AI } from './ai/ai';
import { START } from './data';
import { checkMap } from './mapcheck';
import { unplayable } from './mapplay';
import { MAPS, type MapFile } from './maps';
import { fingerprint } from './sim/fingerprint';
import { ticks } from './sim/fixed';
import { createMatch, seatFactions } from './sim/setup';
import type { Command, World } from './sim/world';

/** A small open map with the rules a scenario gives (MapFile.seats, MapFile.units). */
const raw = () => ({
  format: 1,
  id: 'regles',
  name: 'Règles',
  size: 64,
  players: [2],
  symmetry: 'rot180',
  biome: 'desert',
  terrain: [],
  bases: [
    { start: true, hq: [10, 10], minerals: [[6, 6], [7, 6], [8, 6]], wells: [[16, 6]] },
    { hq: [24, 24], minerals: [[22, 30], [23, 30]], wells: [] },
  ],
  seats: [
    { race: 'z', minerals: 1000, energy: 300, forbid: ['tourelle', 'centrek'] },
    { forbid: ['caserne'] },
  ],
  units: [
    { type: 'pod', owner: 0, at: [26, 12] },
    { type: 'tour', owner: -1, at: [32, 32] },
    { type: 'auxiliaire', owner: 1, at: [44, 50] },
    { type: 'legionnaire', owner: 3, at: [30, 50] },
  ],
});
const rules = (patch: Record<string, unknown> = {}): MapFile | string => checkMap({ ...raw(), ...patch });
const map = () => rules() as MapFile;
const of = (w: World, owner: number, type: string) => [...w.entities.values()].filter((e) => e.owner === owner && e.type === type);

describe('règles de carte : import (mapcheck)', () => {
  it('prend les réglages par joueur et les unités placées, tels quels', () => {
    const m = map();
    expect(typeof m).toBe('object');
    expect(m.seats).toEqual(raw().seats);
    expect(m.units).toEqual(raw().units);
  });

  it('refuse un réglage de joueur hors bornes ou inconnu', () => {
    const seat = (s: unknown) => rules({ seats: [s] });
    expect(seat({ race: 'orcs' })).toMatch(/race inconnue/);
    expect(seat({ minerals: -1 })).toMatch(/minerals/);
    expect(seat({ minerals: 100_001 })).toMatch(/minerals/);
    expect(seat({ energy: 1.5 })).toMatch(/energy/);
    expect(seat({ forbid: ['nimporte'] })).toMatch(/inconnu/);
    expect(seat({ forbid: ['minerai'] })).toMatch(/inconnu/);
    expect(seat({ forbid: ['caserne', 'caserne'] })).toMatch(/double/);
    expect(seat({ forbid: Array(301).fill('caserne') })).toMatch(/forbid/);
    expect(seat({ couleur: 'rouge' })).toMatch(/champ inconnu/);
    expect(seat('z')).toMatch(/objet/);
    expect(rules({ seats: [{}, {}, {}, {}, {}] })).toMatch(/seats/);
    expect(rules({ seats: { race: 'z' } })).toMatch(/seats/);
  });

  it('refuse une unité placée inconnue, hors carte ou à un propriétaire impossible', () => {
    const unit = (u: unknown) => rules({ units: [u] });
    expect(unit({ type: 'dragonrouge', owner: 0, at: [5, 5] })).toMatch(/inconnu/);
    expect(unit({ type: 'minerai', owner: 0, at: [5, 5] })).toMatch(/inconnu/);
    expect(unit({ type: 'boostgenetique', owner: 0, at: [5, 5] })).toMatch(/inconnu/); // a research
    expect(unit({ type: 'auxiliaire', owner: 4, at: [5, 5] })).toMatch(/owner/);
    expect(unit({ type: 'auxiliaire', owner: -2, at: [5, 5] })).toMatch(/owner/);
    expect(unit({ type: 'auxiliaire', owner: 0, at: [64, 5] })).toMatch(/at/);
    expect(unit({ type: 'caserne', owner: 0, at: [62, 5] })).toMatch(/at/); // 3×3: its footprint off the map
    expect(unit({ type: 'auxiliaire', owner: 0, at: [5, 5], hp: 9999 })).toMatch(/champ inconnu/);
    expect(rules({ units: Array(201).fill({ type: 'auxiliaire', owner: 0, at: [40, 40] }) })).toMatch(/units/);
  });

  it('refuse une unité placée sur un gouffre ou un bâtiment sur un autre (jouabilité)', () => {
    expect(unplayable(map())).toBeNull();
    expect(unplayable({ ...map(), units: [{ type: 'caserne', owner: 0, at: [11, 11] }] })).toMatch(/chevauche/);
    expect(unplayable({ ...map(), units: [{ type: 'auxiliaire', owner: 0, at: [7, 6] }] })).toMatch(/mal placé/);
    expect(unplayable({ ...map(), terrain: [{ shape: 'rect', from: [43, 49], to: [45, 51], chasm: true }] })).toMatch(/mal placé/);
  });
});

describe('règles de carte : partie (createMatch)', () => {
  it('impose la race, donne les ressources, pose les unités', () => {
    const w = createMatch(['humains', 'isdaris'], undefined, map());
    expect(w.players.map((p) => p.faction)).toEqual(['z', 'isdaris']);
    expect(seatFactions(map(), ['humains', 'isdaris'])).toEqual(['z', 'isdaris']);
    expect([w.players[0].minerals, w.players[0].energy]).toEqual([1000, 300]);
    expect([w.players[1].minerals, w.players[1].energy]).toEqual([START.minerals, START.energy]);
    expect(of(w, 0, 'intelligence')).toHaveLength(1);
    expect(of(w, 0, 'pod').map((e) => [e.tx, e.ty])).toEqual([[26, 12]]);
    expect(of(w, 0, 'pod')[0].buildLeft).toBe(0); // there from the start, built
    expect(of(w, -1, 'tour')).toHaveLength(1);
    expect(of(w, 1, 'auxiliaire')).toHaveLength(1);
    // A seat not playing this match: its units stay out.
    expect([...w.entities.values()].some((e) => e.type === 'legionnaire')).toBe(false);
  });

  it('interdit ce que la carte interdit : construire, produire, rechercher', () => {
    const w = createMatch(['humains', 'humains'], undefined, map());
    expect(w.lacks(0, 'tourelle')).toBe('Interdit sur cette carte.');
    expect(w.lacks(1, 'caserne')).toBe('Interdit sur cette carte.');
    expect(w.lacks(1, 'grenier')).toBe('');
    const serf = of(w, 1, 'serf')[0];
    w.players[1].minerals = 5000;
    w.step([{ player: 1, kind: 'build', ids: [serf.id], type: 'caserne', tx: 40, ty: 40 }]);
    expect(serf.order?.kind).not.toBe('build');
    expect(w.events.some((e) => e.player === 1 && e.text === 'Interdit sur cette carte.')).toBe(true);
  });

  it('sans règles, une carte du jeu reste la même partie', () => {
    for (const def of Object.values(MAPS)) {
      expect(def.seats).toBeUndefined();
      expect(def.units).toBeUndefined();
      const w = createMatch(['humains', 'z'], undefined, def.id, def.biome);
      expect(w.players.every((p) => p.forbid === undefined)).toBe(true);
    }
  });

  it("l'IA ne construit ni ne produit ce qui lui est interdit", () => {
    const def = rules({ seats: [{ forbid: ['caserne', 'tour', 'forge'] }, { forbid: ['plateforme'] }] }) as MapFile;
    const w = createMatch(['humains', 'z'], undefined, def);
    const ais = [new AI(w, 0), new AI(w, 1)];
    while (w.tick < ticks(10 * 60) && w.winner === null) w.step(ais.flatMap((a) => a.think()));
    for (const t of ['caserne', 'tour', 'forge']) expect(of(w, 0, t), t).toHaveLength(0);
    expect(of(w, 1, 'plateforme')).toHaveLength(0);
    // Still playing: workers and supply came.
    expect(of(w, 0, 'serf').length).toBeGreaterThan(START.serfs);
  }, 60_000);

  it('une partie sur une carte à règles rejoue à l’identique depuis ses ordres', () => {
    const live = createMatch(['humains', 'isdaris'], undefined, map());
    const ais = [new AI(live, 0), new AI(live, 1)];
    const record: [number, Command[]][] = [];
    while (live.tick < ticks(5 * 60)) {
      const cmds = ais.flatMap((ai) => ai.think());
      if (cmds.length) record.push([live.tick, cmds]);
      live.step(cmds);
    }
    const played = new Map<number, Command[]>(JSON.parse(JSON.stringify(record)));
    // The map read back from its JSON, as a replay carries it.
    const again = createMatch(['humains', 'isdaris'], undefined, checkMap(JSON.parse(JSON.stringify(map()))) as MapFile);
    while (again.tick < live.tick) again.step(played.get(again.tick) ?? []);
    expect(fingerprint(again)).toBe(fingerprint(live));
  }, 60_000);
});
