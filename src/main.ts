import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, Mesh, PCFShadowMap, Scene, ShadowMaterial, Vector3, WebGLRenderer } from 'three';
import { AI, DIFFICULTY } from './ai/ai';
import { Audio, type Sfx } from './audio';
import { holdPointer } from './game/pointerlock';
import { showRecap } from './game/recap';
import { Recorder } from './game/recap-data';
import { CameraRig, MAX_VIEW } from './camera';
import { stageAttract } from './game/attract';
import { Hud } from './game/hud';
import { freeAsSeen } from './game/hud-place';
import { Input } from './game/input';
import { Minimap } from './minimap';
import { Effects, FX_STYLE } from './render/effects';
import { Marks } from './render/marks';
import { Post } from './render/post';
import { Paving } from './render/paving';
import { PowerNet } from './render/power';
import { Overlay } from './render/overlay';
import { EntityRenderer, WEAPON_MODELS } from './render/units';
import { loadModels, MINERAL_VARIANTS } from './render/models';
import { loadSprites } from './render/sprites';
import { setLite } from './render/textures';
import { type BuildingDef, DEFS, FACTIONS, LOOKS } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import { PerfHud } from './perf';
import { Footprints } from './render/footprints';
import { compileScene } from './render/prewarm';
import { setFxLite } from './render/unitfx';
import { ambientEffects } from './render/ambient';
import { Space } from './render/space';
import { Embers } from './render/embers';
import { PaintedCity, Rain } from './render/painted';
import { PerfRecorder } from './perfrec';
import { detectQuality, pickQuality, pixelRatioFor, QUALITY, QUALITY_KEY } from './quality';
import { heightAt } from './map';
import type { Command, Entity, SandboxTool } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial, lavaTime, setBiome, UNDER_DECK } from './terrain';
import { cityAbyss, cityRoads, cityScape, cityStreets, cityUnderdeck, pickBiome } from './render/biome';
import { Decor } from './render/decor';
import { addDeposits } from './render/deposits';
import { every, readRoom } from './net';
import { fingerprint } from './sim/fingerprint';
import { countMatch, countTitle } from './stats';
import { SANDBOX_TOOLS, type Controls, fmt, rememberSandbox, saveControls, SCROLL, SCROLL_BASE, toggleFullscreen, wantsFullscreen } from './game/settings';
import { initMenus, showHome, showLobby } from './game/menus';
import { cameraControls } from './game/scroll';
import { Marking } from './game/radial';
import { NetGame } from './game/netui';
import { controlFields, PAUSE_HTML, sandboxFields, skinField, TOOLS_HTML } from './game/pausemenu';
import { downloadReplay, GAME_VERSION, measuresFile, type Replay, type ReplayEnd, replaySource, saveFile, saveReplay, withReplayBiome } from './game/replay';
import { ATTRACT, factions, foeFaction, gameSpeed, MAP, myFaction, NET_ROLE, page, params, PLAYER, REPLAY, SANDBOX, slots, SPECTATE, TOUCH } from './game/config';

/** The game just played has been kept as the last game. */
let saved = false;

const renderer = new WebGLRenderer({ antialias: true });
const perf = new PerfHud(renderer);
renderer.localClippingEnabled = true; // Z buildings are fabricated layer by layer (render/units.ts)
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
const pixelRatio = () => (Number(params.get('pr')) ? Math.min(Number(params.get('pr')), window.devicePixelRatio) : pixelRatioFor(QUALITY_LEVEL, window.innerWidth, window.innerHeight, window.devicePixelRatio));
renderer.setPixelRatio(pixelRatio());
setLite(GFX.lite); // before any ground or model material is made
document.body.classList.toggle('touch', TOUCH);
renderer.toneMapping = ACESFilmicToneMapping;
const biome = pickBiome(withReplayBiome(params, REPLAY), MAP);
renderer.toneMappingExposure = biome.exposure;
renderer.shadowMap.enabled = GFX.shadows > 0;
renderer.shadowMap.type = PCFShadowMap;
document.body.appendChild(renderer.domElement);

