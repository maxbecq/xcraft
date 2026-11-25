import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { checkMap, MAP_MAX_CHARS, MAX_MAP_ID, mapPrint, parseMap } from '../mapcheck';
import { addMap, MAPS, MAX_FRIEND_MAPS, type MapFile, ownImports, receiveMap, removeMap } from '../maps';
import { lobbyOk } from '../net';
import { ticks } from '../sim/fixed';
import { createMatch } from '../sim/setup';
import type { Command } from '../sim/world';
import { parseReplay, type Replay } from './replay';

/** Le Col, imported under another name: a playable map from outside the game. */
const imported = (): MapFile => checkMap({ ...JSON.parse(JSON.stringify(MAPS['le-col'])), id: 'col-perso', name: 'Mon col' }) as MapFile;

/** Two AIs play `seconds` on the map; the orders they gave, by tick, as a replay keeps them, and the world's hash at the end. */
function play(def: MapFile, seconds: number): { ticks: [number, Command[]][]; hash: number } {
  const w = createMatch(['humains', 'z'], undefined, def.id, def.biome);
  const ais = [new AI(w, 0), new AI(w, 1)];
  const out: [number, Command[]][] = [];
  while (w.tick < ticks(seconds)) {
    const cmds = ais.flatMap((ai) => ai.think());
    if (cmds.length) out.push([w.tick, cmds]);
    w.step(cmds);
  }
  return { ticks: out, hash: w.hash() };
}

describe('an imported map in a replay', () => {
  it('travels with the replay and plays again the same on a browser that never had it', () => {
    const def = imported();
    addMap(def);
    const { ticks: orders, hash } = play(def, 90);
    const replay: Replay = { v: 1, map: def.id, carte: def, factions: ['humains', 'z'], teams: [0, 1], biome: def.biome, handicap: [100, 100], ticks: orders };
    const text = JSON.stringify(replay);
    removeMap(def.id); // another browser: the map is not there
    expect(MAPS[def.id]).toBeUndefined();
    const r = parseReplay(text);
    if (typeof r === 'string') throw new Error(r);
    expect(r.lostMap).toBeUndefined();
    expect(MAPS[def.id]).toEqual(def);
    const w = createMatch(r.factions, r.teams, r.map, r.biome);
    let k = 0;
    while (w.tick < ticks(90)) w.step(r.ticks[k]?.[0] === w.tick ? r.ticks[k++][1] : []);
    expect(w.hash()).toBe(hash);
    removeMap(def.id);
  }, 60_000);

  it('refuses a replay whose map does not check out, or is not the one it names', () => {
    const def = imported();
    const base = { v: 1, factions: ['humains', 'z'], teams: [0, 1], biome: 'volcan', handicap: [100, 100], ticks: [] };
    expect(parseReplay(JSON.stringify({ ...base, map: def.id, carte: { ...def, size: 5000 } }))).toMatch(/carte jointe : « size »/);
    expect(parseReplay(JSON.stringify({ ...base, map: 'origine', carte: def }))).toMatch(/carte jointe/);
    expect(parseReplay(JSON.stringify({ ...base, map: def.id, carte: { ...def, name: '<b>' } }))).toMatch(/carte jointe/);
    expect(MAPS[def.id]).toBeUndefined();
  });

  it('leaves no map on the page when the replay is refused after its map checked out', () => {
    const def = imported(); // Le Col: two places
    const three = { v: 1, map: def.id, carte: def, factions: ['humains', 'z', 'dieux'], teams: [0, 1, 2], biome: 'volcan', handicap: [100, 100, 100], ticks: [] };
    expect(parseReplay(JSON.stringify(three))).toMatch(/plus de camps/);
    expect(MAPS[def.id]).toBeUndefined();
  });
});

describe('an imported map in a friends\' game', () => {
  const setup = { camps: ['humains', 'z'], map: 'import-col-perso', biome: 'volcan' };
  it('lets the map file through as text, within the size a map may have', () => {
    expect(lobbyOk({ carte: JSON.stringify(imported()) })).toBe(true);
    expect(lobbyOk({ carte: 'x'.repeat(MAP_MAX_CHARS + 1) })).toBe(false);
    expect(lobbyOk({ carte: { id: 'x' } })).toBe(false);
  });

  it('takes a setup with or without a print, never a malformed one', () => {
    expect(lobbyOk({ setup })).toBe(true);
    expect(lobbyOk({ setup: { ...setup, print: mapPrint(imported()) } })).toBe(true);
    expect(lobbyOk({ setup: { ...setup, print: 'zz' } })).toBe(false);
    expect(lobbyOk({ go: { ...setup, print: 12 }, id: 1 })).toBe(false);
  });

  it('tells two copies of a map apart by their print, whoever checked them', () => {
    const a = imported();
    const b = checkMap(JSON.parse(JSON.stringify(a))) as MapFile; // the guest's copy, checked again
    expect(mapPrint(b)).toBe(mapPrint(a));
    expect(mapPrint({ ...a, bases: a.bases.slice(0, 1) })).not.toBe(mapPrint(a));
  });
});

