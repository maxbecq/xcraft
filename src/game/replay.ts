/** Replays: a game kept as the commands the simulation took, saved, opened from a file and played back. */
import type { Faction } from '../data';
import type { Command } from '../sim/world';

export const REPLAY_KEY = 'xcraft.replay';

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
export interface Replay {
  v: 1;
  /** Map id; missing in replays from before map files (the original map). */
  map?: string;
  factions: Faction[];
  /** Each player's team; missing in replays from before teams (everyone alone). */
  teams?: number[];
  biome: string;
  handicap: number[];
  ticks: [number, Command[]][];
}

/** The replay to play: one opened from a file this session, else the last saved game. */
export function readReplay(): Replay | null {
  for (const read of [() => sessionStorage.getItem(REPLAY_KEY), () => localStorage.getItem(REPLAY_KEY)]) {
    try {
      const r = JSON.parse(read() ?? 'null') as Replay | null;
      if (r?.v === 1 && Array.isArray(r.ticks)) return r;
    } catch {
      // unavailable or not a replay: try the next place
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
    const text = await input.files?.[0]?.text();
    if (!text) return;
    try {
      const r = JSON.parse(text) as Replay;
      if (r.v !== 1 || !Array.isArray(r.ticks)) throw new Error('not a replay');
      sessionStorage.setItem(REPLAY_KEY, text);
      playReplay(r);
    } catch {
      alert('Ce fichier n’est pas un replay Xcraft.');
    }
  };
  input.click();
}
