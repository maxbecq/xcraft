import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { AI, DIFFICULTY } from './ai/ai';
import { Audio, type Sfx } from './audio';
import { holdPointer } from './game/pointerlock';
import { CameraRig, MAX_VIEW } from './camera';
import { stageAttract } from './game/attract';
import { Hud } from './game/hud';
import { Input } from './game/input';
import { Minimap } from './minimap';
import { Effects } from './render/effects';
import { Post } from './render/post';
import { Paving } from './render/paving';
import { PowerNet } from './render/power';
import { Overlay } from './render/overlay';
import { EntityRenderer, MINERAL_VARIANTS, TEAM_COLORS, loadModels } from './render/units';
import { type BuildingDef, DEFS, FACTIONS, type Faction, LOOKS } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import { DEFAULT_MAP, MAPS, mapFile } from './maps';
import { mapCards, seatsOf } from './mappicker';
import { PerfHud } from './perf';
import { detectQuality, pickQuality, QUALITY, QUALITY_KEY, QUALITY_NAMES } from './quality';
import { heightAt } from './map';
import type { Command, Entity } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial, setBiome, UNDER_DECK } from './terrain';
import { BIOMES, cityAbyss, cityRoads, cityScape, cityStreets, cityUnderdeck, pickBiome } from './render/biome';
import { Decor } from './render/decor';
import { addDeposits } from './render/deposits';
import { connect, every, matchCode, newRoom, readCode, stateHash, type NetStatus } from './net';
import { countMatch, countTitle, SKIPPED } from './stats';

/** Edge scrolling: how close to the screen's edge (at the bottom, to the top of the command console) the mouse must be. */
/** Control settings for this computer (Options, also from the pause menu): edge scrolling's speed, band width (1 = as
 * designed), speed-up while held (0 = none) and coasting on letting go (s); the held cursor's speed (one to one with the system cursor at 1)
 * (game/pointerlock.ts); the pointer held in the window; grid hotkeys; the game's speed against the AI. */
const SCROLL_KEY = 'xcraft.scroll';
const SCROLL_BASE = { speed: 1, band: 1, ramp: 1, coast: 0.4, mouse: 1, lock: false, grid: false, halo: true, game: 1 };
type Controls = typeof SCROLL_BASE;
const SCROLL: Controls = (() => {
  const base = { ...SCROLL_BASE };
  try {
    // Holding the pointer is off unless chosen again: an earlier version stored it on, hence `lock2`, which ignores the old `lock`.
    const stored = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? '{}');
    for (const k of ['speed', 'band', 'ramp', 'coast', 'mouse', 'game'] as const) if (typeof stored[k] === 'number' && Number.isFinite(stored[k])) base[k] = stored[k];
    return { ...base, lock: stored.lock2 === true, grid: stored.grid === true, halo: stored.halo !== false };
  } catch {
    return base;
  }
})();
function saveControls(): void {
  try {
    const { lock, ...rest } = SCROLL;
    localStorage.setItem(SCROLL_KEY, JSON.stringify({ ...rest, lock2: lock }));
  } catch {
    // private browsing: kept for this page only
  }
}
/** Its width grows with the screen: 12 % of its short side, never under 120 px (130 px on a 1080p screen), times the setting. */
const edgeBand = () => Math.round(SCROLL.band * Math.max(120, 0.12 * Math.min(window.innerWidth, window.innerHeight)));
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
/** Alone against the AI, the game's speed is a setting (never online: both machines must step alike). */
const SOLO = params.has('play') && !NET_ROLE;
const gameSpeed = () => (SOLO ? SCROLL.game : SPEED);
const PLAYER_PARAM = params.get('p')?.split(',').findIndex((s) => s.startsWith('you.')) ?? -1;
const PLAYER = NET_ROLE === 'join' ? 1 : Math.max(0, PLAYER_PARAM);

const renderer = new WebGLRenderer({ antialias: true });
const perf = new PerfHud(renderer);
renderer.localClippingEnabled = true; // Z buildings are fabricated layer by layer (render/units.ts)
/** Phones and tablets: touch controls, lighter rendering. */
const TOUCH = matchMedia('(pointer: coarse)').matches;
/** Graphics quality, from the URL, the menu's choice or the graphics chip (src/quality.ts). */
const DETECTED = detectQuality(renderer, TOUCH);
const QUALITY_LEVEL = pickQuality(params, (() => {
  try {
    return localStorage.getItem(QUALITY_KEY);
  } catch {
    return null;
  }
})(), DETECTED);
const GFX = QUALITY[QUALITY_LEVEL];
renderer.setPixelRatio(Math.min(GFX.pixelRatio, window.devicePixelRatio));
document.body.classList.toggle('touch', TOUCH);
renderer.toneMapping = ACESFilmicToneMapping;
const biome = pickBiome(params);
renderer.toneMappingExposure = biome.exposure;
renderer.shadowMap.enabled = GFX.shadows > 0;
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
const asFaction = (v: string | null): Faction => (v === 'isdaris' || v === 'z' || v === 'dieux' ? v : 'humains');
/** The map: a replay's, else from the URL, else the last one picked. */
const MAP = mapFile(REPLAY ? (REPLAY.map ?? DEFAULT_MAP) : (params.get('map') ?? stored('xcraft.map')));
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
slots.length = Math.min(slots.length, seatsOf(MAP)); // no more players than the map has starts
const factions = slots.map((s) => s.faction);
const [myFaction, foeFaction] = factions;
const world = createMatch(factions, slots.map((s) => s.team), MAP.id, biome.id);
// Title screen: a still scene, not a running match (no simulation, no AI, so no fights and no sound).
if (ATTRACT) stageAttract(world);
document.body.classList.toggle('isdaris', factions[PLAYER] === 'isdaris'); // spectating shows the first side's interface
document.body.classList.toggle('z', factions[PLAYER] === 'z');
document.body.classList.toggle('dieux', factions[PLAYER] === 'dieux');
document.body.classList.toggle('humains', factions[PLAYER] === 'humains');
document.body.classList.toggle('spectate', SPECTATE);
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
const sees = (e: Entity) => SPECTATE || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => SPECTATE || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
// Every player not played by someone is an AI, its difficulty a harvesting handicap.
const ais = REPLAY || NET_ROLE || ATTRACT ? [] : slots.flatMap((s, i) => (s.control === 'you' && !SPECTATE ? [] : [new AI(world, i, undefined, s.control)]));
if (!REPLAY && !NET_ROLE) slots.forEach((s, i) => (world.players[i].handicap = DIFFICULTY[s.control] ?? 100));
if (REPLAY) REPLAY.handicap.forEach((h, i) => (world.players[i].handicap = h));
/** Every command the simulation took, by tick: the whole game, since it is deterministic. */
const record: Replay = { v: 1, map: MAP.id, factions, teams: slots.map((s) => s.team), biome: biome.id, handicap: world.players.map((p) => p.handicap), ticks: [] };
const replayed = new Map(REPLAY?.ticks ?? []);
// A game left before its end is kept too.
window.addEventListener('pagehide', () => {
  if (!saved && !REPLAY && !ATTRACT && record.ticks.length) saved = saveReplay(record);
});
const map = world.map;
const scene = new Scene();
scene.background = new Color(biome.background);
setBiome(biome);
const roads = biome.style === 'city' ? cityRoads(world) : undefined;
const terrain = buildTerrain(map, roads?.texture);
scene.add(terrain);
const fog = createFog(map);
addFog(terrain, fog, map);
const decor = new Decor(map, world, biome.decorTint, !!biome.greyStones, roads?.streets);
if (biome.style === 'city') scene.add(cityAbyss(map.width, map.height), cityScape(map.width, map.height, 0), cityUnderdeck(map, UNDER_DECK), cityStreets(map, (x, z) => heightAt(map, x, z)));
addDeposits(scene, map, world, (m) => fogMaterial(m, fog, map));

