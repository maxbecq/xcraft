import { ACESFilmicToneMapping, Clock, Color, DirectionalLight, HemisphereLight, PCFSoftShadowMap, Scene, Vector3, WebGLRenderer } from 'three';
import { AI, DIFFICULTY } from './ai/ai';
import { Audio } from './audio';
import { CameraRig } from './camera';
import { Hud } from './game/hud';
import { Input } from './game/input';
import { Minimap } from './minimap';
import { Effects } from './render/effects';
import { Post } from './render/post';
import { Overlay } from './render/overlay';
import { EntityRenderer, loadModels } from './render/units';
import { DEFS } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import type { Command, Entity } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial } from './terrain';
import { Decor } from './render/decor';

const EDGE_PX = 8;
const params = new URLSearchParams(location.search);
/** `?spectate`: watch the AI play itself, without fog. */
const SPECTATE = params.has('spectate');
/** `?speed=4`: simulation speed multiplier. */
const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
const PLAYER = 0;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const world = createMatch();
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
const sees = (e: Entity) => SPECTATE || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => SPECTATE || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
const ais = SPECTATE ? [new AI(world, 0), new AI(world, 1)] : [new AI(world, 1)];
if (!SPECTATE) world.players[1].handicap = DIFFICULTY[params.get('ai') ?? 'normal'] ?? 100;
const map = world.map;
const scene = new Scene();
scene.background = new Color(0x0d0f12);
const terrain = buildTerrain(map);
scene.add(terrain);
const fog = createFog(map);
addFog(terrain, fog, map);
const decor = new Decor(map, world);

// Warm low sun from the north-west, cool sky fill: long readable shadows like SC2.
scene.add(new HemisphereLight(0xb8c8e8, 0x4a3820, 1.1));
const sun = new DirectionalLight(0xffe2b8, 3.2);
const SUN_OFFSET = new Vector3(-22, 40, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
// The shadow box follows the camera, so shadows stay crisp.
Object.assign(sun.shadow.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 140 });
scene.add(sun, sun.target);

let pending: Command[] = [];


const rig = new CameraRig(map.width, map.height);
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === 'conseil')!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, rig, issue: (c: Command) => pending.push(c) } });

const minimap = new Minimap(map, rig);
document.body.appendChild(minimap.canvas);

const units = new EntityRenderer(scene, map);
units.onBuilding = (e) => decor.hideUnder(e.tx, e.ty, (e.def as { size: number }).size);
const issue = (c: Command) => pending.push(c);
const input = new Input(world, map, PLAYER, {
  camera: () => rig.camera,
  terrain,
  roots: () => units.roots,
  issue,
  focus: (x, z) => rig.lookAt(x, z),
  click: (button, ground, shift, target) => hud.click(button, ground, shift, target),
}, renderer.domElement);
const audio = new Audio();
const hud = new Hud(world, map, PLAYER, input, scene, issue, audio);
minimap.onOrder = (x, y) => input.orderAt(x, y);
minimap.intercept = (x, y) => hud.minimapClick(x, y);
const effects = new Effects(scene, map, audio);
const overlay = new Overlay(map);
document.body.insertBefore(overlay.canvas, minimap.canvas);

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
window.addEventListener('mousemove', (e) => (mouse = { x: e.clientX, y: e.clientY }));
document.addEventListener('mouseleave', () => (mouse = null));
window.addEventListener('wheel', (e) => rig.zoomBy(Math.exp(e.deltaY * 0.001)));

function scrollDirection(): [number, number] {
  let dx = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  let dy = Number(keys.has('ArrowUp')) - Number(keys.has('ArrowDown'));
  if (mouse) {
    if (mouse.x < EDGE_PX) dx = -1;
    if (mouse.x > window.innerWidth - EDGE_PX) dx = 1;
    if (mouse.y < EDGE_PX) dy = 1;
    if (mouse.y > window.innerHeight - EDGE_PX) dy = -1;
  }
  return [dx, dy];
}

renderer.setSize(window.innerWidth, window.innerHeight);
const post = new Post(renderer, scene, rig.camera, !params.has('lowfx'));
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  post.setSize(window.innerWidth, window.innerHeight);
});

const TICK = 1 / TICK_RATE;
const clock = new Clock();
let acc = 0;
// Title screen and help.
const tools = document.createElement('div');
tools.className = 'tools';
tools.innerHTML = '<button class="tool" data-t="help">? Aide</button>';
const help = document.createElement('div');
help.className = 'help';
help.hidden = true;
help.innerHTML = `<h3>Contrôles</h3>
Clic gauche / rectangle : sélectionner (<kbd>Maj</kbd> pour ajouter)<br>
Clic droit : déplacer, récolter, attaquer, point de ralliement<br>
<kbd>A</kbd> puis clic : attaquer / attaque-déplacement<br>
<kbd>S</kbd> stop · <kbd>B</kbd> construire (serf) · <kbd>Échap</kbd> annuler<br>
<kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> : groupe, <kbd>1</kbd>…<kbd>9</kbd> : rappel (×2 : centrer)<br>
Flèches, bords d'écran, minimap : caméra · molette : zoom<br>
<kbd>F1</kbd> : cette aide`;
document.body.append(tools, help);
tools.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).dataset.t;
  if (t === 'help') help.hidden = !help.hidden;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'F1') {
    e.preventDefault();
    help.hidden = !help.hidden;
  }
});
window.addEventListener('pointerdown', () => audio.start(), { once: true });

const ready = Promise.all([loadModels(Object.keys(DEFS)), decor.load(scene, (m) => fogMaterial(m, fog, map))]);
if (SPECTATE || params.has('play')) {
  ready.then(start);
} else {
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `<h1>XCRAFT</h1><p>Les Humains — V1</p>
    <button data-m="easy">Jouer — IA facile</button>
    <button data-m="normal">Jouer — IA normale</button>
    <button data-m="hard">Jouer — IA difficile</button>
    <button data-m="watch">Regarder IA contre IA</button>`;
  document.body.append(menu);
  menu.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    if (m === 'watch') location.search = '?spectate&speed=2';
    else if (m) location.search = `?play&ai=${m}`;
  });
}

function start(): void {
  clock.getDelta();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.25);
    acc += dt * SPEED;
    while (acc >= TICK) {
      world.step([...pending, ...ais.flatMap((ai) => ai.think())]);
      pending = [];
      hud.notify(world.events);
      effects.collect(world, seenAt);
      if (world.tick % 4 === 1) updateFog();
      acc -= TICK;
    }
    const [dx, dy] = scrollDirection();
    rig.pan(dx, dy, dt);
    rig.update(window.innerWidth / window.innerHeight);
    input.prune();
    units.sync(world, acc / TICK, input.selected, PLAYER, sees);
    hud.update();
    effects.update(dt);
    overlay.draw(world, rig.camera, input.selected, sees, acc / TICK);
    audio.frame();
    minimap.draw(world, sees);
    sun.target.position.copy(rig.target);
    sun.position.copy(rig.target).add(SUN_OFFSET);
    post.render();
  });
}
