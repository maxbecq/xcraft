/** The title screen's menus: home, options, match setup, joining a friend, the friends' lobby; a match starts by loading its URL. */
import { type Faction, FACTIONS } from '../data';
import { MAPS, type MapFile, mapFile } from '../maps';
import { mapCards, seatsOf } from '../mappicker';
import { newRoom, openLobby, readRoom, type LobbySetup } from '../net';
import type { PerfHud } from '../perf';
import { type Quality, QUALITY_KEY, QUALITY_NAMES } from '../quality';
import { BIOMES, type Biome } from '../render/biome';
import { TEAM_COLORS } from '../render/units';
import { SKIPPED } from '../stats';
import { openReplayFile, playReplay, readReplay, REPLAY_KEY } from './replay';
import { encodeSeats } from './seats';
import { asFaction, FULLSCREEN_KEY, SANDBOX_TOOLS, stored, toggleFullscreen, wantsFullscreen } from './settings';

/** What the menus take from the page (main.ts), given once by initMenus. */
let myFaction: Faction, foeFaction: Faction, biome: Biome, MAP: MapFile, perf: PerfHud, DETECTED: Quality, TOUCH: boolean;
let controlFields: (inMatch: boolean) => string;
let controlChange: (field: HTMLInputElement | HTMLSelectElement) => boolean;
export function initMenus(page: {
  myFaction: Faction;
  foeFaction: Faction;
  biome: Biome;
  MAP: MapFile;
  perf: PerfHud;
  DETECTED: Quality;
  TOUCH: boolean;
  controlFields: typeof controlFields;
  controlChange: typeof controlChange;
}): void {
  ({ myFaction, foeFaction, biome, MAP, perf, DETECTED, TOUCH, controlFields, controlChange } = page);
}

/** A match to set up: each side's faction and who plays it, the planet, and the speed when only AIs play. */
export interface Setup {
  /** Four seats; `control` 'none' leaves a seat empty (the third and fourth by default). */
  sides: { faction: Faction; control: string; team: number }[];
  biome: string;
  /** Map id (public/maps/). */
  map: string;
  speed: number;
}
const CONTROLS: Record<string, string> = { none: 'Fermé', you: 'Vous', easy: 'IA facile', normal: 'IA normale', hard: 'IA difficile' };

function readSetup(): Setup {
  const fallback: Setup = {
    sides: [
      { faction: myFaction, control: 'you', team: 0 },
      { faction: foeFaction, control: 'normal', team: 1 },
      { faction: 'humains', control: 'none', team: 2 },
      { faction: 'isdaris', control: 'none', team: 3 },
    ],
    biome: biome.id,
    map: MAP.id,
    speed: 2,
  };
  try {
    const s = JSON.parse(stored('xcraft.setup') ?? 'null') as Setup | null;
    if (s && Array.isArray(s.sides) && s.sides.length >= 2 && BIOMES[s.biome]) {
      // Older saves had two seats and no teams.
      const old = s.sides;
      s.sides = [0, 1, 2, 3].map((i) => ({ ...fallback.sides[i], ...old[i], team: old[i]?.team ?? i }));
      if (!MAPS[s.map]) s.map = fallback.map;
      return s;
    }
  } catch {
    // a broken entry: start over
  }
  return fallback;
}

