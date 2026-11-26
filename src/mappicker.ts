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

/** One card per map: its picture, name, planet, players, size and bases; the chosen one highlighted. */
/** The map cards; with `players`, those that do not play at that count are shown but cannot be picked. */
export function mapCards(chosen: string, count?: number): string {
  return Object.values(MAPS)
    .map((m) => {
      const off = count !== undefined && !m.players.includes(count);
      const bases = m.bases.length;
      const players = m.players.length > 1 ? `${Math.min(...m.players)}–${seatsOf(m)} joueurs` : `${m.players[0]} joueurs`;
      return `<button type="button" class="map-card${m.id === chosen ? ' chosen' : ''}" data-map="${m.id}" title="${off ? `Ne se joue pas à ${count}` : (m.description ?? '')}"${off ? ' disabled' : ''}>
        <img src="${mapThumb(m)}" alt="">
        <span class="map-name">${m.name}${isImported(m) ? ' <span class="map-imported">importée</span>' : ''}</span>
        <span class="map-meta">${biomeOf(m).name} · ${players} · ${m.size}×${m.size} · ${bases} base${bases > 1 ? 's' : ''} chacun</span>
      </button>`;
    })
    .join('');
}

/** Computers: the row of maps shows it scrolls (the user's request, 2026-11-24), a big arrow at its right end (a click
 * scrolls on) until the last map is in view, besides its scrollbar kept visible (mappicker.css). Again after each redraw. */
export function moreMaps(row: HTMLElement | null): void {
  if (!row || row.closest('.compact')) return;
  const arrow = document.createElement('button');
  arrow.type = 'button';
  arrow.className = 'maps-more';
  arrow.textContent = '›';
  arrow.setAttribute('aria-label', 'Autres cartes');
  arrow.onclick = () => row.scrollBy({ left: row.clientWidth * 0.8, behavior: 'smooth' });
  row.append(arrow);
  const update = () => {
    const a = row.querySelector<HTMLElement>('.maps-more');
    if (a) a.hidden = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
  };
  if (!row.dataset.more) {
    row.dataset.more = '1';
    row.addEventListener('scroll', update, { passive: true });
  }
  requestAnimationFrame(update);
}
