import type { WebGLRenderer } from 'three';

/** Graphics quality: how much the renderer draws on top of the game itself. */
export type Quality = 'basse' | 'moyenne' | 'haute';
export const QUALITY_NAMES: Record<Quality | 'auto', string> = { auto: 'Auto', basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute' };
export const QUALITY_KEY = 'xcraft.quality';

/** What each level costs: pixel density, post-processing (none, light, full) and sun shadows. */
export const QUALITY: Record<Quality, { pixelRatio: number; post: 'off' | 'light' | 'full'; shadows: number }> = {
  basse: { pixelRatio: 1, post: 'off', shadows: 0 },
  moyenne: { pixelRatio: 1.25, post: 'light', shadows: 2048 },
  haute: { pixelRatio: 2, post: 'full', shadows: 4096 },
};

/**
 * The level guessed from the graphics chip: low on integrated PC chips (Intel HD, UHD, Iris), medium on
 * phones and tablets, high otherwise (dedicated cards, Apple silicon).
 */
export function detectQuality(renderer: WebGLRenderer, touch: boolean): Quality {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const chip = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (/intel|swiftshader|llvmpipe|software/i.test(chip)) return 'basse';
  return touch ? 'moyenne' : 'haute';
}

/** `?quality=basse|moyenne|haute` (or the older `?lowfx`), else the menu's choice, else the detected level. */
export function pickQuality(params: URLSearchParams, stored: string | null, detected: Quality): Quality {
  const asked = params.get('quality') ?? (params.has('lowfx') ? 'basse' : stored);
  return asked && asked in QUALITY ? (asked as Quality) : detected;
}