// Warm low sun from the north-west, cool sky fill: long readable shadows like SC2.
scene.add(new HemisphereLight(biome.sky.color, biome.sky.ground, biome.sky.intensity));
const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
const SUN_OFFSET = new Vector3(-22, 40, -12);
sun.castShadow = GFX.shadows > 0;
sun.shadow.mapSize.set(GFX.shadows || 1, GFX.shadows || 1);
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
const link = NET_ROLE ? connect(PLAYER, ROOM, (status, detail) => showNet(status, detail)) : null;
const net = link?.lock ?? null;
/** The other side has been here: the match runs (before, nobody's clock starts). */
let netStarted = false;
/** The match ended for the network: a forfeit, or the two games no longer alike. Nothing more is simulated. */
let netOver = false;
/** Since when the link has been cut, and since when the game has been waiting for the other side's orders (0: not). */
let cutSince = 0;
let stalledSince = 0;
/** Without a word from the other side for this long, the match is won by forfeit. */
const FORFEIT_MS = 60_000;
/** Shorter waits go unsaid: a hiccup, not a problem. */
const QUIET_MS = 2000;
function showNet(status: NetStatus, detail?: string): void {
  if (netOver) return;
  if (status === 'connected') {
    if (!netStarted) countMatch('en-ligne', MAP.id, factions[PLAYER]);
    netStarted = true;
    cutSince = stalledSince = 0;
    netBanner.hidden = true;
    return;
  }
  if (status === 'reconnecting') {
    cutSince = performance.now();
    return; // watchNet tells, once the cut lasts
  }
  if (status === 'left') return endNet('Victoire par abandon', detail ?? "L'adversaire a quitté la partie.");
  netBanner.hidden = false;
  if (status === 'waiting') {
    const code = matchCode(ROOM, [factions[0], factions[1]], biome.id, Object.keys(MAPS).indexOf(MAP.id));
    const link = `${location.origin}${location.pathname}?net=join&room=${ROOM}&camp=${factions[0]}&adversaire=${factions[1]}&biome=${biome.id}&map=${MAP.id}`;
    netBanner.innerHTML = `<h2>En attente de votre adversaire</h2>
      <p>Donnez-lui ce code (menu « Rejoindre une partie ») :</p><div class="net-code">${code}</div>
      <p>ou ce lien :</p><input class="net-link" readonly value="${link}"><button data-n="copy">Copier le lien</button>
      <button data-n="quit">Annuler</button>`;
  } else if (status === 'connecting') netBanner.innerHTML = `<h2>Connexion à la partie…</h2>${detail ? `<p>${detail}</p>` : ''}<button data-n="quit">Annuler</button>`;
  else netBanner.innerHTML = `<h2>Connexion impossible</h2>${detail ? `<p>${detail}</p>` : ''}<button data-n="quit">Menu principal</button>`;
}
/** The match is over for the network: said, kept as a replay, and the other side told. */
function endNet(title: string, detail: string): void {
  if (netOver) return;
  netOver = true;
  link?.leave();
  if (!saved && record.ticks.length) saved = saveReplay(record);
  netBanner.hidden = false;
  netBanner.innerHTML = `<h2>${title}</h2><p>${detail}</p><button data-n="quit">Menu principal</button><button data-n="replay">Enregistrer le replay</button>`;
}
/** Long waits for the other side, said with the time left before the forfeit. A few times a second, even in a background tab. */
let warned = '';
function watchNet(): void {
  if (!netStarted || netOver) return;
  const since = cutSince || stalledSince;
  const waited = since ? performance.now() - since : 0;
  if (waited < QUIET_MS) {
    if (warned) netBanner.hidden = true;
    warned = '';
    return;
  }
  const left = Math.ceil((FORFEIT_MS - waited) / 1000);
  if (left <= 0) return endNet('Victoire par abandon', "L'adversaire ne répond plus.");
  const text = `<h2>L'adversaire ne répond plus</h2><p>${cutSince ? 'Connexion coupée, reconnexion…' : 'En attente de ses ordres…'}</p><p>Victoire par abandon dans ${left} s.</p><button data-n="quit">Quitter la partie</button>`;
  if (text === warned) return;
  warned = text;
  netBanner.hidden = false;
  netBanner.innerHTML = text;
}
netBanner.addEventListener('click', (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')?.dataset.n;
  if (n === 'copy') {
    const field = netBanner.querySelector<HTMLInputElement>('.net-link')!;
    field.select();
    navigator.clipboard?.writeText(field.value).catch(() => document.execCommand('copy'));
  } else if (n === 'replay') downloadReplay(record);
  else if (n === 'quit') {
    link?.leave();
    location.search = `?biome=${biome.id}&map=${MAP.id}`;
  }
});
if (net) showNet(PLAYER === 0 ? 'waiting' : 'connecting');
// Leaving the page tells the other side at once, rather than after the silence timeout.
window.addEventListener('pagehide', () => link?.leave());


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
  ordered: (x, z, target) => {
    overlay.mark(PLAYER, x, z, target);
    audio.play(target && target.owner >= 0 && world.hostile(PLAYER, target.owner) ? 'target' : 'order');
    answer('go');
  },
  pan: (dx, dy) => rig.panPixels(dx, dy),
  fling: (vx, vy) => rig.fling(vx, vy),
  zoom: (f) => rig.zoomBy(f),
}, renderer.domElement);
/** Windowed: the pointer stays in the game (Pointer Lock), so edge scrolling never loses it off the window. */
/** When the first click asked for fullscreen: no lock in the same gesture (Safari stalls on both at once). */
let fullscreenAsked = -Infinity;
const pointer = holdPointer(
  renderer.domElement,
  () => SCROLL.lock && !TOUCH && !paused && !ATTRACT && performance.now() - fullscreenAsked > 1500,
  () => SCROLL.mouse,
);
const audio = new Audio();
/** Our units' wordless answer, at most every 0.3 s so a burst of clicks does not chatter. */
let lastAnswer = 0;
let lastPicked = new Set<number>();
function answer(kind: 'ack' | 'go'): void {
  if (SPECTATE || performance.now() - lastAnswer < 300) return;
  lastAnswer = performance.now();
  audio.play(`${kind}${factions[PLAYER]}` as Sfx, 0.8);
}
const hud = new Hud(world, map, PLAYER, input, scene, issue, audio, SPECTATE);
hud.gridKeys = SCROLL.grid && !TOUCH;
hud.mapSlot.append(minimap.canvas);
minimap.onOrder = (x, y) => input.orderAt(x, y);
/** The big minimap (² on AZERTY, ` on QWERTY): a larger target to move the view or send units, over the middle of
 * the screen; a left click (or drag) there moves the view and closes it, as does the key again or Escape. Drawn only while open. */
