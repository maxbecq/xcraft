import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, type Object3D, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
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
import { EntityRenderer, MINERAL_VARIANTS, WEAPON_MODELS, loadModels } from './render/units';
import { loadSprites } from './render/sprites';
import { type BuildingDef, DEFS, FACTIONS, type Faction, LOOKS } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import { DEFAULT_MAP, MAPS, mapFile } from './maps';
import { seatsOf } from './mappicker';
import { PerfHud } from './perf';
import { Footprints } from './render/footprints';
import { PerfRecorder } from './perfrec';
import { stableShadowDepth } from './render/shadowdepth';
import { drawXray } from './render/xray';
import { detectQuality, pickQuality, QUALITY, QUALITY_KEY } from './quality';
import { heightAt } from './map';
import { type Command, type Entity, type SandboxTool, World } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial, setBiome, UNDER_DECK } from './terrain';
import { BIOMES, cityAbyss, cityRoads, cityScape, cityStreets, cityUnderdeck, pickBiome } from './render/biome';
import { Decor } from './render/decor';
import { addDeposits } from './render/deposits';
import { connect, every, NO_DIRECT, readRoom, stateHash, type NetStatus } from './net';
import { countMatch, countTitle } from './stats';
import { asFaction, SANDBOX_TOOLS, type Controls, fmt, saveControls, SCROLL, SCROLL_BASE, stored, toggleFullscreen, wantsFullscreen } from './game/settings';
import { initMenus, showHome, showLobby } from './game/menus';
import { downloadReplay, readReplay, type Replay, saveReplay } from './game/replay';

/** Edge scrolling: how close to the screen's edge (at the bottom, to the top of the command console) the mouse must be. */
/** Its width grows with the screen: 12 % of its short side, never under 120 px (130 px on a 1080p screen), times the setting. */
const edgeBand = () => Math.round(SCROLL.band * Math.max(120, 0.12 * Math.min(window.innerWidth, window.innerHeight)));
const params = new URLSearchParams(location.search);
/** `?spectate`: watch the AI play itself, without fog. */
/** Title screen: an AI-versus-AI match plays behind the menu, under a drifting camera. */
/** `?net=host|join&room=ABCD`: a two-player game over the network (the host is player 0). */
const NET_ROLE = params.get('net');
/** `?sandbox&camp=…&map=…&biome=…`: Bac à sable, one player alone on the map, no opponent, with test switches. */
const SANDBOX = params.has('sandbox') && !params.has('replay') && !NET_ROLE;
const ATTRACT = !params.has('spectate') && !params.has('play') && !params.has('replay') && !NET_ROLE && !SANDBOX;
/** The game just played has been kept as the last game. */
let saved = false;
/** `?replay`: plays back the last saved game (or one opened from a file), watched like a spectator. */
const REPLAY = params.has('replay') ? readReplay() : null;
const SPECTATE = params.has('spectate') || ATTRACT || !!REPLAY;
/** `?speed=4`: simulation speed multiplier. */
const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
/** Alone against the AI, the game's speed is a setting (never online: both machines must step alike). */
const SOLO = (params.has('play') || SANDBOX) && !NET_ROLE;
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
// `?pr=1.5`: another pixel density cap, to measure on a given machine (with ?perf=rec) what the level's costs the graphics chip.
renderer.setPixelRatio(Math.min(Number(params.get('pr')) || GFX.pixelRatio, window.devicePixelRatio));
document.body.classList.toggle('touch', TOUCH);
renderer.toneMapping = ACESFilmicToneMapping;
const biome = pickBiome(params);
renderer.toneMappingExposure = biome.exposure;
renderer.shadowMap.enabled = GFX.shadows > 0;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

/** Factions: the player's and the AI's, from the URL or the last menu choice. */
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
  : SANDBOX
    ? [{ control: 'you', faction: asFaction(params.get('camp') ?? stored('xcraft.camp')), team: 0 }]
  : params.has('p')
    ? params.get('p')!.split(',').slice(0, 4).map((s, i) => {
        const [control, faction, team] = s.split('.');
        return { control: control || 'normal', faction: asFaction(faction), team: Number(team) || i };
      })
    : [
        { control: NET_ROLE ? 'net' : SPECTATE ? (params.get('ai0') ?? 'normal') : 'you', faction: asFaction(params.get('camp') ?? stored('xcraft.camp')), team: 0 },
        { control: NET_ROLE ? 'net' : (params.get(SPECTATE ? 'ai1' : 'ai') ?? 'normal'), faction: asFaction(params.get('adversaire') ?? stored('xcraft.adversaire')), team: 1 },
      ];
