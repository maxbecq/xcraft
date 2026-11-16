import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { AI, DIFFICULTY } from './ai/ai';
import { Audio } from './audio';
import { CameraRig } from './camera';
import { Hud } from './game/hud';
import { Input } from './game/input';
import { Minimap } from './minimap';
import { Effects } from './render/effects';
import { Post } from './render/post';
import { PowerNet } from './render/power';
import { Overlay } from './render/overlay';
import { EntityRenderer, MINERAL_VARIANTS, TEAM_COLORS, loadModels } from './render/units';
import { type BuildingDef, DEFS, FACTIONS, type Faction } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import { heightAt } from './map';
import type { Command, Entity } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial, setBiome } from './terrain';
import { BIOMES, pickBiome } from './render/biome';
import { Decor } from './render/decor';
import { addDeposits } from './render/deposits';
import { Lockstep, matchCode, newRoom, readCode } from './net';

/** Edge scrolling: how close to the screen's edge (at the bottom, to the top of the command console) the mouse must be. */
const EDGE_PX = 40;
const params = new URLSearchParams(location.search);
/** `?spectate`: watch the AI play itself, without fog. */
/** Title screen: an AI-versus-AI match plays behind the menu, under a drifting camera. */
/** `?net=host|join&room=ABCD`: a two-player game over the network (the host is player 0). */
const NET_ROLE = params.get('net');
const ATTRACT = !params.has('spectate') && !params.has('play') && !params.has('replay') && !NET_ROLE;
const REPLAY_KEY = 'xcraft.replay';
/** The game just played has been kept as the last game. */
let saved = false;
/** `?replay`: plays back the last saved game (or one opened from a file), watched like a spectator. */
const REPLAY = params.has('replay') ? readReplay() : null;
const SPECTATE = params.has('spectate') || ATTRACT || !!REPLAY;
/** `?speed=4`: simulation speed multiplier. */
const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
const PLAYER_PARAM = params.get('p')?.split(',').findIndex((s) => s.startsWith('you.')) ?? -1;
const PLAYER = NET_ROLE === 'join' ? 1 : Math.max(0, PLAYER_PARAM);

const renderer = new WebGLRenderer({ antialias: true });
/** Phones and tablets: touch controls, lighter rendering. */
const TOUCH = matchMedia('(pointer: coarse)').matches;
renderer.setPixelRatio(Math.min(TOUCH ? 1.25 : 2, window.devicePixelRatio));
document.body.classList.toggle('touch', TOUCH);
renderer.toneMapping = ACESFilmicToneMapping;
const biome = pickBiome(params);
renderer.toneMappingExposure = biome.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

/** Factions: the player's and the AI's, from the URL or the last menu choice. */
const stored = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const asFaction = (v: string | null): Faction => (v === 'isdaris' ? 'isdaris' : 'humains');
/** One player of the match: who plays it (you, an AI difficulty, the network, a replay), its faction and team. */
interface Slot {
  control: string;
  faction: Faction;
  team: number;
}
/**
 * The players: `?p=you.humains.0,hard.isdaris.1,…` (controller, faction, team for each), else the two-player
 * parameters (`camp` and `adversaire` are player 0's and player 1's factions, also over the network).
 */
const slots: Slot[] = REPLAY
  ? REPLAY.factions.map((faction, i) => ({ control: 'replay', faction, team: REPLAY.teams?.[i] ?? i }))
  : params.has('p')
    ? params.get('p')!.split(',').slice(0, 4).map((s, i) => {
        const [control, faction, team] = s.split('.');
        return { control: control || 'normal', faction: asFaction(faction), team: Number(team) || i };
      })
    : [
        { control: NET_ROLE ? 'net' : SPECTATE ? (params.get('ai0') ?? 'normal') : 'you', faction: asFaction(params.get('camp') ?? stored('xcraft.camp')), team: 0 },
        { control: NET_ROLE ? 'net' : (params.get(SPECTATE ? 'ai1' : 'ai') ?? 'normal'), faction: asFaction(params.get('adversaire') ?? stored('xcraft.adversaire')), team: 1 },
      ];
