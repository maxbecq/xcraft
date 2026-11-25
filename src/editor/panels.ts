/**
 * The docked panels' insides: palette, players, minimap, properties of the selection, layers. Each reads the shared
 * state (state.ts) and draws itself again when it changes.
 */
import { Pane } from 'tweakpane';
import type { Dir } from '../map';
import { rotateFootprint } from '../map';
import { CORNERS } from '../maps';
import { BIOMES } from '../render/biome';
import { TEAM_COLORS } from '../render/models';
import { DEFS, type Faction, START } from '../data';
import { PLANETS } from '../mapcheck';
import { DECOR, RACES, type Symmetry } from './format2';
import { act, changed, ed, LAYERS, onChanged, startNumbers, type Tool } from './state';
import { teamsWindow, techTree } from './windows';

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
export const RACE_NAMES: Record<Faction, string> = { humains: 'Humains', z: 'Z', isdaris: 'Isdaris', dieux: 'Dieux' };
const ICONS = `${import.meta.env.BASE_URL}icons/`;
/** The game's icon for a type, or its initials when it has none. */
const icon = (type: string) => `<img src="${ICONS}${type}.png" alt="" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:${esc(JSON.stringify((DEFS[type]?.name ?? type).slice(0, 2)))}}))">`;
/** Names shown for the doodads file's pieces. */
export const DECOR_NAMES: Record<string, string> = {
  barrels: 'Barils', barrier: 'Barrière', billboard: 'Panneau', bones: 'Ossements', cables: 'Câbles', crates: 'Caisses', dead_tree: 'Arbre mort', dry_bush: 'Buisson sec',
  hovercar: 'Glisseur', pebbles: 'Cailloux', rocks_a: 'Rochers', rocks_b: 'Rochers (2)', rubble: 'Gravats', scrap_pile: 'Ferraille', shopfront: 'Devanture',
  streetlamp: 'Lampadaire', techbox: 'Boîtier', terminal: 'Terminal', tire_pile: 'Pneus', trash: 'Détritus', vending: 'Distributeur', vent: 'Aération',
  walldoor: 'Mur (porte)', wallpanel: 'Mur (panneau)', wallpipe: 'Mur (tuyau)', wreck: 'Épave',
};
const DIR_NAMES: Record<Dir, string> = { N: 'N', E: 'E', S: 'S', W: 'O' };

function pickTool(t: Tool): void {
  ed.tool = t;
  if (t !== 'select') ed.selection = null;
  act.redrawThings();
}

