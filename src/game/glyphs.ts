/** The HUD's pictures: things' icons and the Z commands' pictograms; and its element maker. */
import { LOOKS } from '../data';

const icon = (type: string) => `${import.meta.env.BASE_URL}icons/${LOOKS[type] ?? type}.png`;
export const noIcon = new Set<string>();
export const img = (type: string, alt: string) => (noIcon.has(type) ? '' : `<img src="${icon(type)}" alt="${alt}" data-icon="${type}">`);

export function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

/** Z socle weapons' pictograms on the weapon panel: strokes on a 24 px box, drawn in the LCD's phosphor. */
const WEAPON_GLYPHS: Record<string, string> = {
  mitrailleuse: 'M3 10h13M3 14h13M16 8v8h3M19 11h2M6 14v3',
  laser: 'M3 12h12M15 12l2-2 2 2-2 2zM19 12h2M9 9v-2M9 15v2',
  flammes: 'M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 3 3 3c0-2-1-4 0-7z',
  roquettes: 'M5 19l3-3M8 16l9-9 3-1-1 3-9 9zM8 12l-3 1M12 16l-1 3',
  dechiqueteur: 'M12 3l2 3 3-1v3l3 2-3 2v3l-3-1-2 3-2-3-3 1v-3l-3-2 3-2V5l3 1zM12 10a2 2 0 1 0 0 4 2 2 0 1 0 0-4',
  jetsonique: 'M3 12h3M9 7a7 7 0 0 1 0 10M13 5a10 10 0 0 1 0 14M17 3a13 13 0 0 1 0 18',
  arc: 'M13 2L6 13h5l-2 9 8-12h-5z',
  canonx04: 'M3 10h12l3 2h3M3 14h12l3-2M6 14v4M11 14v4M3 10v4',
  reparateur: 'M15 4a4 4 0 0 0-1 6l-8 8 2 2 8-8a4 4 0 0 0 6-1l-3-1-1-3z',
  accumulateur: 'M4 8h14v8H4zM18 11h2v2h-2M7 10v4M10 10v4M13 10v4',
};

/**
 * The other Z commands' pictograms, in the same phosphor strokes: abilities, support kits and research lines (by line:
 * a level's trailing number is dropped, so every level of Blindage des socles shares one). A command that is about a
 * weapon takes that weapon's own drawing.
 */
const EYE = 'M2 12c3-5 6-7 10-7s7 2 10 7c-3 5-6 7-10 7s-7-2-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6';
export const Z_GLYPHS: Record<string, string> = {
  balisez: 'M12 21V10M9 21h6M12 10a2 2 0 1 0 0-4 2 2 0 1 0 0 4M7 3a6 6 0 0 0 0 10M17 3a6 6 0 0 1 0 10',
  impulsion: 'M6 4v8a6 6 0 0 0 12 0V4M10 4v8a2 2 0 0 0 4 0V4M6 4h4M14 4h4M4 21l3-3M20 21l-3-3',
  invistemp: `${EYE}M4 20L20 4`,
  kitinvisibilite: `${EYE}M4 20L20 4`,
  megaespion: `${EYE}M12 1v2M4 3l1.5 1.5M20 3l-1.5 1.5`,
  kitdetection: 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 12l6-6',
  kitreparateur: WEAPON_GLYPHS.reparateur,
  kitbalise: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8',
  canoniem: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M13 6l-4 7h4l-2 5',
  gel: 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2',
  vacarme: 'M2 8.5v3M2 10h12M14 9.5c3 0 5-2 8-4.5v10c-3-2.5-5-4.5-8-4.5M7 10V6M10 10V6M13 10V6M6 6h2M9 6h2M12 6h2M5 10v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3.5',
  cone: 'M12 3L4 17M12 3l8 14M4 17a8 3 0 0 0 16 0M12 3v17',
  zproxi: 'M3 17l3 3 10-10 2-6-6 2zM17 15v6M14 18h6',
  zdist: 'M2 9h9M7 5l4 4-4 4M14 2v12M18 15v6M15 18h6',
  zblindage: 'M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6zM8 10h8M8 14h8',
  titane: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8l4 2.3v4.6L12 17l-4-2.1v-4.6z',
  deploiement: 'M3 6l6 6-6 6M11 6l6 6-6 6M19 6v12',
  sonderobuste: 'M7 14a5 5 0 0 1 10 0v2H7zM9 16l-2 4M15 16l2 4M12 9V5M9 5h6M5 9l2 2M19 9l-2 2',
  podsuperieur: 'M3 19h18M5 19v-4a7 7 0 0 1 14 0v4M12 2v6M9 5l3-3 3 3',
  optimisationp: 'M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  rquadripode: 'M7 8h10v5H7zM7 13l-3 6M17 13l3 6M10 13l-1 6M14 13l1 6',
  rhexapode: 'M7 8h10v5H7zM7 13l-3 6M17 13l3 6M10 13l-1 6M14 13l1 6M7 10H2M17 10h5',
  rcoleoptere: 'M4 15a8 7 0 0 1 16 0zM12 8v7M7 15l-2 5M17 15l2 5M12 8l-3-4M12 8l3-4',
  roctopode: 'M12 7.5c1.8 0 2.8 2 2.8 4.5S13.8 16.5 12 16.5 9.2 14.5 9.2 12 10.2 7.5 12 7.5zM13.3 9.1L15.7 7.1L13.2 1.6M14.2 10.8L18.1 9.9L20.2 6.8M14.2 13.2L18.1 14.1L20.2 17.2M13.3 14.9L15.7 16.9L13.2 22.4M10.7 9.1L8.3 7.1L10.8 1.6M9.8 10.8L5.9 9.9L3.8 6.8M9.8 13.2L5.9 14.1L3.8 17.2M10.7 14.9L8.3 16.9L10.8 22.4',
  rmastodonte: 'M2 8h20v7H2zM6 8V4h12v4M4 15v5M9 15v5M15 15v5M20 15v5',
  rbarge: 'M2 13h20l-4 6H6zM6 13V9h12v4M12 9V4M9 4h6',
};

/** A pictogram drawn in phosphor strokes on a 24 px box: the command's colour, so it inverts with the button. */
export function pictogram(d: string): string {
  return `<svg class="ico-weapon" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

/** A Z weapon's pictogram (WEAPON_GLYPHS), the one drawing used on the weapon panel, the command card and tooltips. */
export function weaponIcon(k?: string): string {
  return pictogram(WEAPON_GLYPHS[k ?? ''] ?? '');
}