const bigMap = new Minimap(map, rig, 440);
const bigBox = document.createElement('div');
bigBox.className = 'bigmap';
bigBox.hidden = true;
bigBox.append(bigMap.canvas);
document.body.append(bigBox);
bigMap.onOrder = (x, y) => input.orderAt(x, y);
bigMap.intercept = (x, y) => hud.minimapClick(x, y);
// Closes once the left button is let go (it may drag the view about first).
bigMap.canvas.addEventListener('pointerup', (e) => e.button === 0 && (bigBox.hidden = true));
const toggleBigMap = (open = bigBox.hidden) => {
  bigBox.hidden = !open || TOUCH;
  if (!bigBox.hidden) updateFog();
};
minimap.canvas.title = 'Carte (² ou ` : agrandir)';
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
  if (e.code === 'Backquote') {
    e.preventDefault();
    toggleBigMap();
  } else if (e.key === 'Escape' && !bigBox.hidden) {
    e.stopImmediatePropagation();
    toggleBigMap(false);
  }
}, true);
hud.ping = (x, y) => {
  minimap.ping(x, y);
  bigMap.ping(x, y);
};
hud.focus = (x, y) => rig.lookAt(x, y);
minimap.intercept = (x, y) => hud.minimapClick(x, y);
const fxScene = new Scene();
const effects = new Effects(fxScene, scene, map, audio);
effects.density = GFX.particles;
const overlay = new Overlay(map);
overlay.hostile = (a, b) => world.hostile(a, b);
const power = new PowerNet(scene, map, fog);
const paving = new Paving(scene, map, fog, QUALITY_LEVEL !== 'basse');
document.body.insertBefore(overlay.canvas, renderer.domElement.nextSibling);

/** Copies the player's fog of war to the terrain and minimap. */
function updateFog(): void {
  const tiles = SPECTATE ? world.vision[PLAYER].tiles.map(() => 2) : world.vision[PLAYER].tiles;
  const data = fog.image.data as Uint8Array;
  for (let i = 0; i < tiles.length; i++) data[i] = tiles[i] === 2 ? 255 : tiles[i] === 1 ? 128 : 0;
  fog.needsUpdate = true;
  minimap.fog(tiles);
  if (!bigBox.hidden) bigMap.fog(tiles);
}

// Camera: arrow keys, screen-edge scrolling, wheel zoom.
const keys = new Set<string>();
window.addEventListener('keydown', (e) => keys.add(e.key));
window.addEventListener('keyup', (e) => keys.delete(e.key));
window.addEventListener('blur', () => keys.clear());
// Space held: the map follows the mouse (handy on a touchpad); Space tapped without moving, or Enter: to the last
// attack. F5…F8: saved views (Ctrl, Cmd or Shift + the key saves the current one).
const views = new Map<string, { x: number; z: number }>();
/** Space held: where the mouse was last seen, and whether it dragged the map (then letting go jumps nowhere). */
let spaceDrag: { x: number; y: number; moved: boolean } | null = null;
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
  if (e.key === 'Alt') e.preventDefault(); // held to show every health bar, not to open the browser's menu
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) spaceDrag = { x: mouse?.x ?? -1, y: mouse?.y ?? -1, moved: false };
  } else if (e.key === 'Enter') {
    hud.toAlert();
  } else if (/^F[5-8]$/.test(e.key)) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || e.shiftKey) views.set(e.key, { x: rig.target.x, z: rig.target.z });
    else {
      const v = views.get(e.key);
      if (v) rig.lookAt(v.x, v.z);
    }
  }
});

let mouse: { x: number; y: number; onButton: boolean } | null = null;
// Edge scrolling follows the mouse only: fingers drag the map instead. Only over the map itself: over any piece of
// the interface (console, minimap, command card, top bar, menus, messages) the view stays put. The element really
// under the pointer decides, so the Dieux console's cut-out shape and the dip of the others count as they are drawn
// (a held pointer replays its moves there too, see game/pointerlock.ts).
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouse = { x: e.clientX, y: e.clientY, onButton: e.target !== renderer.domElement };
  if (spaceDrag && !paused) {
    // Positions, not movementX: a held pointer replays its moves without it.
    if (spaceDrag.x >= 0) rig.panPixels(e.clientX - spaceDrag.x, e.clientY - spaceDrag.y);
    if (spaceDrag.x >= 0 && (e.clientX !== spaceDrag.x || e.clientY !== spaceDrag.y)) spaceDrag.moved = true;
    spaceDrag.x = e.clientX;
    spaceDrag.y = e.clientY;
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' || !spaceDrag) return;
  if (!spaceDrag.moved) hud.toAlert();
  spaceDrag = null;
});
window.addEventListener('blur', () => (spaceDrag = null));
document.addEventListener('mouseleave', () => (mouse = null));
// Wheel zooms. A trackpad's two-finger scroll (sideways or fractional pixel deltas) pans,
// and its pinch (sent as ctrl+wheel) zooms.
window.addEventListener('wheel', (e) => {
  if (!(e.target instanceof HTMLCanvasElement)) return;
  e.preventDefault();
  const trackpad = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
  if (e.ctrlKey) rig.zoomBy(Math.exp(e.deltaY * 0.01), e.clientX, e.clientY);
  else if (trackpad) rig.panPixels(-e.deltaX, -e.deltaY);
  else rig.zoomBy(Math.exp(e.deltaY * 0.001), e.clientX, e.clientY);
}, { passive: false });

// Glowing edge and arrow cursor while the mouse scrolls the map.
const edgeGlow = document.createElement('div');
edgeGlow.className = 'edge-glow';
document.body.append(edgeGlow);
let edgeShown = '';
/** When the pointer entered an edge band (scrolling waits a moment, so crossing the band to a button does not scroll). */
let edgeSince = 0;
/** A pointer settled in a band this long starts scrolling; touching the screen's very edge scrolls at once. */
const EDGE_DWELL_MS = 200;
/** In the band's outer part (this share of it), the wait is short: the pointer is clearly heading for the edge. */
const EDGE_OUTER = 0.4;
const EDGE_DWELL_OUTER_MS = 60;
const EDGE_TOUCH_PX = 3;
/** Panels set against a screen edge (the minimap, the command card, the menu with its chips, the production list):
 * the edge they touch does not scroll along them, nor a band's width past their ends, which takes in the corner they
 * sit in. The way from the middle of the screen to any of them crosses no scrolling band (as in StarCraft II, where the
 * console's edge is no scrolling edge). */