const world = createMatch(factions, slots.map((s) => s.team), MAP.id, biome.id);
/** The end-of-game analysis being gathered (none on the title screen). */
const recap = ATTRACT ? null : new Recorder(world);
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
// The alternative interface has no console: the Machines' LCD one gives way to it (its build tree stays).
document.body.classList.toggle('lcd', SCROLL.lcd && !(SCROLL.alt && !TOUCH));
document.body.classList.toggle('alt', SCROLL.alt && !TOUCH);
document.body.classList.toggle('tactile', TOUCH && SCROLL.tactile);
document.body.classList.toggle('tuck', TOUCH && SCROLL.tuck);
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
const record: Replay = { v: 1, version: GAME_VERSION, map: MAP.id, factions, teams: slots.map((s) => s.team), biome: biome.id, handicap: world.players.map((p) => p.handicap), ticks: [] };
const replayed = new Map(REPLAY?.ticks ?? []);
let replayEnded = false;
/** Keeps the game as the last game, once: a write that fails (storage full or blocked) is not tried again every tick,
 * and the player is told, quietly, unless the page is going. */
let keepTried = false;
/** The record as it stands, with where and why it stops (a game won stays as it was won). */
function sealed(end: ReplayEnd): Replay {
  if (record.end !== 'victory') {
    record.endTick = world.tick;
    record.end = world.winner !== null ? 'victory' : end;
  }
  return record;
}
function keepGame(quiet = false, end: ReplayEnd = 'left'): void {
  if (saved || keepTried || REPLAY || ATTRACT || !world.tick) return; // with its end tick, a game with no order is a replay too
  keepTried = true;
  saved = saveReplay(sealed(end));
  if (!saved && !quiet) hud.notify([{ player: PLAYER, kind: 'alert', text: 'Replay non conservé : stockage du navigateur plein ou bloqué. « Enregistrer le replay » le télécharge.' }]);
}
// A match under way, left by the browser (a stray « previous page », the tab closed): asked first.
window.addEventListener('beforeunload', (e) => {
  if (page.leaving || SPECTATE || world.winner !== null || !world.tick) return;
  e.preventDefault();
  e.returnValue = '';
});
// A game left before its end is kept too.
window.addEventListener('pagehide', () => keepGame(true));
// The tab closed while measuring: the measures handed to the downloads, if the browser still takes them (no dialog).
window.addEventListener('pagehide', () => measuresOnce());
const map = world.map;
const scene = new Scene();
scene.background = new Color(biome.background);
setBiome(biome);
const fog = createFog(map);
// The night city is one painting (render/painted.ts): none of the other city's scenery, and the ground mesh stays only
// to be clicked on.
const painted = biome.id === 'villenuit' ? new PaintedCity(map, fog, QUALITY_LEVEL === 'haute' ? 24 : 16) : null;
const roads = biome.style === 'city' && !painted ? cityRoads(world) : undefined;
const terrain = buildTerrain(map, roads?.texture);
scene.add(terrain);
addFog(terrain, fog, map);
if (painted) {
  // What is left of the ground mesh: the shadows the units and buildings cast on it (none at the basse level).
  const shade = new ShadowMaterial({ opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  terrain.traverse((o) => {
    if (o instanceof Mesh) Object.assign(o, { material: shade, castShadow: false, receiveShadow: true });
  });
  terrain.visible = GFX.shadows > 0;
  scene.add(painted.root);
}
const decor = new Decor(map, world, biome.decorTint, !!biome.greyStones, painted ? [] : roads?.streets, !!biome.space, biome.decorSkip);
// The asteroids float over space, seen through the chasms and past the edges.
const space = biome.space ? new Space(map.width, map.height) : null;
if (space) scene.add(space.root);
// Over the volcano's lava, embers and smoke (fewer at the basse level).
const embers = biome.chasm.lava ? new Embers(map, fog, biome.chasm.depth, QUALITY_LEVEL === 'basse' ? 120 : 320, QUALITY_LEVEL !== 'basse') : null;
if (embers) scene.add(embers.root);
if (biome.style === 'city' && !painted) scene.add(cityAbyss(map.width, map.height), cityScape(map.width, map.height, 0), cityUnderdeck(map, UNDER_DECK), cityStreets(map, (x, z) => heightAt(map, x, z)));
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

const netGame = new NetGame(world, record, biome, () => {
  keepGame(false, 'network');
  measuresOnce();
  return saved;
});
const { link, net } = netGame;


const rig = new CameraRig(map.width, map.height);
// Upright phones: zoom out so the narrow view still spans a dozen tiles.
if (window.innerHeight > window.innerWidth) rig.viewHeight = 26;
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === FACTIONS[factions[PLAYER]].hq)!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, rig, painted, issue: (c: Command) => pending.push(c) } });

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
  marking: {
    start: (x, y, target) => marking.start(x, y, target),
    move: (x, y) => marking.move(x, y),
    end: (x, y) => marking.end(x, y),
    cancel: () => marking.close(),
  },
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
  hud.endButtons = !rec.on ? '' : measured ? `<p class="measures">Les mesures de la partie sont dans le dossier Téléchargements : <b>${measured}</b>.<br>Envoyez ce fichier à l'équipe du jeu. Rien ne s'est téléchargé ? « Enregistrer à nouveau ».</p><button data-p="perfrec">Enregistrer à nouveau</button>` : '<button data-p="perfrec">Enregistrer les mesures</button>';
  netGame.endButtons = hud.endButtons; // the network's own end banner shows them too
}
/** The measures file's name once saved (« Enregistrer les performances »): saved by itself at the end of the game,
 * or on leaving it, once; the banner then says where it went. */