if (slots.length < 2) slots.push({ control: 'normal', faction: 'humains', team: 1 });
const factions = slots.map((s) => s.faction);
const [myFaction, foeFaction] = factions;
const world = createMatch(factions, slots.map((s) => s.team));
document.body.classList.toggle('isdaris', factions[PLAYER] === 'isdaris'); // spectating shows the first side's interface
document.body.classList.toggle('spectate', SPECTATE);
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
const sees = (e: Entity) => SPECTATE || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => SPECTATE || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
// Every player not played by someone is an AI, its difficulty a harvesting handicap.
const ais = REPLAY || NET_ROLE ? [] : slots.flatMap((s, i) => (s.control === 'you' && !SPECTATE ? [] : [new AI(world, i)]));
if (!REPLAY && !NET_ROLE) slots.forEach((s, i) => (world.players[i].handicap = DIFFICULTY[s.control] ?? 100));
if (REPLAY) REPLAY.handicap.forEach((h, i) => (world.players[i].handicap = h));
/** Every command the simulation took, by tick: the whole game, since it is deterministic. */
const record: Replay = { v: 1, factions, teams: slots.map((s) => s.team), biome: biome.id, handicap: world.players.map((p) => p.handicap), ticks: [] };
const replayed = new Map(REPLAY?.ticks ?? []);
// A game left before its end is kept too.
window.addEventListener('pagehide', () => {
  if (!saved && !REPLAY && !ATTRACT && record.ticks.length) saved = saveReplay(record);
});
const map = world.map;
const scene = new Scene();
scene.background = new Color(biome.background);
setBiome(biome);
const terrain = buildTerrain(map);
scene.add(terrain);
const fog = createFog(map);
addFog(terrain, fog, map);
const decor = new Decor(map, world, biome.decorTint, !!biome.greyStones);
addDeposits(scene, map, world, (m) => fogMaterial(m, fog, map));

// Warm low sun from the north-west, cool sky fill: long readable shadows like SC2.
scene.add(new HemisphereLight(biome.sky.color, biome.sky.ground, biome.sky.intensity));
const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
const SUN_OFFSET = new Vector3(-22, 40, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 2048 : 4096, TOUCH ? 2048 : 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
// The shadow box follows the camera, so shadows stay crisp.
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
scene.add(sun, sun.target);

let pending: Command[] = [];

// Network game: a banner while waiting for the other player, or once the link is lost.
const netBanner = document.createElement('div');
netBanner.className = 'net-banner';
netBanner.hidden = true;
document.body.append(netBanner);
const ROOM = params.get('room') ?? '';
const net = NET_ROLE ? new Lockstep(PLAYER, ROOM, (status, detail) => showNet(status, detail)) : null;
function showNet(status: string, detail?: string): void {
  if (status === 'connected') {
    netBanner.hidden = true;
    return;
  }
  netBanner.hidden = false;
  if (status === 'waiting' && PLAYER === 0) {
    const code = matchCode(ROOM, [factions[0], factions[1]], biome.id);
    const link = `${location.origin}${location.pathname}?net=join&room=${ROOM}&camp=${factions[0]}&adversaire=${factions[1]}&biome=${biome.id}`;
    netBanner.innerHTML = `<h2>En attente de votre adversaire</h2>
      <p>Donnez-lui ce code (menu « Rejoindre une partie ») :</p><div class="net-code">${code}</div>
      <p>ou ce lien :</p><input class="net-link" readonly value="${link}"><button data-n="copy">Copier le lien</button>
      <button data-n="quit">Annuler</button>`;
  } else if (status === 'waiting') netBanner.innerHTML = '<h2>Connexion à la partie…</h2><button data-n="quit">Annuler</button>';
  else netBanner.innerHTML = `<h2>${status === 'lost' ? 'Connexion perdue' : 'Connexion impossible'}</h2>${detail ? `<p>${detail}</p>` : ''}<button data-n="quit">Menu principal</button>`;
}
netBanner.addEventListener('click', (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')?.dataset.n;
  if (n === 'copy') {
    const field = netBanner.querySelector<HTMLInputElement>('.net-link')!;
    field.select();
    navigator.clipboard?.writeText(field.value).catch(() => document.execCommand('copy'));
  } else if (n === 'quit') {
    net?.close();
    location.search = `?biome=${biome.id}`;
  }
});
if (net) showNet('waiting');
// Leaving the page tells the other side at once, rather than after the silence timeout.
window.addEventListener('pagehide', () => net?.close());
let desyncShown = false;
/** A cheap fingerprint of the game state, compared between the two sides of a network game. */
const checksum = () => {
  let h = world.tick;
  for (const e of world.entities.values()) h = (Math.imul(h, 31) + e.id * 7 + e.x * 3 + e.y * 5 + e.hp) | 0;
  for (const p of world.players) h = (Math.imul(h, 31) + p.minerals + p.energy * 3) | 0;
  return h;
};


const rig = new CameraRig(map.width, map.height);
// Upright phones: zoom out so the narrow view still spans a dozen tiles.
if (window.innerHeight > window.innerWidth) rig.viewHeight = 26;
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === FACTIONS[factions[PLAYER]].hq)!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, rig, issue: (c: Command) => pending.push(c) } });

