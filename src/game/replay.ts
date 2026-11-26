/** Replays: a game kept as the commands the simulation took, saved, opened from a file and played back. */
import { type Faction, FACTIONS } from '../data';
import { DEFAULT_MAP, MAPS, type MapFile } from '../maps';
import { checkMap } from '../mapcheck';
import { unplayable } from '../mapplay';
import { commandOk } from '../net';
import type { Command } from '../sim/world';

export const REPLAY_KEY = 'xcraft.replay';

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
export interface Replay {
  v: 1;
  /** The game's version that played it (the simulation's rules change with it); missing in older replays. */
  version?: string;
  /** Map id; missing in replays from before map files (the original map). */
  map?: string;
  /** An imported map, carried whole so the replay plays anywhere (checked again on reading, as any outside map). */
  carte?: MapFile;
  /** A map this version does not have, replaced by the original one (said to the viewer: the game may differ). */
  lostMap?: string;
  factions: Faction[];
  /** Each player's team; missing in replays from before teams (everyone alone). */
  teams?: number[];
  biome: string;
  handicap: number[];
  ticks: [number, Command[]][];
  /** The tick the game was kept at (its playback stops there) and why it stopped; missing in older replays (played to
   * their last order, then on). */
  endTick?: number;
  end?: ReplayEnd;
  /** The game's seed the AIs drew their strategies with (they are not replayed: for the analysis); missing in older
   * replays, whose AIs drew from the sides and the map. */
  seed?: number;
}

/** Why a kept game stopped: won, left (page closed, Quitter), cut on the network, or saved while it went on. */
export type ReplayEnd = 'victory' | 'left' | 'network' | 'ongoing';
const ENDS: readonly string[] = ['victory', 'left', 'network', 'ongoing'] satisfies ReplayEnd[];

/** Largest replay accepted (a long game is a few megabytes). */
export const REPLAY_MAX_BYTES = 32 * 1024 * 1024;

/**
 * A replay read from text (storage or a file), checked before anything plays it: its version, its ticks (pairs of a
 * tick ≥ 0 and its commands, in order), each command's player among the replay's, its sides (known factions, teams and
 * handicaps one each). An unknown map falls back to the original one, a missing biome to the desert. The reason in
 * French when it is not a replay that can be played.
 */
export function parseReplay(text: string): Replay | string {
  const bad = 'Ce fichier n’est pas un replay Xcraft lisible';
  if (text.length > REPLAY_MAX_BYTES) return `${bad} (trop gros).`;
  let r: Replay;
  try {
    r = JSON.parse(text);
  } catch {
    return `${bad}.`;
  }
  if (!r || typeof r !== 'object' || r.v !== 1) return `${bad} (version inconnue).`;
  const n = Array.isArray(r.factions) ? r.factions.length : 0;
  if (n < 1 || n > 4 || !r.factions.every((f) => typeof f === 'string' && Object.hasOwn(FACTIONS, f))) return `${bad} (camps inconnus).`;
  const counted = (a: unknown, ok: (v: unknown) => boolean) => Array.isArray(a) && a.length === n && a.every(ok);
  if (r.teams !== undefined && !counted(r.teams, (t) => Number.isInteger(t) && (t as number) >= 0)) return `${bad} (équipes).`;
  // A harvest handicap is a whole percent (AI levels: 60 to 130).
  if (!counted(r.handicap, (h) => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 1000)) return `${bad} (handicaps).`;
  if (!Array.isArray(r.ticks)) return `${bad} (commandes).`;
  let last = -1;
  for (const entry of r.ticks) {
    if (!Array.isArray(entry) || entry.length !== 2) return `${bad} (commandes).`;
    const [tick, cmds] = entry;
    if (!Number.isInteger(tick) || tick < 0 || tick <= last || !Array.isArray(cmds)) return `${bad} (commandes).`;
    last = tick;
    for (const c of cmds) {
      if (!c || typeof c !== 'object' || !Number.isInteger(c.player) || c.player < 0 || c.player >= n) return `${bad} (joueur inconnu).`;
      // The same check as an order from the network; a Bac à sable (one player) has its switches too, an AI its resignation (never alone: the simulation ignores it there).
      if (!commandOk(c, n === 1, n > 1)) return `${bad} (commande invalide).`;
    }
  }
  // An end before the last order (or no number) is not one: played as an older replay.
  if (r.endTick !== undefined && (!Number.isInteger(r.endTick) || r.endTick <= last)) delete r.endTick;
  if (r.end !== undefined && !ENDS.includes(r.end)) delete r.end;
  if (r.seed !== undefined && (!Number.isInteger(r.seed) || r.seed < 0 || r.seed > 0xffffffff)) delete r.seed;
  if (r.carte !== undefined) {
    const def = checkMap(r.carte);
    const why = typeof def === 'string' ? def : def.id !== r.map ? 'elle ne porte pas le nom de la partie' : unplayable(def);
    if (why || typeof def === 'string') return `${bad} (carte jointe : ${why}).`;
    r.carte = def;
  }
  if (!r.carte && r.map !== undefined && (typeof r.map !== 'string' || !Object.hasOwn(MAPS, r.map))) {
    r.lostMap = String(r.map).replace(/[^\w.-]/g, '').slice(0, 60); // shown on screen: letters only, never markup
    delete r.map;
  }
  // Every side needs a start on the map it plays on (the original one for a map this version lacks); a map from
  // outside, at a players count it offers (the counts it was checked at).
  if (n > Math.max(...(r.carte ?? MAPS[r.map ?? DEFAULT_MAP]).players)) return `${bad} (plus de camps que la carte n’a de places).`;
  if (r.carte && !r.carte.players.includes(n)) return `${bad} (la carte jointe ne se joue pas à ${n}).`;
  if (r.version !== undefined && (typeof r.version !== 'string' || !/^[\w.-]{1,24}$/.test(r.version))) delete r.version;
  if (typeof r.biome !== 'string' || !/^[a-z-]{1,24}$/.test(r.biome)) r.biome = 'desert';
  delete (r as { perf?: unknown }).perf; // a measures file (measuresFile) carries its telemetry beside the replay
  // The page's maps stay as they are: the replay plays on its own copy (config.ts MAP), never one of the player's.
  return r;
}