let measured = '';
function saveMeasures(): void {
  if (!rec.on || ATTRACT) return;
  const f = measuresFile(REPLAY ? replaySource(REPLAY) : sealed('ongoing'), JSON.parse(rec.report({ ticks: world.tick, winner: world.winner })));
  measured ||= f.name; // saved again under the same name (the banner says it)
  saveFile(measured, f.text);
  showRecButtons();
  if (world.winner !== null) hud.banner.hidden = true; // drawn again with the file's name
}
/** Saved once by itself: at the end, or on leaving before it (a save by hand mid-game does not count). */
let autoSaved = false;
/** The game has just ended: the measures are saved at the end of this frame. */
let measuresDue = false;
function measuresOnce(): void {
  if (autoSaved || !rec.on) return;
  autoSaved = true;
  saveMeasures();
}
const hud = new Hud(world, map, PLAYER, input, scene, issue, audio, SPECTATE);
hud.online = !!NET_ROLE;
const marking = new Marking(hud);
hud.gridKeys = SCROLL.grid && !TOUCH && !SCROLL.alt;
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
effects.muzzle = (id) => units.muzzle(id);
effects.top = (id) => units.top(id);
effects.hand = (id, h, side, fwd, radius) => units.handAt(id, h, side, fwd, radius);
effects.slammed = (id) => units.slammed(id);
effects.density = GFX.particles;
effects.eye = rig.camera;
setFxLite(GFX.particles < 1);
const overlay = new Overlay(map);
const marks = new Marks(scene, map, FX_STYLE);
overlay.top = (id, built) => units.top(id, built);
hud.top = overlay.top;
hud.alt = input.alt = SCROLL.alt && !TOUCH;
input.rattack = SCROLL.rattack;
input.army = TOUCH ? SCROLL.armytap : SCROLL.alt && SCROLL.army;
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

const camera = cameraControls(renderer.domElement, rig, hud, input, () => paused);
const keys = camera.keys;

// Never 0 by 0: a page opened hidden (a background tab, a closed panel) has no size yet, and render targets of size 0
// make WebGL complain (« dimensions not positive »). The resize on showing gives the real size.
const viewW = () => Math.max(1, window.innerWidth);
const viewH = () => Math.max(1, window.innerHeight);
renderer.setSize(viewW(), viewH());
const rain = painted ? new Rain() : null;
if (rain) fxScene.add(rain.mesh);
const post = new Post(renderer, scene, fxScene, rig.camera, GFX.post !== 'off', GFX.post === 'light', biome.warmShadows);
post.xray = GFX.xray;
if (!GFX.ao && !params.has('ao')) post.noOcclusion(); // `?ao`: kept, to compare
window.addEventListener('resize', () => {
  renderer.setPixelRatio(pixelRatio()); // the basse level's depends on the window's size
  renderer.setSize(viewW(), viewH());
  post.setSize(viewW(), viewH());
});