const minimap = new Minimap(map, rig, 164);

const units = new EntityRenderer(scene, map);
units.onBuilding = (e) => decor.hideUnder(e.tx, e.ty, (e.def as { size: number }).size);
// Spectating (or a replay): every side is played by the computer, nobody else gives orders.
const issue = (c: Command) => {
  if (!SPECTATE) pending.push(c);
};
const input = new Input(world, map, PLAYER, {
  camera: () => rig.camera,
  terrain,
  roots: () => units.roots,
  issue,
  focus: (x, z) => rig.lookAt(x, z),
  click: (button, ground, shift, target) => hud.click(button, ground, shift, target),
  ordered: (x, z, target) => overlay.mark(PLAYER, x, z, target),
  pan: (dx, dy) => rig.panPixels(dx, dy),
  zoom: (f) => rig.zoomBy(f),
}, renderer.domElement);
const audio = new Audio();
const hud = new Hud(world, map, PLAYER, input, scene, issue, audio);
hud.mapSlot.append(minimap.canvas);
minimap.onOrder = (x, y) => input.orderAt(x, y);
minimap.intercept = (x, y) => hud.minimapClick(x, y);
const fxScene = new Scene();
const effects = new Effects(fxScene, scene, map, audio);
const overlay = new Overlay(map);
overlay.hostile = (a, b) => world.hostile(a, b);
const power = new PowerNet(scene, map);
document.body.insertBefore(overlay.canvas, renderer.domElement.nextSibling);

/** Copies the player's fog of war to the terrain and minimap. */
function updateFog(): void {
  const tiles = SPECTATE ? world.vision[PLAYER].tiles.map(() => 2) : world.vision[PLAYER].tiles;
  const data = fog.image.data as Uint8Array;
  for (let i = 0; i < tiles.length; i++) data[i] = tiles[i] === 2 ? 255 : tiles[i] === 1 ? 128 : 0;
  fog.needsUpdate = true;
  minimap.fog(tiles);
}

// Camera: arrow keys, screen-edge scrolling, wheel zoom.
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key));
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => keys.clear());

