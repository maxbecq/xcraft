/**
 * The editor's windows: rare or complex settings, out of the main screen (tech tree, keyboard help; teams and the
 * triggers come with later batches). Each is a modal <dialog>: OK applies, Annuler leaves the file as it was.
 */
import { TEAM_COLORS } from '../render/models';
import { DEFS, type Faction } from '../data';
import { gameCounts, RACES } from './format2';
import { act, ed, iconOf } from './state';

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
        const row = h(`<label class="ck${on ? '' : ' no'}"><input type="checkbox"${on ? ' checked' : ''}><img src="${ICONS}${iconOf(id)}.png" alt="" onerror="this.remove()">${esc(d.name)}</label>`);
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
  ['⌥T', 'Éditeur de déclencheurs'],
  ['⌥N', 'Nouvelle carte (⌘N, ⌘T et ⌘W restent au navigateur)'],
];
export function keysHelp(): void {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const k = (s: string) => (mac ? s : s.replaceAll('⌘', 'Ctrl+').replaceAll('⇧', 'Maj+').replaceAll('⌥', 'Alt+'));
  dialog('Raccourcis clavier', h(`<table class="keys">${KEYS.map(([a, b]) => `<tr><td><kbd>${esc(k(a))}</kbd></td><td>${esc(b)}</td></tr>`).join('')}</table>`), [{ label: 'Fermer', main: true }]);
}

/** Teams and victory: who plays with whom (the map's choice, or the menu's), and what the game decides by itself. */
export function teamsWindow(): void {
  const f = ed.f;
  const n = f.players.length;
  const teams = f.players.map((p) => p.team);
  let mode: 'menu' | 'map' | 'alone' = teams.every((t) => t === undefined) ? 'menu' : teams.every((t, i) => t === i) ? 'alone' : 'map';
  const pick: number[] = f.players.map((p, i) => p.team ?? Math.min(i, 1));
  const body = h('<div class="teams"><div class="row modes"></div><div class="boxes"></div><div class="rules"></div></div>');
  const draw = () => {
    const modes = body.querySelector('.modes')!;
    modes.replaceChildren(h('<span class="lbl">Équipes</span>'), ...([['menu', 'Choisies au menu'], ['map', 'Fixées par la carte'], ['alone', 'Chacun pour soi']] as const).map(([m, name]) => {
      const b = h(`<button class="chip${mode === m ? ' on' : ''}">${name}</button>`);
      b.onclick = () => {
        mode = m;
        draw();
      };
      return b;
    }));
    const boxes = body.querySelector('.boxes')!;
    if (mode !== 'map') {
      boxes.replaceChildren(h(`<p class="note">${mode === 'menu' ? 'Les joueurs choisissent leurs équipes au menu de la partie, comme sur les cartes du jeu.' : 'Chaque joueur joue seul contre tous, quel que soit le choix du menu.'}</p>`));
      return;
    }
    boxes.replaceChildren(...Array.from({ length: Math.max(2, n) }, (_, t) => {
      const box = h(`<div class="team"><div class="h">Équipe ${t + 1}</div></div>`);
      f.players.forEach((p, i) => {
        if (pick[i] !== t) return;
        const row = h(`<div class="m"><i class="swatch" style="background:${hex(TEAM_COLORS[i])}"></i>Joueur ${i + 1} · ${p.race ? RACE_NAMES[p.race] : 'au choix'}<select>${Array.from({ length: Math.max(2, n) }, (_, k) => `<option value="${k}"${k === t ? ' selected' : ''}>Équipe ${k + 1}</option>`).join('')}</select></div>`);
        row.querySelector('select')!.onchange = (e) => {
          pick[i] = Number((e.target as HTMLSelectElement).value);
          draw();
        };
        box.appendChild(row);
      });
      if (!box.querySelector('.m')) box.appendChild(h('<div class="m note">aucun joueur</div>'));
      return box;
    }));
  };
  body.querySelector('.rules')!.innerHTML = `<h4>Ce que le jeu décide</h4>
    <div class="form">
      <label>Alliés <span>Vision partagée ; ils ne se combattent pas.</span></label>
      <label>Victoire <span>Détruire tous les bâtiments ennemis : la dernière équipe debout gagne.</span></label>
      <label>Neutres <span>Passifs : ils ne bougent ni n'attaquent.</span></label>
    </div>
    <p class="note">Pour d'autres conditions de victoire ou de défaite : les actions Victoire et Défaite des déclencheurs.</p>`;
  draw();
  dialog('Équipes et victoire', body, [
    { label: 'Annuler' },
    {
      label: 'OK', main: true, run: () => {
        const next = f.players.map((_, i) => (mode === 'menu' ? undefined : mode === 'alone' ? i : pick[i]));
        // As the game checks it (mapcheck.ts): at each players count the export offers, two teams at least.
        const counts = gameCounts(f);
        if (mode === 'map' && counts.some((k) => k <= n && new Set(next.slice(0, k)).size < 2)) {
          act.say(`Les ${Math.min(...counts.filter((k) => k <= n && new Set(next.slice(0, k)).size < 2))} premiers joueurs sont dans la même équipe : la partie serait gagnée d'avance.`);
          return false;
        }
        if (next.every((t, i) => t === f.players[i].team)) return;
        act.snapshot();
        f.players.forEach((p, i) => {
          if (next[i] === undefined) delete p.team;
          else p.team = next[i];
        });
        act.redrawThings();
      },
    },
  ]);
}