// A Bac à sable (or its replay) has one player.
if (slots.length < 2 && !SANDBOX && !REPLAY) slots.push({ control: 'normal', faction: 'humains', team: 1 });
slots.length = Math.min(slots.length, seatsOf(MAP)); // no more players than the map has starts
const factions = slots.map((s) => s.faction);
const [myFaction, foeFaction = asFaction(stored('xcraft.adversaire'))] = factions; // a Bac à sable has no opponent
const world = createMatch(factions, slots.map((s) => s.team), MAP.id, biome.id);
/** `?perf=rec` or the Options box: frame-by-frame telemetry of this game, to send at the end. */
const rec = new PerfRecorder(renderer, {
  version: typeof __VERSION__ === 'string' ? __VERSION__ : 'dev',
  mode: ATTRACT ? 'titre' : REPLAY ? 'replay' : NET_ROLE ? 'en-ligne' : SANDBOX ? 'bac-a-sable' : SPECTATE ? 'spectateur' : 'solo',
  map: MAP.id,
  factions,
  quality: QUALITY_LEVEL,
  touch: TOUCH,
});
// Title screen: a still scene, not a running match (no simulation, no AI, so no fights and no sound).
if (ATTRACT) stageAttract(world);
document.body.classList.toggle('isdaris', factions[PLAYER] === 'isdaris'); // spectating shows the first side's interface
document.body.classList.toggle('z', factions[PLAYER] === 'z');
document.body.classList.toggle('dieux', factions[PLAYER] === 'dieux');
document.body.classList.toggle('humains', factions[PLAYER] === 'humains');
document.body.classList.toggle('spectate', SPECTATE);
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
/** No fog: spectating, or the Bac à sable's « Carte révélée ». */
const revealed = () => SPECTATE || !!world.players[PLAYER].reveal;
const sees = (e: Entity) => revealed() || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => revealed() || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
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
// Bac à sable: the options picked before the match (`&outils=unlimited,instant,reveal`), turned on at its first tick.
if (SANDBOX) for (const tool of params.get('outils')?.split(',') ?? []) if (tool in SANDBOX_TOOLS) pending.push({ player: PLAYER, kind: 'sandbox', ids: [], tool: tool as SandboxTool, on: true });

// Network game: a banner while waiting for the other player, or once the link is lost.
const netBanner = document.createElement('div');
netBanner.className = 'net-banner';
netBanner.hidden = true;
document.body.append(netBanner);
const ROOM = params.get('room') ?? '';
/** A map or planet this build does not have would be swapped for the default one, on this side only: the two games would differ. */
const UNKNOWN = !!NET_ROLE && (!MAPS[params.get('map') ?? ''] || !BIOMES[params.get('biome') ?? '']);
const link = NET_ROLE && !UNKNOWN ? connect(PLAYER, ROOM, (status, detail) => showNet(status, detail)) : null;
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
  if (status === 'again' || status === 'go' || (status === 'left' && world.winner !== null)) return rematch(status, detail);
  if (status === 'left') return endNet('Victoire par abandon', detail ?? "L'adversaire a quitté la partie.");
  netBanner.hidden = false;
  // The network in the way: a fresh try may go through (another network, the friend's page reloaded).
  const retry = detail === NO_DIRECT ? '<button data-n="retry">Réessayer</button>' : '';
  if (status === 'waiting') netBanner.innerHTML = `<h2>En attente de votre adversaire…</h2>${detail ? `<p>${detail}</p>` : ''}${retry}<button data-n="quit">Annuler</button>`;
  else if (status === 'connecting') netBanner.innerHTML = `<h2>Connexion à la partie…</h2>${detail ? `<p>${detail}</p>` : ''}${retry}<button data-n="quit">Annuler</button>`;
  else netBanner.innerHTML = `<h2>Connexion impossible</h2>${detail ? `<p>${detail}</p>` : ''}<button data-n="quit">Menu principal</button>`;
}
/** After the end: the other side wants a rematch, both do (`room`: where), or it left and there will be none. */
function rematch(status: NetStatus, room?: string): void {
  const button = document.querySelector<HTMLButtonElement>('.hud-banner [data-p="restart"]');
  if (status === 'go') {
    // The host's page leaves a moment after telling the other, so the room's name gets there.
    setTimeout(() => (location.search = `?net=${NET_ROLE}&room=${room}&camp=${factions[0]}&adversaire=${factions[1]}&biome=${biome.id}&map=${MAP.id}`), PLAYER === 0 ? 300 : 0);
  } else if (button && status === 'again') button.textContent = rematchAsked ? 'Revanche…' : 'Revanche (votre adversaire est prêt)';
  else if (button) {
    button.disabled = true;
    button.textContent = 'Adversaire parti';
  }
}
let rematchAsked = false;
/** The match is over for the network: said, kept as a replay, and the other side told. */
function endNet(title: string, detail: string): void {
  if (netOver) return;
  netOver = true;
  link?.leave();
  if (!saved && record.ticks.length) saved = saveReplay(record);
  netBanner.hidden = false;
  netBanner.innerHTML = `<h2>${title}</h2><p>${detail}</p><button data-n="quit">Menu principal</button><button data-n="replay">Enregistrer le replay</button>`;
}
/**
 * Long waits for the other side, said with the time left. While its match is still loading (none of its orders
 * yet), it is only waited for. A link cut for good ends the match with no winner (each side would otherwise claim
 * it); a side still linked but sending no orders loses by forfeit. A few times a second, even in a background tab.
 */
