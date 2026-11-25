/**
 * The editor's frame: menu bar, toolbar, docked panels (dockview), status bar, keyboard shortcuts, messages. The
 * panels' insides are in panels.ts, the windows in windows.ts.
 */
import type { DockviewApi } from 'dockview-core';
// The browser bundle: it carries dockview's stylesheet, which the package's ES module does not.
import { createDockview, themeDark } from 'dockview-core/dist/dockview-core.js';
import { MAPS } from '../maps';
import { BIOMES } from '../render/biome';
import { checkMap, PLANETS } from '../mapcheck';
import { addMap, isImported, MAX_IMPORTED } from '../maps';
import { unplayable } from '../mapplay';
import { fromFormat1, MAX_SIZE, parseMap, type Symmetry, blankMap, toFormat1 } from './format2';
import { act, changed, ed, onChanged, type Tool, TOOL_HELP, TOOL_NAMES } from './state';
import { layersPanel, minimapPanel, palettePanel, playersPanel, propertiesPanel, setPlayers } from './panels';
import { dialog, keysHelp, mapProperties, playability, teamsWindow, techTree } from './windows';
import './editor.css';

export interface Shell {
  /** The minimap's canvas. */
  minimap: HTMLCanvasElement;
  /** The flat view's canvas (the view from above). */
  flat: HTMLCanvasElement;
  say(text: string): void;
  /** The status bar drawn again (cursor moved). */
  status(): void;
  /** Whether the keyboard goes to the map (not to a field). */
  viewFocused(): boolean;
}
interface ViewHooks {
  canvas: HTMLCanvasElement;
  pointer: { down(e: PointerEvent): void; move(e: PointerEvent): void; up(): void; wheel(e: WheelEvent): void; leave(): void };
  minimapLook(e: PointerEvent): void;
  resize(w: number, h: number): void;
  removeSelected(): void;
  keys: Set<string>;
  stats(): { building: boolean; buildMs: number; terrain: number; rest: number; sync: number };
}

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
/** A shortcut as shown in menus: ⌘ on a Mac, Ctrl elsewhere. */
const keyName = (k: string) => (MAC ? k : k.replace('⌘', 'Ctrl+').replace('⇧', 'Maj+').replace('⌥', 'Alt+'));
const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// ---- files ----
function download(name: string, data: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const json = (v: unknown) => new Blob([JSON.stringify(v, null, 1)], { type: 'application/json' });
function save(): void {
  download(`${ed.f.id}.editeur.json`, json(ed.f));
  ed.saved = true;
  ed.file = `${ed.f.id}.editeur.json`;
  act.say(`Enregistré : ${ed.file} (dossier des téléchargements).`);
  changed();
}
function saveAs(): void {
  const body = h(`<div class="form"><label>Identifiant du fichier <input type="text" value="${esc(ed.f.id)}" pattern="[a-z0-9-]+"></label><p class="note">Lettres minuscules, chiffres et tirets. Le navigateur enregistre dans le dossier des téléchargements.</p></div>`);
  dialog('Enregistrer sous', body, [{ label: 'Annuler' }, {
    label: 'Enregistrer', main: true, run: () => {
      const id = body.querySelector('input')!.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
      if (!id) return false;
      ed.f.id = id;
      save();
    },
  }]);
}
/** The format 1 file the game imports, checked as the game will check it; null (and why) if it would be refused. */
function gameFile(): { def: ReturnType<typeof toFormat1>['map']; notes: string[] } | null {
  try {
    const { map, notes } = toFormat1(ed.f);
    const checked = checkMap(JSON.parse(JSON.stringify(map)));
    if (typeof checked === 'string') throw new Error(checked);
    return { def: map, notes };
  } catch (err) {
    act.say(`Export pour le jeu impossible : ${(err as Error).message}`);
    return null;
  }
}
function exportGame(): void {
  const g = gameFile();
  if (!g) return;
  download(`${g.def.id}.json`, json(g.def));
  act.say(['Exporté pour le jeu : à importer par « Importer une carte » dans le menu du jeu.', ...g.notes].join(' '));
}
/** The map put among this browser's imported maps, and a match on it opened in a new tab. */
function testMap(spectate: boolean): void {
  const g = gameFile();
  if (!g) return;
  const def = checkMap(JSON.parse(JSON.stringify(g.def)));
  if (typeof def === 'string') return act.say(def);
  const why = unplayable(def);
  if (why) return act.say(`La carte ne se joue pas : ${why}`);
  if (!Object.values(MAPS).some((m) => m.id === def.id) && Object.values(MAPS).filter(isImported).length >= MAX_IMPORTED) {
    return act.say(`Le jeu garde ${MAX_IMPORTED} cartes importées au plus : en supprimer une dans son menu d'abord.`);
  }
  if (!addMap(def, true)) return act.say('Le navigateur refuse de garder la carte (stockage plein ou désactivé).');
  const race = (i: number) => ed.f.players[i]?.race || 'humains';
  const q = spectate ? `?spectate&map=${def.id}&ai0=normal&ai1=normal` : `?play&map=${def.id}&camp=${race(0)}&adversaire=${race(1)}`;
  window.open(`${import.meta.env.BASE_URL}${q}`, '_blank');
  act.say(`Partie lancée dans un nouvel onglet, sur « ${def.name} »${g.notes.length ? ` (${g.notes.join(' ')})` : ''}.`);
}
const picker = h('<input type="file" accept=".json,application/json" hidden>') as HTMLInputElement;
document.body.appendChild(picker);
picker.onchange = async () => {
  const file = picker.files?.[0];
  picker.value = '';
  if (!file) return;
  try {
    if (file.size > 4_000_000) throw new Error('Fichier trop gros (4 Mo au plus).');
    const next = parseMap(JSON.parse(await file.text()), (d) => {
      const c = checkMap(d, false); // a format 1 file from outside: checked as the game checks it
      if (typeof c === 'string') throw new Error(c);
      return fromFormat1(c);
    });
    act.open(next, file.name);
    act.say(`Ouvert : ${next.name}`);
  } catch (err) {
    act.say(`Fichier refusé : ${(err as Error).message}`);
  }
};
function newMap(): void {
  const body = h(`<div class="form">
    <label>Taille (tuiles) <input type="number" min="32" max="${MAX_SIZE}" step="8" value="96"></label>
    <label>Biome <select>${PLANETS.map((id) => `<option value="${id}"${id === ed.f.biome ? ' selected' : ''}>${esc(BIOMES[id]?.name ?? id)}</option>`).join('')}</select></label>
  </div>`);
  dialog('Nouvelle carte', body, [{ label: 'Annuler' }, {
    label: 'Créer', main: true, run: () => {
      const n = Math.max(32, Math.min(MAX_SIZE, Math.round(Number(body.querySelector('input')!.value) || 96)));
      act.open(blankMap(n, body.querySelector('select')!.value), 'sans-titre');
    },
  }]);
}
function openGameMap(id: string): void {
  if (!ed.saved && !confirmLoss()) return;
  act.open(fromFormat1(MAPS[id], MAPS[id].biome), MAPS[id].name);
}
/** Asked before throwing away unsaved work (an inline question would need its own window: the browser's is enough here). */
const confirmLoss = () => window.confirm('Les changements non enregistrés seront perdus. Continuer ?');

// ---- menus ----
interface Item {
  label: string | (() => string);
  key?: string;
  run?: () => void;
  off?: () => boolean;
  on?: () => boolean;
  sub?: () => Item[];
}
const SEP: Item = { label: '-' };

function setTool(t: Tool): void {
  ed.tool = t;
  if (t !== 'select') ed.selection = null;
  act.redrawThings();
}
function toggleView(): void {
  ed.view = ed.view === '3d' ? 'top' : '3d';
  changed();
}
function toggleLayer(l: 'grid'): void {
  if (ed.hidden.has(l)) ed.hidden.delete(l);
  else ed.hidden.add(l);
  act.redrawThings();
}

let dock: DockviewApi;
let hooks: ViewHooks;
let clipboard: { kind: 'unit' | 'decor'; data: unknown } | null = null;
function copy(): boolean {
  const s = ed.selection;
  if (s?.kind === 'unit') clipboard = { kind: 'unit', data: structuredClone(ed.f.units[s.i]) };
  else if (s?.kind === 'decor') clipboard = { kind: 'decor', data: structuredClone(ed.f.decor[s.i]) };
  else return false;
  return true;
}
function paste(dx = 0, dy = 0): void {
  if (!clipboard) return;
  const thing = structuredClone(clipboard.data) as { at: [number, number] };
  const at = hoverAt() ?? [thing.at[0] + dx, thing.at[1] + dy];
  thing.at = [Math.max(0, Math.min(ed.f.size - 1, at[0])), Math.max(0, Math.min(ed.f.size - 1, at[1]))];
  act.snapshot();
  const list = (clipboard.kind === 'unit' ? ed.f.units : ed.f.decor) as unknown[];
  list.push(thing);
  ed.selection = { kind: clipboard.kind, i: list.length - 1 };
  act.redrawThings();
}
/** The tile under the pointer, from the status text (the view keeps it). */
const hoverAt = (): [number, number] | null => {
  const m = /\((\d+), (\d+)\)/.exec(ed.hover);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

function menus(): [string, Item[]][] {
  const sel = () => !!ed.selection;
  return [
    ['Fichier', [
      { label: 'Nouvelle carte…', key: '⌥N', run: () => (ed.saved || confirmLoss()) && newMap() },
      { label: 'Ouvrir…', key: '⌘O', run: () => (ed.saved || confirmLoss()) && picker.click() },
      { label: 'Ouvrir une carte du jeu', sub: () => Object.values(MAPS).filter((m) => !isImported(m)).map((m) => ({ label: m.name, run: () => openGameMap(m.id) })) },
      SEP,
      { label: 'Enregistrer', key: '⌘S', run: save },
      { label: 'Enregistrer sous…', key: '⇧⌘S', run: saveAs },
      SEP,
      { label: 'Importer une carte du jeu (format 1)…', run: () => (ed.saved || confirmLoss()) && picker.click() },
      { label: 'Exporter pour le jeu…', key: '⌘E', run: exportGame },
      { label: 'Exporter une image de la vue…', run: () => hooks.canvas.toBlob((b) => b && download(`${ed.f.id}.png`, b)) },
      SEP,
      { label: 'Tester la carte', key: 'F9', run: () => testMap(false) },
      { label: 'Tester en spectateur (IA contre IA)', key: '⇧F9', run: () => testMap(true) },
    ]],
    ['Édition', [
      { label: 'Annuler', key: '⌘Z', run: () => act.undo(), off: () => !ed.undo.length },
      { label: 'Rétablir', key: '⇧⌘Z', run: () => act.redo(), off: () => !ed.redo.length },
      SEP,
      { label: 'Couper', key: '⌘X', run: () => copy() && hooks.removeSelected(), off: () => !['unit', 'decor'].includes(ed.selection?.kind ?? '') },
      { label: 'Copier', key: '⌘C', run: () => void copy(), off: () => !['unit', 'decor'].includes(ed.selection?.kind ?? '') },
      { label: 'Coller', key: '⌘V', run: () => paste(), off: () => !clipboard },
      { label: 'Dupliquer', key: '⌘D', run: () => copy() && paste(1, 1), off: () => !['unit', 'decor'].includes(ed.selection?.kind ?? '') },
      { label: 'Supprimer', key: '⌫', run: () => hooks.removeSelected(), off: () => !sel() },
      SEP,
      { label: 'Désélectionner', key: 'Échap', run: () => ((ed.selection = null), act.redrawThings()), off: () => !sel() },
    ]],
    ['Affichage', [
      { label: 'Vue 3D du jeu', key: 'Tab', on: () => ed.view === '3d', run: () => ed.view !== '3d' && toggleView() },
      { label: 'Vue de dessus', key: 'Tab', on: () => ed.view === 'top', run: () => ed.view !== 'top' && toggleView() },
      SEP,
      { label: 'Grille', key: 'G', on: () => !ed.hidden.has('grid'), run: () => toggleLayer('grid') },
      { label: 'Recentrer sur le départ du joueur', key: 'H', run: () => act.lookAt(ed.f.players[ed.seat].start[0] + 2, ed.f.players[ed.seat].start[1] + 2) },
      SEP,
      { label: 'Panneaux', sub: () => PANELS.map(([id, title]) => ({ label: title, on: () => !!dock.getPanel(id), run: () => showPanel(id) })) },
      { label: 'Réinitialiser la disposition', run: resetLayout },
    ]],
    ['Carte', [
      { label: 'Propriétés de la carte…', run: openProperties },
      { label: 'Biome', sub: () => PLANETS.map((id) => ({ label: BIOMES[id]?.name ?? id, on: () => ed.f.biome === id, run: () => setBiome(id) })) },
      { label: 'Symétrie', sub: () => (['none', 'rot180', 'rot90'] as Symmetry[]).map((s) => ({ label: SYM[s], on: () => ed.f.symmetry === s, run: () => setSymmetry(s) })) },
      SEP,
      { label: 'Vérifier la jouabilité', key: '⇧⌘V', run: () => playability(fullCheck) },
    ]],
    ['Joueurs', [
      { label: 'Nombre de joueurs', sub: () => [1, 2, 3, 4].map((n) => ({ label: String(n), on: () => ed.f.players.length === n, run: () => setPlayers(n) })) },
      { label: 'Arbre technologique…', key: '⌘K', run: () => techTree(ed.seat) },
      { label: 'Équipes et victoire…', run: teamsWindow },
    ]],
    ['Déclencheurs', [
      { label: 'Éditeur de déclencheurs…', key: '⌥T', off: () => true },
    ]],
    ['Aide', [
      { label: 'Raccourcis clavier', key: 'F1', run: keysHelp },
      { label: 'À propos de l\'éditeur', run: about },
    ]],
  ];
}
function openProperties(): void {
  mapProperties(act.picture(), PLANETS.map((id) => [id, BIOMES[id]?.name ?? id]), setPlayers);
}
/** Everything the game checks on an import, the players counts one by one, and what the export leaves out. */
function fullCheck(): { format: string | null; counts: [number, string | null][]; notes: string[] } {
  try {
    const { map, notes } = toFormat1(ed.f);
    const c = checkMap(JSON.parse(JSON.stringify(map)));
    if (typeof c === 'string') return { format: c, counts: [], notes };
    return { format: null, counts: c.players.map((k) => [k, unplayable({ ...c, players: [k] })?.replace(/^À \d+ joueurs : /, '') ?? null]), notes };
  } catch (e) {
    return { format: (e as Error).message, counts: [], notes: [] };
  }
}
export const SYM: Record<Symmetry, string> = { none: 'Aucune', rot180: 'Rotation 180° (2 parts)', rot90: 'Rotation 90° (4 parts)' };
function setBiome(id: string): void {
  act.snapshot();
  ed.f.biome = id;
  act.redrawAll();
}
function setSymmetry(s: Symmetry): void {
  act.snapshot();
  ed.f.symmetry = s;
  changed();
}
function about(): void {
  dialog('À propos de l\'éditeur', h(`<div class="form"><p>Éditeur de cartes de Xcraft. La vue est le rendu du jeu ; les panneaux sont faits avec dockview et Tweakpane (licences MIT).</p>
    <p>Le fichier de l'éditeur (format 2) garde tout ce qui se règle ici. « Exporter pour le jeu » écrit le format que le jeu importe (format 1) ; ce que le jeu ne lit pas encore est signalé à l'export.</p>
    <p class="note">Page de test : elle n'est liée nulle part dans le jeu.</p></div>`), [{ label: 'Fermer', main: true }]);
}

let openMenu: HTMLElement | null = null;
function closeMenus(): void {
  openMenu?.remove();
  openMenu = null;
  document.querySelectorAll('.menubar > span.on').forEach((e) => e.classList.remove('on'));
}
function dropdown(items: Item[], x: number, y: number, nested = false): HTMLElement {
  const box = h('<div class="dropdown"></div>');
  for (const it of items) {
    if (it === SEP) {
      box.appendChild(h('<div class="sep"></div>'));
      continue;
    }
    const off = it.off?.() ?? false;
    const label = typeof it.label === 'function' ? it.label() : it.label;
    const row = h(`<div class="item${off ? ' off' : ''}"><i>${it.on?.() ? '✓' : ''}</i><span>${esc(label)}</span><b>${it.sub ? '▸' : it.key ? esc(keyName(it.key)) : ''}</b></div>`);
    if (it.sub) {
      row.onmouseenter = () => {
        box.querySelectorAll('.dropdown').forEach((d) => d.remove());
        const r = row.getBoundingClientRect();
        const sub = dropdown(it.sub!(), r.right - 2, r.top - 4, true);
        box.appendChild(sub);
      };
    } else {
      row.onmouseenter = () => box.querySelectorAll(':scope > .dropdown').forEach((d) => d.remove());
      if (!off) {
        row.onclick = (e) => {
          e.stopPropagation();
          closeMenus();
          it.run?.();
          changed();
        };
      }
    }
    box.appendChild(row);
  }
  Object.assign(box.style, { left: `${x}px`, top: `${y}px` });
  if (!nested) document.body.appendChild(box);
  return box;
}
function menubar(): HTMLElement {
  const bar = h('<div class="menubar"></div>');
  for (const [name, items] of menus()) {
    const m = h(`<span>${name}</span>`);
    const show = () => {
      closeMenus();
      m.classList.add('on');
      const r = m.getBoundingClientRect();
      openMenu = dropdown(menus().find((x) => x[0] === name)![1], r.left, r.bottom);
      void items;
    };
    m.onmousedown = (e) => {
      e.stopPropagation();
      if (m.classList.contains('on')) closeMenus();
      else show();
    };
    m.onmouseenter = () => openMenu && !m.classList.contains('on') && show();
    bar.appendChild(m);
  }
  bar.appendChild(h('<div class="file"></div>'));
  return bar;
}
addEventListener('mousedown', (e) => {
  if (openMenu && !(e.target as HTMLElement).closest('.dropdown')) closeMenus();
});

/** Every shortcut of the menus, found by its key. */
function shortcut(e: KeyboardEvent): boolean {
  const name = `${e.altKey ? '⌥' : ''}${e.shiftKey ? '⇧' : ''}${e.metaKey || e.ctrlKey ? '⌘' : ''}${e.key.length === 1 ? e.key.toUpperCase() : e.key}`;
  const alias: Record<string, string> = { Delete: '⌫', Backspace: '⌫', Escape: 'Échap', '⇧⌘Z': '⇧⌘Z' };
  const want = alias[name] ?? name;
  const all = (items: Item[]): Item[] => items.flatMap((i) => (i.sub ? [] : [i]));
  for (const [, items] of menus()) {
    for (const it of all(items)) {
      if (!it.key || it.key === 'Tab' || it.off?.()) continue; // Tab: handled below, it switches either way
      const k = it.key.replace('Tab', 'Tab');
      if (k === want || (it.key === '⌥N' && e.altKey && e.code === 'KeyN') || (it.key === '⌥T' && e.altKey && e.code === 'KeyT')) {
        it.run?.();
        changed();
        return true;
      }
    }
  }
  return false;
}

// ---- toolbar ----
const TOOLBAR: [Tool, string][] = [['select', '⬚'], ['relief', '⛰'], ['ramp', '◢'], ['minerai', '◆'], ['puits', '✺'], ['base', '▢'], ['depart', '⚑'], ['decor', '🌵'], ['unite', '⚔']];
function toolbar(): HTMLElement {
  const bar = h('<div class="toolbar"></div>');
  const btn = (icon: string, label: string, run: () => void, cls = '') => {
    const b = h(`<button class="tb ${cls}" title="${esc(label)}"><i>${icon}</i><span>${esc(label)}</span></button>`) as HTMLButtonElement;
    b.onclick = () => {
      run();
      changed();
    };
    bar.appendChild(b);
    return b;
  };
  const sep = () => bar.appendChild(h('<div class="sep"></div>'));
  btn('🗋', 'Nouvelle', () => (ed.saved || confirmLoss()) && newMap());
  btn('📂', 'Ouvrir', () => (ed.saved || confirmLoss()) && picker.click());
  btn('💾', 'Enregistrer', save);
  sep();
  const undo = btn('↶', 'Annuler', () => act.undo());
  const redo = btn('↷', 'Rétablir', () => act.redo());
  sep();
  const tools = TOOLBAR.map(([t, icon]) => [t, btn(icon, TOOL_NAMES[t], () => setTool(t))] as const);
  sep();
  const sym = h(`<label class="combo">Symétrie<select>${(['none', 'rot180', 'rot90'] as Symmetry[]).map((s) => `<option value="${s}">${SYM[s]}</option>`).join('')}</select></label>`);
  sym.querySelector('select')!.onchange = (e) => setSymmetry((e.target as HTMLSelectElement).value as Symmetry);
  bar.appendChild(sym);
  const bio = h(`<label class="combo">Biome<select>${PLANETS.map((id) => `<option value="${id}">${esc(BIOMES[id]?.name ?? id)}</option>`).join('')}</select></label>`);
  bio.querySelector('select')!.onchange = (e) => setBiome((e.target as HTMLSelectElement).value);
  bar.appendChild(bio);
  sep();
  const gridB = btn('▦', 'Grille', () => toggleLayer('grid'));
  const viewB = btn('⇄', 'Vue de dessus', toggleView);
  sep();
  const trig = btn('⚡', 'Déclencheurs', () => {});
  trig.disabled = true;
  btn('🌳', 'Arbre techno', () => techTree(ed.seat));
  btn('⚑', 'Équipes', teamsWindow);
  const play = h('<div class="playable" title=""></div>');
  play.onclick = () => playability(fullCheck);
  bar.appendChild(play);
  const test = h('<button class="test">▶ Tester la carte (F9)</button>');
  test.onclick = () => testMap(false);
  bar.appendChild(test);
  onChanged(() => {
    undo.disabled = !ed.undo.length;
    redo.disabled = !ed.redo.length;
    for (const [t, b] of tools) b.classList.toggle('on', ed.tool === t);
    sym.querySelector('select')!.value = ed.f.symmetry;
    bio.querySelector('select')!.value = ed.f.biome;
    gridB.classList.toggle('on', !ed.hidden.has('grid'));
    viewB.querySelector('span')!.textContent = ed.view === '3d' ? 'Vue de dessus' : 'Vue 3D';
    viewB.classList.toggle('on', ed.view === 'top');
    play.className = `playable ${ed.playable === true ? 'ok' : ed.playable ? 'bad' : ''}`;
    play.textContent = ed.playable === true ? `✔ Jouable (${ed.f.players.length} j.)` : ed.playable ? '✕ Pas jouable' : '…';
    play.title = typeof ed.playable === 'string' ? ed.playable : '';
  });
  return bar;
}

// ---- docked panels ----
// In the order the default layout adds them: the side columns full height, the players under the view only.
const PANELS: [string, string][] = [['vue', 'Vue'], ['palette', 'Palette'], ['minicarte', 'Minicarte'], ['proprietes', 'Propriétés'], ['calques', 'Calques'], ['joueurs', 'Joueurs']];
const LAYOUT_KEY = 'xcraft.editeur.disposition';
const viewRoot = h('<div class="viewroot" tabindex="0"></div>');
const flat = document.createElement('canvas');
flat.className = 'flat';
const minimap = document.createElement('canvas');
minimap.className = 'minimap';
const bodies: Record<string, () => HTMLElement> = {
  vue: () => viewRoot,
  palette: palettePanel,
  joueurs: playersPanel,
  minicarte: () => minimapPanel(minimap),
  proprietes: propertiesPanel,
  calques: layersPanel,
};
function addPanel(id: string): void {
  const title = PANELS.find((p) => p[0] === id)![1];
  const at: Record<string, object> = {
    palette: { position: { referencePanel: 'vue', direction: 'left' }, initialWidth: 300 },
    minicarte: { position: { referencePanel: 'vue', direction: 'right' }, initialWidth: 320 },
    proprietes: { position: { referencePanel: 'minicarte', direction: 'below' } },
    calques: { position: { referencePanel: 'proprietes', direction: 'below' } },
    joueurs: { position: { referencePanel: 'vue', direction: 'below' }, initialHeight: 190 },
  };
  const ref = (at[id] as { position?: { referencePanel: string } } | undefined)?.position?.referencePanel;
  dock.addPanel({ id, component: id, title, ...(ref && !dock.getPanel(ref) ? {} : at[id]) });
}
function showPanel(id: string): void {
  const p = dock.getPanel(id);
  if (p) p.api.setActive();
  else addPanel(id);
}
function defaultLayout(): void {
  dock.clear();
  for (const [id] of PANELS) addPanel(id);
  dock.getPanel('vue')?.api.setActive();
}
function resetLayout(): void {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    // no storage: nothing kept anyway
  }
  defaultLayout();
}

// ---- messages and status ----
const msg = h('<div class="toast" hidden></div>');
let msgTimer = 0;
function say(text: string): void {
  msg.textContent = text;
  msg.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (msg.hidden = true), Math.max(5000, text.length * 70));
}
const statusBar = h('<div class="statusbar"></div>');
const SEL_NAMES = { unit: 'unité', decor: 'décor', base: 'base libre', start: 'départ', well: 'puits', ramp: 'rampe', mineral: 'minerai' };
function status(): void {
  const f = ed.f;
  const s = hooks.stats();
  const parts = [
    ed.hover || 'Curseur hors de la carte',
    `Outil : ${TOOL_NAMES[ed.tool]}${ed.tool === 'relief' || ed.tool === 'minerai' ? `, pinceau ${ed.round ? 'rond' : 'carré'} ${ed.brush}` : ''}`,
    `Symétrie : ${SYM[f.symmetry]}`,
    `${f.size} × ${f.size} · ${BIOMES[f.biome]?.name ?? f.biome} · ${f.players.length} joueur${f.players.length > 1 ? 's' : ''}`,
    ed.selection ? `Sélection : ${SEL_NAMES[ed.selection.kind]}` : 'Aucune sélection',
  ];
  statusBar.replaceChildren(...parts.map((p) => h(`<span>${esc(p)}</span>`)));
  const play = h(`<span class="${ed.playable === true ? 'ok' : ed.playable ? 'bad' : ''}">${ed.playable === true ? '✔ Jouable' : ed.playable ? `✕ ${esc(ed.playable)}` : 'Vérification…'}</span>`);
  statusBar.append(play, h(`<span class="right">${esc(ed.file)}${ed.saved ? '' : ' · modifiée'}</span>`), h(`<span>${s.building ? 'dessin…' : `${s.buildMs} ms`}</span>`));
}