/** The map's name, description, planet, symmetry and players count; its picture. */
export function mapProperties(picture: HTMLCanvasElement, planets: [string, string][], setPlayers: (n: number) => void): void {
  const f = ed.f;
  const body = h(`<div class="mapprops"><div class="form">
    <label>Nom <input class="name" type="text" maxlength="60" value="${esc(f.name)}"></label>
    <label>Identifiant <input class="id" type="text" maxlength="40" value="${esc(f.id)}"></label>
    <label>Description <textarea class="desc" rows="3" maxlength="300">${esc(f.description ?? '')}</textarea></label>
    <label>Taille <span>${f.size} × ${f.size} tuiles</span></label>
    <label>Biome <select class="biome">${planets.map(([id, name]) => `<option value="${id}"${id === f.biome ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
    <label>Symétrie <select class="sym"><option value="none">Aucune</option><option value="rot180">Rotation 180° (2 parts)</option><option value="rot90">Rotation 90° (4 parts)</option></select></label>
    <label>Joueurs <select class="count">${[1, 2, 3, 4].map((k) => `<option${k === f.players.length ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
    <label>Se joue à <span class="counts">${[2, 3, 4].map((k) => `<label class="chip"><input type="checkbox" value="${k}"${gameCounts(f).includes(k) ? ' checked' : ''}> ${k}</label>`).join(' ')}</span></label>
    <p class="note">À l'export : 2 seulement sans symétrie à quatre parts ; une carte 2 contre 2 se joue à 4 seulement.</p>
  </div><div class="pic"></div></div>`);
  (body.querySelector('.sym') as HTMLSelectElement).value = f.symmetry;
  const pic = document.createElement('canvas');
  pic.width = pic.height = 200;
  const g = pic.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(picture, 0, 0, 200, 200);
  body.querySelector('.pic')!.append(pic, h('<p class="note">Vue de dessus</p>'));
  const val = (c: string) => (body.querySelector(c) as HTMLInputElement).value;
  dialog('Propriétés de la carte', body, [
    { label: 'Annuler' },
    {
      label: 'OK', main: true, run: () => {
        const id = val('.id').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 32);
        if (!id) {
          act.say('Identifiant vide.');
          return false;
        }
        const biome = val('.biome');
        const next = { name: val('.name').trim().slice(0, 60) || f.name, id, description: val('.desc').trim().slice(0, 300) || undefined, biome, symmetry: val('.sym') as typeof f.symmetry };
        const count = Number(val('.count'));
        const counts = [...body.querySelectorAll<HTMLInputElement>('.counts input:checked')].map((c) => Number(c.value));
        const all = gameCounts({ symmetry: val('.sym') as typeof f.symmetry });
        if (!counts.some((k) => all.includes(k))) {
          act.say(`Il faut au moins un nombre de joueurs parmi ${all.join(', ')} (selon la symétrie).`);
          return false;
        }
        if (Object.entries(next).some(([k, v]) => f[k as keyof typeof next] !== v)) {
          act.snapshot();
          Object.assign(f, next);
          if (next.description === undefined) delete f.description;
        }
        if (count !== f.players.length) setPlayers(count);
        const kept = counts.filter((k) => all.includes(k));
        if (kept.join() !== gameCounts(f).join()) {
          act.snapshot();
          if (kept.join() === all.join()) delete f.counts;
          else f.counts = kept;
        }
        act.redrawAll();
      },
    },
  ]);
}

/**
 * The game's checks, one line each: the format, each players count, then what the export leaves out. A line naming
 * a tile has a link that shows it.
 */
export function playability(check: () => { format: string | null; counts: [number, string | null][]; notes: string[] }): void {
  const body = h('<div class="check"></div>');
  const run = () => {
    const t = performance.now();
    const r = check();
    const ms = Math.round(performance.now() - t);
    const line = (cls: string, mark: string, text: string, right: string) => {
      const row = h(`<div class="${cls}"><b>${mark}</b><span>${esc(text)}</span><em>${right}</em></div>`);
      const at = /\((\d+), (\d+)\)/.exec(text);
      if (at) {
        const a = h('<a href="#">aller</a>');
        a.onclick = (e) => {
          e.preventDefault();
          act.lookAt(Number(at[1]) + 2, Number(at[2]) + 2);
        };
        row.querySelector('span')!.append(' — ', a);
      }
      return row;
    };
    body.replaceChildren(
      r.format ? line('x', '✕', `Format refusé par le jeu : ${r.format}`, 'bloquant') : line('ok', '✔', 'Format accepté par le jeu (mapcheck)', `${ms} ms`),
      ...r.counts.map(([k, why]) => (why ? line('x', '✕', `À ${k} joueurs : ${why}`, 'bloquant') : line('ok', '✔', `À ${k} joueurs : chaque départ a son QG, rejoint les autres et chaque base`, ''))),
      ...r.notes.map((nt) => line('w', '!', nt, 'avertissement')),
    );
  };
  run();
  dialog('Vérifier la jouabilité', body, [{ label: 'Revérifier', run: () => (run(), false) }, { label: 'Fermer', main: true }], 'large');
}