let warned = '';
function watchNet(): void {
  if (!netStarted || netOver || !net || world.winner !== null) return;
  const say = (text: string) => {
    if (text === warned) return;
    warned = text;
    netBanner.hidden = false;
    netBanner.innerHTML = text;
  };
  if (!net.started) return say('<h2>En attente de votre ami…</h2><p>Sa partie se charge.</p><button data-n="quit">Annuler</button>');
  const since = cutSince || stalledSince;
  const waited = since ? performance.now() - since : 0;
  if (waited < QUIET_MS) {
    if (warned) netBanner.hidden = true;
    warned = '';
    return;
  }
  const left = Math.ceil((FORFEIT_MS - waited) / 1000);
  if (left <= 0 && cutSince) return endNet('Partie interrompue', 'La connexion avec votre adversaire n\'a pas pu être rétablie. Aucun vainqueur ; le replay est enregistré.');
  if (left <= 0) return endNet('Victoire par abandon', "L'adversaire ne répond plus.");
  say(`<h2>L'adversaire ne répond plus</h2><p>${cutSince ? 'Connexion coupée, reconnexion…' : 'En attente de ses ordres…'}</p><p>${cutSince ? 'Partie interrompue' : 'Victoire par abandon'} dans ${left} s.</p><button data-n="quit">Quitter la partie</button>`);
}
netBanner.addEventListener('click', (e) => {
  const n = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')?.dataset.n;
  if (n === 'replay') downloadReplay(record);
  else if (n === 'retry') {
    link?.leave();
    location.reload();
  }
  else if (n === 'quit') {
    link?.leave();
    location.search = `?biome=${biome.id}&map=${MAP.id}`;
  }
});
if (UNKNOWN) showNet('error', 'Carte ou planète inconnue de cette version du jeu : rechargez la page (tous les deux).');
else if (net) showNet(PLAYER === 0 ? 'waiting' : 'connecting');
// Leaving the page tells the other side at once, rather than after the silence timeout.
window.addEventListener('pagehide', () => link?.leave());


const rig = new CameraRig(map.width, map.height);
// Upright phones: zoom out so the narrow view still spans a dozen tiles.
if (window.innerHeight > window.innerWidth) rig.viewHeight = 26;
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === FACTIONS[factions[PLAYER]].hq)!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, rig, issue: (c: Command) => pending.push(c) } });