let mouse: { x: number; y: number } | null = null;
// Edge scrolling follows the mouse only: fingers drag the map instead.
window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') mouse = { x: e.clientX, y: e.clientY };
});
document.addEventListener('mouseleave', () => (mouse = null));
// Wheel zooms. A trackpad's two-finger scroll (sideways or fractional pixel deltas) pans,
// and its pinch (sent as ctrl+wheel) zooms.
window.addEventListener('wheel', (e) => {
  if (!(e.target instanceof HTMLCanvasElement)) return;
  e.preventDefault();
  const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
  if (e.ctrlKey) rig.zoomBy(Math.exp(e.deltaY * 0.01));
  else if (trackpad) rig.panPixels(-e.deltaX, -e.deltaY);
  else rig.zoomBy(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// Glowing edge and arrow cursor while the mouse scrolls the map.
const edgeGlow = document.createElement('div');
edgeGlow.className = 'edge-glow';
document.body.append(edgeGlow);
let edgeShown = '';
function scrollDirection(): [number, number] {
  let dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  let dy = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
  let edge = '';
  if (mouse && !paused && !ATTRACT) {
    let ex = mouse.x < EDGE_PX ? -1 : mouse.x > window.innerWidth - EDGE_PX ? 1 : 0;
    // The bottom band sits just above the console, so its buttons never scroll the map.
    const bottom = document.querySelector('.console')?.getBoundingClientRect().top ?? window.innerHeight;
    edgeGlow.style.setProperty('--edge-bottom', `${window.innerHeight - bottom}px`);
    let ey = mouse.y < EDGE_PX ? 1 : mouse.y > bottom - EDGE_PX && mouse.y < bottom ? -1 : 0;
    // Near a corner along an edge (the outer fifth): scroll diagonally, no need to aim for the corner itself.
    const cornerX = window.innerWidth * 0.2;
    const cornerY = bottom * 0.2;
    if (ex && !ey) ey = mouse.y < cornerY ? 1 : mouse.y > bottom - cornerY && mouse.y < bottom ? -1 : 0;
    if (ey && !ex) ex = mouse.x < cornerX ? -1 : mouse.x > window.innerWidth - cornerX ? 1 : 0;
    if (ex) dx = ex;
    if (ey) dy = ey;
    edge = (ey > 0 ? 'n' : ey < 0 ? 's' : '') + (ex > 0 ? 'e' : ex < 0 ? 'w' : '');
  }
  if (edge !== edgeShown) {
    edgeShown = edge;
    edgeGlow.className = `edge-glow ${[...edge].map((d) => `edge-${d}`).join(' ')}`;
    document.body.style.cursor = edge ? `${edge}-resize` : '';
  }
  return [dx, dy];
}

renderer.setSize(window.innerWidth, window.innerHeight);
const post = new Post(renderer, scene, fxScene, rig.camera, !params.has('lowfx'), TOUCH);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

/** Where buildings give off smoke or steam: [x, y, z offset from the centre, dark smoke?]. */
const VENTS: Record<string, [number, number, number, boolean]> = {
  conseil: [-1.4, 0.8, 2.0, true], // the burning tyre stack
  mine: [-0.9, 0.9, -0.7, false], // generator steam
  puits: [0, 0.2, 0, false], // energy mist rising from the well
};

const TICK = 1 / TICK_RATE;
const clock = new Clock();
let acc = 0;
// Pause menu (with the controls) and tool buttons.
let paused = false;
/** Edge and arrow-key scrolling, eased: current speed per axis (-1..1), and how fast it changes per second. */
const scroll = { x: 0, y: 0 };
const SCROLL_ACCEL = 4;
const tools = document.createElement('div');
tools.className = 'tools';
tools.innerHTML = '<button class="tool" data-t="menu" title="Menu">≡<span> Menu</span></button><button class="tool" data-t="army" title="Toute l\'armée">⚔<span> Armée</span></button>';
const pause = document.createElement('div');
pause.className = 'pause';
pause.hidden = true;
pause.innerHTML = `<div class="pause-box">
<h2>Pause</h2>
<button data-p="resume">Reprendre</button>
<button data-p="help">Contrôles</button>
<button data-p="restart">Recommencer</button>
<button data-p="replay">Enregistrer le replay</button>
<button data-p="quit">Quitter la partie</button>
<div class="help" hidden><h3>Contrôles</h3>
Clic gauche / rectangle : sélectionner (<kbd>Maj</kbd> pour ajouter)<br>
Clic droit : déplacer, récolter, attaquer, point de ralliement<br>
<kbd>A</kbd> puis clic : attaquer / attaque-déplacement<br>
<kbd>S</kbd> stop · <kbd>B</kbd> construire (serf) · <kbd>Échap</kbd> annuler<br>
<kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> : groupe, <kbd>1</kbd>…<kbd>9</kbd> : rappel (×2 : centrer)<br>
Flèches, bords d'écran, minimap, clic molette glissé, deux doigts (trackpad) : caméra · molette, pincer : zoom<br>
<kbd>F2</kbd> ou ⚔ : toute l'armée · <kbd>F1</kbd>, <kbd>F10</kbd> ou ≡ : menu et pause
<h3>Écran tactile</h3>
Tap : sélectionner, puis tap ailleurs pour donner l'ordre<br>
Double tap : toutes les unités de ce type à l'écran<br>
Glisser : déplacer la vue · pincer : zoomer<br>
Appui long puis glisser : rectangle de sélection</div></div>`;
document.body.append(tools, pause);
const helpText = pause.querySelector<HTMLElement>('.help')!;
const setPaused = (on: boolean) => {
  paused = on;
  pause.hidden = !on;
  if (!on) helpText.hidden = true;
};
tools.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
  if (t === 'menu') setPaused(!paused);
  if (t === 'army') input.selectArmy();
});
// The pause menu and the end-of-game banner share these actions.
document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('.pause [data-p], .hud-banner [data-p]');
  const p = button?.dataset.p;
  if (p === 'resume') setPaused(false);
  else if (p === 'help') helpText.hidden = !helpText.hidden;
  else if (p === 'restart' && !net) location.reload();
  else if (p === 'replay') downloadReplay(record);
  else if (p === 'quit' || p === 'restart') {
    net?.close();
    location.search = `?biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}`;
  }
});
// Captured first: while paused, game hotkeys do nothing; F1, F10 and Escape close the menu.
window.addEventListener(
  'keydown',
  (e) => {
    if (e.key === 'F1' || e.key === 'F10' || (paused && e.key === 'Escape')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!ATTRACT) setPaused(!paused);
    } else if (paused) e.stopImmediatePropagation();
  },
  { capture: true },
);
window.addEventListener('pointerdown', () => audio.start(), { once: true });