export function showHome(): void {
  const menu = document.querySelector('.menu') ?? document.body.appendChild(document.createElement('div'));
  menu.className = 'menu';
  menu.innerHTML = `<h1>XCRAFT</h1><p>Humains · Isdaris · Z · Dieux</p>
    <button data-m="new">Nouvelle partie</button>
    <button data-m="friend">Jouer avec un ami</button>
    <button data-m="join">Rejoindre un ami</button>
    <button data-m="sandbox">Bac à sable</button>
    <button data-m="options">Options</button>
    <div class="row">
      ${stored(REPLAY_KEY) ? '<button data-m="last-replay">Revoir la dernière partie</button>' : ''}
      <button data-m="open-replay">Ouvrir un replay…</button>
    </div>
    <div class="build">v${__VERSION__} · ${__COMMIT__} · ${new Date(__BUILT__).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${SKIPPED ? ' · vos visites ne sont pas comptées' : ''}</div>`;
  (menu as HTMLElement).onclick = (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    if (m === 'new') showSetup(menu as HTMLElement, readSetup());
    else if (m === 'sandbox') showSetup(menu as HTMLElement, readSetup(), 'map', true);
    else if (m === 'friend') showLobby(menu as HTMLElement, newRoom(), true);
    else if (m === 'join') showJoin(menu as HTMLElement);
    else if (m === 'options') showOptions(menu as HTMLElement);
    else if (m === 'last-replay') playReplay(readReplay());
    else if (m === 'open-replay') openReplayFile();
  };
}

/** The graphics level picked in the options, or 'auto'. */
function storedQuality(): string {
  try {
    return localStorage.getItem(QUALITY_KEY) ?? 'auto';
  } catch {
    return 'auto';
  }
}

/** Settings kept for this computer (its browser): graphics for now. A change reloads the page on the way back. */
function showOptions(menu: HTMLElement): void {
  const before = storedQuality();
  const options = { ...QUALITY_NAMES, auto: `Auto (${QUALITY_NAMES[DETECTED].toLowerCase()} pour cet ordinateur)` };
  menu.className = 'menu setup';
  menu.innerHTML = `<h2>Options</h2>
    <fieldset class="options"><legend>Affichage</legend>
      <label>Graphismes <select data-k="quality">${Object.entries(options)
        .map(([v, label]) => `<option value="${v}"${v === before ? ' selected' : ''}>${label}</option>`)
        .join('')}</select></label>
      ${document.fullscreenEnabled && !TOUCH ? `<label><input type="checkbox" data-k="fullscreen"${wantsFullscreen() ? ' checked' : ''}> Jouer en plein écran</label>` : ''}
    </fieldset>
    ${controlFields(false)}
    ${perf.field()}
    <p class="stats-note" style="margin:0;font:12px var(--ui);letter-spacing:0;text-transform:none;opacity:.55">Statistiques anonymes de fréquentation (GoatCounter, sans cookie)</p>
    <div class="row"><button data-m="back">Retour</button></div>`;
  menu.oninput = (e) => controlChange(e.target as HTMLInputElement);
  menu.onchange = (e) => {
    const field = e.target as HTMLSelectElement | HTMLInputElement;
    if (controlChange(field)) return;
    if (field.dataset.k === 'fullscreen') {
      try {
        localStorage.setItem(FULLSCREEN_KEY, (field as HTMLInputElement).checked ? '1' : '0');
      } catch {
        // private browsing: the pause menu's button still works
      }
      // Ticking it is the click the browser asks for: the menus go fullscreen at once.
      if ((field as HTMLInputElement).checked !== !!document.fullscreenElement) toggleFullscreen();
      return;
    }
    const v = field.value;
    try {
      if (v === 'auto') localStorage.removeItem(QUALITY_KEY);
      else localStorage.setItem(QUALITY_KEY, v);
    } catch {
      // private browsing: the detected level stays
    }
  };
  menu.onclick = (e) => {
    if ((e.target as HTMLElement).closest('button')?.dataset.m !== 'back') return;
    // The renderer is set up once per page: a new level needs a reload.
    if (storedQuality() !== before) location.reload();
    else showHome();
  };
}

/** Small screens (phones, either way up): the setup comes in two steps, the map first, then the players. */
const COMPACT = matchMedia('(max-width: 820px), (max-height: 600px)');

/**
 * The match setup screen: the maps, one row per player (on/off switch, dropdowns), then the planet; the match
 * loads from the URL. On small screens `step` shows the maps alone, then the rest. `sandbox`: Bac à sable, the
 * player's faction alone.
 */
/** Bac à sable: the options picked before the match (all off at first). */
const sandboxPicked = new Set<string>();