// The Z porthole's frame is thin (style.css): its map is drawn larger, as large as the console allows.
const minimap = new Minimap(map, rig, factions[PLAYER] === 'z' ? 210 : 164);

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
  grab: (x, y) => hud.grab(x, y),
  drag: (ground) => hud.drag(ground),
  ordered: (x, z, target, rally) => {
    overlay.mark(PLAYER, x, z, target, rally);
    audio.play(target && target.owner >= 0 && world.hostile(PLAYER, target.owner) ? 'target' : 'order');
    answer('go');
  },
  pan: (dx, dy) => rig.panPixels(dx, dy),
  fling: (vx, vy) => rig.fling(vx, vy),
  zoom: (f) => rig.zoomBy(f),
}, renderer.domElement, SPECTATE);
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
/** The telemetry's buttons, in the pause menu and the end-of-game banner, while it records. */
function showRecButtons(): void {
  pause.querySelector<HTMLElement>('[data-p="perfrec"]')!.hidden = !rec.on;
  hud.endButtons = rec.on ? '<button data-p="perfrec">Enregistrer les mesures</button>' : '';
}
const hud = new Hud(world, map, PLAYER, input, scene, issue, audio, SPECTATE);
hud.online = !!NET_ROLE;
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
overlay.top = (id) => units.top(id);
overlay.hostile = (a, b) => world.hostile(a, b);
const power = new PowerNet(scene, map, fog);
const paving = new Paving(scene, map, fog, QUALITY_LEVEL !== 'basse');
const footprints = new Footprints(scene, map, biome.id, QUALITY_LEVEL !== 'basse');
document.body.insertBefore(overlay.canvas, renderer.domElement.nextSibling);

/** Copies the player's fog of war to the terrain and minimap. */
function updateFog(): void {
  const t0 = performance.now();
  const tiles = revealed() ? world.vision[PLAYER].tiles.map(() => 2) : world.vision[PLAYER].tiles;
  const data = fog.image.data as Uint8Array;
  for (let i = 0; i < tiles.length; i++) data[i] = tiles[i] === 2 ? 255 : tiles[i] === 1 ? 128 : 0;
  fog.needsUpdate = true;
  minimap.fog(tiles);
  if (!bigBox.hidden) bigMap.fog(tiles);
  rec.add('fog', performance.now() - t0);
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
  // Space held drags the map with the mouse: the edges would scroll it too, against the drag.
  if (!mouse || spaceDrag) edgeSince = 0;
  if (mouse && !spaceDrag && !mouse.onButton && !paused && !ATTRACT) {
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
<button data-p="perfrec" hidden>Enregistrer les mesures de performance</button>
<button data-p="quit">Quitter la partie</button>
<div class="help" hidden><h3>Contrôles</h3>
Clic gauche / rectangle : sélectionner (<kbd>Maj</kbd> pour ajouter) · double-clic ou <kbd>Ctrl</kbd>+clic : tout ce type à l'écran<br>
Clic droit : déplacer, récolter, attaquer, point de ralliement<br>
<kbd>A</kbd> puis clic : attaquer / attaque-déplacement<br>
<kbd>S</kbd> stop · <kbd>H</kbd> maintenir la position · <kbd>P</kbd> puis clic : patrouille · <kbd>Y</kbd> puis clic : point de ralliement (bâtiment) · <kbd>B</kbd> construire (serf) · <kbd>Échap</kbd> annuler<br>
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
    if (pauseOptions.hidden) pauseOptions.innerHTML = sandboxFields() + controlFields(true) + perf.field(rec.field());
    pauseOptions.hidden = !pauseOptions.hidden;
  }
  else if (p === 'fullscreen') toggleFullscreen();
  else if (p === 'restart' && !net) location.reload();
  else if (p === 'restart' && link && !rematchAsked) {
    rematchAsked = true;
    button!.textContent = 'Revanche : en attente de votre adversaire…';
    link.again();
  } else if (p === 'restart' && link) return;
  else if (p === 'replay') downloadReplay(record);
  else if (p === 'perfrec') rec.save({ ticks: world.tick, winner: world.winner });
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

/**
 * The match's own shader programs, compiled behind the loading screen: what lies off screen at first (decor,
 * deposits, the other base under the fog) would otherwise compile when the camera first scrolls over it, a frame
 * held up for 60 to 380 ms (CPU slowed 4 times). The entities' views are made first (before the first frame there
 * are none), then one draw of the whole map and its unit silhouettes through an empty scissor, hidden things shown
 * for it: the shadow pass's programs, the silhouettes' and those that differ from one object to the next (skinned,
 * shadowed) are built too.
 */
async function compileScene(catalog: [string, number][]): Promise<void> {
  units.sync(world, 0, input.selected, PLAYER, sees, seenAt);
  // Every type the match can show (`catalog`: type and owner, for its colours), built and, for buildings, being built,
  // in a world of its own never stepped (the match's ids and simulation untouched), drawn by a renderer of its own:
  // a type first trained or built mid-game compiled its shaders then (the Marché held a frame 1.25 s, CPU slowed 4 times).
  const spare = new World(map, world.players.length);
  spare.players.forEach((p, i) => (p.faction = world.players[i].faction));
  for (const [type, owner] of catalog) {
    if (DEFS[type].kind === 'resource') continue; // already on the map
    spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP);
    // Each weapon module on its socles too: a weapon first seen mid-game would compile then.
    for (const kit of (DEFS[type] as { weapons?: string[] }).weapons ?? []) spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP).kit = kit;
    if (DEFS[type].kind === 'building') spare.spawn(type, owner, (map.width / 2) * FP, (map.height / 2) * FP).buildLeft = 1;
  }
  const shapes = new EntityRenderer(scene, map);
  shapes.sync(spare, 0, new Set(), PLAYER, () => true, () => true);
  stableShadowDepth(scene); // the decor, deposits and ground (each entity's view gets it when made)
  const into = post.sceneTarget;
  renderer.setRenderTarget(into);
  await renderer.compileAsync(scene, rig.camera);
  const aspect = window.innerWidth / window.innerHeight;
  const [target, view, box] = [rig.target.clone(), rig.viewHeight, { ...sun.shadow.camera }];
  // An empty scissor: drawn, nothing shows.
  const scissor = (on: boolean) => {
    if (into) [into.scissorTest, into.scissor.x, into.scissor.y, into.scissor.z, into.scissor.w] = on ? [true, 0, 0, 0, 0] : [false, 0, 0, into.width, into.height];
    else renderer.setScissorTest(on);
  };
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible) return;
    hidden.push(o);
    o.visible = true;
  });
  try {
    rig.lookAt(map.width / 2, map.height / 2);
    rig.viewHeight = rig.overview(aspect);
    rig.update(aspect);
    const reach = Math.max(map.width, map.height);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, far: 400 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.copy(rig.target);
    sun.position.copy(rig.target).add(SUN_OFFSET);
    renderer.setScissor(0, 0, 0, 0);
    renderer.setRenderTarget(into);
    scissor(true);
    renderer.shadowMap.needsUpdate = true; // its programs too (the map is only drawn when asked for)
    renderer.render(scene, rig.camera);
    drawXray(renderer, scene, rig.camera, into); // the buildings' depth and the silhouettes, one per side
  } finally {
    scissor(false);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(null);
    for (const o of hidden) o.visible = false;
    Object.assign(sun.shadow.camera, { left: box.left, right: box.right, top: box.top, bottom: box.bottom, far: box.far });
    sun.shadow.camera.updateProjectionMatrix();
    rig.target.copy(target);
    rig.viewHeight = view;
    rig.update(aspect);
    shapes.clear();
  }
}