const ready = Promise.all([loadModels([...Object.keys(DEFS).filter((t) => DEFS[t].kind !== 'upgrade'), ...MINERAL_VARIANTS]), decor.load(scene, (m) => fogMaterial(m, fog, map))]);
if (!ATTRACT) {
  ready.then(start);
} else {
  document.body.classList.add('attract');
  ready.then(start);
  showHome();
}

/** A match to set up: each side's faction and who plays it, the planet, and the speed when only AIs play. */
interface Setup {
  /** Four seats; `control` 'none' leaves a seat empty (the third and fourth by default). */
  sides: { faction: Faction; control: string; team: number }[];
  biome: string;
  speed: number;
}
const CONTROLS: Record<string, string> = { none: 'Fermé', you: 'Vous', easy: 'IA facile', normal: 'IA normale', hard: 'IA difficile', online: 'Ami en ligne' };

function readSetup(): Setup {
  const fallback: Setup = {
    sides: [
      { faction: myFaction, control: 'you', team: 0 },
      { faction: foeFaction, control: 'normal', team: 1 },
      { faction: 'humains', control: 'none', team: 2 },
      { faction: 'isdaris', control: 'none', team: 3 },
    ],
    biome: biome.id,
    speed: 2,
  };
  try {
    const s = JSON.parse(stored('xcraft.setup') ?? 'null') as Setup | null;
    if (s && Array.isArray(s.sides) && s.sides.length >= 2 && BIOMES[s.biome]) {
      // Older saves had two seats and no teams.
      const old = s.sides;
      s.sides = [0, 1, 2, 3].map((i) => ({ ...fallback.sides[i], ...old[i], team: old[i]?.team ?? i }));
      return s;
    }
  } catch {
    // a broken entry: start over
  }
  return fallback;
}

function showHome(): void {
  const menu = document.querySelector('.menu') ?? document.body.appendChild(document.createElement('div'));
  menu.className = 'menu';
  menu.innerHTML = `<h1>XCRAFT</h1><p>Humains · Isdaris</p>
    <button data-m="new">Nouvelle partie</button>
    <button data-m="join">Rejoindre une partie</button>
    <div class="row">
      ${stored(REPLAY_KEY) ? '<button data-m="last-replay">Revoir la dernière partie</button>' : ''}
      <button data-m="open-replay">Ouvrir un replay…</button>
    </div>
    <div class="build">v${__VERSION__} · ${__COMMIT__} · ${new Date(__BUILT__).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</div>`;
  (menu as HTMLElement).onclick = (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    if (m === 'new') showSetup(menu as HTMLElement, readSetup());
    else if (m === 'join') showJoin(menu as HTMLElement);
    else if (m === 'last-replay') playReplay(readReplay());
    else if (m === 'open-replay') openReplayFile();
  };
}