describe('a friend\'s imported map with the id of one of the guest\'s own', () => {
  const store = new Map<string, string>();
  const withStorage = (f: () => void) => {
    Object.assign(globalThis, { localStorage: { setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k), getItem: (k: string) => store.get(k) ?? null } });
    try {
      f();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
      for (const id of Object.keys(MAPS)) if (id.startsWith('import-')) removeMap(id);
      store.clear();
    }
  };

  it('is the guest\'s own when it holds the same: nothing new kept', () =>
    withStorage(() => {
      const mine = imported();
      addMap(mine, true);
      expect(receiveMap(checkMap(JSON.parse(JSON.stringify(mine))) as MapFile)).toBe(mine.id);
      expect(store.size).toBe(1);
    }));

  it('is kept beside the guest\'s own when it differs, which stays as it was', () =>
    withStorage(() => {
      const mine = imported();
      addMap(mine, true);
      const theirs = { ...mine, name: 'Le col de mon ami', bases: mine.bases.slice(0, 1) };
      const id = receiveMap(theirs);
      expect(id).toBe(`${mine.id}-${mapPrint(theirs).slice(0, 6)}`);
      expect(MAPS[mine.id]).toEqual(mine);
      expect(parseMap(store.get(`xcraft.carte:${mine.id}`)!)).toEqual(mine);
      expect(mapPrint(MAPS[id!])).toBe(mapPrint(theirs)); // the print is the content's, whatever the id
      expect(parseMap(store.get(`xcraft.ami:${id}`)!)).toEqual(MAPS[id!]); // and it reads back on the match's page
      expect(receiveMap(theirs)).toBe(id); // received again: the same copy
    }));

  it('keeps an id of 32 letters readable once prefixed, and once suffixed too', () =>
    withStorage(() => {
      const long = checkMap({ ...JSON.parse(JSON.stringify(MAPS['le-col'])), id: 'a'.repeat(32) }) as MapFile;
      expect(long.id).toBe('import-' + 'a'.repeat(32));
      expect(checkMap({ ...long, id: 'a'.repeat(33) })).toMatch(/id/);
      addMap(long, true);
      const other = receiveMap({ ...long, name: 'Autre' })!;
      expect(other.length).toBeLessThanOrEqual(MAX_MAP_ID); // a waiting room takes it (net.ts lobbyOk)
      expect(lobbyOk({ setup: { camps: ['humains', 'z'], map: other, biome: 'desert' } })).toBe(true);
      expect(typeof checkMap({ ...MAPS[other] }, false)).toBe('object');
      expect(parseMap(store.get(`xcraft.carte:${long.id}`)!)).toEqual(MAPS[long.id]);
      expect(parseMap(store.get(`xcraft.ami:${other}`)!)).toEqual(MAPS[other]);
    }));

  it('keeps friends\' maps apart, the last ones only, never in the player\'s own imports', () =>
    withStorage(() => {
      const mine = imported();
      addMap(mine, true);
      const sent = Array.from({ length: MAX_FRIEND_MAPS + 2 }, (_, i) => ({ ...imported(), id: `import-ami-${i}`, name: `Carte ${i}` }));
      const ids = sent.map((m) => receiveMap(m)!);
      expect(ids).toEqual(sent.map((m) => m.id));
      for (const id of ids.slice(0, 2)) expect(MAPS[id], id).toBeUndefined(); // the two oldest replaced
      for (const id of ids.slice(2)) expect(MAPS[id], id).toBeDefined();
      expect([...store.keys()].filter((k) => k.startsWith('xcraft.ami:')).sort()).toEqual(ids.slice(2).map((id) => `xcraft.ami:${id}`).sort());
      expect(JSON.parse(store.get('xcraft.amis')!)).toEqual(ids.slice(2));
      expect(ownImports()).toEqual([mine.id]); // the player's quota untouched
      expect(MAPS[mine.id]).toEqual(mine);
      removeMap(ids[6]);
      expect(JSON.parse(store.get('xcraft.amis')!)).toEqual(ids.slice(2, 6));
    }));
});

describe('a map the browser refuses to keep', () => {
  it('is not offered either: addMap lists it only once stored', () => {
    Object.assign(globalThis, { localStorage: { setItem: () => { throw new Error('quota'); }, removeItem: () => {}, getItem: () => null } });
    try {
      const def = imported();
      expect(addMap(def, true)).toBe(false);
      expect(MAPS[def.id]).toBeUndefined();
      expect(addMap(def)).toBe(true); // for this page only (a replay's): listed, nothing stored
      expect(MAPS[def.id]).toEqual(def);
      removeMap(def.id);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
