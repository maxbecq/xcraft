import { Clock, Color, DirectionalLight, HemisphereLight, PCFSoftShadowMap, Scene, WebGLRenderer } from 'three';
import { CameraRig } from './camera';
import { Hud } from './game/hud';
import { Input } from './game/input';
import { Minimap } from './minimap';
import { Effects } from './render/effects';
import { Overlay } from './render/overlay';
import { EntityRenderer } from './render/units';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import type { Command } from './sim/world';
import './style.css';
import { addFog, buildTerrain } from './terrain';

const EDGE_PX = 8;
const PLAYER = 0;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const world = createMatch();
const map = world.map;
const scene = new Scene();
scene.background = new Color(0x0d0f12);
const terrain = buildTerrain(map);
scene.add(terrain);
const fog = addFog(terrain, map);

scene.add(new HemisphereLight(0xcfd8ff, 0x3a3020, 1.2));
const sun = new DirectionalLight(0xfff1d6, 2.2);
sun.position.set(map.width / 2 - 30, 60, map.height / 2 - 20);
sun.target.position.set(map.width / 2, 0, map.height / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, far: 200 });
scene.add(sun, sun.target);

let pending: Command[] = [];
if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, issue: (c: Command) => pending.push(c) } });

const rig = new CameraRig(map.width, map.height);
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === 'conseil')!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

const minimap = new Minimap(map, rig);
document.body.appendChild(minimap.canvas);

const units = new EntityRenderer(scene, map);
const issue = (c: Command) => pending.push(c);
const input = new Input(world, map, PLAYER, {
  camera: () => rig.camera,
  terrain,
  roots: () => units.roots,
  issue,
  focus: (x, z) => rig.lookAt(x, z),
  click: (button, ground, shift, target) => hud.click(button, ground, shift, target),
}, renderer.domElement);
const hud = new Hud(world, map, PLAYER, input, scene, issue);
minimap.onOrder = (x, y) => input.orderAt(x, y);
minimap.intercept = (x, y) => hud.minimapClick(x, y);
const effects = new Effects(scene, map);
const overlay = new Overlay(map);
document.body.insertBefore(overlay.canvas, minimap.canvas);

/** Copies the player's fog of war to the terrain and minimap. */
function updateFog(): void {
  const tiles = world.vision[PLAYER].tiles;
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

window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));
renderer.setSize(window.innerWidth, window.innerHeight);

const TICK = 1 / TICK_RATE;
const clock = new Clock();
let acc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.25);
  acc += dt;
  while (acc >= TICK) {
    world.step(pending);
    pending = [];
    hud.notify(world.events);
    effects.collect(world, PLAYER);
    if (world.tick % 4 === 1) updateFog();
    acc -= TICK;
  }
  const [dx, dy] = scrollDirection();
  rig.pan(dx, dy, dt);
  rig.update(window.innerWidth / window.innerHeight);
  input.prune();
  units.sync(world, acc / TICK, input.selected, PLAYER);
  hud.update();
  effects.update(dt);
  overlay.draw(world, rig.camera, input.selected, PLAYER, acc / TICK);
  minimap.draw(world, PLAYER);
  renderer.render(scene, rig.camera);
});