const EDGE_PANELS = '.map-slot, .hud-card, .tools > *, .prod-panel';
/** A panel this close to an edge is set against it. */
const ATTACH_PX = 48;
/** Whether the edge `side` (l, r, t, b: the bottom one runs along the console's top, at `bottom`) is calm at `along`
 * (y for the side edges, x for the others). A panel resting on the console (the tools on a small screen) counts as
 * set against the bottom. */
function calmEdge(side: 'l' | 'r' | 't' | 'b', along: number, band: number, bottom: number): boolean {
  for (const el of document.querySelectorAll<HTMLElement>(EDGE_PANELS)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const near = side === 'l' ? r.left : side === 'r' ? window.innerWidth - r.right : side === 't' ? r.top : Math.min(window.innerHeight - r.bottom, Math.abs(bottom - r.bottom));
    const [from, to] = side === 'l' || side === 'r' ? [r.top, r.bottom] : [r.left, r.right];
    if (near < ATTACH_PX && along > from - band && along < to + band) return true;
  }
  return false;
}
/** The console's top edge, this deep, scrolls down at once, like the screen's very bottom: a pointer thrown down at
 * the console lands on it (it crosses the band above in a frame or two). Deeper in, the console is for clicking. */
const EDGE_LINE_PX = 14;
function scrollDirection(): [number, number] {
  let dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  let dy = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
  let edge = '';
  if (!mouse) edgeSince = 0;
  if (mouse && !mouse.onButton && !paused && !ATTRACT) {
    // Speed grows the deeper the pointer goes into the band, along an S: barely moving as it enters, then faster and
    // faster, and level again at the screen's edge.
    const EDGE_PX = edgeBand();
    const depth = (d: number) => {
      const t = Math.min(1, Math.max(0, 1 - d / EDGE_PX));
      return 0.06 + 0.94 * t * t * (3 - 2 * t);
    };
    let ex = mouse.x < EDGE_PX ? -depth(mouse.x) : mouse.x > window.innerWidth - EDGE_PX ? depth(window.innerWidth - mouse.x) : 0;
    // The bottom band sits just above the console, so its buttons never scroll the map.
    const bottom = document.querySelector('.console')?.getBoundingClientRect().top ?? window.innerHeight;
    if (ex && calmEdge(ex < 0 ? 'l' : 'r', mouse.y, EDGE_PX, bottom)) ex = 0;
    edgeGlow.style.setProperty('--edge-bottom', `${window.innerHeight - bottom}px`);
    const floor = mouse.y >= window.innerHeight - 1 - EDGE_TOUCH_PX || (mouse.y >= bottom && mouse.y < bottom + EDGE_LINE_PX);
    let ey = mouse.y < EDGE_PX ? depth(mouse.y) : mouse.y > bottom - EDGE_PX && mouse.y < bottom ? -depth(bottom - mouse.y) : floor ? -1 : 0;
    if (ey && calmEdge(ey > 0 ? 't' : 'b', mouse.x, EDGE_PX, bottom)) ey = 0;
    // Near a corner along an edge (the outer fifth): scroll diagonally, as fast as along the edge.
    const cornerX = window.innerWidth * 0.2;
    const cornerY = bottom * 0.2;
    if (ex && !ey) ey = Math.abs(ex) * (mouse.y < cornerY ? 1 : mouse.y > bottom - cornerY && mouse.y < bottom + EDGE_LINE_PX ? -1 : 0);
    else if (ey && !ex) ex = Math.abs(ey) * (mouse.x < cornerX ? -1 : mouse.x > window.innerWidth - cornerX ? 1 : 0);
    // The glow along the edge brightens with the speed.
    edgeGlow.style.opacity = String(0.35 + 0.65 * Math.max(Math.abs(ex), Math.abs(ey)));
    // Crossing the band on the way to a button, or near one: no scrolling.
    const inBand = !!(ex || ey);
    if (!inBand) edgeSince = 0;
    else if (!edgeSince) edgeSince = performance.now();
    const touching = floor || mouse.x <= EDGE_TOUCH_PX || mouse.y <= EDGE_TOUCH_PX || mouse.x >= window.innerWidth - 1 - EDGE_TOUCH_PX;
    // Distance to the nearest edge being scrolled, to know whether the pointer is in the band's outer part.
    const toEdge = Math.min(ex ? Math.min(mouse.x, window.innerWidth - mouse.x) : Infinity, ey > 0 ? mouse.y : ey < 0 ? Math.max(0, bottom - mouse.y) : Infinity);
    const dwell = toEdge < EDGE_PX * EDGE_OUTER ? EDGE_DWELL_OUTER_MS : EDGE_DWELL_MS;
    if (inBand && !touching && performance.now() - edgeSince < dwell) ex = ey = 0;
    if (ex) dx = ex;
    if (ey) dy = ey;
    edge = (ey > 0 ? 'n' : ey < 0 ? 's' : '') + (ex > 0 ? 'e' : ex < 0 ? 'w' : '');
  }
  if (edge !== edgeShown) {
    edgeShown = edge;
    edgeGlow.className = `edge-glow ${[...edge].map((d) => `edge-${d}`).join(' ')}`;
    input.scrollEdge = edge;
  }
  return [dx, dy];
}