export function buildShell(v: ViewHooks): Shell {
  hooks = v;
  const app = h('<div class="app"></div>');
  const host = h('<div class="dock"></div>');
  app.append(menubar(), toolbar(), host, statusBar);
  document.body.append(app, msg);
  // The view: the 3D canvas or the flat one, a bar with the switch, a hint.
  const bar = h('<div class="viewbar"><button class="switch"><b>Vue 3D du jeu</b><em>⇄</em><span>Vue de dessus</span></button><span class="hint">Tab pour basculer</span><button class="again">⟲ Recentrer</button></div>');
  bar.querySelector<HTMLButtonElement>('.switch')!.onclick = toggleView;
  bar.querySelector<HTMLButtonElement>('.again')!.onclick = () => act.lookAt(ed.f.players[ed.seat].start[0] + 2, ed.f.players[ed.seat].start[1] + 2);
  const help = h('<div class="toolhelp"></div>');
  viewRoot.append(v.canvas, flat, bar, help);
  for (const c of [v.canvas, flat]) {
    c.addEventListener('pointerdown', v.pointer.down);
    c.addEventListener('pointermove', v.pointer.move);
    c.addEventListener('pointerup', v.pointer.up);
    c.addEventListener('pointerleave', v.pointer.leave);
    c.addEventListener('wheel', v.pointer.wheel, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  new ResizeObserver(() => {
    const r = viewRoot.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    v.resize(r.width, r.height);
    const dpr = Math.min(2, devicePixelRatio);
    flat.width = Math.round(r.width * dpr);
    flat.height = Math.round(r.height * dpr);
  }).observe(viewRoot);
  minimap.addEventListener('pointerdown', (e) => {
    v.minimapLook(e);
    try {
      minimap.setPointerCapture(e.pointerId);
    } catch {
      // as above
    }
  });
  minimap.addEventListener('pointermove', (e) => e.buttons && v.minimapLook(e));
  new ResizeObserver(() => {
    const r = minimap.getBoundingClientRect();
    minimap.width = Math.round(r.width * Math.min(2, devicePixelRatio));
    minimap.height = Math.round(r.height * Math.min(2, devicePixelRatio));
  }).observe(minimap);

  dock = createDockview(host, {
    theme: themeDark,
    createComponent: (o) => {
      const el = h('<div class="panel"></div>');
      el.appendChild(bodies[o.name]());
      return { element: el, init: () => {} };
    },
  });
  try {
    const saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) dock.fromJSON(JSON.parse(saved));
    else defaultLayout();
    if (!dock.getPanel('vue')) defaultLayout();
  } catch {
    defaultLayout();
  }
  dock.onDidLayoutChange(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(dock.toJSON()));
    } catch {
      // no storage: the layout is not kept
    }
  });

  onChanged(() => {
    v.canvas.hidden = ed.view !== '3d';
    flat.hidden = ed.view !== 'top';
    bar.querySelector('.switch')!.innerHTML = ed.view === '3d' ? '<b>Vue 3D du jeu</b><em>⇄</em><span>Vue de dessus</span>' : '<span>Vue 3D du jeu</span><em>⇄</em><b>Vue de dessus</b>';
    help.textContent = TOOL_HELP[ed.tool];
    menubarFile();
    status();
  });
  const menubarFile = () => (app.querySelector('.menubar .file')!.textContent = `${ed.f.name} — ${ed.file}${ed.saved ? '' : ' · modifiée'}`);

  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
    if (document.querySelector('dialog[open]') && !e.metaKey && !e.ctrlKey) return;
    if (typing && !(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'Escape' && openMenu) return closeMenus();
    if (shortcut(e)) return e.preventDefault();
    if (typing) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      return toggleView();
    }
    v.keys.add(e.key);
    if (e.key === 'g' || e.key === 'G') toggleLayer('grid');
    if (e.key === 'h' || e.key === 'H') act.lookAt(ed.f.players[ed.seat].start[0] + 2, ed.f.players[ed.seat].start[1] + 2);
    if (e.key === '[' || e.key === ']') {
      ed.brush = Math.max(1, Math.min(15, ed.brush + (e.key === ']' ? 1 : -1)));
      changed();
    }
    if (ed.tool === 'relief' && ['0', '1', '2', 'x', 'X'].includes(e.key)) {
      ed.paint = e.key.toLowerCase();
      changed();
    }
  });
  addEventListener('keyup', (e) => v.keys.delete(e.key));
  addEventListener('blur', () => v.keys.clear());
  return {
    minimap,
    flat,
    say,
    status,
    viewFocused: () => {
      const a = document.activeElement as HTMLElement | null;
      return !a || a === document.body || !!a.closest('.viewroot');
    },
  };
}
