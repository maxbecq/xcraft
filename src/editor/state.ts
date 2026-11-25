/**
 * What the editor's parts share: the file being edited, the tool and its settings, what is shown, what is selected.
 * The view (main.ts) and the panels (shell.ts, panels.ts) read it; a change is announced with `changed`, and each
 * part draws itself again.
 */
import type { Dir } from '../map';
import { MAPS } from '../maps';
import { fromFormat1, type MapFile2 } from './format2';

export type Tool = 'select' | 'relief' | 'ramp' | 'minerai' | 'puits' | 'base' | 'depart' | 'decor' | 'unite';
export const TOOL_NAMES: Record<Tool, string> = {
  select: 'Sélection', relief: 'Relief', ramp: 'Rampe', minerai: 'Minerai', puits: 'Puits', base: 'Base libre', depart: 'Départ', decor: 'Décor', unite: 'Unités',
};
export const TOOL_HELP: Record<Tool, string> = {
  select: 'Clic : choisir un objet (unité, décor, départ, base, puits, rampe, minerai). Suppr : l\'enlever.',
  relief: 'Clic : peindre. Clic droit : remettre au niveau 0. Touches 0, 1, 2, X : niveau ou gouffre ; [ ] : taille.',
  ramp: 'Clic : rampe dont la tuile du haut est sous le curseur. Clic droit : l\'enlever.',
  minerai: 'Clic : poser du minerai. Clic droit : en enlever.',
  puits: 'Clic : puits d\'énergie 3×3 centré sur le curseur. Clic droit : l\'enlever.',
  base: 'Clic : emplacement de base libre (QG 4×4). Clic droit : l\'enlever.',
  depart: 'Clic : départ du joueur choisi (QG 4×4). Avec une symétrie, le départ du joueur 1 place les autres.',
  decor: 'Clic : poser l\'objet. Clic droit : enlever le plus proche.',
  unite: 'Clic : poser pour le propriétaire choisi. Clic droit : enlever le plus proche.',
};

/** What can be shown or hidden, locked or not (the « Calques » panel). */
export type Layer = 'relief' | 'ramps' | 'resources' | 'decorPlaced' | 'decorSeeded' | 'units' | 'starts' | 'grid';
export const LAYERS: { id: Layer; name: string; hide: boolean; lock: boolean }[] = [
  { id: 'relief', name: 'Relief et gouffres', hide: false, lock: true },
  { id: 'ramps', name: 'Rampes', hide: false, lock: true },
  { id: 'resources', name: 'Ressources', hide: true, lock: true },
  { id: 'decorPlaced', name: 'Décor posé', hide: true, lock: true },
  { id: 'decorSeeded', name: 'Décor semé par le biome', hide: true, lock: false },
  { id: 'units', name: 'Unités et bâtiments placés', hide: true, lock: true },
  { id: 'starts', name: 'Départs et bases libres', hide: true, lock: true },
  { id: 'grid', name: 'Grille', hide: true, lock: false },
];
/** The layer a tool writes to. */
export const TOOL_LAYER: Record<Tool, Layer | null> = {
  select: null, relief: 'relief', ramp: 'ramps', minerai: 'resources', puits: 'resources', base: 'starts', depart: 'starts', decor: 'decorPlaced', unite: 'units',
};

/** One thing picked with the selection tool, by its place in the file's lists. */
export type Selection =
  | { kind: 'unit' | 'decor' | 'base' | 'well' | 'ramp' | 'mineral'; i: number }
  | { kind: 'start'; i: number };

export const ed = {
  f: fromFormat1(MAPS.origine, MAPS.origine.biome, 2) as MapFile2,
  tool: 'relief' as Tool,
  brush: 3,
  round: true,
  /** '0', '1', '2', 'x', or 'up' / 'down' (one level). */
  paint: '1',
  rampDir: 'N' as Dir,
  rampWidth: 3,
  /** The player the « Départ » tool and the players' table work on. */
  seat: 0,
  unitType: 'caserne',
  unitOwner: 0,
  decorType: 'rocks_a',
  view: '3d' as '3d' | 'top',
  hidden: new Set<Layer>(['grid']),
  locked: new Set<Layer>(),
  selection: null as Selection | null,
  /** Under the pointer: tile and what it is. */
  hover: '',
  /** Whether the game would play the map, and why not (checked a moment after each change). */
  playable: null as null | true | string,
  file: 'sans-titre',
  saved: true,
  undo: [] as string[],
  redo: [] as string[],
};

const listeners: (() => void)[] = [];
/** Calls `fn` after each change of the state (the panels draw themselves again). */
export const onChanged = (fn: () => void) => listeners.push(fn);
let queued = false;
/** Something changed: the panels draw again, once, on the next frame. */
export function changed(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    for (const fn of listeners) fn();
  });
}

/** What the view offers the panels (filled by main.ts). */
export interface Actions {
  /** Keeps the file as it is now for « Annuler »; call before changing it. */
  snapshot(): void;
  undo(): void;
  redo(): void;
  /** The whole file changed (or a part the view cannot follow): everything drawn again. */
  redrawAll(): void;
  /** Units, scenery, markers drawn again (not the terrain). */
  redrawThings(): void;
  /** A new file: new camera, everything drawn again. */
  open(f: MapFile2, name?: string): void;
  lookAt(x: number, y: number): void;
  /** Takes the selected thing out of the file. */
  removeSelected(): void;
  say(text: string): void;
}
export const act = {} as Actions;

/** Starts in a fixed order (top to bottom, then left to right): « Départ 1 » is the first. */
export function startNumbers(f: MapFile2): number[] {
  const order = f.players.map((p, i) => [p.start[1], p.start[0], i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((a) => a[2]);
  const num: number[] = [];
  order.forEach((player, k) => (num[player] = k + 1));
  return num;
}