// ---- palette ----
let unitRace: Faction = 'humains';
let unitKind: 'unit' | 'building' = 'unit';
export function palettePanel(): HTMLElement {
  const root = h('<div class="palette"></div>');
  const section = (title: string, key: string) => {
    const s = h(`<section><h3>${title}<span>${key}</span></h3><div class="body"></div></section>`);
    root.appendChild(s);
    return s.querySelector('.body') as HTMLElement;
  };

  // Relief.
  const relief = section('Relief', 'R');
  const levels = h('<div class="row"></div>');
  const LV: [string, string, string][] = [['x', 'Gouffre', '#050505'], ['0', 'Niveau 0', '#8a6a43'], ['1', 'Niveau 1', '#a98457'], ['2', 'Niveau 2', '#c9a676'], ['up', 'Relever', ''], ['down', 'Abaisser', '']];
  const lvB = LV.map(([v, name, c]) => {
    const b = h(`<button class="lv">${c ? `<i style="background:${c}"></i>` : `<i class="arrow">${v === 'up' ? '▲' : '▼'}</i>`}${name}</button>`);
    b.onclick = () => {
      ed.paint = v;
      pickTool('relief');
    };
    levels.appendChild(b);
    return [v, b] as const;
  });
  relief.appendChild(levels);
  const shape = h('<div class="row"><span class="lbl">Pinceau</span><button class="chip" data-r="1">● Rond</button><button class="chip" data-r="0">■ Carré</button></div>');
  shape.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    ed.round = b.dataset.r === '1';
    changed();
  }));
  relief.appendChild(shape);
  const reliefPane = new Pane({ container: relief });
  reliefPane.addBinding(ed, 'brush', { label: 'Taille', min: 1, max: 15, step: 1 }).on('change', () => changed());

  // Ramps.
  const ramps = section('Rampes', 'P');
  const compass = h('<div class="row"><span class="lbl">Montée vers</span></div>');
  const dirB = (['N', 'E', 'S', 'W'] as Dir[]).map((d) => {
    const b = h(`<button class="chip">${DIR_NAMES[d]}</button>`);
    b.onclick = () => {
      ed.rampDir = d;
      pickTool('ramp');
    };
    compass.appendChild(b);
    return [d, b] as const;
  });
  ramps.appendChild(compass);
  const rampPane = new Pane({ container: ramps });
  rampPane.addBinding(ed, 'rampWidth', { label: 'Largeur', min: 1, max: 12, step: 1 }).on('change', () => changed());
  ramps.appendChild(h('<p class="note">Une rampe fait 4 tuiles de long ; son pied est un niveau sous la tuile qui la prolonge vers le haut.</p>'));

  // Resources and starts.
  const res = section('Ressources et départs', 'M');
  const resRow = h('<div class="tiles"></div>');
  const RES: [Tool, string, string][] = [['minerai', 'Minerai', icon('minerai')], ['puits', 'Puits 3×3', icon('puits')], ['base', 'Base libre', '<b class="dash">4×4</b>'], ['depart', 'Départ', '<b class="flag">⚑</b>']];
  const resB = RES.map(([t, name, pic]) => {
    const b = h(`<button class="tile">${pic}<span>${name}</span></button>`);
    b.onclick = () => pickTool(t);
    resRow.appendChild(b);
    return [t, b] as const;
  });
  res.appendChild(resRow);
  const departNote = h('<p class="note"></p>');
  res.appendChild(departNote);

  // Scenery.
  const dec = section('Décor', 'D');
  const decGrid = h('<div class="tiles small"></div>');
  const decB = DECOR.map((d) => {
    const b = h(`<button class="tile"><span>${esc(DECOR_NAMES[d] ?? d)}</span></button>`);
    b.onclick = () => {
      ed.decorType = d;
      pickTool('decor');
    };
    decGrid.appendChild(b);
    return [d, b] as const;
  });
  dec.appendChild(decGrid);

  // Units and buildings.
  const un = section('Unités et bâtiments', 'U');
  const tabs = h(`<div class="tabs">${RACES.map((r) => `<button data-r="${r}">${RACE_NAMES[r]}</button>`).join('')}</div>`);
  tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    unitRace = b.dataset.r as Faction;
    fillUnits();
    changed();
  }));
  un.appendChild(tabs);
  const ownerRow = h('<div class="row"><span class="lbl">Pour</span><select class="owner"></select><button class="chip" data-k="unit">Unités</button><button class="chip" data-k="building">Bâtiments</button></div>');
  ownerRow.querySelector('select')!.onchange = (e) => {
    ed.unitOwner = Number((e.target as HTMLSelectElement).value);
    changed();
  };
  ownerRow.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.onclick = () => {
    unitKind = b.dataset.k as 'unit' | 'building';
    fillUnits();
    changed();
  }));
  un.appendChild(ownerRow);
  const unitGrid = h('<div class="units"></div>');
  un.appendChild(unitGrid);
  function fillUnits(): void {
    const list = Object.entries(DEFS).filter(([, d]) => d.kind === unitKind && 'faction' in d && d.faction === unitRace);
    unitGrid.replaceChildren(...list.map(([id, d]) => {
      const b = h(`<button class="unit" data-t="${id}" title="${esc(d.name)}">${icon(id)}<span>${esc(d.name)}</span></button>`);
      b.onclick = () => {
        ed.unitType = id;
        pickTool('unite');
      };
      return b;
    }));
  }
  fillUnits();

  onChanged(() => {
    for (const [v, b] of lvB) b.classList.toggle('on', ed.tool === 'relief' && ed.paint === v);
    shape.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', (b.dataset.r === '1') === ed.round));
    for (const [d, b] of dirB) b.classList.toggle('on', ed.rampDir === d);
    for (const [t, b] of resB) b.classList.toggle('on', ed.tool === t);
    for (const [d, b] of decB) b.classList.toggle('on', ed.tool === 'decor' && ed.decorType === d);
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.r === unitRace));
    ownerRow.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.k === unitKind));
    const sel = ownerRow.querySelector('select')!;
    sel.innerHTML = `<option value="-1">Neutre</option>${ed.f.players.map((_, i) => `<option value="${i}">Joueur ${i + 1}</option>`).join('')}`;
    sel.value = String(ed.unitOwner);
    unitGrid.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', ed.tool === 'unite' && b.dataset.t === ed.unitType));
    departNote.textContent = ed.tool === 'depart' ? `Départ du joueur ${ed.seat + 1} (choisi dans le panneau Joueurs).` : '';
    reliefPane.refresh();
    rampPane.refresh();
  });
  return root;
}