// Never 0 by 0: a page opened hidden (a background tab, a closed panel) has no size yet, and render targets of size 0
// make WebGL complain (« dimensions not positive »). The resize on showing gives the real size.
const viewW = () => Math.max(1, window.innerWidth);
const viewH = () => Math.max(1, window.innerHeight);
renderer.setSize(viewW(), viewH());
const post = new Post(renderer, scene, fxScene, rig.camera, GFX.post !== 'off', GFX.post === 'light');
window.addEventListener('resize', () => {
  renderer.setSize(viewW(), viewH());
  post.setSize(viewW(), viewH());
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
const SCROLL_ACCEL = 8;
/** How long the view has been scrolled without a break (s), for the speed-up. */
let scrollHeld = 0;
const tools = document.createElement('div');
tools.className = 'tools';
tools.innerHTML = '<button class="tool" data-t="menu" title="Menu"><svg class="burger" viewBox="0 0 20 16" aria-hidden="true"><path d="M2 2h16M2 8h16M2 14h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><span> Menu</span></button><button class="tool" data-t="army" title="Toute l\'armée"><svg class="swords" viewBox="0 0 20 20" aria-hidden="true"><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"><path d="M3 3l11 11M17 3L6 14"/><path d="M11.5 16.5l5-5M3.5 11.5l5 5" stroke-width="2"/><path d="M15.5 15.5l2 2M4.5 15.5l-2 2"/></g></svg><span> Armée</span></button><button class="tool" data-t="home" title="Retour à la base principale"><svg class="keep" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 18V8h3V5h2v3h4V5h2v3h3v10zM8.5 18v-4a1.5 1.5 0 0 1 3 0v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg><span> Base</span></button>';
const pause = document.createElement('div');
pause.className = 'pause';
pause.hidden = true;
pause.innerHTML = `<div class="pause-box">
<h2>Pause</h2>
<button data-p="resume">Reprendre</button>
<button data-p="help">Contrôles</button>
<button data-p="options">Options</button>
<div class="pause-options" hidden></div>
<button data-p="fullscreen" hidden>Plein écran</button>
<button data-p="restart">Recommencer</button>
<button data-p="replay">Enregistrer le replay</button>
<button data-p="quit">Quitter la partie</button>
<div class="help" hidden><h3>Contrôles</h3>
Clic gauche / rectangle : sélectionner (<kbd>Maj</kbd> pour ajouter) · double-clic ou <kbd>Ctrl</kbd>+clic : tout ce type à l'écran<br>
Clic droit : déplacer, récolter, attaquer, point de ralliement<br>
<kbd>A</kbd> puis clic : attaquer / attaque-déplacement<br>
<kbd>S</kbd> stop · <kbd>H</kbd> maintenir la position · <kbd>P</kbd> puis clic : patrouille · <kbd>B</kbd> construire (serf) · <kbd>Échap</kbd> annuler<br>
<kbd>Ctrl</kbd> ou <kbd>Alt</kbd> (<kbd>⌥</kbd> sur Mac)+<kbd>1</kbd>…<kbd>9</kbd> : créer ou remplacer le groupe, <kbd>Maj</kbd>+<kbd>1</kbd>…<kbd>9</kbd> : ajouter au groupe, <kbd>1</kbd>…<kbd>9</kbd> ou son icône en haut : rappel (×2 : centrer)<br>
Icône d'ouvrier en haut : ouvriers inactifs (clic : les sélectionner)<br>
Flèches, bords d'écran, minimap, clic molette glissé (ou clic droit glissé sans unité sélectionnée), deux doigts (trackpad) : caméra · molette, pincer : zoom vers le curseur, jusqu'à la carte entière<br>
<kbd>Tab</kbd> : type actif d'une sélection mixte (ses capacités) · <kbd>Maj</kbd> maintenu : voir les ordres en file<br>
<kbd>Espace</kbd>, <kbd>Entrée</kbd> ou clic sur l'alerte : aller à la dernière attaque · <kbd>Espace</kbd> maintenu en bougeant la souris : faire glisser la carte · <kbd>Alt</kbd> maintenu : toutes les barres de vie<br>
<kbd>Ctrl</kbd>+<kbd>F5</kbd>…<kbd>F8</kbd> : mémoriser la vue, <kbd>F5</kbd>…<kbd>F8</kbd> : y revenir · <kbd>²</kbd> : grande carte<br>
<kbd>F3</kbd> : panneau de production (toutes les files) · <kbd>F2</kbd> ou ⚔ : toute l'armée · icône de donjon : retour à la base principale · <kbd>F1</kbd>, <kbd>F10</kbd> ou ≡ : menu et pause
<h3>Écran tactile</h3>
Tap : sélectionner, puis tap ailleurs pour donner l'ordre<br>
Double tap : toutes les unités de ce type à l'écran<br>
Glisser : déplacer la vue · pincer : zoomer<br>
Appui long puis glisser : rectangle de sélection</div></div>`;
tools.append(hud.idle, hud.idleProd, hud.prodToggle, hud.groups);
document.body.append(tools, pause);
const helpText = pause.querySelector<HTMLElement>('.help')!;
const setPaused = (on: boolean) => {
  paused = on;
  if (on) pointer.release(); // the menu wants the real cursor
  pause.hidden = !on;
  if (!on) helpText.hidden = pauseOptions.hidden = true;
};
const pauseOptions = pause.querySelector<HTMLElement>('.pause-options')!;
pauseOptions.addEventListener('input', (e) => controlChange(e.target as HTMLInputElement));
pauseOptions.addEventListener('change', (e) => controlChange(e.target as HTMLInputElement));
tools.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-t]')?.dataset.t;
  if (t === 'menu') setPaused(!paused);
  if (t === 'army') input.selectArmy();
  if (t === 'home') {
    // The main base: our headquarters, else our oldest building still standing.
    const own = [...world.entities.values()].filter((e) => e.owner === PLAYER && e.def.kind === 'building');
    const base = own.find((e) => e.type === FACTIONS[factions[PLAYER]].hq) ?? own[0];
    if (base) rig.lookAt(base.x / FP, base.y / FP);
  }
});
// The pause menu and the end-of-game banner share these actions.
document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('.pause [data-p], .hud-banner [data-p]');
  const p = button?.dataset.p;
  if (p === 'resume') setPaused(false);
  else if (p === 'help') helpText.hidden = !helpText.hidden;
  else if (p === 'options') {
    // Built on opening, so the fields show the values in force.
    if (pauseOptions.hidden) pauseOptions.innerHTML = controlFields(true) + perf.field();
    pauseOptions.hidden = !pauseOptions.hidden;
  }
  else if (p === 'fullscreen') toggleFullscreen();
  else if (p === 'restart' && !net) location.reload();
  else if (p === 'replay') downloadReplay(record);
  else if (p === 'quit' || p === 'restart') {
    link?.leave();
    location.search = `?biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}&map=${MAP.id}`;
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
for (const type of ['pointerdown', 'pointerup']) window.addEventListener(type, () => audio.start());
// Menus: a soft blip on every button and choice made, a discreet tick on opening a list or a top-bar button.
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('.menu button, .pause-box button, .hud-banner button')) audio.play('menu');
  else if (t.closest('.menu select, .tool')) audio.play('click');
});
document.addEventListener('change', (e) => {
  if ((e.target as HTMLElement).closest('.menu')) audio.play('menu');
});

// The loading screen (index.html) fills as the models arrive and lifts once the first pictures are drawn.
const loading = document.getElementById('loading');
// Only the models this page can show: the title scene's own, or in a match every type of the factions playing and the neutral ones.
const shown = ATTRACT
  ? [...new Set([...world.entities.values()].map((e) => e.type))]
  : Object.keys(DEFS).filter((t) => DEFS[t].kind !== 'upgrade' && (!('faction' in DEFS[t]) || factions.includes(DEFS[t].faction)));
