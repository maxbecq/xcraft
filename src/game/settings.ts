/** What this computer keeps between pages (its browser's storage): control settings, fullscreen, the last choices. */
import type { Faction } from '../data';

/** Control settings for this computer (Options, also from the pause menu): edge scrolling's speed, band width (1 = as
 * designed), speed-up while held (0 = none) and coasting on letting go (s); the held cursor's speed (one to one with the system cursor at 1)
 * (game/pointerlock.ts); the pointer held in the window; grid hotkeys; the game's speed against the AI. */
export const SCROLL_KEY = 'xcraft.scroll';
/** `lcd`: the Machines' console as three floating LCD screens, with the build list drawn as a tech tree (Z only).
 * `tactile`: the trial touch controls (phones and tablets): a marking menu on a long press, quick actions at the bottom.
 * `tuck`: touch screens, the selection sheet and the commands slide away a moment after the last touch (on unless unticked).
 * `alt`: the alternative desktop interface (game/hud-alt.ts): no console; off on touch screens.
 * `volume`, `mute`: the sound's level (0 to 1) and whether it is cut. */
export const SCROLL_BASE = { speed: 1, band: 1, ramp: 1, coast: 0.4, mouse: 1, lock: false, grid: false, halo: true, lcd: false, tactile: false, tuck: true, alt: false, game: 1, volume: 0.5, mute: false };
export type Controls = typeof SCROLL_BASE;
/** The sliders' ends (pause menu, Options): a stored value outside them (an old or edited one) is brought back in,
 * so a game speed of 0 cannot freeze a match, nor a huge one hang the page catching up. */
export const SCROLL_RANGE = { speed: [0.5, 2], band: [0.4, 1.6], ramp: [0, 2], coast: [0, 1], mouse: [0.5, 2], game: [0.5, 2], volume: [0, 1] } as const;
export const SCROLL: Controls = (() => {
  const base = { ...SCROLL_BASE };
  try {
    // Holding the pointer is off unless chosen again: an earlier version stored it on, hence `lock2`, which ignores the old `lock`.
    const stored = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? '{}');
    for (const k of Object.keys(SCROLL_RANGE) as (keyof typeof SCROLL_RANGE)[])
      if (typeof stored[k] === 'number' && Number.isFinite(stored[k])) base[k] = Math.min(SCROLL_RANGE[k][1], Math.max(SCROLL_RANGE[k][0], stored[k]));
    return { ...base, lock: stored.lock2 === true, grid: stored.grid === true, halo: stored.halo !== false, lcd: stored.lcd === true, tactile: stored.tactile === true, tuck: stored.tuck !== false, alt: stored.alt === true, mute: stored.mute === true };
  } catch {
    return base;
  }
})();
export function saveControls(): void {
  try {
    const { lock, ...rest } = SCROLL;
    localStorage.setItem(SCROLL_KEY, JSON.stringify({ ...rest, lock2: lock }));
  } catch {
    // private browsing: kept for this page only
  }
}

/** A stored value, or null (none, or storage blocked). */
export const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

/** Bac à sable: its options, all off unless picked (before the match or in the pause menu's options). */
export const SANDBOX_TOOLS = { unlimited: 'Ressources illimitées', instant: 'Construction, production et recherche instantanées', reveal: 'Carte révélée (sans brouillard)' } as const;

/** Bac à sable: the options last picked, before or during a match, ticked again for the next one. */
const SANDBOX_KEY = 'xcraft.sandbox';
export function sandboxRemembered(): Set<string> {
  try {
    return new Set((localStorage.getItem(SANDBOX_KEY) ?? '').split(',').filter((t) => t in SANDBOX_TOOLS));
  } catch {
    return new Set(); // private browsing: all off
  }
}
export function rememberSandbox(tool: string, on: boolean): void {
  const picked = sandboxRemembered();
  if (on) picked.add(tool);
  else picked.delete(tool);
  try {
    localStorage.setItem(SANDBOX_KEY, [...picked].join(','));
  } catch {
    // private browsing: for this match only
  }
}

export const asFaction = (v: string | null): Faction => (v === 'isdaris' || v === 'z' || v === 'dieux' ? v : 'humains');

/** Fullscreen: chosen in the options for this computer, toggled from the pause menu. */
export const FULLSCREEN_KEY = 'xcraft.fullscreen';
export function wantsFullscreen(): boolean {
  try {
    return localStorage.getItem(FULLSCREEN_KEY) === '1';
  } catch {
    return false;
  }
}
export function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}

export const fmt = (v: number, unit: string) => (unit === '×' ? `×${+v.toFixed(2)}` : unit === '%' ? `${Math.round(v * 100)} %` : `${+v.toFixed(2)}${unit}`);