function showSetup(menu: HTMLElement, s: Setup, step: 'map' | 'players' = 'map', sandbox = false): void {
  const select = (key: string, options: Record<string, string>, now: string) =>
    `<select data-k="${key}">${Object.entries(options)
      .map(([v, label]) => `<option value="${v}"${v === now ? ' selected' : ''}>${label}</option>`)
      .join('')}</select>`;
  const factions = Object.fromEntries(Object.entries(FACTIONS).map(([f, d]) => [f, d.name]));
  const teams = { 0: 'Équipe 1', 1: 'Équipe 2', 2: 'Équipe 3', 3: 'Équipe 4' };
  const row = (i: number) => {
    const controls: Record<string, string> = { ...CONTROLS };
    delete controls.none; // closing a seat is the switch's job
    if (i > 0) delete controls.you; // the local player is always the first side
    const color = `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    const open = s.sides[i].control !== 'none';
    // The first two seats are always taken; the others have an on/off switch.
    const toggle = i < 2 ? '<span class="seat-fixed"></span>' : `<label class="switch"><input type="checkbox" data-k="on${i}"${open ? ' checked' : ''}><span></span></label>`;
    return `<div class="seat${open ? '' : ' off'}">
      <span class="chip" style="background:${color}"></span><span class="who">Joueur ${i + 1}</span>${toggle}
      ${open ? `${select(`f${i}`, factions, s.sides[i].faction)}${select(`c${i}`, controls, s.sides[i].control)}${select(`t${i}`, teams, String(s.sides[i].team))}` : '<span class="closed">Emplacement fermé</span>'}
    </div>`;
  };
  if (sandbox) s.sides[0].control = 'you';
  const chosen = mapFile(s.map);
  const watching = s.sides[0].control !== 'you';
  const title = sandbox ? 'Bac à sable' : 'Nouvelle partie';
  const seats = sandbox
    ? `<fieldset class="seats"><legend>Votre camp</legend><div class="seat"><span class="chip" style="background:#${TEAM_COLORS[0].toString(16).padStart(6, '0')}"></span><span class="who">Joueur 1</span><span class="seat-fixed"></span>${select('f0', factions, s.sides[0].faction)}</div></fieldset>`
    : `<fieldset class="seats"><legend>Joueurs</legend>${[0, 1, 2, 3].slice(0, seatsOf(chosen)).map(row).join('')}</fieldset>`;
  const compact = COMPACT.matches;
  const maps = `<fieldset class="maps"><legend>Carte</legend>${mapCards(chosen.id, s.biome)}</fieldset>
    <p class="map-about">${chosen.description ?? ''}</p>`;
  menu.className = `menu setup${compact ? ' compact' : ''}`;
  if (compact && step === 'map') {
    menu.innerHTML = `<h2>${title}</h2>${maps}
      <div class="row"><button data-m="back">Retour</button><button data-m="next" class="go">Suivant</button></div>`;
  } else
    menu.innerHTML = `<h2>${title}</h2>
    ${compact ? '' : maps}
    ${seats}
    <fieldset class="options"><legend>Partie</legend>
      ${compact ? `<label>Carte <button type="button" data-m="maps" class="map-change">${chosen.name}</button></label>` : ''}
      <label>Planète ${select('biome', Object.fromEntries(Object.values(BIOMES).map((b) => [b.id, b.name])), s.biome)}</label>
      ${watching ? `<label>Vitesse ${select('speed', { 1: '×1', 2: '×2', 4: '×4' }, String(s.speed))}</label>` : ''}
    </fieldset>
    ${sandbox ? `<fieldset class="options"><legend>Options du bac à sable</legend>${Object.entries(SANDBOX_TOOLS).map(([k, label]) => `<label><input type="checkbox" data-sandbox="${k}"${sandboxPicked.has(k) ? ' checked' : ''}> ${label}</label>`).join('')}</fieldset>` : ''}
    <div class="row"><button data-m="back">Retour</button><button data-m="go" class="go">${watching ? 'Regarder' : 'Jouer'}</button></div>`;
  menu.onchange = (e) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    const tool = el.dataset.sandbox;
    if (tool) return void ((el as HTMLInputElement).checked ? sandboxPicked.add(tool) : sandboxPicked.delete(tool));
    const k = el.dataset.k;
    if (!k) return;
    const v = el.value;
    if (k === 'biome') s.biome = v;
    else if (k === 'speed') s.speed = Number(v);
    else if (k.startsWith('on')) s.sides[Number(k[2])].control = (el as HTMLInputElement).checked ? 'normal' : 'none';
    else if (k[0] === 'f') s.sides[Number(k[1])].faction = asFaction(v);
    else if (k[0] === 't') s.sides[Number(k[1])].team = Number(v);
    else s.sides[Number(k[1])].control = v;
    showSetup(menu, s, step, sandbox);
  };
  menu.onclick = (e) => {
    const button = (e.target as HTMLElement).closest('button');
    const m = button?.dataset.m;
    if (button?.dataset.map) {
      s.map = button.dataset.map;
      // Seats the map has no start for close.
      for (let i = seatsOf(mapFile(s.map)); i < 4; i++) s.sides[i].control = 'none';
      showSetup(menu, s, step, sandbox);
    } else if (m === 'next') showSetup(menu, s, 'players', sandbox);
    else if (m === 'maps' || (m === 'back' && compact && step === 'players')) showSetup(menu, s, 'map', sandbox);
    else if (m === 'back') showHome();
    else if (m === 'go') launch(s, sandbox);
  };
}

/** Joining a friend's match with the code (or the link) they sent. */
function showJoin(menu: HTMLElement): void {
  menu.className = 'menu setup';
  menu.innerHTML = `<h2>Rejoindre un ami</h2>
    <fieldset><legend>Code de la partie</legend><input class="net-input" maxlength="80" placeholder="K7QX" autocomplete="off" spellcheck="false"></fieldset>
    <p class="net-error" hidden></p>
    <div class="row"><button data-m="back">Retour</button><button data-m="go" class="go">Rejoindre</button></div>`;
  const field = menu.querySelector<HTMLInputElement>('.net-input')!;
  const error = menu.querySelector<HTMLElement>('.net-error')!;
  field.focus();
  const go = () => {
    const room = readRoom(field.value);
    if (room) return showLobby(menu, room, false);
    error.hidden = false;
    error.textContent = 'Code invalide : quatre caractères, comme K7QX (ou collez le lien).';
  };
  field.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') go();
  };
  menu.onclick = (e) => {
    const m = (e.target as HTMLElement).closest('button')?.dataset.m;
    if (m === 'back') showHome();
    else if (m === 'go') go();
  };
}

/**
 * The waiting room of a match between two friends: the host gets a link to send; the friend opening it lands here
 * too. Each picks its own faction, the host the map and the planet; the host starts, and both pages load the match.
 */
export function showLobby(menu: HTMLElement, room: string, host: boolean): void {
  history.replaceState(null, '', `${location.pathname}?ami=${room}${host ? '&hote' : ''}`); // a reload comes back to the room, on the same side
  const setup: LobbySetup = { camps: [asFaction(stored('xcraft.camp')), 'humains'], map: MAP.id, biome: biome.id };
  if (!host) setup.camps = [setup.camps[1], setup.camps[0]];
  const me = host ? 0 : 1;
  let status = host ? 'Ouverture du salon…' : 'Connexion au salon…';
  let here = false;
  /** Not getting through: a fresh try is offered (a new room for the host, which may shake off a stale one). */
  let stuck = false;
  const link = `${location.origin}${location.pathname}?ami=${room}`;
  const names = Object.fromEntries(Object.entries(FACTIONS).map(([f, d]) => [f, d.name]));
  const options = (all: Record<string, string>, now: string) => Object.entries(all).map(([v, n]) => `<option value="${v}"${v === now ? ' selected' : ''}>${n}</option>`).join('');
  const seat = (i: number) =>
    `<div class="lobby-seat"><span class="chip" style="background:#${TEAM_COLORS[i].toString(16).padStart(6, '0')}"></span><span class="who">${i === me ? 'Vous' : 'Votre ami'}</span>${
      i === me ? `<select data-k="camp">${options(names, setup.camps[i])}</select>` : '<span class="lobby-other lobby-camp"></span>'
    }</div>`;
  // Built once; what changes is then set in place (refresh), so a list open or a choice being made is never swept away.
  menu.className = 'menu setup lobby';
  menu.innerHTML = `<h2>Partie entre amis</h2>
    ${host ? `<fieldset class="lobby-invite"><legend>Invitez votre ami</legend>
      <p class="lobby-note">Envoyez-lui ce lien : en l'ouvrant, il arrive ici.</p>
      <input class="net-link" readonly value="${link}">
      <div class="row"><button data-m="copy">Copier le lien</button>${'share' in navigator ? '<button data-m="share">Partager…</button>' : ''}</div>
      <p class="lobby-note">ou le code <b>${room}</b> (menu « Rejoindre un ami »)</p></fieldset>` : ''}
    <p class="lobby-note lobby-status"></p>
    <fieldset class="seats"><legend>Joueurs</legend>${seat(0)}${seat(1)}</fieldset>
    <fieldset class="maps${host ? '' : ' fixed'}"></fieldset>
    <fieldset class="options"><legend>Partie</legend><label>Planète ${
      host ? `<select data-k="biome">${options(Object.fromEntries(Object.values(BIOMES).map((b) => [b.id, b.name])), setup.biome)}</select>` : '<span class="lobby-other lobby-biome"></span>'
    }</label></fieldset>
    <div class="row"><button data-m="back">Retour</button><button data-m="retry" hidden>Réessayer</button>${host ? '<button data-m="go" class="go" disabled>Lancer la partie</button>' : ''}</div>`;
  const $ = <T extends HTMLElement>(q: string) => menu.querySelector<T>(q);
  let drawnMaps = '';
  const refresh = () => {
    const invite = $('.lobby-invite');
    if (invite) invite.hidden = here;
    $('.lobby-status')!.textContent = status;
    $('.lobby-camp')!.textContent = here ? names[setup.camps[1 - me]] : 'en attente…';
    const biomeName = $('.lobby-biome');
    if (biomeName) biomeName.textContent = BIOMES[setup.biome]?.name ?? '';
    // The cards' pictures follow the planet: drawn again only when the map or the planet changes.
    const key = `${setup.map}/${setup.biome}`;
    if (key !== drawnMaps) {
      drawnMaps = key;
      const cards = mapCards(mapFile(setup.map).id, setup.biome);
      $('.maps')!.innerHTML = `<legend>Carte${host ? '' : ' (choisie par votre ami)'}</legend>${host ? cards : cards.replace(/<button/g, '<button disabled')}`;
    }
    $<HTMLButtonElement>('[data-m="retry"]')!.hidden = !stuck;
    const go = $<HTMLButtonElement>('[data-m="go"]');
    if (go) go.disabled = !here;
  };
  /** Into the match, with the setup the host sent: the host's page hosts it, the guest's joins it. */
  const play = (s: LobbySetup) => {
    lobby.close();
    try {
      localStorage.setItem('xcraft.camp', s.camps[me]);
    } catch {
      // the URL carries it all
    }
    location.search = `?net=${host ? 'host' : 'join'}&room=${room}&camp=${s.camps[0]}&adversaire=${s.camps[1]}&biome=${s.biome}&map=${s.map}`;
  };
  /** A map or planet not in this build: no match. */
  const unknown = (s: LobbySetup) => !MAPS[s.map] || !BIOMES[s.biome];
  const UNKNOWN_TEXT = "Votre ami a choisi une carte ou une planète que votre version du jeu n'a pas : rechargez la page (tous les deux).";
  const lobby = openLobby(room, host, {
    status: (s, detail) => {
      here = s === 'here';
      stuck = s === 'trouble' || s === 'error';
      status = s === 'here' ? (host ? 'Votre ami est là. Lancez la partie quand vous êtes prêts.' : 'Vous êtes dans le salon. Votre ami lance la partie.')
        : s === 'waiting' ? 'En attente de votre ami…'
        : s === 'gone' ? 'Votre ami est parti, reconnexion…'
        : (detail ?? 'Connexion impossible.');
      if (here && host) lobby.send({ setup });
      if (here && !host) lobby.send({ camp: setup.camps[me] });
      refresh();
    },
    message: (m) => {
      if ('setup' in m && !host) {
        // The guest's own pick stays as it is here: the host's copy may be older, and the start brings the final one.
        Object.assign(setup, { ...m.setup, camps: [m.setup.camps[0], setup.camps[1]] });
        if (unknown(setup)) status = UNKNOWN_TEXT;
      } else if ('camp' in m && host) {
        setup.camps[1] = asFaction(m.camp);
        lobby.send({ setup });
      } else if ('go' in m && !host) {
        if (!unknown(m.go)) return play(m.go);
        status = UNKNOWN_TEXT;
      }
      refresh();
    },
  });
  refresh();
  menu.onchange = (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.k === 'camp') setup.camps[me] = asFaction(el.value);
    else if (el.dataset.k === 'biome') setup.biome = el.value;
    if (host) lobby.send({ setup });
    else lobby.send({ camp: setup.camps[me] });
    refresh();
  };
  /** « Lancer »'s page change, a moment after telling the other side: Retour or Réessayer call it off. */
  let going = 0;
  menu.onclick = (e) => {
    const button = (e.target as HTMLElement).closest('button');
    const m = button?.dataset.m;
    if (button?.dataset.map && host) {
      setup.map = button.dataset.map;
      lobby.send({ setup });
      refresh();
    } else if (m === 'copy') {
      const field = $<HTMLInputElement>('.net-link')!;
      field.select();
      navigator.clipboard?.writeText(link).catch(() => document.execCommand('copy'));
      button!.textContent = 'Lien copié';
    } else if (m === 'share') navigator.share({ title: 'Xcraft', text: 'Une partie de Xcraft ?', url: link }).catch(() => {});
    else if (m === 'go' && here) {
      // The setup as it stands now is the match, on both pages, whatever comes in meanwhile.
      const final: LobbySetup = { ...setup, camps: [...setup.camps] };
      lobby.send({ go: final });
      // A moment for the message to leave before the page does (called off by Retour or Réessayer meanwhile).
      clearTimeout(going);
      going = window.setTimeout(() => play(final), 300);
    } else if (m === 'retry') {
      clearTimeout(going);
      lobby.close();
      showLobby(menu, host ? newRoom() : room, host);
    } else if (m === 'back') {
      clearTimeout(going);
      lobby.close();
      history.replaceState(null, '', location.pathname);
      showHome();
    }
  };
}

function launch(s: Setup, sandbox = false): void {
  const [a, b] = s.sides;
  try {
    localStorage.setItem('xcraft.setup', JSON.stringify(s));
    localStorage.setItem('xcraft.camp', a.faction);
    localStorage.setItem('xcraft.adversaire', b.faction);
    localStorage.setItem('xcraft.biome', s.biome);
    localStorage.setItem('xcraft.map', s.map);
  } catch {
    // the URL carries it all
  }
  const keep = `biome=${s.biome}&camp=${a.faction}&adversaire=${b.faction}&map=${s.map}`;
  if (sandbox) return void (location.search = `?sandbox&${keep}${sandboxPicked.size ? `&outils=${[...sandboxPicked].join(',')}` : ''}`);
  const p = encodeSeats(s.sides.filter((x) => x.control !== 'none'));
  location.search = a.control === 'you' ? `?play&p=${p}&${keep}` : `?spectate&speed=${s.speed}&p=${p}&${keep}`;
}