// ---- players ----
/** Players count: the new ones start on the first's start turned, with the game's starting resources. */
export function setPlayers(n: number): void {
  const f = ed.f;
  if (n === f.players.length) return;
  act.snapshot();
  while (f.players.length > n) f.players.pop();
  while (f.players.length < n) {
    const s0 = f.players[0].start;
    f.players.push({ race: '', start: rotateFootprint(f.size, s0[0], s0[1], 4, CORNERS[f.players.length]), minerals: START.minerals, energy: START.energy, forbid: [] });
  }
  f.units = f.units.filter((u) => u.owner < n);
  ed.seat = Math.min(ed.seat, n - 1);
  ed.unitOwner = Math.min(ed.unitOwner, n - 1);
  ed.selection = null;
  act.redrawThings();
}
export function playersPanel(): HTMLElement {
  const root = h('<div class="players"></div>');
  const head = h('<div class="row"><span class="lbl">Nombre de joueurs</span><select class="count">' + [1, 2, 3, 4].map((n) => `<option>${n}</option>`).join('') + '</select><span class="note">Un clic sur une ligne choisit le joueur (outil Départ, arbre techno, départ mis en évidence).</span></div>');
  head.querySelector('select')!.onchange = (e) => setPlayers(Number((e.target as HTMLSelectElement).value));
  const table = h('<table><thead><tr><th></th><th>Joueur</th><th>Race</th><th>Minerai</th><th>Énergie</th><th>Équipe</th><th>Départ</th><th>Arbre technologique</th></tr></thead><tbody></tbody></table>');
  root.append(head, table);
  const body = table.querySelector('tbody')!;
  let drawn = '';
  const draw = () => {
    const f = ed.f;
    const key = JSON.stringify([f.players, ed.seat]);
    (head.querySelector('select') as HTMLSelectElement).value = String(f.players.length);
    if (key === drawn) return;
    drawn = key;
    const num = startNumbers(f);
    body.replaceChildren(...f.players.map((p, i) => {
      const tr = h(`<tr class="${i === ed.seat ? 'on' : ''}">
        <td><i class="swatch" style="background:${hex(TEAM_COLORS[i])}"></i></td><td>Joueur ${i + 1}</td>
        <td><select class="race"><option value="">Au choix</option>${RACES.map((r) => `<option value="${r}"${r === p.race ? ' selected' : ''}>${RACE_NAMES[r]}</option>`).join('')}</select>${p.race ? ' <span class="lock" title="Race imposée par la carte">🔒</span>' : ''}</td>
        <td><input class="mi" type="number" min="0" max="100000" step="50" value="${p.minerals}"></td>
        <td><input class="en" type="number" min="0" max="100000" step="50" value="${p.energy}"></td>
        <td><button class="small team" title="Équipes et victoire">${p.team === undefined ? 'au menu' : `Équipe ${p.team + 1}`}</button></td>
        <td><select class="start">${f.players.map((_, k) => `<option value="${k + 1}"${num[i] === k + 1 ? ' selected' : ''}>Départ ${k + 1}</option>`).join('')}</select></td>
        <td><button class="small tech">🌳 Ouvrir…</button> <span class="note">${p.forbid.length ? `${p.forbid.length} interdit${p.forbid.length > 1 ? 's' : ''}` : 'aucun interdit'}</span></td></tr>`);
      tr.onclick = (e) => {
        if ((e.target as HTMLElement).closest('select,input,button')) return;
        ed.seat = i;
        act.redrawThings();
      };
      tr.querySelector<HTMLSelectElement>('.race')!.onchange = (e) => {
        act.snapshot();
        p.race = (e.target as HTMLSelectElement).value as Faction | '';
        p.forbid = p.forbid.filter((t) => !p.race || (DEFS[t] as { faction?: string }).faction === p.race);
        act.redrawThings();
      };
      const num2 = (cls: string, k: 'minerals' | 'energy') => (tr.querySelector<HTMLInputElement>(cls)!.onchange = (e) => {
        act.snapshot();
        p[k] = Math.max(0, Math.min(100_000, Math.round(Number((e.target as HTMLInputElement).value) || 0)));
        changed();
      });
      num2('.mi', 'minerals');
      num2('.en', 'energy');
      // A start taken by another player: the two swap.
      tr.querySelector<HTMLSelectElement>('.start')!.onchange = (e) => {
        const k = Number((e.target as HTMLSelectElement).value);
        const j = num.indexOf(k);
        if (j < 0 || j === i) return;
        act.snapshot();
        [p.start, f.players[j].start] = [f.players[j].start, p.start];
        ed.seat = i;
        act.redrawThings();
      };
      tr.querySelector<HTMLButtonElement>('.tech')!.onclick = () => techTree(i);
      tr.querySelector<HTMLButtonElement>('.team')!.onclick = () => teamsWindow();
      return tr;
    }));
  };
  onChanged(draw);
  return root;
}