const ready = Promise.all([
  loadModels([...shown, ...shown.flatMap((t) => LOOKS[t] ?? []), ...MINERAL_VARIANTS], (done, total) => loading?.style.setProperty('--p', String(0.9 * (done / total)))),
  decor.load(scene, (m) => fogMaterial(m, fog, map)),
]);
ready.then(() => loading?.style.setProperty('--p', '1'));
if (!ATTRACT) {
  // Every portrait the match can show is readied behind the loading screen (render/portrait.ts).
  const portraits = world.players.flatMap((p, i) => shown.filter((t) => (!('faction' in DEFS[t]) ? i === 0 : DEFS[t].faction === p.faction)).map((t): [string, number] => [t, 'faction' in DEFS[t] ? i : -1]));
  ready.then(() => hud.portrait.prewarm(portraits).catch(() => {})).then(start);
  if (!net) ready.then(() => countMatch(REPLAY ? 'replay' : SPECTATE ? 'spectateur' : 'ia', MAP.id, factions[PLAYER]));
} else {
  countTitle();
  document.body.classList.add('attract');
  // Shaders compiled in the background (parallel compile where the browser has it) rather than in one long first frame.
  ready.then(() => renderer.compileAsync(scene, rig.camera)).catch(() => {}).then(start);
  showHome();
  loading?.classList.add('mini'); // the menu does not wait for the scene behind it
}

/** A match to set up: each side's faction and who plays it, the planet, and the speed when only AIs play. */
interface Setup {
  /** Four seats; `control` 'none' leaves a seat empty (the third and fourth by default). */
  sides: { faction: Faction; control: string; team: number }[];
  biome: string;
  /** Map id (public/maps/). */
  map: string;
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

function showHome(): void {
  const menu = document.querySelector('.menu') ?? document.body.appendChild(document.createElement('div'));
  menu.className = 'menu';
  menu.innerHTML = `<h1>XCRAFT</h1><p>Humains · Isdaris · Z · Dieux</p>
    <button data-m="new">Nouvelle partie</button>
    <button data-m="join">Rejoindre une partie</button>
    <button data-m="options">Options</button>
    <div class="row">
      ${stored(REPLAY_KEY) ? '<button data-m="last-replay">Revoir la dernière partie</button>' : ''}
      <button data-m="open-replay">Ouvrir un replay…</button>
    </div>
    <div class="build">v${__VERSION__} · ${__COMMIT__} · ${new Date(__BUILT__).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}${SKIPPED ? ' · vos visites ne sont pas comptées' : ''}</div>`;
  (menu as HTMLElement).onclick = (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    if (m === 'new') showSetup(menu as HTMLElement, readSetup());
    else if (m === 'join') showJoin(menu as HTMLElement);
    else if (m === 'options') showOptions(menu as HTMLElement);
    else if (m === 'last-replay') playReplay(readReplay());
    else if (m === 'open-replay') openReplayFile();
  };
}

/** Fullscreen: chosen in the options for this computer, toggled from the pause menu. */
const FULLSCREEN_KEY = 'xcraft.fullscreen';
function wantsFullscreen(): boolean {
  try {
    return localStorage.getItem(FULLSCREEN_KEY) === '1';
  } catch {
    return false;
  }
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => {});
}
if (document.fullscreenEnabled && !TOUCH) {
  const button = pause.querySelector<HTMLElement>('[data-p="fullscreen"]')!;
  button.hidden = false;
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    button.textContent = on ? 'Quitter le plein écran' : 'Plein écran';
    // Chrome and Edge let the game keep Escape (held down, it still leaves fullscreen); elsewhere it leaves at once.
    const keyboard = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
    if (on) void keyboard?.lock?.(['Escape']).catch(() => {});
    else keyboard?.unlock?.();
  });
  // Browsers only go fullscreen on a click or key press, and loading a match reloads the page:
  // with the option on, the first one in the match does it.
  if (!ATTRACT && wantsFullscreen()) {
    // Captured, so it runs before the map's own press (which may hold the pointer).
    const enter = () => {
      fullscreenAsked = performance.now();
      if (!document.fullscreenElement) toggleFullscreen();
      window.removeEventListener('pointerdown', enter, true);
      window.removeEventListener('keydown', enter, true);
    };
    window.addEventListener('pointerdown', enter, true);
    window.addEventListener('keydown', enter, true);
  }
}

/** The control settings' fields (mouse and keyboard; none on a touch screen), in the title's options and the pause
 * menu; the game's speed only in a match alone against the AI. Sliders show their value. */
