import { Clock, Color, DirectionalLight, HemisphereLight, PCFSoftShadowMap, Scene, WebGLRenderer } from 'three';
import { CameraRig } from './camera';
import { Input } from './game/input';
import { createMap } from './map';
import { Minimap } from './minimap';
import { EntityRenderer } from './render/units';
import { FP, TICK_RATE } from './sim/fixed';
import { type Command, World } from './sim/world';
import { buildTerrain } from './terrain';

const EDGE_PX = 8;
const PLAYER = 0;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const map = createMap();
const scene = new Scene();
scene.background = new Color(0x0d0f12);
const terrain = buildTerrain(map);
scene.add(terrain);

scene.add(new HemisphereLight(0xcfd8ff, 0x3a3020, 1.2));
const sun = new DirectionalLight(0xfff1d6, 2.2);
sun.position.set(map.width / 2 - 30, 60, map.height / 2 - 20);
sun.target.position.set(map.width / 2, 0, map.height / 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, far: 200 });
scene.add(sun, sun.target);

// Simulation, with a starting squad for each player until the economy exists (M3).
const world = new World(map);
const squad = ['serf', 'serf', 'serf', 'auxiliaire', 'auxiliaire', 'auxiliaire', 'auxiliaire', 'legionnaire', 'legionnaire', 'soigneur'];
for (const [owner, cx, cy] of [[0, 14, 14], [1, 81, 81]]) {
  squad.forEach((type, i) => world.spawn(type, owner, (cx - 2 + (i % 4)) * FP + FP / 2, (cy - 1 + Math.floor(i / 4)) * FP + FP / 2));
}
let pending: Command[] = [];

const rig = new CameraRig(map.width, map.height);
rig.lookAt(14, 14); // player 1's main base

const minimap = new Minimap(map, rig);
document.body.appendChild(minimap.canvas);

const units = new EntityRenderer(scene, map);
const input = new Input(world, map, PLAYER, () => rig.camera, terrain, (c) => pending.push(c), (x, z) => rig.lookAt(x, z), renderer.domElement);
minimap.onOrder = (x, y) => input.orderAt(x, y);

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
    acc -= TICK;
  }
  const [dx, dy] = scrollDirection();
  rig.pan(dx, dy, dt);
  rig.update(window.innerWidth / window.innerHeight);
  units.sync(world, acc / TICK, input.selected, PLAYER);
  minimap.draw(world);
  renderer.render(scene, rig.camera);
});