/** The match setup screen: picks are toggled in place, then the match loads from the URL. */
function showSetup(menu: HTMLElement, s: Setup): void {
  const pick = (key: string, options: Record<string, string>, now: string) =>
    `<div class="pick">${Object.entries(options)
      .map(([v, label]) => `<button data-k="${key}" data-v="${v}"${v === now ? ' class="on"' : ''}>${label}</button>`)
      .join('')}</div>`;
  const factions = Object.fromEntries(Object.entries(FACTIONS).map(([f, d]) => [f, d.name]));
  const seated = s.sides.filter((x) => x.control !== 'none').length;
  const side = (i: number) => {
    const controls: Record<string, string> = { ...CONTROLS };
    if (i > 0) delete controls.you; // the local player is always the first side
    if (i < 2) delete controls.none; // at least two players
    // A friend online plays the second side, one against one only (for now).
    if (i !== 1 || s.sides[0].control !== 'you' || s.sides[2].control !== 'none' || s.sides[3].control !== 'none') delete controls.online;
    const color = `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    const open = s.sides[i].control !== 'none';
    const teams = seated > 2 && open ? pick(`t${i}`, { 0: 'Équipe 1', 1: 'Équipe 2', 2: 'Équipe 3', 3: 'Équipe 4' }, String(s.sides[i].team)) : '';
    return `<fieldset><legend style="color:${color}">Joueur ${i + 1}</legend>${open ? pick(`f${i}`, factions, s.sides[i].faction) : ''}${pick(`c${i}`, controls, s.sides[i].control)}${teams}</fieldset>`;
  };
  const watching = s.sides[0].control !== 'you';
  menu.className = 'menu setup';
  menu.innerHTML = `<h2>Nouvelle partie</h2>
    ${side(0)}${side(1)}${side(2)}${side(3)}
    <fieldset><legend>Planète</legend>${pick('biome', Object.fromEntries(Object.values(BIOMES).map((b) => [b.id, b.name])), s.biome)}</fieldset>
    ${watching ? `<fieldset><legend>Vitesse</legend>${pick('speed', { 1: '×1', 2: '×2', 4: '×4' }, String(s.speed))}</fieldset>` : ''}
    <div class="row"><button data-m="back">Retour</button><button data-m="go" class="go">${watching ? 'Regarder' : 'Jouer'}</button></div>`;
  menu.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const { k, v, m } = b.dataset;
    if (k && v) {
      if (k === 'biome') s.biome = v;
      else if (k === 'speed') s.speed = Number(v);
      else if (k[0] === 'f') s.sides[Number(k[1])].faction = asFaction(v);
      else if (k[0] === 't') s.sides[Number(k[1])].team = Number(v);
      else s.sides[Number(k[1])].control = v;
      const crowd = s.sides[2].control !== 'none' || s.sides[3].control !== 'none';
      if ((s.sides[0].control !== 'you' || crowd) && s.sides[1].control === 'online') s.sides[1].control = 'normal';
      showSetup(menu, s);
    } else if (m === 'back') showHome();
    else if (m === 'go') launch(s);
  };
}

/** Joining a friend's network game with the code shown on their screen. */
function showJoin(menu: HTMLElement): void {
  menu.className = 'menu setup';
  menu.innerHTML = `<h2>Rejoindre une partie</h2>
    <fieldset><legend>Code de la partie</legend><input class="net-input" maxlength="9" placeholder="K7QX-HIL" autocomplete="off" spellcheck="false"></fieldset>
    <p class="net-error" hidden></p>
    <div class="row"><button data-m="back">Retour</button><button data-m="go" class="go">Rejoindre</button></div>`;
  const field = menu.querySelector<HTMLInputElement>('.net-input')!;
  const error = menu.querySelector<HTMLElement>('.net-error')!;
  field.focus();
  const go = () => {
    const c = readCode(field.value, Object.keys(BIOMES));
    if (!c) {
      error.hidden = false;
      error.textContent = 'Code invalide : il ressemble à K7QX-HIL.';
      return;
    }
    location.search = `?net=join&room=${c.room}&camp=${c.factions[0]}&adversaire=${c.factions[1]}&biome=${c.biome}`;
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

function launch(s: Setup): void {
  const [a, b] = s.sides;
  try {
    localStorage.setItem('xcraft.setup', JSON.stringify(s));
    localStorage.setItem('xcraft.camp', a.faction);
    localStorage.setItem('xcraft.adversaire', b.faction);
    localStorage.setItem('xcraft.biome', s.biome);
  } catch {
    // the URL carries it all
  }
  const keep = `biome=${s.biome}&camp=${a.faction}&adversaire=${b.faction}`;
  const seated = s.sides.filter((x) => x.control !== 'none');
  // With two players, each is its own team whatever was picked; with more, teams as chosen.
  const teams = seated.length > 2 && !seated.every((x) => x.team === seated[0].team);
  const p = seated.map((x, i) => `${x.control}.${x.faction}.${teams ? x.team : i}`).join(',');
  if (b.control === 'online') location.search = `?net=host&room=${newRoom()}&${keep}`;
  else location.search = a.control === 'you' ? `?play&p=${p}&${keep}` : `?spectate&speed=${s.speed}&p=${p}&${keep}`;
}

function start(): void {
  clock.getDelta();
  const timing: Record<string, number> = {};
  if (import.meta.env.DEV) Object.assign(window, { timing });
  let mark = 0;
  const lap = (name: string) => {
    const now = performance.now();
    timing[name] = (timing[name] ?? 0) * 0.9 + (now - mark) * 0.1;
    mark = now;
  };
  const frame = (elapsed: number) => {
    mark = performance.now();
    const dt = Math.min(elapsed, 0.25);
    acc += dt * SPEED;
    while (acc >= TICK) {
      // Network game: wait for the other side's orders for this tick (and do not race ahead after a stall).
      if (net && !net.ready(world.tick)) {
        acc = Math.min(acc, TICK);
        break;
      }
      const cmds = REPLAY ? (replayed.get(world.tick) ?? []) : net ? net.step(world.tick, pending) : [...pending, ...ais.flatMap((ai) => ai.think())];
      if (net && world.tick % 100 === 0) net.check(world.tick, checksum());
      if (net?.desync && !desyncShown) {
        desyncShown = true;
        showNet('lost', 'Les deux parties ne sont plus identiques (désynchronisation).');
      }
      if (cmds.length && !ATTRACT) record.ticks.push([world.tick, cmds]);
      world.step(cmds);
      if (world.winner !== null && !REPLAY && !ATTRACT && !saved) saved = saveReplay(record);
      pending = [];
      hud.notify(world.events);
      effects.collect(world, seenAt);
      if (world.tick % 4 === 1) updateFog();
      acc -= TICK;
    }
    lap('sim');
    const [dx, dy] = scrollDirection();
    if (ATTRACT) {
      // Slow orbit over the battlefield.
      const t = performance.now() / 1000 / 40;
      rig.lookAt(map.width / 2 + Math.cos(t) * 26, map.height / 2 + Math.sin(t) * 26);
    } else {
      // Eased scrolling: the view speeds up over a quarter second, then glides to a stop (slow, fast, slow).
      const step = SCROLL_ACCEL * dt;
      scroll.x += Math.max(-step, Math.min(step, dx - scroll.x));
      scroll.y += Math.max(-step, Math.min(step, dy - scroll.y));
      const ease = (v: number) => Math.sign(v) * Math.abs(v) * Math.abs(v) * (3 - 2 * Math.abs(v)); // smoothstep
      if (scroll.x || scroll.y) rig.pan(ease(scroll.x), ease(scroll.y), dt);
    }
    rig.update(window.innerWidth / window.innerHeight);
    input.prune();
    units.sync(world, acc / TICK, input.selected, PLAYER, sees);
    lap('units');
    hud.update();
    lap('hud');
    for (const e of world.entities.values()) {
      // Serfs at work: the jackhammer throws blue sparks where it bites (the field or the building site).
      const o = e.order;
      if (e.type === 'serf' && e.x === e.px && e.y === e.py && sees(e) && ((o?.kind === 'gather' && o.phase === 'mine') || o?.kind === 'construct')) {
        const t = world.entities.get(o.target);
        if (t) {
          const x = e.x / FP;
          const z = e.y / FP;
          const d = Math.hypot(t.x / FP - x, t.y / FP - z) || 1;
          const tx = x + ((t.x / FP - x) / d) * 0.32;
          const tz = z + ((t.y / FP - z) / d) * 0.32;
          effects.sparks(new Vector3(tx, heightAt(map, tx, tz) + 0.05, tz), dt);
        }
      }
      if (e.type === 'puits') {
        const covered = [...world.entities.values()].some((m) => m.def.kind === 'building' && m.def.energyRate && m.tx === e.tx && m.ty === e.ty);
        if (!covered) effects.ambient(new Vector3(e.x / FP, heightAt(map, e.x / FP, e.y / FP) + 0.2, e.y / FP), dt, false);
        continue;
      }
      if (e.def.kind !== 'building' || e.buildLeft > 0 || !sees(e)) continue;
      const vent = VENTS[e.type];
      if (vent) {
        const vx = e.x / FP + vent[0];
        const vz = e.y / FP + vent[2];
        effects.ambient(new Vector3(vx, heightAt(map, e.x / FP, e.y / FP) + vent[1], vz), dt, vent[3]);
      }
      if (e.hp > e.maxHp / 2) continue;
      const size = e.def.size;
      const x = e.x / FP;
      const z = e.y / FP;
      effects.burn(new Vector3(x, heightAt(map, x, z) + size * 0.4, z), e.hp / e.maxHp, size, dt);
    }
    effects.update(dt);
    overlay.draw(world, rig.camera, input.selected, sees, acc / TICK);
    const placed = hud.placingType && (DEFS[hud.placingType] as BuildingDef).warp;
    power.update(world, sees, !!placed || [...input.selected].some((id) => !!(world.entities.get(id)?.def as BuildingDef | undefined)?.power));
    audio.frame();
    lap('fx+overlay');
    minimap.draw(world, sees);
    lap('minimap');
    sun.target.position.copy(rig.target);
    sun.position.copy(rig.target).add(SUN_OFFSET);
    post.render();
    lap('render');
  };
  // Dev: xcraft.frame(dt) advances one frame by hand (handy when the browser throttles animation frames).
  if (import.meta.env.DEV) Object.assign((window as unknown as { xcraft: object }).xcraft, { frame, effects, fxScene, scene, input, renderer });
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    // Paused: the world, units and effects stand still; the picture is still drawn under the menu.
    // A network game never pauses: the other player is still playing.
    if (paused && !net) post.render();
    else frame(dt);
  });
}

// ---------------------------------------------------------------- replays

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
interface Replay {
  v: 1;
  factions: Faction[];
  /** Each player's team; missing in replays from before teams (everyone alone). */
  teams?: number[];
  biome: string;
  handicap: number[];
  ticks: [number, Command[]][];
}

/** The replay to play: one opened from a file this session, else the last saved game. */
function readReplay(): Replay | null {
  for (const read of [() => sessionStorage.getItem(REPLAY_KEY), () => localStorage.getItem(REPLAY_KEY)]) {
    try {
      const r = JSON.parse(read() ?? 'null') as Replay | null;
      if (r?.v === 1 && Array.isArray(r.ticks)) return r;
    } catch {
      // unavailable or not a replay: try the next place
    }
  }
  return null;
}

/** Keeps the game as the "last game" (games that do not fit in storage are just not kept). */
function saveReplay(r: Replay): boolean {
  try {
    localStorage.setItem(REPLAY_KEY, JSON.stringify(r));
  } catch {
    // storage full or blocked
  }
  return true;
}

function playReplay(r: Replay | null): void {
  if (r) location.search = `?replay&speed=2&biome=${r.biome}`;
}

function downloadReplay(r: Replay): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
  a.download = `xcraft-${r.factions.join('-')}-${new Date().toISOString().slice(0, 16).replace(':', 'h')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Lets the player pick a replay file, then plays it. */
function openReplayFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const text = await input.files?.[0]?.text();
    if (!text) return;
    try {
      const r = JSON.parse(text) as Replay;
      if (r.v !== 1 || !Array.isArray(r.ticks)) throw new Error('not a replay');
      sessionStorage.setItem(REPLAY_KEY, text);
      playReplay(r);
    } catch {
      alert('Ce fichier n’est pas un replay Xcraft.');
    }
  };
  input.click();
}
