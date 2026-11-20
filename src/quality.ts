import type { WebGLRenderer } from 'three';

/** Graphics quality: how much the renderer draws on top of the game itself. */
export type Quality = 'basse' | 'moyenne' | 'haute';
export const QUALITY_NAMES: Record<Quality | 'auto', string> = { auto: 'Auto', basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute' };
export const QUALITY_KEY = 'xcraft.quality';

/**
 * What each level costs: pixel density, post-processing (none, light, full), sun shadows, and the share of
 * effect particles drawn (each one is a draw call: half of a big battle's on the basse level).
 */
export const QUALITY: Record<Quality, { pixelRatio: number; post: 'off' | 'light' | 'full'; shadows: number; particles: number }> = {
  basse: { pixelRatio: 1, post: 'off', shadows: 0, particles: 0.4 },
  moyenne: { pixelRatio: 1.25, post: 'light', shadows: 2048, particles: 1 },
  // 1.5, not 2: on a Retina Mac under Safari the full post-processing at 2 (3456x1902) held the frame at about 19 ms
  // while our own work took 11, the graphics chip's fill; 1.5 draws 44 % fewer pixels in every full-screen pass.
  haute: { pixelRatio: 1.5, post: 'full', shadows: 4096, particles: 1 },
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
