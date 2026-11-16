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

/** Edge scrolling: how close to the screen's edge (at the bottom, to the top of the command console) the mouse must be. */
const EDGE_PX = 40;
const params = new URLSearchParams(location.search);
/** `?spectate`: watch the AI play itself, without fog. */
/** Title screen: an AI-versus-AI match plays behind the menu, under a drifting camera. */
const ATTRACT = !params.has('spectate') && !params.has('play') && !params.has('replay');
const REPLAY_KEY = 'xcraft.replay';
/** The game just played has been kept as the last game. */
let saved = false;
/** `?replay`: plays back the last saved game (or one opened from a file), watched like a spectator. */
const REPLAY = params.has('replay') ? readReplay() : null;
const SPECTATE = params.has('spectate') || ATTRACT || !!REPLAY;
/** `?speed=4`: simulation speed multiplier. */
const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
const PLAYER = 0;

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
const myFaction = REPLAY ? REPLAY.factions[0] : asFaction(params.get('camp') ?? stored('xcraft.camp'));
const foeFaction = REPLAY ? REPLAY.factions[1] : asFaction(params.get('adversaire') ?? stored('xcraft.adversaire'));
const world = createMatch([myFaction, foeFaction]);
document.body.classList.toggle('isdaris', myFaction === 'isdaris'); // spectating shows the first side's interface
document.body.classList.toggle('spectate', SPECTATE);
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
const sees = (e: Entity) => SPECTATE || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => SPECTATE || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
const ais = REPLAY ? [] : SPECTATE ? [new AI(world, 0), new AI(world, 1)] : [new AI(world, 1)];
if (!SPECTATE) world.players[1].handicap = DIFFICULTY[params.get('ai') ?? 'normal'] ?? 100;
else if (!REPLAY && !ATTRACT) [0, 1].forEach((i) => (world.players[i].handicap = DIFFICULTY[params.get(`ai${i}`) ?? 'normal'] ?? 100));
if (REPLAY) REPLAY.handicap.forEach((h, i) => (world.players[i].handicap = h));
/** Every command the simulation took, by tick: the whole game, since it is deterministic. */
const record: Replay = { v: 1, factions: [myFaction, foeFaction], biome: biome.id, handicap: world.players.map((p) => p.handicap), ticks: [] };
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


const rig = new CameraRig(map.width, map.height);
// Upright phones: zoom out so the narrow view still spans a dozen tiles.
if (window.innerHeight > window.innerWidth) rig.viewHeight = 26;
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === FACTIONS[myFaction].hq)!;
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
    const ex = mouse.x < EDGE_PX ? -1 : mouse.x > window.innerWidth - EDGE_PX ? 1 : 0;
    // The bottom band sits just above the console, so its buttons never scroll the map.
    const bottom = document.querySelector('.console')?.getBoundingClientRect().top ?? window.innerHeight;
    edgeGlow.style.setProperty('--edge-bottom', `${window.innerHeight - bottom}px`);
    const ey = mouse.y < EDGE_PX ? 1 : mouse.y > bottom - EDGE_PX && mouse.y < bottom ? -1 : 0;
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
  else if (p === 'restart') location.reload();
  else if (p === 'replay') downloadReplay(record);
  else if (p === 'quit') location.search = `?biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}`;
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
  sides: { faction: Faction; control: string }[];
  biome: string;
  speed: number;
}
const CONTROLS: Record<string, string> = { you: 'Vous', easy: 'IA facile', normal: 'IA normale', hard: 'IA difficile' };

function readSetup(): Setup {
  const fallback: Setup = {
    sides: [
      { faction: myFaction, control: 'you' },
      { faction: foeFaction, control: 'normal' },
    ],
    biome: biome.id,
    speed: 2,
  };
  try {
    const s = JSON.parse(stored('xcraft.setup') ?? 'null') as Setup | null;
    if (s?.sides?.length === 2 && BIOMES[s.biome]) return s;
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
    <div class="row">
      ${stored(REPLAY_KEY) ? '<button data-m="last-replay">Revoir la dernière partie</button>' : ''}
      <button data-m="open-replay">Ouvrir un replay…</button>
    </div>`;
  (menu as HTMLElement).onclick = (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    if (m === 'new') showSetup(menu as HTMLElement, readSetup());
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
  const side = (i: number) => {
    const controls = { ...CONTROLS };
    if (i === 1) delete controls.you; // the local player is always the first side
    const color = `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    return `<fieldset><legend style="color:${color}">Joueur ${i + 1}</legend>${pick(`f${i}`, factions, s.sides[i].faction)}${pick(`c${i}`, controls, s.sides[i].control)}</fieldset>`;
  };
  const watching = s.sides[0].control !== 'you';
  menu.className = 'menu setup';
  menu.innerHTML = `<h2>Nouvelle partie</h2>
    ${side(0)}${side(1)}
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
      else s.sides[Number(k[1])].control = v;
      showSetup(menu, s);
    } else if (m === 'back') showHome();
    else if (m === 'go') launch(s);
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
  location.search = a.control === 'you' ? `?play&ai=${b.control}&${keep}` : `?spectate&speed=${s.speed}&ai0=${a.control}&ai1=${b.control}&${keep}`;
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
      const cmds = REPLAY ? (replayed.get(world.tick) ?? []) : [...pending, ...ais.flatMap((ai) => ai.think())];
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
    } else rig.pan(dx, dy, dt);
    rig.update(window.innerWidth / window.innerHeight);
    input.prune();
    units.sync(world, acc / TICK, input.selected, PLAYER, sees);
    lap('units');
    hud.update();
    lap('hud');
    for (const e of world.entities.values()) {
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
    if (paused) post.render();
    else frame(dt);
  });
}

// ---------------------------------------------------------------- replays

/** A game as the commands the simulation took, tick by tick; replaying them rebuilds it exactly. */
interface Replay {
  v: 1;
  factions: [Faction, Faction];
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
