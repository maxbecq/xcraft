import type { WebGLRenderer } from 'three';

/** Graphics quality: how much the renderer draws on top of the game itself. */
export type Quality = 'basse' | 'moyenne' | 'haute';
export const QUALITY_NAMES: Record<Quality | 'auto', string> = { auto: 'Auto', basse: 'Basse', moyenne: 'Moyenne', haute: 'Haute' };
export const QUALITY_KEY = 'xcraft.quality';

/**
 * What each level costs: pixel density, post-processing (none, light, full), sun shadows, and the share of
 * effect particles drawn. The basse level (integrated chips) also caps the 3D picture's pixels whatever the window
 * (`maxPixels`: an Intel HD drew 2.3 million at 1920 x 1200, most of its frame), drops the silhouettes of units
 * behind buildings (`xray`: the scene drawn twice more) and reads its ground and weathering noise from a texture
 * instead of working it out for every pixel (`lite`). Only the haute level shades ambient occlusion (`ao`): on the
 * moyenne one its three full-screen passes go, the ink lines stay (render/post.ts noOcclusion).
 */
export const QUALITY: Record<Quality, { pixelRatio: number; maxPixels: number; post: 'off' | 'light' | 'full'; shadows: number; particles: number; xray: boolean; lite: boolean; ao: boolean }> = {
  basse: { pixelRatio: 1, maxPixels: 1_300_000, post: 'off', shadows: 0, particles: 0.4, xray: false, lite: true, ao: false },
  // 1024, not 2048: on a phone the 3D picture is half a million pixels, the shadow map had eight times as many texels,
  // and the whole map's cliffs and scenery are drawn into it every frame.
  moyenne: { pixelRatio: 1.25, maxPixels: Infinity, post: 'light', shadows: 1024, particles: 1, xray: true, lite: false, ao: false },
  // 1.5, not 2: on a Retina Mac under Safari the full post-processing at 2 (3456x1902) held the frame at about 19 ms
  // while our own work took 11, the graphics chip's fill; 1.5 draws 44 % fewer pixels in every full-screen pass.
  haute: { pixelRatio: 1.5, maxPixels: Infinity, post: 'full', shadows: 4096, particles: 1, xray: true, lite: false, ao: true },
};

/**
 * The 3D picture's pixel density for a window of `w` by `h` CSS pixels on a screen of density `dpr`: the level's own,
 * never over the screen's, and lowered (not under 0.6, where the picture turns to mush) so the picture stays within
 * the level's `maxPixels`. The interface and the health bars are drawn apart, at the screen's own density.
 */
export function pixelRatioFor(level: Quality, w: number, h: number, dpr: number): number {
  const q = QUALITY[level];
  const capped = Math.sqrt(q.maxPixels / Math.max(1, w * h));
  return Math.min(q.pixelRatio, dpr, Math.max(0.6, capped));
}

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
