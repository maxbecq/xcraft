import { describe, expect, it } from 'vitest';
import { AI } from '../ai/ai';
import { checkMap, MAP_MAX_CHARS, MAX_MAP_ID, mapPrint, parseMap } from '../mapcheck';
import { addMap, MAPS, MAX_FRIEND_MAPS, type MapFile, ownImports, receiveMap, removeMap } from '../maps';
import { CARTE_PART, carteParts, lobbyOk } from '../net';
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
    expect(MAPS[def.id]).toBeUndefined(); // the page's maps untouched: the replay plays on its own copy
    expect(r.carte).toEqual(def);
    const w = createMatch(r.factions, r.teams, r.carte!, r.biome);
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
    for (const part of carteParts(JSON.stringify(imported()))) expect(lobbyOk(part)).toBe(true);
    expect(lobbyOk({ carte: 'x'.repeat(CARTE_PART + 1), part: 0, parts: 1 })).toBe(false);
    expect(lobbyOk({ carte: 'x', part: 1, parts: 1 })).toBe(false);
    expect(lobbyOk({ carte: JSON.stringify(imported()) })).toBe(false); // whole, as before: no more
    expect(lobbyOk({ carte: { id: 'x' }, part: 0, parts: 1 })).toBe(false);
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

  it('never takes one of the guest\'s own ids, even the suffixed one it would have picked', () =>
    withStorage(() => {
      const mine = imported();
      addMap(mine, true);
      const theirs = { ...mine, name: 'Le col de mon ami', bases: mine.bases.slice(0, 1) };
      // The guest also has a map of its own under the id the copy would have taken.
      const taken = { ...imported(), id: `${mine.id}-${mapPrint(theirs).slice(0, 6)}`, name: 'Autre col à moi' };
      addMap(taken, true);
      const id = receiveMap(theirs)!;
      expect([mine.id, taken.id]).not.toContain(id);
      expect(MAPS[taken.id]).toEqual(taken);
      expect(parseMap(store.get(`xcraft.carte:${taken.id}`)!)).toEqual(taken);
      expect(mapPrint(MAPS[id])).toBe(mapPrint(theirs));
      expect(id.length).toBeLessThanOrEqual(MAX_MAP_ID);
    }));

  it('changes nothing when storage refuses the copy: no map listed, none of the older ones dropped', () =>
    withStorage(() => {
      const sent = Array.from({ length: MAX_FRIEND_MAPS }, (_, i) => ({ ...imported(), id: `import-ami-${i}`, name: `Carte ${i}` }));
      for (const m of sent) receiveMap(m);
      const before = JSON.parse(store.get('xcraft.amis')!);
      const set = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('quota');
      };
      try {
        expect(receiveMap({ ...imported(), id: 'import-nouvelle', name: 'Nouvelle' })).toBeNull();
      } finally {
        localStorage.setItem = set;
      }
      expect(MAPS['import-nouvelle']).toBeUndefined();
      for (const m of sent) expect(MAPS[m.id], m.id).toBeDefined();
      expect(JSON.parse(store.get('xcraft.amis')!)).toEqual(before);
      expect(store.has('xcraft.ami:import-nouvelle')).toBe(false);
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

describe('a map file sent to a friend', () => {
  it('goes in parts each under PeerJS\'s 16 300 bytes, joined back whole', () => {
    // As big as a map may be, accents and quotes included (UTF-8 bytes and JSON escapes count).
    const text = ('{"name":"Éèàç ✓ \\"quote\\" ' + 'x'.repeat(50)).repeat(1000).slice(0, MAP_MAX_CHARS);
    const parts = carteParts(text);
    for (const p of parts) expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(16_300);
    expect(parts.map((p) => p.carte).join('')).toBe(text);
    expect(parts.every((p, i) => p.part === i && p.parts === parts.length)).toBe(true);
    const emoji = '😀'.repeat(3000);
    expect(carteParts(emoji).map((p) => p.carte).join('')).toBe(emoji);
    for (const p of carteParts(emoji)) expect(p.carte.charCodeAt(p.carte.length - 1) >= 0xd800 && p.carte.charCodeAt(p.carte.length - 1) <= 0xdbff).toBe(false);
  });

  it('is refused when its checked copy, written again, would not read back', () => {
    const def = JSON.parse(JSON.stringify(imported()));
    // Numbers that grow when written again (1e-6 → 0.000001): small as sent, too big once kept.
    def.terrain = Array.from({ length: 15 }, () => ({ shape: 'polygon', points: Array.from({ length: 256 }, () => [1e-6, 1e-6]), level: 1 }));
    const text = JSON.stringify(def).replace(/0\.000001/g, '1e-6');
    expect(text.length).toBeLessThan(MAP_MAX_CHARS);
    expect(JSON.stringify(checkMap(JSON.parse(text))).length).toBeGreaterThan(MAP_MAX_CHARS);
    expect(parseMap(text)).toMatch(/trop grosse une fois relue/);
  });
});

