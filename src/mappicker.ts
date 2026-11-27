import { CORNERS, MAPS, type MapFile, buildMap, isImported, turnsOf } from './maps';
import { rotateFootprint } from './map';
import { TEAM_COLORS } from './render/models';
import { tileColor } from './terrain';
import { biomeOf } from './render/biome';
import './mappicker.css';

/** Most players a map takes. */
export const seatsOf = (def: MapFile) => Math.max(...def.players);

/** Pictures by map file (not by id: a map imported again under its id gets its new picture). */
const thumbs = new WeakMap<MapFile, string>();

/**
 * A top view of a map, drawn from its file: relief (in the colours of its planet), minerals, wells, the players'
 * starts and the other base spots. Returned as an image URL, made once per map.
 */
export function mapThumb(def: MapFile, px = 192): string {
  const done = thumbs.get(def);
  if (done) return done;
  const players = seatsOf(def);
  const planet = biomeOf(def);
  const map = buildMap(def, players, planet.id);
  const s = px / map.width;
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const col = tileColor(map, x, y, planet);
      const l = map.level[y * map.width + x];
      const edge = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => map.level[(y + dy) * map.width + x + dx] < l && !map.ramp[(y + dy) * map.width + x + dx]);
      if (edge) col.multiplyScalar(0.45);
      g.fillStyle = `#${col.getHexString()}`;
      g.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s));
    }
  }
  const dot = (tx: number, ty: number, size: number, color: string, r: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.arc((tx + size / 2) * s, (ty + size / 2) * s, r, 0, Math.PI * 2);
    g.fill();
  };
  for (const q of turnsOf(def, players)) {
    for (const b of def.bases) {
      for (const [x, y] of b.minerals) dot(...rotateFootprint(map.width, x, y, 1, q), 1, '#6fd3ff', Math.max(1, s * 0.6));
      for (const [x, y] of b.wells) dot(...rotateFootprint(map.width, x, y, 3, q), 3, '#5be07c', Math.max(2, s * 1.4));
    }
  }
  for (const site of map.sites ?? []) {
    const [x, y] = site.hq;
    const seat = CORNERS.indexOf(site.turn);
    g.lineWidth = Math.max(1.5, s);
    if (site.start && seat < players) {
      g.fillStyle = `#${TEAM_COLORS[seat].toString(16).padStart(6, '0')}`;
      g.strokeStyle = '#000';
      g.fillRect(x * s, y * s, 5 * s, 5 * s);
      g.strokeRect(x * s, y * s, 5 * s, 5 * s);
    } else {
      g.strokeStyle = '#ffffff';
      g.beginPath();
      g.arc((x + 2.5) * s, (y + 2.5) * s, 2.6 * s, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const url = c.toDataURL();
  thumbs.set(def, url);
  return url;
}

const playersOf = (m: MapFile) => (m.players.length > 1 ? `${Math.min(...m.players)}–${seatsOf(m)}` : `${m.players[0]}`);

/** The fixed panel: the map in large, with what it is played with (its planet, players, size, bases, description). */
function mapView(m: MapFile): string {
  const bases = m.bases.length;
  return `<img src="${mapThumb(m)}" alt="">
    <div class="map-view-text">
      <span class="map-name">${m.name}${isImported(m) ? ' <span class="map-imported">importée</span>' : ''}</span>
      <dl>
        <dt>Planète</dt><dd>${biomeOf(m).name}</dd>
        <dt>Joueurs</dt><dd>${playersOf(m)}</dd>
        <dt>Taille</dt><dd>${m.size}×${m.size}</dd>
        <dt>Bases</dt><dd>${bases} chacun</dd>
      </dl>
      ${m.description ? `<p class="map-desc">${m.description}</p>` : ''}
    </div>`;
}

/**
 * The maps as a list that scrolls (picture, name, players, size; the chosen one lit) beside a fixed panel showing the map
 * hovered, focused or chosen in large (the user's request, 2026-11-27: the row of cards grew too long). With `count`,
 * those that do not play at that count are listed but cannot be picked. wireMaps makes the panel follow.
 */
export function mapCards(chosen: string, count?: number): string {
  const rows = Object.values(MAPS)
    .map((m) => {
      const off = count !== undefined && !m.players.includes(count);
      return `<button type="button" class="map-card${m.id === chosen ? ' chosen' : ''}" data-map="${m.id}"${off ? ` disabled title="Ne se joue pas à ${count}"` : ''}>
        <img src="${mapThumb(m)}" alt="">
        <span class="map-name">${m.name}${isImported(m) ? ' <span class="map-imported">importée</span>' : ''}</span>
        <span class="map-meta">${playersOf(m)} j. · ${m.size}×${m.size}</span>
      </button>`;
    })
    .join('');
  const shown = MAPS[chosen] ?? Object.values(MAPS)[0];
  return `<div class="map-list" role="listbox">${rows}</div><div class="map-view" aria-live="polite">${shown ? mapView(shown) : ''}</div>`;
}

/** A map was picked from the keyboard: the list redrawn, the focus goes back to it. */
let refocus = false;

/**
 * The panel follows the map under the pointer or the keyboard focus and comes back to the chosen one when they leave;
 * the arrows move through the list (Entrée picks, as a click does). The chosen map is scrolled into view and, when the
 * list had the focus before a redraw, focused again. Again after each redraw.
 */
export function wireMaps(box: HTMLElement | null): void {
  const list = box?.querySelector<HTMLElement>('.map-list');
  const view = box?.querySelector<HTMLElement>('.map-view');
  if (!box || !list || !view) return;
  const chosen = list.querySelector<HTMLElement>('.map-card.chosen');
  let shown = chosen?.dataset.map;
  const show = (id: string | undefined) => {
    if (!id || id === shown || !Object.hasOwn(MAPS, id)) return;
    shown = id;
    view.innerHTML = mapView(MAPS[id]);
  };
  const back = () => show(chosen?.dataset.map);
  const cardOf = (e: Event) => (e.target as HTMLElement).closest<HTMLElement>('.map-card');
  list.onpointerover = (e) => show(cardOf(e)?.dataset.map);
  list.onpointerleave = () => (list.contains(document.activeElement) ? show((document.activeElement as HTMLElement).dataset.map) : back());
  // The list is new at each redraw: its listeners go with it.
  list.addEventListener('focusin', (e) => show(cardOf(e)?.dataset.map));
  list.addEventListener('focusout', (e) => {
    if (!list.contains(e.relatedTarget as Node)) back();
  });
  // Runs before the menu's own click (it redraws): a click without a pointer (detail 0) is Entrée or Espace.
  list.onclick = (e) => (refocus = (e as MouseEvent).detail === 0);
  list.onkeydown = (e) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const cards = [...list.querySelectorAll<HTMLButtonElement>('.map-card')];
    const at = cards.indexOf(document.activeElement as HTMLButtonElement);
    const next = cards[Math.max(0, Math.min(cards.length - 1, (at < 0 ? cards.indexOf(chosen as HTMLButtonElement) : at) + step))];
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: 'nearest' });
  };
  if (!chosen) return;
  // Into view inside the list only (it is the cards' offsetParent), never scrolling the page.
  const top = chosen.offsetTop;
  if (top < list.scrollTop || top + chosen.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - (list.clientHeight - chosen.offsetHeight) / 2;
  if (refocus) chosen.focus({ preventScroll: true });
  refocus = false;
}