function controlFields(inMatch: boolean): string {
  if (TOUCH) return '';
  const range = (k: keyof Controls, label: string, min: number, max: number, step: number, unit = '') =>
    `<label>${label} <input type="range" data-k="${k}" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${SCROLL[k]}"><output>${fmt(Number(SCROLL[k]), unit)}</output></label>`;
  const check = (k: 'lock' | 'grid' | 'halo', label: string) => `<label><input type="checkbox" data-k="${k}"${SCROLL[k] ? ' checked' : ''}> ${label}</label>`;
  return `<fieldset class="options"><legend>Défilement par les bords</legend>
      ${range('speed', 'Vitesse', 0.5, 2, 0.1, '×')}
      ${range('band', 'Largeur des bords', 0.4, 1.6, 0.1, '×')}
      ${range('ramp', 'Accélération', 0, 2, 0.1, '×')}
      ${range('coast', 'Inertie', 0, 1, 0.05, ' s')}
    </fieldset>
    <fieldset class="options"><legend>Souris</legend>
      ${check('lock', 'Garder la souris dans la fenêtre (hors plein écran)')}
      ${range('mouse', 'Vitesse du curseur gardé', 0.5, 2, 0.05, '×')}
    </fieldset>
    <fieldset class="options"><legend>Interface</legend>
      ${check('halo', 'Halo sur le bâtiment survolé')}
    </fieldset>
    <fieldset class="options"><legend>Raccourcis</legend>
      ${check('grid', `Raccourcis en grille : la place du bouton (${navigator.language?.startsWith('fr') ? 'A Z E R / Q S D F / W X C V' : 'Q W E R / A S D F / Z X C V'}) plutôt que la lettre de son nom`)}
    </fieldset>
    ${inMatch && SOLO ? `<fieldset class="options"><legend>Partie contre l'IA</legend>${range('game', 'Vitesse du jeu', 0.5, 2, 0.25, '×')}</fieldset>` : ''}`;
}
const fmt = (v: number, unit: string) => (unit === '×' ? `×${+v.toFixed(2)}` : `${+v.toFixed(2)}${unit}`);
/** A control field changed: kept, and live in the match. False for any other field. */
function controlChange(field: HTMLInputElement | HTMLSelectElement): boolean {
  if (field.dataset.k === 'debug') {
    perf.toggle((field as HTMLInputElement).checked);
    return true;
  }
  const k = field.dataset.k as keyof Controls | undefined;
  if (!k || !(k in SCROLL_BASE)) return false;
  if (k === 'lock' || k === 'grid' || k === 'halo') {
    SCROLL[k] = (field as HTMLInputElement).checked;
    hud.gridKeys = SCROLL.grid && !TOUCH;
    if (!SCROLL.lock) pointer.release();
  } else {
    SCROLL[k] = Number(field.value);
    const out = field.nextElementSibling;
    if (out instanceof HTMLOutputElement) out.value = fmt(SCROLL[k], field.dataset.unit ?? '');
  }
  saveControls();
  return true;
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
 * loads from the URL. On small screens `step` shows the maps alone, then the rest.
 */
function showSetup(menu: HTMLElement, s: Setup, step: 'map' | 'players' = 'map'): void {
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
    // A friend online plays the second side, one against one only (for now).
    if (i !== 1 || s.sides[0].control !== 'you' || s.sides[2].control !== 'none' || s.sides[3].control !== 'none') delete controls.online;
    const color = `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    const open = s.sides[i].control !== 'none';
    // The first two seats are always taken; the others have an on/off switch.
    const toggle = i < 2 ? '<span class="seat-fixed"></span>' : `<label class="switch"><input type="checkbox" data-k="on${i}"${open ? ' checked' : ''}><span></span></label>`;
    return `<div class="seat${open ? '' : ' off'}">
      <span class="chip" style="background:${color}"></span><span class="who">Joueur ${i + 1}</span>${toggle}
      ${open ? `${select(`f${i}`, factions, s.sides[i].faction)}${select(`c${i}`, controls, s.sides[i].control)}${select(`t${i}`, teams, String(s.sides[i].team))}` : '<span class="closed">Emplacement fermé</span>'}
    </div>`;
  };
  const watching = s.sides[0].control !== 'you';
  const chosen = mapFile(s.map);
  const compact = COMPACT.matches;
  const maps = `<fieldset class="maps"><legend>Carte</legend>${mapCards(chosen.id, s.biome)}</fieldset>
    <p class="map-about">${chosen.description ?? ''}</p>`;
  menu.className = `menu setup${compact ? ' compact' : ''}`;
  if (compact && step === 'map') {
    menu.innerHTML = `<h2>Nouvelle partie</h2>${maps}
      <div class="row"><button data-m="back">Retour</button><button data-m="next" class="go">Suivant</button></div>`;
  } else
    menu.innerHTML = `<h2>Nouvelle partie</h2>
    ${compact ? '' : maps}
    <fieldset class="seats"><legend>Joueurs</legend>${[0, 1, 2, 3].slice(0, seatsOf(chosen)).map(row).join('')}</fieldset>
    <fieldset class="options"><legend>Partie</legend>
      ${compact ? `<label>Carte <button type="button" data-m="maps" class="map-change">${chosen.name}</button></label>` : ''}
      <label>Planète ${select('biome', Object.fromEntries(Object.values(BIOMES).map((b) => [b.id, b.name])), s.biome)}</label>
      ${watching ? `<label>Vitesse ${select('speed', { 1: '×1', 2: '×2', 4: '×4' }, String(s.speed))}</label>` : ''}
    </fieldset>
    <div class="row"><button data-m="back">Retour</button><button data-m="go" class="go">${watching ? 'Regarder' : 'Jouer'}</button></div>`;
  menu.onchange = (e) => {
    const el = e.target as HTMLSelectElement | HTMLInputElement;
    const k = el.dataset.k;
    if (!k) return;
    const v = el.value;
    if (k === 'biome') s.biome = v;
    else if (k === 'speed') s.speed = Number(v);
    else if (k.startsWith('on')) s.sides[Number(k[2])].control = (el as HTMLInputElement).checked ? 'normal' : 'none';
    else if (k[0] === 'f') s.sides[Number(k[1])].faction = asFaction(v);
    else if (k[0] === 't') s.sides[Number(k[1])].team = Number(v);
    else s.sides[Number(k[1])].control = v;
    const crowd = s.sides[2].control !== 'none' || s.sides[3].control !== 'none';
    if ((s.sides[0].control !== 'you' || crowd) && s.sides[1].control === 'online') s.sides[1].control = 'normal';
    showSetup(menu, s, step);
  };
  menu.onclick = (e) => {
    const button = (e.target as HTMLElement).closest('button');
    const m = button?.dataset.m;
    if (button?.dataset.map) {
      s.map = button.dataset.map;
      // Seats the map has no start for close.
      for (let i = seatsOf(mapFile(s.map)); i < 4; i++) s.sides[i].control = 'none';
      showSetup(menu, s, step);
    } else if (m === 'next') showSetup(menu, s, 'players');
    else if (m === 'maps' || (m === 'back' && compact && step === 'players')) showSetup(menu, s, 'map');
    else if (m === 'back') showHome();
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
    const c = readCode(field.value, Object.keys(BIOMES), Object.keys(MAPS));
    if (!c) {
      error.hidden = false;
      error.textContent = 'Code invalide : il ressemble à K7QX-HIL.';
      return;
    }
    location.search = `?net=join&room=${c.room}&camp=${c.factions[0]}&adversaire=${c.factions[1]}&biome=${c.biome}&map=${c.map}`;
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
    localStorage.setItem('xcraft.map', s.map);
  } catch {
    // the URL carries it all
  }
  const keep = `biome=${s.biome}&camp=${a.faction}&adversaire=${b.faction}&map=${s.map}`;
  const seated = s.sides.filter((x) => x.control !== 'none');
  // With two players, each is its own team whatever was picked; with more, teams as chosen.
  const teams = seated.length > 2 && !seated.every((x) => x.team === seated[0].team);
  const p = seated.map((x, i) => `${x.control}.${x.faction}.${teams ? x.team : i}`).join(',');
  if (b.control === 'online') location.search = `?net=host&room=${newRoom()}&${keep}`;
  else location.search = a.control === 'you' ? `?play&p=${p}&${keep}` : `?spectate&speed=${s.speed}&p=${p}&${keep}`;
}

function start(): void {
  clock.getDelta();
  if (ATTRACT) updateFog(); // the simulation never runs to do it
  const timing: Record<string, number> = {};
  if (import.meta.env.DEV) Object.assign(window, { timing });
  let mark = 0;
  const lap = (name: string) => {
    const now = performance.now();
    timing[name] = (timing[name] ?? 0) * 0.9 + (now - mark) * 0.1;
    mark = now;
  };
  /** Runs the simulation `dt` seconds on. `drawn`: false in a background tab, where nothing is shown. */
  const advance = (dt: number, drawn = true) => {
    if (!ATTRACT && !(paused && !net)) acc += dt * gameSpeed();
    while (acc >= TICK) {
      // Network game: wait for the other side's orders for this tick (and do not race ahead after a stall).
      if (net && (netOver || !netStarted || !net.ready(world.tick))) {
        if (netStarted && !stalledSince) stalledSince = performance.now();
        acc = Math.min(acc, TICK);
        break;
      }
      stalledSince = 0;
      const cmds = REPLAY ? (replayed.get(world.tick) ?? []) : net ? net.step(world.tick, pending) : [...pending, ...ais.flatMap((ai) => ai.think())];
      if (net && world.tick % 100 === 0) net.check(world.tick, stateHash(world));
      if (cmds.length && !ATTRACT) record.ticks.push([world.tick, cmds]);
      world.step(cmds);
      if (world.winner !== null && !REPLAY && !ATTRACT && !saved) saved = saveReplay(record);
      pending = [];
      hud.notify(world.events);
      if (drawn) effects.collect(world, seenAt);
      if (drawn && world.tick % 4 === 1) updateFog();
      acc -= TICK;
      if (net?.desync != null) endNet('Désynchronisation', `Les deux parties ne sont plus identiques (tick ${net.desync}) : elle ne peut pas continuer. Le replay est enregistré.`);
    }
  };
  // Network game: a background tab draws nothing (the browser stops or slows its frames), but its side of the match
  // must go on, or the other player would be stuck. A worker's clock steps it then, and watches for an absent other side.
  let framed = performance.now();
  if (net)
    every(50, () => {
      if (performance.now() - framed > 250) advance(Math.min(clock.getDelta(), 1), false);
      watchNet();
    });
  const frame = (elapsed: number) => {
    mark = performance.now();
    const dt = Math.min(elapsed, 0.25);
    // The pause menu stops the match on this machine (alone, or watching a replay); online both sides step together,
    // so it pauses nothing there.
    advance(dt);
    lap('sim');
    const [dx, dy] = scrollDirection();
    if (ATTRACT) {
      // A slow loop along the diagonal: over the first base, past the armies face to face, over the second.
      const t = performance.now() / 1000 / 24;
      const along = Math.cos(t) * 30;
      const across = Math.sin(t) * 9;
      rig.lookAt(map.width / 2 - (along - across) / Math.SQRT2, map.height / 2 - (along + across) / Math.SQRT2);
    } else {
      // Eased scrolling: the view speeds up over an eighth of a second, then glides to a stop (slow, fast, slow) over
      // the coasting time set in the options.
      const decel = 1 / Math.max(0.02, SCROLL.coast);
      const towards = (v: number, to: number) => {
        const step = (Math.abs(to) < Math.abs(v) || Math.sign(to) !== Math.sign(v) ? decel : SCROLL_ACCEL) * dt;
        return v + Math.max(-step, Math.min(step, to - v));
      };
      scroll.x = towards(scroll.x, dx);
      scroll.y = towards(scroll.y, dy);
      rig.coast(dt);
      const ease = (v: number) => Math.sign(v) * Math.abs(v) * Math.abs(v) * (3 - 2 * Math.abs(v)); // smoothstep
      // Held on and on, scrolling speeds up along an S: slow to aim at first, up to 1.8 times as fast (with the
      // speed-up option at 1) after a second and a half.
      scrollHeld = dx || dy ? scrollHeld + dt : 0;
      const held = Math.min(1, Math.max(0, scrollHeld - 0.3) / 1.2);
      const boost = SCROLL.speed * (1 + 0.8 * SCROLL.ramp * held * held * (3 - 2 * held));
      if (scroll.x || scroll.y) rig.pan(ease(scroll.x) * boost, ease(scroll.y) * boost, dt);
    }
    // A computer can zoom out to the whole map (phones keep the near view, lighter to draw).
    if (!TOUCH) rig.maxView = rig.overview(window.innerWidth / window.innerHeight);
    rig.update(window.innerWidth / window.innerHeight);
    input.prune();
    // Our units answer when picked: once per selection that gains one of them (not when one dies out of it).
    const picked = input.own().filter((u) => u.def.kind === 'unit').map((u) => u.id);
    if (picked.some((id) => !lastPicked.has(id))) answer('ack');
    lastPicked = new Set(picked);
    units.sync(world, acc / TICK, input.selected, PLAYER, sees);
    // The hover halo: a building in sight under the mouse (none on a touch screen, which has no hover).
    const hovered = input.hovered;
    units.glow(SCROLL.halo && !TOUCH && !ATTRACT && hovered?.def.kind === 'building' && world.entities.has(hovered.id) && sees(hovered) ? hovered.id : null, performance.now());
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
      effects.burn(new Vector3(x, heightAt(map, x, z) + size * 0.4, z), e.hp / e.maxHp, size, dt, e.id, (e.def as BuildingDef).faction === 'isdaris');
    }
    effects.update(dt);
    overlay.showAll = keys.has('Alt');
    overlay.showQueue = keys.has('Shift');
    overlay.draw(world, rig.camera, input.selected, sees, acc / TICK);
    const placed = hud.placingType && (DEFS[hud.placingType] as BuildingDef).warp;
    power.update(world, sees, !!placed || [...input.selected].some((id) => !!(world.entities.get(id)?.def as BuildingDef | undefined)?.power), (o) => !SPECTATE && world.hostile(o, PLAYER));
    paving.update(world, sees);
    audio.frame();
    lap('fx+overlay');
    minimap.draw(world, sees);
    if (!bigBox.hidden) bigMap.draw(world, sees);
    lap('minimap');
    sun.target.position.copy(rig.target);
    sun.position.copy(rig.target).add(SUN_OFFSET);
    // Zoomed out past the usual range, the shadow box widens with the view (softer shadows, none cut off).
    const reach = 34 * Math.max(1, rig.viewHeight / MAX_VIEW);
    if (sun.shadow.camera.right !== reach) {
      Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: 140 * reach / 34 });
      sun.shadow.camera.updateProjectionMatrix();
    }
    post.render();
    lap('render');
  };
  // Dev: xcraft.frame(dt) advances one frame by hand (handy when the browser throttles animation frames).
  if (import.meta.env.DEV) Object.assign((window as unknown as { xcraft: object }).xcraft, { frame, effects, fxScene, scene, input, renderer });
  // Two frames on (the first compiles the shaders), the picture is ready: the loading screen fades away.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 500);
  }));
  // Title screen: the scene is only a backdrop behind the menu. On phones and the basse level it is drawn at most
  // 30 times a second, and on phones it holds still for a moment after a touch, so the menu's answer is drawn at
  // once instead of waiting behind a heavy frame.
  let lastDraw = 0;
  let quietUntil = 0;
  // Only on touch screens: on a computer the pause read as the backdrop freezing at every click.
  if (ATTRACT && TOUCH) document.addEventListener('pointerdown', () => (quietUntil = performance.now() + 350), true);
  const capped = ATTRACT && (TOUCH || QUALITY_LEVEL === 'basse');
  renderer.setAnimationLoop(() => {
    // performance.now(), the very clock quietUntil is set on, rather than the loop's own frame time.
    const now = performance.now();
    if (ATTRACT && (now < quietUntil || (capped && now - lastDraw < 30))) return;
    lastDraw = now;
    framed = now;
    const dt = clock.getDelta();
    // Paused: the world, units and effects stand still; the picture is still drawn under the menu.
    // A network game never pauses: the other player is still playing.
    if (paused && !net) post.render();
    else frame(dt);
    perf.frame(world.tick);
  });
}

// ---------------------------------------------------------------- replays

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
interface Replay {
  v: 1;
  /** Map id; missing in replays from before map files (the original map). */
  map?: string;
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