// The loading screen (index.html) fills as the models arrive and lifts once the first pictures are drawn.
const loading = document.getElementById('loading');
// Only the models this page can show: the title scene's own, or in a match every type of the factions playing and the neutral ones.
const shown = ATTRACT
  ? [...new Set([...world.entities.values()].map((e) => e.type))]
  : Object.keys(DEFS).filter((t) => DEFS[t].kind !== 'upgrade' && (!('faction' in DEFS[t]) || factions.includes(DEFS[t].faction)));
const ready = Promise.all([
  loadModels([...shown, ...shown.flatMap((t) => LOOKS[t] ?? []), ...MINERAL_VARIANTS, ...(factions.includes('z') ? WEAPON_MODELS : [])], (done, total) => loading?.style.setProperty('--p', String(0.9 * (done / total)))),
  decor.load(scene, (m) => fogMaterial(m, fog, map)),
  loadSprites(shown),
]);
ready.then(() => loading?.style.setProperty('--p', '1'));
if (!ATTRACT) {
  // Every portrait the match can show is readied behind the loading screen (render/portrait.ts).
  const portraits = world.players.flatMap((p, i) => shown.filter((t) => (!('faction' in DEFS[t]) ? i === 0 : DEFS[t].faction === p.faction)).map((t): [string, number] => [t, 'faction' in DEFS[t] ? i : -1]));
  // Never waited for more than 3 s: a page the browser does not draw (a tab opened behind, never shown) may never
  // finish compiling shaders, and its match, so the other player's too, would not start until it is shown.
  const warmed = (p: Promise<void>) => Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, 3000))]);
  ready.then(() => warmed(Promise.all([hud.portrait.prewarm(portraits), compileScene(portraits)]).then(() => {}))).then(start);
  if (!net) ready.then(() => countMatch(REPLAY ? 'replay' : SPECTATE ? 'spectateur' : 'ia', MAP.id, factions[PLAYER]));
} else {
  countTitle();
  document.body.classList.add('attract');
  // Shaders compiled in the background (parallel compile where the browser has it) rather than in one long first frame.
  ready.then(() => renderer.compileAsync(scene, rig.camera)).catch(() => {}).then(start);
  initMenus({ myFaction, foeFaction, biome, MAP, perf, DETECTED, TOUCH, controlFields, controlChange });
  const friend = readRoom(params.get('ami') ?? '');
  if (friend) showLobby(document.body.appendChild(Object.assign(document.createElement('div'), { className: 'menu' })), friend, params.has('hote'));
  else showHome();
  loading?.classList.add('mini'); // the menu does not wait for the scene behind it
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
  // with the option on, the first one on the page (title menus or match) does it.
  if (wantsFullscreen()) {
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
/** Bac à sable: its options in the pause menu, as they stand now (shown on touch screens too). */
function sandboxFields(): string {
  if (!SANDBOX) return '';
  const p = world.players[PLAYER];
  return `<fieldset class="options"><legend>Bac à sable</legend>${Object.entries(SANDBOX_TOOLS)
    .map(([k, label]) => `<label><input type="checkbox" data-sandbox="${k}"${p[k as SandboxTool] ? ' checked' : ''}> ${label}</label>`)
    .join('')}</fieldset>`;
}

/** A control field changed: kept, and live in the match. False for any other field. */
function controlChange(field: HTMLInputElement | HTMLSelectElement): boolean {
  const tool = field.dataset.sandbox as SandboxTool | undefined;
  if (tool && tool in SANDBOX_TOOLS) {
    if (field.type === 'checkbox') issue({ player: PLAYER, kind: 'sandbox', ids: [], tool, on: (field as HTMLInputElement).checked });
    return true;
  }
  if (field.dataset.k === 'debug') {
    perf.toggle((field as HTMLInputElement).checked);
    return true;
  }
  if (field.dataset.k === 'perfrec') {
    rec.toggle((field as HTMLInputElement).checked);
    showRecButtons();
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

function start(): void {
  clock.getDelta();
  showRecButtons();
  if (ATTRACT) updateFog(); // the simulation never runs to do it
  const timing: Record<string, number> = {};
  if (import.meta.env.DEV) Object.assign(window, { timing });
  let mark = 0;
  const lap = (name: string) => {
    const now = performance.now();
    timing[name] = (timing[name] ?? 0) * 0.9 + (now - mark) * 0.1;
    mark = now;
    rec.lap(name);
  };
  /** This frame's simulation steps and what they reported, for the telemetry. */
  let stepped = 0;
  const happened: Record<string, number> = {};
  /** Runs the simulation `dt` seconds on. `drawn`: false in a background tab, where nothing is shown. */
  const advance = (dt: number, drawn = true) => {
    if (!ATTRACT && !(paused && !net)) acc += dt * gameSpeed();
    while (acc >= TICK) {
      // Network game: wait for the other side's orders for this tick (and do not race ahead after a stall).
      if (net && (netOver || !netStarted || !net.ready(world.tick))) {
        if (netStarted && net.started && !stalledSince) stalledSince = performance.now();
        acc = Math.min(acc, TICK);
        break;
      }
      stalledSince = 0;
      const cmds = REPLAY ? (replayed.get(world.tick) ?? []) : net ? net.step(world.tick, pending) : [...pending, ...ais.flatMap((ai) => ai.think())];
      if (net && world.tick % 100 === 0) net.check(world.tick, stateHash(world));
      if (cmds.length && !ATTRACT) record.ticks.push([world.tick, cmds]);
      world.step(cmds);
      if (rec.on) {
        stepped++;
        for (const ev of world.events) happened[ev.kind] = (happened[ev.kind] ?? 0) + 1;
      }
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
    rec.begin();
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
    // What the camera sees, with a margin (shadows, tall models): off it, skeletons wait (render/units.ts).
    const seen = rig.footprint();
    const [x0, x1] = [Math.min(...seen.map((p) => p.x)) - 4, Math.max(...seen.map((p) => p.x)) + 4];
    const [z0, z1] = [Math.min(...seen.map((p) => p.z)) - 4, Math.max(...seen.map((p) => p.z)) + 4];
    units.inView = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
    units.sync(world, acc / TICK, input.selected, PLAYER, sees, seenAt);
    footprints.update(world, sees, performance.now());
    // The hover halo: a building in sight under the mouse, not already selected (none on a touch screen, which has no hover).
    const hovered = input.hovered;
    units.glow(SCROLL.halo && !TOUCH && !ATTRACT && hovered?.def.kind === 'building' && !input.selected.has(hovered.id) && world.entities.has(hovered.id) && sees(hovered) ? hovered.id : null, performance.now());
    lap('units');
    hud.update();
    lap('hud');
    for (const e of world.entities.values()) {
      // Serfs at work: the jackhammer throws blue sparks where it bites (the field or the building site); a Z drone
      // drilling a crystal throws the same.
      const o = e.order;
      if ((e.type === 'serf' || e.type === 'drone') && e.x === e.px && e.y === e.py && sees(e) && ((o?.kind === 'gather' && o.phase === 'mine') || o?.kind === 'construct')) {
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
      if (e.type === 'plateforme' && e.buildLeft === 0 && e.trainLeft > 0 && DEFS[e.queue[0]]?.kind === 'unit' && sees(e)) {
        // Welding on the deck while it assembles a unit: blue sparks from the tip of the arm's torch as it sweeps over
        // the socle, or, a model with no arm to follow, at a point that wanders over it.
        const a = performance.now() / 260 + e.id;
        const wx = e.x / FP + Math.cos(a * 1.7) * 0.35;
        const wz = e.y / FP + 0.1 + Math.sin(a * 1.3) * 0.3;
        const weld = units.weld(e.id) ?? new Vector3(wx, heightAt(map, e.x / FP, e.y / FP) + 0.55 + Math.abs(Math.sin(a)) * 0.35, wz);
        effects.sparks(weld, dt);
        effects.sparks(weld, dt); // twice a jackhammer's rate: a weld crackles
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
    if (rec.on) rec.end(`${rig.target.x.toFixed(2)},${rig.target.z.toFixed(2)},${rig.viewHeight.toFixed(1)}`, { tick: world.tick, ticks: stepped, events: { ...happened } }, unitsOnScreen);
    stepped = 0;
    for (const k in happened) delete happened[k];
  };
  /** Units in the camera's view (only counted for a telemetry spike). */
  const unitsOnScreen = () => {
    const v = new Vector3();
    let n = 0;
    for (const e of world.entities.values()) {
      if (e.def.kind !== 'unit' || e.inside || !sees(e)) continue;
      v.set(e.x / FP, 0, e.y / FP).project(rig.camera);
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) n++;
    }
    return n;
  };
  // Dev: xcraft.frame(dt) advances one frame by hand (handy when the browser throttles animation frames).
  if (import.meta.env.DEV) Object.assign((window as unknown as { xcraft: object }).xcraft, { frame, effects, fxScene, scene, input, renderer, rec });
  // Two frames on (the first compiles the shaders), the picture is ready: the loading screen fades away.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 500);
  }));
  // Title screen: the scene is only a backdrop behind the menu. On phones and the basse level it is drawn at most
  // 30 times a second. It no longer holds still after a touch: that read as the backdrop freezing, and the menu
  // answers as fast without it (about 105 ms either way on a phone profile, CPU slowed 4 times).
  let lastDraw = 0;
  const capped = ATTRACT && (TOUCH || QUALITY_LEVEL === 'basse');
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    if (capped && now - lastDraw < 30) return;
    lastDraw = now;
    framed = now;
    const dt = clock.getDelta();
    // Paused: the world, units and effects stand still; the picture is still drawn under the menu.
    // A network game never pauses: the other player is still playing.
    if (paused && !net) {
      post.render();
      rec.idle();
    }
    else frame(dt);
    perf.frame(world.tick);
  });
}
