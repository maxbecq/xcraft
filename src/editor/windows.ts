/**
 * The editor's windows: rare or complex settings, out of the main screen (tech tree, keyboard help; teams and the
 * triggers come with later batches). Each is a modal <dialog>: OK applies, Annuler leaves the file as it was.
 */
import { TEAM_COLORS } from '../render/models';
import { DEFS, type Faction } from '../data';
import { RACES } from './format2';
import { act, ed } from './state';

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const RACE_NAMES: Record<Faction, string> = { humains: 'Humains', z: 'Z', isdaris: 'Isdaris', dieux: 'Dieux' };
const ICONS = `${import.meta.env.BASE_URL}icons/`;

export interface Button {
  label: string;
  main?: boolean;
  /** Returns false to keep the window open. */
  run?: () => boolean | void;
}
/** A modal window: title, body, buttons at the bottom right (Échap closes it as « Annuler »). */
export function dialog(title: string, body: HTMLElement, buttons: Button[], wide = ''): HTMLDialogElement {
  const d = h(`<dialog class="win ${wide}"><header><b>${esc(title)}</b><button class="x" title="Fermer">✕</button></header><div class="content"></div><footer></footer></dialog>`) as HTMLDialogElement;
  d.querySelector('.content')!.appendChild(body);
  const foot = d.querySelector('footer')!;
  for (const b of buttons) {
    const el = h(`<button class="${b.main ? 'main' : ''}">${esc(b.label)}</button>`);
    el.onclick = () => {
      if (b.run?.() === false) return;
      d.close();
    };
    foot.appendChild(el);
  }
  d.querySelector<HTMLButtonElement>('.x')!.onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d);
  d.showModal();
  return d;
}

/** The tech tree: per player, what the map forbids (unticked), by kind; a player whose race is free has a tab per race. */
export function techTree(start: number): void {
  const f = ed.f;
  // Worked on a copy: OK applies it, Annuler drops it.
  const forbid = f.players.map((p) => new Set(p.forbid));
  let who = Math.min(start, f.players.length - 1);
  let race: Faction = f.players[who].race || 'humains';
  const body = h('<div class="tech"><div class="who"></div><div class="side"><div class="head"></div><div class="tabs"></div><div class="cols"></div></div></div>');
  const draw = () => {
    const p = f.players[who];
    if (p.race) race = p.race;
    body.querySelector('.who')!.replaceChildren(...f.players.map((q, i) => {
      const row = h(`<button class="${i === who ? 'on' : ''}"><i class="swatch" style="background:${hex(TEAM_COLORS[i])}"></i>Joueur ${i + 1}<small>${q.race ? RACE_NAMES[q.race] : 'au choix'} · ${forbid[i].size}</small></button>`);
      row.onclick = () => {
        who = i;
        draw();
      };
      return row;
    }));
    body.querySelector('.head')!.innerHTML = `<b>Joueur ${who + 1} · ${p.race ? RACE_NAMES[p.race] : 'race au choix'}</b><span class="note">Décocher = interdit sur cette carte · ${forbid[who].size} interdit${forbid[who].size > 1 ? 's' : ''}</span>`;
    const tabs = body.querySelector('.tabs')!;
    tabs.replaceChildren(...(p.race ? [] : RACES.map((r) => {
      const b = h(`<button class="${r === race ? 'on' : ''}">${RACE_NAMES[r]}</button>`);
      b.onclick = () => {
        race = r;
        draw();
      };
      return b;
    })));
    const col = (kind: string, title: string) => {
      const items = Object.entries(DEFS).filter(([, d]) => d.kind === kind && 'faction' in d && d.faction === race);
      const c = h(`<div><h4>${title}</h4></div>`);
      for (const [id, d] of items) {
        const on = !forbid[who].has(id);
        const row = h(`<label class="ck${on ? '' : ' no'}"><input type="checkbox"${on ? ' checked' : ''}><img src="${ICONS}${id}.png" alt="" onerror="this.remove()">${esc(d.name)}</label>`);
        row.querySelector('input')!.onchange = (e) => {
          if ((e.target as HTMLInputElement).checked) forbid[who].delete(id);
          else forbid[who].add(id);
          draw();
        };
        c.appendChild(row);
      }
      return c;
    };
    body.querySelector('.cols')!.replaceChildren(col('building', 'Bâtiments'), col('unit', 'Unités'), col('upgrade', 'Recherches'));
  };
  draw();
  const copyTo = h(`<select class="copyto"><option value="">Copier vers…</option>${f.players.map((_, i) => `<option value="${i}">Joueur ${i + 1}</option>`).join('')}</select>`) as HTMLSelectElement;
  copyTo.onchange = () => {
    const j = Number(copyTo.value);
    copyTo.value = '';
    if (Number.isNaN(j) || j === who) return;
    const r = f.players[j].race;
    forbid[j] = new Set([...forbid[who]].filter((t) => !r || (DEFS[t] as { faction?: string }).faction === r));
    draw();
  };
  const d = dialog('Arbre technologique', body, [
    { label: 'Tout autoriser', run: () => (forbid[who].clear(), draw(), false) },
    { label: 'Annuler' },
    {
      label: 'OK', main: true, run: () => {
        if (f.players.every((p, i) => p.forbid.length === forbid[i].size && p.forbid.every((t) => forbid[i].has(t)))) return;
        act.snapshot();
        f.players.forEach((p, i) => (p.forbid = [...forbid[i]]));
        act.redrawThings();
      },
    },
  ], 'large');
  d.querySelector('footer')!.prepend(copyTo, h('<span class="note grow">Un bâtiment interdit grise aussi dans le jeu ce qu\'il permet de produire.</span>'));
}

const KEYS: [string, string][] = [
  ['Clic gauche / droit', 'Utiliser l\'outil / effacer (remettre au niveau 0, enlever)'],
  ['Tab', 'Basculer entre la vue 3D du jeu et la vue de dessus'],
  ['Flèches ou Z Q S D', 'Déplacer la vue'],
  ['Molette', 'Zoomer'],
  ['Clic milieu, ou Espace + glisser', 'Déplacer la vue à la main'],
  ['0, 1, 2, X', 'Relief : niveau ou gouffre'],
  ['[ et ]', 'Taille du pinceau'],
  ['G', 'Grille'],
  ['H', 'Recentrer sur le départ du joueur choisi'],
  ['Suppr', 'Enlever l\'objet sélectionné'],
  ['⌘Z / ⇧⌘Z', 'Annuler / rétablir'],
  ['⌘C, ⌘X, ⌘V, ⌘D', 'Copier, couper, coller, dupliquer (unités et décor)'],
  ['⌘S, ⌘O, ⌘E', 'Enregistrer, ouvrir, exporter pour le jeu'],
  ['⌘K', 'Arbre technologique'],
  ['F9 / ⇧F9', 'Tester la carte / en spectateur'],
  ['⌥N', 'Nouvelle carte (⌘N, ⌘T et ⌘W restent au navigateur)'],
];
export function keysHelp(): void {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const k = (s: string) => (mac ? s : s.replaceAll('⌘', 'Ctrl+').replaceAll('⇧', 'Maj+').replaceAll('⌥', 'Alt+'));
  dialog('Raccourcis clavier', h(`<table class="keys">${KEYS.map(([a, b]) => `<tr><td><kbd>${esc(k(a))}</kbd></td><td>${esc(b)}</td></tr>`).join('')}</table>`), [{ label: 'Fermer', main: true }]);
}