// ---- minimap ----
export function minimapPanel(c: HTMLCanvasElement): HTMLElement {
  const root = h('<div class="minipanel"></div>');
  root.append(c, h('<p class="note">Clic ou glisser : déplacer la vue.</p>'));
  return root;
}

// ---- properties ----
export function propertiesPanel(): HTMLElement {
  const root = h('<div class="props"></div>');
  let pane: Pane | null = null;
  let key = '';
  const build = () => {
    const f = ed.f;
    const s = ed.selection;
    const k = JSON.stringify([s, s && thing(), f.name, f.id, f.description, f.biome, f.symmetry, f.size]);
    if (k === key) return;
    key = k;
    pane?.dispose();
    root.replaceChildren();
    pane = new Pane({ container: root });
    const p = pane;
    /** A field over a copy: on its last change, the file keeps the old state for « Annuler », then takes the value. */
    const field = <T extends Record<string, unknown>>(obj: T, name: keyof T & string, opts: Record<string, unknown>, set: (v: T[keyof T]) => void) => {
      p.addBinding(obj, name, opts).on('change', (ev) => {
        if (ev.last === false) return;
        act.snapshot();
        set(ev.value as T[keyof T]);
        act.redrawThings();
      });
    };
    const xy = (at: [number, number], size: number, redraw: 'things' | 'all' = 'things') => {
      const o = { x: at[0], y: at[1] };
      const max = f.size - size;
      for (const c of ['x', 'y'] as const) {
        p.addBinding(o, c, { label: c === 'x' ? 'Colonne' : 'Ligne', min: 0, max, step: 1 }).on('change', (ev) => {
          if (ev.last === false) return;
          act.snapshot();
          at[c === 'x' ? 0 : 1] = Math.max(0, Math.min(max, Math.round(ev.value as number)));
          if (redraw === 'all') act.redrawAll();
          else act.redrawThings();
        });
      }
    };
    const actions = () => {
      p.addButton({ title: 'Centrer la vue dessus' }).on('click', () => {
        const at = thing()?.at;
        if (at) act.lookAt(at[0] + 1, at[1] + 1);
      });
      p.addButton({ title: 'Enlever (Suppr)' }).on('click', () => act.removeSelected());
    };
    function thing(): { at: [number, number] } | null {
      if (!s) return null;
      switch (s.kind) {
        case 'unit': return f.units[s.i] ?? null;
        case 'decor': return f.decor[s.i] ?? null;
        case 'start': return f.players[s.i] ? { at: f.players[s.i].start } : null;
        case 'base': return f.bases[s.i] ? { at: f.bases[s.i] } : null;
        case 'well': return f.wells[s.i] ? { at: f.wells[s.i] } : null;
        case 'mineral': return f.minerals[s.i] ? { at: f.minerals[s.i] } : null;
        case 'ramp': return f.ramps[s.i] ?? null;
      }
    }
    if (!s || !thing()) {
      root.prepend(h('<h4>Carte</h4>'));
      const o = { name: f.name, id: f.id, description: f.description ?? '', biome: f.biome, symmetry: f.symmetry };
      field(o, 'name', { label: 'Nom' }, (v) => (f.name = String(v).slice(0, 60)));
      field(o, 'id', { label: 'Identifiant' }, (v) => (f.id = String(v).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || f.id));
      field(o, 'description', { label: 'Description' }, (v) => (f.description = String(v).slice(0, 300)));
      p.addBinding(o, 'biome', { label: 'Biome', options: Object.fromEntries(PLANETS.map((id) => [BIOMES[id]?.name ?? id, id])) }).on('change', (ev) => {
        act.snapshot();
        f.biome = ev.value as string;
        act.redrawAll();
      });
      field(o, 'symmetry', { label: 'Symétrie', options: { Aucune: 'none', 'Rotation 180°': 'rot180', 'Rotation 90°': 'rot90' } }, (v) => (f.symmetry = v as Symmetry));
      p.addBlade({ view: 'text', label: 'Taille', parse: (v: string) => v, value: `${f.size} × ${f.size}`, disabled: true } as never);
      root.appendChild(h('<p class="note">Outil Sélection : un clic sur un objet de la carte montre ses propriétés ici.</p>'));
      return;
    }
    switch (s.kind) {
      case 'unit': {
        const u = f.units[s.i];
        const d = DEFS[u.type];
        root.prepend(h(`<h4>${d.kind === 'building' ? 'Bâtiment' : 'Unité'} placé${d.kind === 'building' ? '' : 'e'}</h4>`));
        const types = Object.fromEntries(Object.entries(DEFS).filter(([, x]) => (x.kind === 'unit' || x.kind === 'building') && 'faction' in x).map(([id, x]) => [`${x.name} (${RACE_NAMES[(x as { faction: Faction }).faction]})`, id]));
        const o = { type: u.type, owner: u.owner };
        field(o, 'type', { label: 'Type', options: types }, (v) => (u.type = String(v)));
        field(o, 'owner', { label: 'Propriétaire', options: Object.fromEntries([['Neutre', -1], ...f.players.map((_, i) => [`Joueur ${i + 1}`, i])]) }, (v) => (u.owner = Number(v)));
        xy(u.at, d.kind === 'building' ? d.size : 1);
        break;
      }
      case 'decor': {
        const d = f.decor[s.i];
        root.prepend(h('<h4>Décor posé</h4>'));
        const o = { type: d.type, yaw: d.yaw ?? 0 };
        field(o, 'type', { label: 'Objet', options: Object.fromEntries(DECOR.map((n) => [DECOR_NAMES[n] ?? n, n])) }, (v) => (d.type = String(v)));
        field(o, 'yaw', { label: 'Orientation', min: -3.14, max: 3.14, step: 0.01 }, (v) => (d.yaw = Math.round(Number(v) * 100) / 100));
        xy(d.at, 1);
        break;
      }
      case 'start':
        root.prepend(h(`<h4>Départ ${startNumbers(f)[s.i]} · Joueur ${s.i + 1}</h4>`));
        xy(f.players[s.i].start, 4);
        break;
      case 'base':
        root.prepend(h('<h4>Base libre</h4>'));
        xy(f.bases[s.i], 4);
        break;
      case 'well':
        root.prepend(h('<h4>Puits d\'énergie</h4>'));
        xy(f.wells[s.i], 3);
        break;
      case 'mineral':
        root.prepend(h('<h4>Minerai</h4>'));
        xy(f.minerals[s.i], 1);
        break;
      case 'ramp': {
        const r = f.ramps[s.i];
        root.prepend(h('<h4>Rampe</h4>'));
        const o = { up: r.up, width: r.width, level: r.level };
        const redo = (fn: () => void) => (v: unknown) => {
          fn();
          void v;
          act.redrawAll();
        };
        p.addBinding(o, 'up', { label: 'Montée vers', options: { Nord: 'N', Est: 'E', Sud: 'S', Ouest: 'W' } }).on('change', (ev) => (act.snapshot(), redo(() => (r.up = ev.value as Dir))(0)));
        p.addBinding(o, 'width', { label: 'Largeur', min: 1, max: 12, step: 1 }).on('change', (ev) => ev.last !== false && (act.snapshot(), redo(() => (r.width = ev.value as number))(0)));
        p.addBinding(o, 'level', { label: 'Niveau du pied', options: { '0 → 1': 0, '1 → 2': 1 } }).on('change', (ev) => (act.snapshot(), redo(() => (r.level = ev.value as number))(0)));
        xy(r.at, 1, 'all');
        break;
      }
    }
    actions();
  };
  onChanged(build);
  return root;
}