/** This build's version, written into the replays it saves. */
export const GAME_VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';

/** What to say before playing a replay from another version (its rules may differ: it may not follow the game), or null. */
export function versionNote(r: Replay): string | null {
  if (r.version === GAME_VERSION) return null;
  const which = r.version ? `de la version ${r.version}` : 'd’une version antérieure';
  return `Replay ${which} (jeu en ${GAME_VERSION}) : les règles ont pu changer depuis, la partie rejouée peut s’écarter de l’originale.`;
}

/** The page's address with the replay's own planet: the map's shape may depend on it, so it wins over the URL and the settings. */
export function withReplayBiome(params: URLSearchParams, r: Replay | null): URLSearchParams {
  if (!r) return params;
  const p = new URLSearchParams(params);
  p.set('biome', r.biome);
  return p;
}

/** Where a replay to play comes from: the last game kept on this browser, or a file just opened. */
export type ReplaySource = 'last' | 'file';

/** A file opened, as read back from IndexedDB before the game's modules ran (see boot.ts). */
let opened: string | null = null;

/** The replay to play from `source` (an address from before the two were told apart, `?replay`, means the last game).
 * One that does not check out is dropped, so it does not stay in the way. */
export function readReplay(source: ReplaySource): Replay | null {
  try {
    const text = source === 'file' ? opened : localStorage.getItem(REPLAY_KEY);
    if (!text) return null;
    const r = parseReplay(text);
    if (typeof r !== 'string') return r;
    if (source === 'last') localStorage.removeItem(REPLAY_KEY);
  } catch {
    // storage unavailable
  }
  return null;
}

/** IndexedDB, where a file opened waits for the page that plays it: no quota as small as the session's storage. */
function fileStore<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((done, fail) => {
    const open = indexedDB.open('xcraft', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('replay');
    open.onerror = () => fail(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('replay', mode);
      const req = act(tx.objectStore('replay'));
      // Settled with the transaction, not the request: a write is only there for the next page once committed.
      tx.oncomplete = () => (db.close(), done(req.result));
      tx.onerror = tx.onabort = () => (db.close(), fail(tx.error ?? req.error));
    };
  });
}

/** Run first (boot.ts) on a page playing a file: reads back the one its address names (`&file=`) for `readReplay('file')`. */
export async function loadOpenedReplay(): Promise<void> {
  const id = new URLSearchParams(location.search).get('file');
  if (id) opened = (await fileStore<string | undefined>('readonly', (s) => s.get(id)).catch(() => undefined)) ?? null;
}

/** Keeps the game as the "last game"; false when it could not be written (storage full or blocked). */
export function saveReplay(r: Replay): boolean {
  try {
    localStorage.setItem(REPLAY_KEY, JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
}

/** `file`: the opened file's key in IndexedDB, kept in the address so a reload plays that file, whatever other tabs opened since. */
export function playReplay(r: Replay | null, source: ReplaySource, file?: string): void {
  if (r) location.search = `?replay=${source}${file ? `&file=${file}` : ''}&speed=2&biome=${r.biome}`;
}

/** A replay as its file was, to save again: whole, with its own map's id (even one this version lacks). */
export function replaySource(r: Replay): Replay {
  const { lostMap, ...source } = r;
  return lostMap ? { ...source, map: lostMap } : source;
}

export function downloadReplay(r: Replay): void {
  saveFile(`xcraft-${r.factions.join('-')}-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.json`, JSON.stringify(r));
}

/** A file handed to the browser's downloads (no dialog, no server). */
export function saveFile(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/**
 * The measures of a game, one file to send: the replay itself (it opens as a replay, `Ouvrir un replay`) with the
 * telemetry beside it under `perf`. Named by the sides and the local date and time: xcraft-mesures-humains-z-2026-11-20T14h05.json.
 */
export function measuresFile(r: Replay, perf: unknown, at = new Date()): { name: string; text: string } {
  const two = (n: number) => String(n).padStart(2, '0');
  const when = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}h${two(at.getMinutes())}`;
  return { name: `xcraft-mesures-${r.factions.join('-')}-${when}.json`, text: JSON.stringify({ ...r, perf }) };
}

/** Lets the player pick a replay file, then plays it. */
export function openReplayFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > REPLAY_MAX_BYTES) return alert('Ce fichier n’est pas un replay Xcraft lisible (trop gros).');
    let text: string;
    try {
      text = await file.text();
    } catch {
      return alert('Ce fichier n’a pas pu être lu.');
    }
    const r = parseReplay(text);
    if (typeof r === 'string') return alert(r);
    // Keys by time, so the oldest files go first: the last few stay for the tabs still playing them.
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try {
      await fileStore('readwrite', (s) => {
        const keys = s.getAllKeys();
        keys.onsuccess = () => keys.result.slice(0, -3).forEach((k) => s.delete(k));
        return s.put(JSON.stringify(r), id);
      });
    } catch {
      return alert('Ce replay n’a pas pu être gardé par le navigateur (stockage bloqué ?).');
    }
    playReplay(r, 'file', id);
  };
  input.click();
}
