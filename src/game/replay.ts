/** Replays: a game kept as the commands the simulation took, saved, opened from a file and played back. */
import { type Faction, FACTIONS } from '../data';
import { DEFAULT_MAP, MAPS } from '../maps';
import { commandOk } from '../net';
import type { Command } from '../sim/world';

export const REPLAY_KEY = 'xcraft.replay';

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
export interface Replay {
  v: 1;
  /** Map id; missing in replays from before map files (the original map). */
  map?: string;
  /** A map this version does not have, replaced by the original one (said to the viewer: the game may differ). */
  lostMap?: string;
  factions: Faction[];
  /** Each player's team; missing in replays from before teams (everyone alone). */
  teams?: number[];
  biome: string;
  handicap: number[];
  ticks: [number, Command[]][];
}

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
  if (n < 1 || n > 4 || !r.factions.every((f) => typeof f === 'string' && f in FACTIONS)) return `${bad} (camps inconnus).`;
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
      // The same check as an order from the network; a Bac à sable (one player) has its switches too.
      if (!commandOk(c, n === 1)) return `${bad} (commande invalide).`;
    }
  }
  if (r.map !== undefined && (typeof r.map !== 'string' || !MAPS[r.map])) {
    r.lostMap = String(r.map).replace(/[^\w.-]/g, '').slice(0, 60); // shown on screen: letters only, never markup
    delete r.map;
  }
  // Every side needs a start on the map it plays on (the original one for a map this version lacks).
  if (n > Math.max(...MAPS[r.map ?? DEFAULT_MAP].players)) return `${bad} (plus de camps que la carte n’a de places).`;
  if (typeof r.biome !== 'string' || !/^[a-z-]{1,24}$/.test(r.biome)) r.biome = 'desert';
  return r;
}

/** The replay to play: one opened from a file this session, else the last saved game. One that does not check out
 * is dropped from this session (so it does not stay in the way). */
export function readReplay(): Replay | null {
  for (const [store, read] of [['session', () => sessionStorage.getItem(REPLAY_KEY)], ['local', () => localStorage.getItem(REPLAY_KEY)]] as const) {
    try {
      const text = read();
      if (!text) continue;
      const r = parseReplay(text);
      if (typeof r !== 'string') return r;
      if (store === 'session') sessionStorage.removeItem(REPLAY_KEY);
    } catch {
      // storage unavailable: try the next place
    }
  }
  return null;
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

export function playReplay(r: Replay | null): void {
  if (r) location.search = `?replay&speed=2&biome=${r.biome}`;
}

export function downloadReplay(r: Replay): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  a.download = `xcraft-${r.factions.join('-')}-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
    try {
      sessionStorage.setItem(REPLAY_KEY, JSON.stringify(r));
    } catch {
      return alert('Ce replay ne tient pas dans le stockage du navigateur.');
    }
    playReplay(r);
  };
  input.click();
}