// ---- layers ----
export function layersPanel(): HTMLElement {
  const root = h('<div class="layers"></div>');
  const draw = () => {
    root.replaceChildren(...LAYERS.map((l) => {
      const shown = !ed.hidden.has(l.id);
      const locked = ed.locked.has(l.id);
      const row = h(`<div class="layer"><button class="eye${shown ? '' : ' off'}" title="${l.hide ? 'Montrer ou cacher' : 'Toujours visible'}"${l.hide ? '' : ' disabled'}>${l.hide ? (shown ? '👁' : '–') : '·'}</button>
        <button class="lockb${locked ? ' on' : ''}" title="${l.lock ? 'Verrouiller : les outils n\'y touchent plus' : ''}"${l.lock ? '' : ' disabled'}>${l.lock ? (locked ? '🔒' : '🔓') : ''}</button><span>${esc(l.name)}</span><em>${count(l.id)}</em></div>`);
      row.querySelector<HTMLButtonElement>('.eye')!.onclick = () => {
        if (shown) ed.hidden.add(l.id);
        else ed.hidden.delete(l.id);
        act.redrawThings();
      };
      row.querySelector<HTMLButtonElement>('.lockb')!.onclick = () => {
        if (locked) ed.locked.delete(l.id);
        else ed.locked.add(l.id);
        changed();
      };
      return row;
    }));
  };
  const count = (id: string) => {
    const f = ed.f;
    return { ramps: f.ramps.length, resources: f.minerals.length + f.wells.length, decorPlaced: f.decor.length, units: f.units.length, starts: `${f.players.length} + ${f.bases.length}`, decorSeeded: 'auto' }[id] ?? '';
  };
  onChanged(draw);
  return root;
}