const TICK = 1 / TICK_RATE;
const clock = new Clock();
let acc = 0;
// Pause menu (with the controls) and tool buttons.
let paused = false;
const tools = document.createElement('div');
tools.className = 'tools';
tools.innerHTML = TOOLS_HTML;
const pause = document.createElement('div');
pause.className = 'pause';
pause.hidden = true;
pause.innerHTML = PAUSE_HTML;
// Online, a match is started over only from its end (the rematch, both agreeing), never from the pause menu.
if (link) pause.querySelector<HTMLElement>('[data-p="restart"]')!.hidden = true;
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
// Sliders follow the hand (input); boxes and lists take their change once (both events fire for them: a Bac à
// sable box sent its order twice).
pauseOptions.addEventListener('input', (e) => (e.target as HTMLInputElement).type === 'range' && controlChange(e.target as HTMLInputElement));
pauseOptions.addEventListener('change', (e) => (e.target as HTMLInputElement).type !== 'range' && controlChange(e.target as HTMLInputElement));
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
let pressedAt = 0;
/** The match's analysis shown, on the way from its end to the menu. */
let analysed = false;
window.addEventListener('pointerdown', () => (pressedAt = performance.now()), true);
document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLElement>('.pause [data-p], .hud-banner [data-p], .net-banner [data-p]');
  // A finger already down as the match ended, lifted where « Rejouer » came up: not a press (it relaunched the match,
  // over and over when watching the AI on a phone).
  if (button?.closest('.hud-banner') && pressedAt < hud.endShownAt) return;
  const p = button?.dataset.p;
  if (p === 'resume') setPaused(false);
  // One section open at a time: opening one folds the other.
  else if (p === 'help') {
    helpText.hidden = !helpText.hidden;
    if (!helpText.hidden) pauseOptions.hidden = true;
  } else if (p === 'options') {
    // Built on opening, so the fields show the values in force.
    if (pauseOptions.hidden) pauseOptions.innerHTML = sandboxFields(world) + skinField(factions[PLAYER]) + controlFields(true) + perf.field(rec.field());
    pauseOptions.hidden = !pauseOptions.hidden;
    if (!pauseOptions.hidden) helpText.hidden = true;
  }
  else if (p === 'fullscreen') toggleFullscreen();
  else if (p === 'restart' && !net) {
    const fresh = rec.on && !autoSaved;
    measuresOnce();
    page.leaving = true;
    setTimeout(() => location.reload(), fresh ? 400 : 0);
  }
  else if (p === 'restart' && link && !button?.closest('.hud-banner')) return;
  else if (p === 'restart' && link && !netGame.rematchAsked) {
    netGame.rematchAsked = true;
    button!.textContent = 'Revanche : en attente de votre adversaire…';
    link.again();
  } else if (p === 'restart' && link) return;
  else if (p === 'replay') downloadReplay(REPLAY ? replaySource(REPLAY) : sealed('ongoing')); // watching one: the file itself, whole
  else if (p === 'perfrec') saveMeasures();
  // From the end of a match, the way to the menu goes through its analysis (the user's choice of 2026-11-24).
  else if (p === 'quit' && recap && button?.closest('.hud-banner') && !analysed) {
    analysed = true;
    showRecap(recap, world, world.players.map((q) => FACTIONS[q.faction].name), () => button.click());
  }
  else if (p === 'quit' || p === 'restart') {
    link?.leave();
    // Left before the end, measuring: the measures saved first, the page left a moment later so the download goes through.
    const fresh = rec.on && !autoSaved;
    measuresOnce();
    page.leaving = true;
    setTimeout(() => (location.search = `?biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}&map=${MAP.id}`), fresh ? 400 : 0);
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
/** Bumped as files arrive: a loading that stops moving for STALL_MS is given up. */
let stirred = 0;
const loaded = Promise.all([
  loadModels([...shown, ...shown.flatMap((t) => LOOKS[t] ?? []), ...MINERAL_VARIANTS, ...(factions.includes('z') ? WEAPON_MODELS : [])], (done, total) => {
    stirred++;
    loading?.style.setProperty('--p', String(0.9 * (done / total)));
  }),
  decor.load(scene, (m) => fogMaterial(m, fog, map)),
  loadSprites(shown),
  painted?.load(renderer).catch((e: Error) => Promise.reject(new Error(`Ville de nuit : ${e.message}`))),
]);
const STALL_MS = 30_000;
/** A match's files, given up on a failure or a stall: said with the file at fault, « Réessayer » and « Menu principal ».
 * (The title screen does not wait: its menus work without the scene behind them.) */
const ready = ATTRACT
  ? loaded
  : Promise.race([
      loaded,
      new Promise<never>((_, fail) => {
        let seen = -1;
        let since = performance.now();
        const timer = setInterval(() => {
          const now = performance.now();
          const moved = stirred + (painted ? -painted.waiting.size : 0);
          if (moved !== seen) [seen, since] = [moved, now];
          else if (now - since > STALL_MS) {
            clearInterval(timer);
            const what = painted?.waiting.size ? `Ville de nuit : ${[...painted.waiting].join(', ')}` : 'les modèles et le décor';
            fail(new Error(`Rien n'arrive depuis ${STALL_MS / 1000} s (${what}).`));
          }
        }, 1000);
        loaded.finally(() => clearInterval(timer)).catch(() => {});
      }),
    ]).catch((e: Error) => {
      loadFailed(e.message);
      return new Promise<never>(() => {}); // the match never starts behind it
    });
function loadFailed(why: string): void {
  // Online, the match is called off: the other side is told at once (it would wait for orders that never come), and
  // only the menu is offered (a page reloaded would find the match over).
  link?.leave();
  document.getElementById('crash')?.remove();
  const d = document.createElement('div');
  d.id = 'crash';
  d.style.cssText = 'position:fixed;inset:0;z-index:99;display:grid;place-content:center;justify-items:center;gap:12px;padding:24px;background:#05070d;color:#dceaff;font:16px system-ui;text-align:center';
  d.innerHTML = `<b style="font-size:22px">Chargement de la partie impossible</b><div style="opacity:.7;max-width:640px;word-break:break-word"></div><div style="display:flex;gap:12px">${link ? '' : '<button data-l="retry">Réessayer</button>'}<button data-l="menu">Menu principal</button></div>`;
  d.children[1].textContent = link ? `${why} La partie en ligne est annulée.` : why;
  for (const b of d.querySelectorAll('button')) b.style.cssText = 'padding:10px 22px;font:600 16px system-ui;cursor:pointer';
  d.addEventListener('click', (e) => {
    const l = (e.target as HTMLElement).closest<HTMLElement>('[data-l]')?.dataset.l;
    page.leaving = true;
    if (l === 'retry') location.reload();
    else if (l === 'menu') location.search = `?biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}&map=${MAP.id}`;
  });
  document.body.append(d);
}
ready.then(() => loading?.style.setProperty('--p', '1'));
if (!ATTRACT) {
  // Every portrait the match can show is readied behind the loading screen (render/portrait.ts).
  const portraits = world.players.flatMap((p, i) => shown.filter((t) => (!('faction' in DEFS[t]) ? i === 0 : DEFS[t].faction === p.faction)).map((t): [string, number] => [t, 'faction' in DEFS[t] ? i : -1]));
  // Never waited for more than 3 s: a page the browser does not draw (a tab opened behind, never shown) may never
  // finish compiling shaders, and its match, so the other player's too, would not start until it is shown.
  // Online that is 3 s, the other player waiting; alone it is 20 s: a slow graphics chip (an Intel HD compiles a
  // program in a tenth of a second or more) was cut off at 3 s and compiled the rest in play, a frame held half a
  // second each time something was first seen. Cut off, the warm-up stops there (`stop`): it never runs over the match.
  let waited = false;
  /** When the loading screen stops waiting: every step of the warm-up is held to it, the ones that cannot be cut short
   * (the paving's texture, a pass of drawing) asked before they begin. */
  const limit = net ? 3000 : 20000;
  let deadline = Infinity;
  const late = () => waited || performance.now() >= deadline;
  /** Settled as the loading screen stops waiting, the warm-up done or not. */
  let started = () => {};
  const stopped = new Promise<void>((r) => (started = r));
  // Then the match's first picture, drawn once behind the loading screen: the power network and the paving as they
  // stand, and the post-processing's own programs and buffers, which the first frame in play built (80 to 130 ms).
  const rehearse = () => {
    if (late()) return;
    power.update(world, sees, false, (o) => !SPECTATE && world.hostile(o, PLAYER));
    if (late()) return;
    paving.update(world, sees);
    if (!late()) post.render();
  };
  const warmed = (p: Promise<void>) => Promise.race([p.catch(() => {}), new Promise<void>((r) => setTimeout(r, limit))]).then(() => {
    waited = true;
    started();
  });
  ready.then(() => {
    deadline = performance.now() + limit;
    return warmed((async () => {
      await new Promise((r) => setTimeout(r)); // the timer armed first: what follows runs inside the wait
      if (factions.includes('humains') && !late()) paving.warm();
      // Each begins with work of its own before it first waits: the time is asked again between them.
      const faces = late() ? undefined : hud.portrait.prewarm(portraits, late);
      const shapes = late() ? undefined : compileScene({ renderer, scene, world, units, selected: input.selected, player: PLAYER, sees, seenAt, rig, sun, sunOffset: SUN_OFFSET, post, effects, extras: power.samples(), stop: late, stopped, ghosts: !SPECTATE }, portraits).then(rehearse);
      await Promise.all([faces, shapes]);
    })());
  }).then(start);
  if (!net) ready.then(() => countMatch(REPLAY ? 'replay' : SPECTATE ? 'spectateur' : 'ia', MAP.id, factions[PLAYER]));
} else {
  countTitle();
  document.body.classList.add('attract');
  // Shaders compiled in the background (parallel compile where the browser has it) rather than in one long first frame.
  ready.then(() => renderer.compileAsync(scene, rig.camera)).catch(() => {}).then(start);
  initMenus({ myFaction, foeFaction, biome, MAP, perf, DETECTED, controlFields, controlChange, recField: () => rec.field() });
  const friend = readRoom(params.get('ami') ?? '');
  if (friend) showLobby(document.body.appendChild(Object.assign(document.createElement('div'), { className: 'menu' })), friend, params.has('hote'));
  else showHome();
  loading?.classList.add('mini'); // the menu does not wait for the scene behind it
}

if (document.fullscreenEnabled) { // phones too (Android; an iPhone has no fullscreen for pages)
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

/** A control field changed: kept, and live in the match. False for any other field. */
function controlChange(field: HTMLInputElement | HTMLSelectElement): boolean {
  const tool = field.dataset.sandbox as SandboxTool | undefined;
  if (tool && tool in SANDBOX_TOOLS) {
    if (field.type === 'checkbox') {
      issue({ player: PLAYER, kind: 'sandbox', ids: [], tool, on: (field as HTMLInputElement).checked });
      rememberSandbox(tool, (field as HTMLInputElement).checked);
      // « Recommencer » reloads this URL: it carries this match's options as they stand now (the ones it was
      // launched with, this one switched), not the ones kept on this browser.
      const url = new URL(location.href);
      const on = new Set((url.searchParams.get('outils') ?? '').split(',').filter((t) => t in SANDBOX_TOOLS));
      if ((field as HTMLInputElement).checked) on.add(tool);
      else on.delete(tool);
      const kept = [...on].join(',');
      if (kept) url.searchParams.set('outils', kept);
      else url.searchParams.delete('outils');
      history.replaceState(history.state, '', url);
    }
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
  if (k === 'lock' || k === 'grid' || k === 'lcd' || k === 'tactile' || k === 'tuck' || k === 'alt' || k === 'rattack' || k === 'army' || k === 'armytap' || k === 'mute') {
    SCROLL[k] = (field as HTMLInputElement).checked;
    document.body.classList.toggle('lcd', SCROLL.lcd && !(SCROLL.alt && !TOUCH));
    document.body.classList.toggle('alt', SCROLL.alt && !TOUCH);
    hud.alt = input.alt = SCROLL.alt && !TOUCH;
    input.rattack = SCROLL.rattack;
    input.army = TOUCH ? SCROLL.armytap : SCROLL.alt && SCROLL.army;
    // The grid hotkeys belong to the classic gameplay, the army click to the experimental one: each offered with its own.
    for (const g of document.querySelectorAll<HTMLElement>('[data-classic]')) g.hidden = SCROLL.alt;
    for (const g of document.querySelectorAll<HTMLElement>('[data-experimental]')) g.hidden = !SCROLL.alt;
    document.body.classList.toggle('tactile', TOUCH && SCROLL.tactile);
    document.body.classList.toggle('tuck', TOUCH && SCROLL.tuck);
    hud.buttonsKey = ''; // the card redrawn in its new form
    hud.gridKeys = SCROLL.grid && !TOUCH && !SCROLL.alt;
    if (!SCROLL.lock) pointer.release();
  } else {
    SCROLL[k] = Number(field.value);
    const out = field.nextElementSibling;
    if (out instanceof HTMLOutputElement) out.value = fmt(SCROLL[k], field.dataset.unit ?? '');
  }
  audio.level();
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
      // The match is won: the world stays as it was at the winning tick (the title screen's AIs play on behind the menu).
      if (world.winner !== null && !ATTRACT) {
        acc = 0;
        break;
      }
      // Network game: wait for the other side's orders for this tick (and do not race ahead after a stall).
      if (net && (netGame.netOver || !netGame.netStarted || !net.ready(world.tick))) {
        if (netGame.netStarted && net.started && !netGame.stalledSince) netGame.stalledSince = performance.now();
        acc = Math.min(acc, TICK);
        break;
      }
      netGame.stalledSince = 0;
      // A replay stops where its game was kept (older ones, without that tick, play on).
      if (REPLAY?.endTick !== undefined && world.tick >= REPLAY.endTick) {
        acc = 0;
        // Won, the victory banner says it; else this one, where the game was left.
        if (!replayEnded && world.winner === null) {
          const why = REPLAY.end === 'network' ? 'La partie a été interrompue : connexion perdue.' : REPLAY.end === 'ongoing' ? 'Le replay a été enregistré pendant la partie.' : 'La partie a été quittée avant sa fin.';
          hud.banner.innerHTML = `<h1>Fin du replay</h1><p>${why}</p><div class="row"><button data-p="quit">Menu principal</button><button data-p="replay">Enregistrer le replay</button></div>`;
          hud.banner.hidden = false;
          hud.endShownAt = performance.now();
        }
        replayEnded = true;
        break;
      }
      const cmds = REPLAY ? (replayed.get(world.tick) ?? []) : net ? net.step(world.tick, pending) : [...pending, ...ais.flatMap((ai) => ai.think())];
      if (net && world.tick % 100 === 0) net.check(world.tick, fingerprint(world));
      if (cmds.length && !ATTRACT && !REPLAY) record.ticks.push([world.tick, cmds]);
      world.step(cmds);
      recap?.observe(cmds);
      if (rec.on) {
        stepped++;
        for (const ev of world.events) happened[ev.kind] = (happened[ev.kind] ?? 0) + 1;
      }
      if (world.winner !== null) {
        keepGame();
        measuresDue = true; // saved once this frame is measured (rec.end), so the file holds the winning frame
      }
      pending = [];
      hud.notify(world.events);
      if (drawn) effects.collect(world, seenAt);
      if (drawn && world.tick % 4 === 1) updateFog();
      acc -= TICK;
      if (net?.desync != null) netGame.endNet('Désynchronisation', `Les deux parties ne sont plus identiques (tick ${net.desync}) : elle ne peut pas continuer.`);
    }
  };
  // Network game: a background tab draws nothing (the browser stops or slows its frames), but its side of the match
  // must go on, or the other player would be stuck. A worker's clock steps it then, and watches for an absent other side.
  let framed = performance.now();
  if (net)
    netGame.stopNetClock = every(50, () => {
      if (performance.now() - framed > 250) advance(Math.min(clock.getDelta(), 1), false);
      netGame.watchNet();
    });
  const frame = (elapsed: number) => {
    mark = performance.now();
    rec.begin();
    const dt = Math.min(elapsed, 0.25);
    // The pause menu stops the match on this machine (alone, or watching a replay); online both sides step together,
    // so it pauses nothing there.
    advance(dt);
    lap('sim');
    const [dx, dy] = camera.direction();
    if (ATTRACT) {
      // A slow loop along the diagonal: over the first base, past the armies face to face, over the second.
      const t = performance.now() / 1000 / 24;
      const along = Math.cos(t) * 30;
      const across = Math.sin(t) * 9;
      rig.lookAt(map.width / 2 - (along - across) / Math.SQRT2, map.height / 2 - (along + across) / Math.SQRT2);
    } else {
      camera.glide(dt, dx, dy);
    }
    // A computer can zoom out to the whole map (phones keep the near view, lighter to draw).
    if (!TOUCH) rig.maxView = rig.overview(window.innerWidth / window.innerHeight);
    rig.update(window.innerWidth / window.innerHeight);
    space?.update(rig.target);
    embers?.update(dt, renderer.domElement.height / (rig.camera.top - rig.camera.bottom));
    rain?.update(renderer.domElement.width, renderer.domElement.height);
    painted?.update(rig, window.innerWidth / window.innerHeight, renderer.domElement.height / rig.viewHeight, renderer);
    lavaTime.value += dt;
    lap('scene');
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
    lap('select');
    units.sync(world, acc / TICK, input.selected, PLAYER, sees, seenAt);
    lap('units');
    footprints.update(world, sees, performance.now());
    // The hover halo: a building in sight under the mouse, not already selected (none on a touch screen, which has no hover).
    const hovered = input.hovered;
    units.glow(!TOUCH && !ATTRACT && hovered?.def.kind === 'building' && !input.selected.has(hovered.id) && world.entities.has(hovered.id) && sees(hovered) ? hovered.id : null, performance.now());
    lap('footprints');
    hud.update();
    lap('hud');
    ambientEffects(world, units, effects, sees, dt, (w) => !freeAsSeen(hud, w)); // a well's mist: found, and free as last seen
    effects.lasting(world, sees, acc / TICK, dt);
    effects.update(dt);
    marks.update(world, sees, seenAt, acc / TICK, dt);
    lap('fx');
    overlay.showAll = keys.has('Alt');
    overlay.showQueue = keys.has('Shift');
    overlay.draw(world, rig.camera, input.selected, sees, acc / TICK);
    lap('overlay');
    const placed = hud.placingType && (DEFS[hud.placingType] as BuildingDef).warp;
    power.update(world, sees, !!placed || [...input.selected].some((id) => !!(world.entities.get(id)?.def as BuildingDef | undefined)?.power), (o) => !SPECTATE && world.hostile(o, PLAYER));
    lap('power');
    paving.update(world, sees);
    lap('paving');
    audio.frame();
    lap('audio');
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
    if (rec.on) rec.end(`${rig.target.x.toFixed(2)},${rig.target.z.toFixed(2)},${rig.viewHeight.toFixed(1)}`, { tick: world.tick, ticks: stepped, events: { ...happened }, entities: world.entities.size, particles: effects.live }, unitsOnScreen);
    if (measuresDue) {
      measuresDue = false;
      measuresOnce();
    }
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
  if (import.meta.env.DEV) Object.assign((window as unknown as { xcraft: object }).xcraft, { frame, effects, fxScene, scene, input, renderer, rec, units });
  // Two frames on (the first compiles the shaders), the picture is ready: the loading screen fades away.
  rec.loaded('ready');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rec.loaded('playable');
    loading?.classList.add('done');
    setTimeout(() => loading?.remove(), 500);
  }));
  // Title screen: the scene is only a backdrop behind the menu. On phones and the basse level it is drawn at most
  // 30 times a second. It no longer holds still after a touch: that read as the backdrop freezing, and the menu
  // answers as fast without it (about 105 ms either way on a phone profile, CPU slowed 4 times).
  let lastDraw = 0;
  const capped = ATTRACT && (TOUCH || QUALITY_LEVEL === 'basse');
  renderer.setAnimationLoop((due: number) => {
    const now = performance.now();
    if (capped && now - lastDraw < 30) return;
    rec.due(due);
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
    rec.tail();
  });
}
