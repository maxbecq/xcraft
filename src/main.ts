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
import { EntityRenderer, MINERAL_VARIANTS, loadModels } from './render/units';
import { DEFS, FACTIONS, type Faction } from './data';
import { FP, TICK_RATE } from './sim/fixed';
import { createMatch } from './sim/setup';
import { heightAt } from './map';
import type { Command, Entity } from './sim/world';
import './style.css';
import { addFog, buildTerrain, createFog, fogMaterial, setBiome } from './terrain';
import { BIOMES, pickBiome } from './render/biome';
import { Decor } from './render/decor';
import { addDeposits } from './render/deposits';

const EDGE_PX = 8;
const params = new URLSearchParams(location.search);
/** `?spectate`: watch the AI play itself, without fog. */
/** Title screen: an AI-versus-AI match plays behind the menu, under a drifting camera. */
const ATTRACT = !params.has('spectate') && !params.has('play');
const SPECTATE = params.has('spectate') || ATTRACT;
/** `?speed=4`: simulation speed multiplier. */
const SPEED = Math.min(16, Math.max(0.25, Number(params.get('speed')) || 1));
const PLAYER = 0;

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
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
const myFaction = asFaction(params.get('camp') ?? stored('xcraft.camp'));
const foeFaction = asFaction(params.get('adversaire') ?? stored('xcraft.adversaire'));
const world = createMatch([myFaction, foeFaction]);
document.body.classList.toggle('isdaris', myFaction === 'isdaris' && !params.has('spectate'));
/** What the local player can see (everything when spectating). Rendering only: the simulation never uses it. */
const sees = (e: Entity) => SPECTATE || world.sees(PLAYER, e);
const seenAt = (x: number, y: number) => SPECTATE || world.vision[PLAYER].visible(Math.floor(x / FP), Math.floor(y / FP));
const ais = SPECTATE ? [new AI(world, 0), new AI(world, 1)] : [new AI(world, 1)];
if (!SPECTATE) world.players[1].handicap = DIFFICULTY[params.get('ai') ?? 'normal'] ?? 100;
const map = world.map;
const scene = new Scene();
scene.background = new Color(biome.background);
setBiome(biome);
const terrain = buildTerrain(map);
scene.add(terrain);
const fog = createFog(map);
addFog(terrain, fog, map);
const decor = new Decor(map, world, biome.decorTint);
addDeposits(scene, map, world, (m) => fogMaterial(m, fog, map));

// Warm low sun from the north-west, cool sky fill: long readable shadows like SC2.
scene.add(new HemisphereLight(biome.sky.color, biome.sky.ground, biome.sky.intensity));
const sun = new DirectionalLight(biome.sun.color, biome.sun.intensity);
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
const home = [...world.entities.values()].find((e) => e.owner === PLAYER && e.type === FACTIONS[myFaction].hq)!;
rig.lookAt(home.x / FP + 2, home.y / FP + 2);

if (import.meta.env.DEV) Object.assign(window, { xcraft: { world, rig, issue: (c: Command) => pending.push(c) } });

const minimap = new Minimap(map, rig, 164);

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
hud.mapSlot.append(minimap.canvas);
minimap.onOrder = (x, y) => input.orderAt(x, y);
minimap.intercept = (x, y) => hud.minimapClick(x, y);
const fxScene = new Scene();
const effects = new Effects(fxScene, scene, map, audio);
const overlay = new Overlay(map);
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
const post = new Post(renderer, scene, fxScene, rig.camera, !params.has('lowfx'));
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

const ready = Promise.all([loadModels([...Object.keys(DEFS), ...MINERAL_VARIANTS]), decor.load(scene, (m) => fogMaterial(m, fog, map))]);
if (!ATTRACT) {
  ready.then(start);
} else {
  document.body.classList.add('attract');
  ready.then(start);
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = `<h1>XCRAFT</h1><p>Humains · Isdaris</p>
    <button data-m="easy">Jouer — IA facile</button>
    <button data-m="normal">Jouer — IA normale</button>
    <button data-m="hard">Jouer — IA difficile</button>
    <button data-m="watch">Regarder IA contre IA</button>
    <div class="row">
      <button data-m="camp">Votre camp : ${FACTIONS[myFaction].name}</button>
      <button data-m="adversaire">Adversaire : ${FACTIONS[foeFaction].name}</button>
      <button data-m="biome">Planète : ${biome.name}</button>
    </div>`;
  document.body.append(menu);
  menu.addEventListener('click', (e) => {
    const m = (e.target as HTMLElement).dataset.m;
    const keep = `biome=${biome.id}&camp=${myFaction}&adversaire=${foeFaction}`;
    if (m === 'camp' || m === 'adversaire') {
      const now = m === 'camp' ? myFaction : foeFaction;
      const next = now === 'humains' ? 'isdaris' : 'humains';
      try {
        localStorage.setItem(`xcraft.${m}`, next);
      } catch {
        // the URL still carries it
      }
      location.search = keep.replace(`${m}=${now}`, `${m}=${next}`);
    } else if (m === 'biome') {
      // Cycle planets; the title screen reloads to show the new one.
      const ids = Object.keys(BIOMES);
      const next = ids[(ids.indexOf(biome.id) + 1) % ids.length];
      try {
        localStorage.setItem('xcraft.biome', next);
      } catch {
        // storage unavailable: the URL still carries it
      }
      location.search = keep.replace(`biome=${biome.id}`, `biome=${next}`);
    } else if (m === 'watch') location.search = `?spectate&speed=2&${keep}`;
    else if (m) location.search = `?play&ai=${m}&${keep}`;
  });
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
      world.step([...pending, ...ais.flatMap((ai) => ai.think())]);
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
  if (import.meta.env.DEV) Object.assign((window as unknown as { xcraft: object }).xcraft, { frame, effects, fxScene });
  renderer.setAnimationLoop(() => frame(clock.getDelta()));
}
