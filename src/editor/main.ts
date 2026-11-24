/**
 * Map editor (prototype, dev only): /editor.html. The view is the game's own renderer (terrain, cliffs, planet,
 * models) under the game's camera, on a format 2 file (format2.ts). A top view in the corner helps find one's way.
 */
import {
  ACESFilmicToneMapping, Cache, CanvasTexture, Color, DirectionalLight, DoubleSide, Group, HemisphereLight, type Material, Mesh, MeshBasicMaterial,
  type Object3D, PCFShadowMap, Plane, PlaneGeometry, Raycaster, Scene, Sprite, SpriteMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// terrain first: it and render/biome import each other, and terrain needs BIOMES ready (as in main.ts).
import { buildTerrain, setBiome, tileColor } from '../terrain';
import { CameraRig } from '../camera';
import { type Dir, type GameMap, heightAt, rotateFootprint, rotateTile } from '../map';
import { CORNERS, MAPS } from '../maps';
import { BIOMES } from '../render/biome';
import { Decor } from '../render/decor';
import { addDeposits } from '../render/deposits';
import { loadModels, MINERAL_VARIANTS, TEAM_COLORS } from '../render/models';
import { EntityRenderer, WEAPON_MODELS } from '../render/units';
import { Space } from '../render/space';
import { DEFS, type Faction, FACTIONS, LOOKS, START } from '../data';
import { checkMap, PLANETS } from '../mapcheck';
import { MAX_SIZE, type MapFile2, type Ramp2, RACES, type Symmetry, blankMap, fromFormat1, parseMap, rampTiles, tileOf, toFormat1, toGameMap, turnRamp, turnsOfSymmetry } from './format2';
import { previewWorld } from './world';

Cache.enabled = true; // the doodads file, read again at each rebuild

type Tool = 'relief' | 'ramp' | 'minerai' | 'puits' | 'decor' | 'depart' | 'base' | 'unite';
const TOOLS: [Tool, string][] = [
  ['relief', 'Relief'], ['ramp', 'Rampe'], ['minerai', 'Minerai'], ['puits', 'Puits'], ['decor', 'Décor'], ['depart', 'Départs'], ['base', 'Base libre'], ['unite', 'Unités'],
];
const TOOL_HELP: Record<Tool, string> = {
  relief: 'Clic gauche : peindre. Touches 0, 1, 2, X : niveau ou gouffre.',
  ramp: 'Clic : rampe dont la tuile du haut est sous le curseur. Clic droit : l\'enlever.',
  minerai: 'Clic gauche : poser du minerai. Clic droit : en enlever.',
  puits: 'Clic : puits d\'énergie (3×3) centré sur le curseur. Clic droit : l\'enlever.',
  decor: 'Clic : poser l\'objet. Clic droit : enlever le plus proche.',
  depart: 'Clic : départ du joueur choisi (QG 4×4). Avec une symétrie, le départ du joueur 1 place les autres.',
  base: 'Clic : emplacement de base libre (QG 4×4). Clic droit : l\'enlever.',
  unite: 'Clic : poser pour le propriétaire choisi. Clic droit : enlever la plus proche.',
};

// ---- state ----
let f: MapFile2 = fromFormat1(MAPS.origine, MAPS.origine.biome, 2);
let tool: Tool = 'relief';
let brush = 3;
let paintLevel = '1';
let rampDir: Dir = 'N';
let rampWidth = 3;
let seat = 0;
let unitType = 'caserne';
let unitOwner = 0;
let decorType = 'rocks_a';
const undo: string[] = [];
const redo: string[] = [];

// ---- scene ----
const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
const scene = new Scene();
const hemi = new HemisphereLight();
const sun = new DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
scene.add(hemi, sun, sun.target);
const SUN_OFFSET = new Vector3(-22, 40, -12);

let rig = new CameraRig(f.size, f.size);
let map: GameMap = toGameMap(f);
let layer = new Scene(); // everything built from the file, thrown away at each rebuild
let units: EntityRenderer | null = null;
let world: ReturnType<typeof previewWorld>['world'] | null = null;
let space: Space | null = null;
scene.add(layer);

// Placed scenery: the game's doodads file, cloned by name.
let doodads: Object3D | null = null;
const doodadNames: string[] = [];
new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/doodads.glb`).then((g) => {
  doodads = g.scene;
  doodadNames.push(...g.scene.children.map((c) => c.name).sort());
  panel();
  dirty = 'full';
});

// Models: the ones the file needs, loaded as they come up.
const loaded = new Set<string>();
async function needModels(): Promise<boolean> {
  const types = new Set<string>(['puits', ...MINERAL_VARIANTS]);
  for (const p of f.players) {
    const r = FACTIONS[p.race || 'humains'];
    [r.hq, r.worker, ...(r.start ?? [])].forEach((t) => types.add(t));
    if (p.race === 'z') WEAPON_MODELS.forEach((t) => types.add(t));
  }
  for (const u of f.units) types.add(u.type);
  const todo = [...types].filter((t) => !loaded.has(t));
  if (!todo.length) return false;
  todo.forEach((t) => loaded.add(t));
  await loadModels([...todo, ...todo.flatMap((t) => LOOKS[t] ?? [])]).catch((e) => say(`Modèles : ${e}`));
  return true;
}

function applyBiome(): void {
  const b = BIOMES[f.biome] ?? BIOMES.desert;
  setBiome(b);
  scene.background = new Color(b.background);
  renderer.toneMappingExposure = b.exposure;
  hemi.color.set(b.sky.color);
  hemi.groundColor.set(b.sky.ground);
  hemi.intensity = b.sky.intensity;
  sun.color.set(b.sun.color);
  sun.intensity = b.sun.intensity;
}

const noFog = (_m: Material) => {};
const markMat = (c: number, opacity = 0.35) => new MeshBasicMaterial({ color: c, transparent: true, opacity, depthWrite: false, side: DoubleSide });

function label(text: string, color: number): Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000a';
  g.fillRect(0, 8, 128, 48);
  g.font = 'bold 34px system-ui';
  g.textAlign = 'center';
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillText(text, 64, 45);
  const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false }));
  s.scale.set(3, 1.5, 1);
  s.renderOrder = 10;
  return s;
}

/** A flat square over the ground (tiles x, y, w × h), for footprints and markers. */
function square(x: number, y: number, w: number, h: number, mat: Material): Mesh {
  const m = new Mesh(new PlaneGeometry(w, h).rotateX(-Math.PI / 2), mat);
  m.position.set(x + w / 2, heightAt(map, x + w / 2, y + h / 2) + 0.08, y + h / 2);
  m.renderOrder = 5;
  return m;
}

/** What the file changed since the view was drawn: the things on the ground ('quick': no scattered scenery, while a stroke goes on). */
let dirty: false | 'quick' | 'full' = 'full';
/** Terrain to draw again: all of it, or the tiles [x0, y0, x1, y1) a stroke touched. */
let groundDirty: 'all' | [number, number, number, number] | null = 'all';
let building = false;
let buildMs = 0;
const times = { terrain: 0, rest: 0, sync: 0 };

/** The terrain in square pieces, each drawn again alone when a stroke touches it. */
const CHUNK = 16;
/** Tiles around a changed one whose look depends on it (rounded cliff tops read 3 tiles away, cut corners 1). */
const REACH = 4;
const terrainRoot = new Group();
scene.add(terrainRoot);
let chunks: (Group | null)[] = [];
let outskirtsPart: Group | null = null;

/** Everything drawn again: a new file, a new planet, an undo. */
function redrawAll(): void {
  groundDirty = 'all';
  dirty = 'full';
}
/** Tiles [x0, y0, x1, y1) changed: the terrain there and around is drawn again, and the things on it. */
function touched(x0: number, y0: number, x1: number, y1: number): void {
  if (groundDirty !== 'all') {
    const r: [number, number, number, number] = [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH];
    groundDirty = groundDirty ? [Math.min(groundDirty[0], r[0]), Math.min(groundDirty[1], r[1]), Math.max(groundDirty[2], r[2]), Math.max(groundDirty[3], r[3])] : r;
  }
  dirty ||= 'quick';
}

const freeMesh = (root: Object3D) =>
  root.traverse((o) => {
    const m = o as Mesh;
    m.geometry?.dispose();
    for (const mat of m.material ? ([] as Material[]).concat(m.material) : []) mat.dispose(); // the pictures stay: terrain.ts keeps them per planet
  });

/** Draws the terrain again: all of it, or the pieces the rectangle reaches. */
function redrawGround(which: 'all' | [number, number, number, number]): void {
  const t = performance.now();
  const n = Math.ceil(f.size / CHUNK);
  if (which === 'all') {
    for (const c of chunks) if (c) (terrainRoot.remove(c), freeMesh(c));
    if (outskirtsPart) (terrainRoot.remove(outskirtsPart), freeMesh(outskirtsPart));
    chunks = new Array(n * n).fill(null);
    outskirtsPart = buildTerrain(map, undefined, { area: [0, 0, 0, 0], outskirts: true });
    terrainRoot.add(outskirtsPart);
  }
  const [x0, y0, x1, y1] = which === 'all' ? [0, 0, f.size, f.size] : which;
  for (let cy = Math.max(0, Math.floor(y0 / CHUNK)); cy <= Math.min(n - 1, Math.floor((y1 - 1) / CHUNK)); cy++) {
    for (let cx = Math.max(0, Math.floor(x0 / CHUNK)); cx <= Math.min(n - 1, Math.floor((x1 - 1) / CHUNK)); cx++) {
      const old = chunks[cy * n + cx];
      if (old) (terrainRoot.remove(old), freeMesh(old));
      const part = buildTerrain(map, undefined, { area: [cx * CHUNK, cy * CHUNK, Math.min(f.size, (cx + 1) * CHUNK), Math.min(f.size, (cy + 1) * CHUNK)], outskirts: false });
      chunks[cy * n + cx] = part;
      terrainRoot.add(part);
    }
  }
  times.terrain = Math.round(performance.now() - t);
}

/** Draws again what changed: the terrain pieces touched, then (`things`) what stands on it. */
async function rebuild(things: false | 'quick' | 'full'): Promise<void> {
  building = true;
  const t0 = performance.now();
  try {
    if (things && (await needModels())) things = 'full';
    applyBiome();
    map = toGameMap(f);
    const ground = groundDirty;
    groundDirty = null;
    if (ground) redrawGround(ground);
    if (ground && !things) drawTop();
    if (things) rebuildThings(things === 'full');
    buildMs = Math.round(performance.now() - t0);
  } catch (e) {
    console.error(e);
    say(`Erreur de rendu : ${(e as Error).message}`);
  } finally {
    building = false;
  }
}

/** Resources, units, buildings, scenery and markers, drawn again from the file. */
function rebuildThings(full: boolean): void {
  units?.clear();
  scene.remove(layer);
  layer.traverse((o) => {
    const m = o as Mesh;
    if (o.userData.keep) return;
    m.geometry?.dispose();
    const mats = m.material ? ([] as Material[]).concat(m.material) : [];
    for (const mat of mats) {
      (mat as MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
  layer = new Scene();
  scene.add(layer);
  const t = performance.now();
  const built = previewWorld(f, map);
  world = built.world;
  if (built.skipped.length) say(`Non placés : ${[...new Set(built.skipped)].join(', ')}`);
  addDeposits(layer, map, world, noFog);
  const b = BIOMES[f.biome] ?? BIOMES.desert;
  if (b.space) {
    space = new Space(map.width, map.height);
    layer.add(space.root);
  } else space = null;
  times.rest = Math.round(performance.now() - t);
  units = new EntityRenderer(layer, map);
  if (full) {
    const decor = new Decor(map, world, b.decorTint, !!b.greyStones, undefined, !!b.space, b.decorSkip);
    void decor.load(layer, noFog);
  }
  // Scenery placed by hand.
  if (doodads) {
    for (const d of f.decor) {
      const node = doodads.getObjectByName(d.type);
      if (!node) continue;
      const o = node.clone();
      o.userData.keep = true; // shares the file's geometry
      o.position.set(d.at[0] + 0.5, heightAt(map, d.at[0] + 0.5, d.at[1] + 0.5), d.at[1] + 0.5);
      o.rotation.y = d.yaw ?? 0;
      o.traverse((c) => {
        c.castShadow = true;
        c.userData.keep = true;
      });
      layer.add(o);
    }
  }
  // Markers: starts, free bases.
  f.players.forEach((p, i) => {
    const s = square(p.start[0], p.start[1], 4, 4, markMat(TEAM_COLORS[i], 0.3));
    layer.add(s);
    const l = label(`J${i + 1}`, TEAM_COLORS[i]);
    l.position.set(p.start[0] + 2, heightAt(map, p.start[0] + 2, p.start[1] + 2) + 5, p.start[1] + 2);
    layer.add(l);
  });
  for (const [x, y] of f.bases) {
    layer.add(square(x, y, 4, 4, markMat(0xffffff, 0.22)));
    const l = label('base', 0xffffff);
    l.position.set(x + 2, heightAt(map, x + 2, y + 2) + 3, y + 2);
    layer.add(l);
  }
  drawTop();
}

// ---- top view ----
const top = document.getElementById('top') as HTMLCanvasElement;
const topCtx = top.getContext('2d')!;
const topImage = document.createElement('canvas');
function drawTop(): void {
  const n = f.size;
  topImage.width = topImage.height = n;
  const g = topImage.getContext('2d')!;
  const img = g.createImageData(n, n);
  const b = BIOMES[f.biome] ?? BIOMES.desert;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const c = map.chasm?.[i] ? new Color(0x050505) : tileColor(map, x, y, b);
      if (map.ramp[i]) c.lerp(new Color(0xffffff), 0.35);
      img.data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
    }
  }
  const dot = (x: number, y: number, rgb: number[]) => img.data.set([...rgb, 255], (y * n + x) * 4);
  for (const [x, y] of f.minerals) dot(x, y, [255, 170, 60]);
  for (const [x, y] of f.wells) for (let k = 0; k < 9; k++) dot(x + (k % 3), y + Math.floor(k / 3), [190, 90, 255]);
  for (const d of f.decor) dot(d.at[0], d.at[1], [90, 90, 90]);
  g.putImageData(img, 0, 0);
  for (const [x, y] of f.bases) {
    g.strokeStyle = '#fff';
    g.strokeRect(x + 0.5, y + 0.5, 3, 3);
  }
  f.players.forEach((p, i) => {
    g.fillStyle = `#${TEAM_COLORS[i].toString(16).padStart(6, '0')}`;
    g.fillRect(p.start[0], p.start[1], 4, 4);
  });
  for (const u of f.units) {
    g.fillStyle = u.owner < 0 ? '#ddd' : `#${TEAM_COLORS[u.owner].toString(16).padStart(6, '0')}`;
    g.fillRect(u.at[0], u.at[1], 2, 2);
  }
}
function paintTop(): void {
  topCtx.imageSmoothingEnabled = false;
  topCtx.drawImage(topImage, 0, 0, top.width, top.height);
  const k = top.width / f.size;
  const pts = rig.footprint();
  topCtx.strokeStyle = '#fff';
  topCtx.beginPath();
  pts.forEach((p, i) => (i ? topCtx.lineTo(p.x * k, p.z * k) : topCtx.moveTo(p.x * k, p.z * k)));
  topCtx.closePath();
  topCtx.stroke();
}
const lookFromTop = (e: PointerEvent) => {
  const r = top.getBoundingClientRect();
  rig.lookAt(((e.clientX - r.left) / r.width) * f.size, ((e.clientY - r.top) / r.height) * f.size);
};
top.addEventListener('pointerdown', (e) => {
  lookFromTop(e);
  try {
    top.setPointerCapture(e.pointerId);
  } catch {
    // as above
  }
});
top.addEventListener('pointermove', (e) => e.buttons && lookFromTop(e));

// ---- editing ----
const turns = () => turnsOfSymmetry(f.symmetry);
const snapshot = () => {
  undo.push(JSON.stringify(f));
  if (undo.length > 100) undo.shift();
  redo.length = 0;
};
function restore(from: string[], to: string[]): void {
  const s = from.pop();
  if (!s) return;
  to.push(JSON.stringify(f));
  f = JSON.parse(s);
  redrawAll();
  panel();
}

function setTile(x: number, y: number, c: string): void {
  if (x < 0 || y < 0 || x >= f.size || y >= f.size) return;
  const row = f.tiles[y];
  if (row[x] === c) return;
  f.tiles[y] = row.slice(0, x) + c + row.slice(x + 1);
  touched(x, y, x + 1, y + 1);
}
/** Tile (x, y) and its copies under the symmetry. */
const copies = (x: number, y: number) => turns().map((q) => rotateTile(f.size, x, y, q));
const footCopies = (x: number, y: number, s: number) => turns().map((q) => rotateFootprint(f.size, x, y, s, q));
const near = (a: [number, number], x: number, y: number, r: number) => Math.abs(a[0] - x) <= r && Math.abs(a[1] - y) <= r;
const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

function apply(x: number, y: number, erase: boolean, first: boolean): void {
  const h = Math.floor((brush - 1) / 2);
  switch (tool) {
    case 'relief':
      for (let dy = -h; dy < brush - h; dy++) for (let dx = -h; dx < brush - h; dx++) for (const [cx, cy] of copies(x + dx, y + dy)) setTile(cx, cy, erase ? '0' : paintLevel);
      break;
    case 'minerai':
      for (let dy = -h; dy < brush - h; dy++) {
        for (let dx = -h; dx < brush - h; dx++) {
          for (const c of copies(x + dx, y + dy)) {
            const at = f.minerals.findIndex((m) => same(m, c));
            if (erase && at >= 0) f.minerals.splice(at, 1);
            if (!erase && at < 0 && c[0] >= 0 && c[1] >= 0 && c[0] < f.size && c[1] < f.size) f.minerals.push(c);
          }
        }
      }
      break;
    default:
      if (!first) return; // the other tools act once per click
      place(x, y, erase);
  }
  dirty ||= 'quick';
}

const touchRamp = (r: Ramp2) => {
  const t = rampTiles(r);
  touched(Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[1])), Math.max(...t.map((p) => p[0])) + 1, Math.max(...t.map((p) => p[1])) + 1);
};

function place(x: number, y: number, erase: boolean): void {
  switch (tool) {
    case 'ramp': {
      if (erase) {
        const [gone, kept] = [f.ramps.filter((r) => rampTiles(r).some(([rx, ry]) => copies(x, y).some((c) => same(c, [rx, ry])))), [] as Ramp2[]];
        for (const r of f.ramps) if (!gone.includes(r)) kept.push(r);
        f.ramps = kept;
        gone.forEach(touchRamp);
        break;
      }
      // Its foot: one level below the ground just above its top tile.
      const [dx, dy] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[rampDir];
      const upper = Number(tileOf(f, x + dx, y + dy)) || 1;
      const [ax, ay] = dx === 0 ? [Math.floor(rampWidth / 2), 0] : [0, Math.floor(rampWidth / 2)];
      const r = { at: [x - ax, y - ay] as [number, number], up: rampDir, width: rampWidth, level: Math.max(0, Math.min(1, upper - 1)) };
      for (const q of turns()) {
        const turned = turnRamp(f.size, r, q);
        f.ramps.push(turned);
        touchRamp(turned);
      }
      break;
    }
    case 'puits':
      if (erase) f.wells = f.wells.filter((w) => !copies(x, y).some(([cx, cy]) => cx >= w[0] && cy >= w[1] && cx < w[0] + 3 && cy < w[1] + 3));
      else f.wells.push(...footCopies(x - 1, y - 1, 3));
      break;
    case 'base':
      if (erase) f.bases = f.bases.filter((b) => !copies(x, y).some(([cx, cy]) => near(b, cx - 2, cy - 2, 3)));
      else f.bases.push(...footCopies(x - 2, y - 2, 4));
      break;
    case 'depart': {
      const s: [number, number] = [x - 2, y - 2];
      f.players[seat].start = s;
      if (seat === 0 && f.symmetry !== 'none') {
        f.players.forEach((p, i) => {
          if (i && turns().includes(CORNERS[i])) p.start = rotateFootprint(f.size, s[0], s[1], 4, CORNERS[i]);
        });
      }
      break;
    }
    case 'decor':
      if (erase) {
        const at = f.decor.findIndex((d) => near(d.at, x, y, 1));
        if (at >= 0) f.decor.splice(at, 1);
      } else for (const at of copies(x, y)) f.decor.push({ type: decorType, at, yaw: Math.round(Math.random() * 628) / 100 });
      break;
    case 'unite': {
      if (erase) {
        const at = f.units.findIndex((u) => near(u.at, x, y, 2));
        if (at >= 0) f.units.splice(at, 1);
        break;
      }
      const def = DEFS[unitType];
      const s = def.kind === 'building' ? def.size : 1;
      const at: [number, number] = [x - Math.floor((s - 1) / 2), y - Math.floor((s - 1) / 2)];
      // Neutral ones follow the symmetry; a player's are placed once.
      if (unitOwner < 0) for (const c of footCopies(at[0], at[1], s)) f.units.push({ type: unitType, owner: -1, at: c });
      else f.units.push({ type: unitType, owner: unitOwner, at });
      break;
    }
  }
}

// ---- pointer ----
const raycaster = new Raycaster();
const ground = new Plane(new Vector3(0, 1, 0), 0);
function tileUnder(e: { clientX: number; clientY: number }): [number, number] | null {
  raycaster.setFromCamera(new Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), rig.camera);
  const hit = raycaster.intersectObject(terrainRoot, true)[0]?.point;
  const p = hit ?? raycaster.ray.intersectPlane(ground, new Vector3());
  if (!p) return null;
  const x = Math.floor(p.x);
  const y = Math.floor(p.z);
  return x >= 0 && y >= 0 && x < f.size && y < f.size ? [x, y] : null;
}

const cursor = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), markMat(0xffe080, 0.45));
cursor.renderOrder = 6;
(cursor.material as Material).depthTest = false;
scene.add(cursor);
function footprint(): number {
  if (tool === 'relief' || tool === 'minerai') return brush;
  if (tool === 'puits') return 3;
  if (tool === 'depart' || tool === 'base') return 4;
  if (tool === 'unite') return DEFS[unitType]?.kind === 'building' ? (DEFS[unitType] as { size: number }).size : 1;
  if (tool === 'ramp') return rampWidth;
  return 1;
}
function moveCursor(t: [number, number] | null): void {
  cursor.visible = !!t;
  if (!t) return;
  const s = footprint();
  const off = tool === 'relief' || tool === 'minerai' ? Math.floor((s - 1) / 2) : tool === 'puits' ? 1 : tool === 'depart' || tool === 'base' ? 2 : Math.floor((s - 1) / 2);
  let [w, h] = [s, s];
  let [x, y] = [t[0] - off, t[1] - off];
  if (tool === 'ramp') {
    const ns = rampDir === 'N' || rampDir === 'S';
    [w, h] = ns ? [rampWidth, 4] : [4, rampWidth];
    x = ns ? t[0] - off : rampDir === 'E' ? t[0] - 3 : t[0];
    y = ns ? (rampDir === 'S' ? t[1] - 3 : t[1]) : t[1] - off;
  }
  cursor.scale.set(w, 1, h);
  cursor.position.set(x + w / 2, heightAt(map, t[0] + 0.5, t[1] + 0.5) + 0.15, y + h / 2);
  const c = tileOf(f, t[0], t[1]);
  status.textContent = `Tuile ${t[0]}, ${t[1]} : ${c === 'x' ? 'gouffre' : `niveau ${c}`}${map.ramp[t[1] * f.size + t[0]] ? ' (rampe)' : ''}`;
}

let painting = -1; // button held, or -1
let lastTile: [number, number] | null = null;
let panning = false;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // a pointer the browser does not know (a scripted one): no capture
  }
  if (e.button === 1 || held.has(' ')) {
    panning = true;
    return;
  }
  const t = tileUnder(e);
  if (!t) return;
  snapshot();
  painting = e.button;
  lastTile = t;
  apply(t[0], t[1], e.button === 2, true);
});
canvas.addEventListener('pointermove', (e) => {
  if (panning) {
    rig.panPixels(e.movementX, e.movementY);
    return;
  }
  const t = tileUnder(e);
  moveCursor(t);
  if (painting >= 0 && t) {
    // Every tile between the last one and this one: a quick stroke leaves no gaps.
    const [lx, ly] = lastTile ?? t;
    const n = Math.max(Math.abs(t[0] - lx), Math.abs(t[1] - ly), 1);
    for (let k = 1; k <= n; k++) apply(Math.round(lx + ((t[0] - lx) * k) / n), Math.round(ly + ((t[1] - ly) * k) / n), painting === 2, false);
    lastTile = t;
  }
});
canvas.addEventListener('pointerup', () => {
  if (painting >= 0) dirty = 'full';
  painting = -1;
  panning = false;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });

const held = new Set<string>();
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  held.add(e.key);
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') restore(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo);
  if (tool === 'relief' && ['0', '1', '2', 'x', 'X'].includes(e.key)) {
    paintLevel = e.key.toLowerCase();
    panel();
  }
});
addEventListener('keyup', (e) => held.delete(e.key));

// ---- panel ----
const panelEl = document.getElementById('panel')!;
const status = document.getElementById('status')!;
const msg = document.getElementById('msg')!;
let msgTimer = 0;
function say(text: string): void {
  msg.textContent = text;
  msg.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (msg.hidden = true), 9000);
}
msg.hidden = true;

const h = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const option = (v: string, text: string, on: boolean) => `<option value="${esc(v)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
const RACE_NAMES: Record<Faction, string> = { humains: 'Humains', z: 'Z', isdaris: 'Isdaris', dieux: 'Dieux' };
/** Units and buildings one can place, by faction (a morph's second form is placed too: it may start so). */
const placeable = (kind: 'unit' | 'building') => Object.entries(DEFS).filter(([, d]) => d.kind === kind && 'faction' in d);

function panel(): void {
  panelEl.replaceChildren();
  const add = (html: string) => panelEl.appendChild(h(html));
  add('<h1>Éditeur de cartes · prototype</h1>');

  // Map settings.
  add('<h2>Carte</h2>');
  const opened = add(`<label>Ouvrir une carte du jeu <select>${option('', '…', true)}${Object.values(MAPS).map((m) => option(m.id, m.name, false)).join('')}</select></label>`);
  opened.querySelector('select')!.onchange = (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    snapshot();
    f = fromFormat1(MAPS[id], MAPS[id].biome);
    reframe();
  };
  const field = (name: string, key: 'name' | 'id' | 'description') => {
    const el = add(`<label>${name} <input type="text" value="${esc(f[key] ?? '')}"></label>`);
    el.querySelector('input')!.onchange = (e) => (f[key] = (e.target as HTMLInputElement).value);
  };
  field('Nom', 'name');
  field('Id', 'id');
  field('Description', 'description');
  const biome = add(`<label>Biome <select>${PLANETS.map((id) => option(id, BIOMES[id]?.name ?? id, id === f.biome)).join('')}</select></label>`);
  biome.querySelector('select')!.onchange = (e) => {
    f.biome = (e.target as HTMLSelectElement).value;
    redrawAll();
  };
  const sym = add(`<label>Symétrie <select>${(['none', 'rot180', 'rot90'] as Symmetry[]).map((s) => option(s, { none: 'aucune', rot180: '2 parts (180°)', rot90: '4 parts (quarts de tour)' }[s], s === f.symmetry)).join('')}</select></label>`);
  sym.querySelector('select')!.onchange = (e) => (f.symmetry = (e.target as HTMLSelectElement).value as Symmetry);
  const fresh = add('<div class="row">Nouvelle : <input type="number" min="32" max="160" step="1" value="96"> tuiles <button>Créer</button></div>');
  fresh.querySelector('button')!.onclick = () => {
    const n = Math.max(32, Math.min(MAX_SIZE, Number(fresh.querySelector('input')!.value) || 96));
    snapshot();
    f = blankMap(n, f.biome);
    reframe();
  };
  const io = add('<div class="row"><button>Exporter (éditeur)</button><button>Exporter pour le jeu</button><button>Importer…</button><button>Annuler</button><button>Rétablir</button><input type="file" accept=".json,application/json" hidden></div>');
  const [exp, exp1, imp, und, red] = io.querySelectorAll('button');
  const file = io.querySelector('input')!;
  const download = (name: string, data: unknown) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  exp.onclick = () => download(`${f.id}.editeur.json`, f);
  // For the game's « Importer une carte »: format 1, checked here as the game will check it.
  exp1.onclick = () => {
    try {
      const { map, notes } = toFormat1(f);
      const checked = checkMap(JSON.parse(JSON.stringify(map)));
      if (typeof checked === 'string') throw new Error(checked);
      download(`${map.id}.json`, map);
      say(['Exporté pour le jeu (relief, rampes, bases, minerai, puits).', ...notes].join(' '));
    } catch (err) {
      say(`Export pour le jeu impossible : ${(err as Error).message}`);
    }
  };
  imp.onclick = () => file.click();
  file.onchange = async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      if (picked.size > 4_000_000) throw new Error('Fichier trop gros (4 Mo au plus).');
      const next = parseMap(JSON.parse(await picked.text()), (d) => {
        const checked = checkMap(d, false); // a format 1 file from outside: checked as the game checks it
        if (typeof checked === 'string') throw new Error(checked);
        return fromFormat1(checked);
      });
      snapshot();
      f = next;
      reframe();
      say(`Importé : ${f.name}`);
    } catch (err) {
      say(`Import refusé : ${(err as Error).message}`);
    }
  };
  und.onclick = () => restore(undo, redo);
  red.onclick = () => restore(redo, undo);

  // Tools.
  add('<h2>Outils</h2>');
  const tools = add('<div class="tools"></div>');
  for (const [t, name] of TOOLS) {
    const b = h(`<button class="${t === tool ? 'on' : ''}">${name}</button>`);
    b.onclick = () => {
      tool = t;
      panel();
    };
    tools.appendChild(b);
  }
  const opts = add(`<div class="opts"><div class="note">${TOOL_HELP[tool]}</div></div>`);
  const opt = (html: string) => opts.appendChild(h(html));
  const brushRow = () => {
    const r = opt(`<label>Pinceau <input type="range" min="1" max="15" value="${brush}"> <span>${brush}</span></label>`);
    r.querySelector('input')!.oninput = (e) => {
      brush = Number((e.target as HTMLInputElement).value);
      r.querySelector('span')!.textContent = String(brush);
    };
  };
  if (tool === 'relief') {
    const r = opt('<div class="row"></div>');
    for (const [v, name] of [['0', 'Niveau 0'], ['1', 'Niveau 1'], ['2', 'Niveau 2'], ['x', 'Gouffre']]) {
      const b = h(`<button class="${v === paintLevel ? 'on' : ''}">${name}</button>`);
      b.onclick = () => {
        paintLevel = v;
        panel();
      };
      r.appendChild(b);
    }
    brushRow();
  }
  if (tool === 'minerai') brushRow();
  if (tool === 'ramp') {
    const r = opt('<div class="row">Le haut vers </div>');
    for (const d of ['N', 'E', 'S', 'W'] as Dir[]) {
      const b = h(`<button class="${d === rampDir ? 'on' : ''}">${{ N: 'nord', E: 'est', S: 'sud', W: 'ouest' }[d]}</button>`);
      b.onclick = () => {
        rampDir = d;
        panel();
      };
      r.appendChild(b);
    }
    const w = opt(`<label>Largeur <input type="number" min="1" max="12" value="${rampWidth}"></label>`);
    w.querySelector('input')!.onchange = (e) => (rampWidth = Math.max(1, Math.min(12, Number((e.target as HTMLInputElement).value) || 3)));
    opt('<div class="note">Une rampe fait 4 tuiles de long ; son pied est un niveau sous la tuile qui la prolonge vers le haut.</div>');
  }
  if (tool === 'decor') {
    const s = opt(`<label>Objet <select>${doodadNames.map((n) => option(n, n, n === decorType)).join('')}</select></label>`);
    s.querySelector('select')!.onchange = (e) => (decorType = (e.target as HTMLSelectElement).value);
  }
  if (tool === 'depart') {
    const r = opt('<div class="row"></div>');
    f.players.forEach((_, i) => {
      const b = h(`<button class="${i === seat ? 'on' : ''}" style="border-color:${hex(TEAM_COLORS[i])}">J${i + 1}</button>`);
      b.onclick = () => {
        seat = i;
        panel();
      };
      r.appendChild(b);
    });
  }
  if (tool === 'unite') {
    const own = opt(`<label>Propriétaire <select>${option('-1', 'Neutre', unitOwner < 0)}${f.players.map((_, i) => option(String(i), `Joueur ${i + 1}`, i === unitOwner)).join('')}</select></label>`);
    own.querySelector('select')!.onchange = (e) => (unitOwner = Number((e.target as HTMLSelectElement).value));
    const groups = RACES.map((r) => {
      const of = (k: 'unit' | 'building') => placeable(k).filter(([, d]) => (d as { faction: string }).faction === r).map(([id, d]) => option(id, `${d.name}${k === 'building' ? ' (bât.)' : ''}`, id === unitType)).join('');
      return `<optgroup label="${RACE_NAMES[r]}">${of('building')}${of('unit')}</optgroup>`;
    });
    const s = opt(`<label>Type <select>${groups.join('')}</select></label>`);
    s.querySelector('select')!.onchange = (e) => (unitType = (e.target as HTMLSelectElement).value);
  }

  // Players.
  add('<h2>Joueurs</h2>');
  const count = add(`<label>Nombre <select>${[1, 2, 3, 4].map((n) => option(String(n), String(n), n === f.players.length)).join('')}</select> <span class="note">aperçu 2 à 4 joueurs</span></label>`);
  count.querySelector('select')!.onchange = (e) => {
    const n = Number((e.target as HTMLSelectElement).value);
    snapshot();
    while (f.players.length > n) f.players.pop();
    while (f.players.length < n) {
      const s0 = f.players[0].start;
      f.players.push({ race: '', start: rotateFootprint(f.size, s0[0], s0[1], 4, CORNERS[f.players.length]), minerals: START.minerals, energy: START.energy, forbid: [] });
    }
    f.units = f.units.filter((u) => u.owner < n);
    seat = Math.min(seat, n - 1);
    unitOwner = Math.min(unitOwner, n - 1);
    dirty = 'full';
    panel();
  };
  f.players.forEach((p, i) => {
    const box = add(`<div class="player"><div class="row"><span class="swatch" style="background:${hex(TEAM_COLORS[i])}"></span><b>Joueur ${i + 1}</b>
      <select>${option('', 'Au choix', !p.race)}${RACES.map((r) => option(r, RACE_NAMES[r], r === p.race)).join('')}</select></div>
      <div class="row">Minerai <input type="number" min="0" step="50" value="${p.minerals}"> Énergie <input type="number" min="0" step="50" value="${p.energy}"></div></div>`);
    box.querySelector('select')!.onchange = (e) => {
      p.race = (e.target as HTMLSelectElement).value as Faction | '';
      p.forbid = [];
      dirty = 'full';
      panel();
    };
    const [mi, en] = box.querySelectorAll('input');
    mi.onchange = () => (p.minerals = Math.max(0, Number(mi.value) || 0));
    en.onchange = () => (p.energy = Math.max(0, Number(en.value) || 0));
    // Tech limits: what this player may not have.
    const kinds: [string, string][] = [['unit', 'Unités'], ['building', 'Bâtiments'], ['upgrade', 'Recherches']];
    const list = kinds.map(([k, name]) => {
      const items = Object.entries(DEFS).filter(([, d]) => d.kind === k && 'faction' in d && (!p.race || d.faction === p.race));
      return `<b>${name}</b>${items.map(([id, d]) => `<label><input type="checkbox" value="${id}"${p.forbid.includes(id) ? ' checked' : ''}> ${esc(d.name)}</label>`).join('')}`;
    });
    const det = h(`<details><summary>Arbre techno : ${p.forbid.length} interdit${p.forbid.length > 1 ? 's' : ''}</summary><div class="forbid">${list.join('')}</div></details>`);
    det.querySelectorAll('input').forEach((c) => {
      c.onchange = () => {
        p.forbid = c.checked ? [...p.forbid, c.value] : p.forbid.filter((x) => x !== c.value);
        det.querySelector('summary')!.textContent = `Arbre techno : ${p.forbid.length} interdit${p.forbid.length > 1 ? 's' : ''}`;
      };
    });
    box.appendChild(det);
  });
  add('<div class="note" style="margin-top:10px">Navigation : flèches ou ZQSD, molette pour zoomer, clic milieu ou Espace + glisser pour déplacer, vue de dessus en bas à droite. Ctrl+Z / Ctrl+Maj+Z.<br><br>Le jeu ne lit pas encore ce format : réglages des joueurs, unités placées, décor posé et limites techno ne vivent que dans le fichier.</div>');
}

/** A new file: a new camera for its size, the view rebuilt. */
function reframe(): void {
  rig = new CameraRig(f.size, f.size);
  rig.maxView = rig.overview(aspect());
  rig.viewHeight = Math.min(rig.maxView, 60);
  const s = f.players[0].start;
  rig.lookAt(s[0] + 2, s[1] + 2);
  seat = 0;
  unitOwner = Math.min(unitOwner, f.players.length - 1);
  redrawAll();
  panel();
}

// ---- loop ----
/** The screen's shape (a page opened in the background may have no size yet). */
function aspect(): number {
  return innerWidth > 0 && innerHeight > 0 ? innerWidth / innerHeight : 1.5;
}
let lastBuild = 0;
let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const k = (a: string, b: string, c: string) => (held.has(a) || held.has(b) || held.has(c) ? 1 : 0);
  rig.pan(k('ArrowRight', 'd', 'D') - k('ArrowLeft', 'q', 'Q'), k('ArrowUp', 'z', 'Z') - k('ArrowDown', 's', 'S'), dt);
  rig.update(aspect());
  sun.position.copy(rig.target).add(SUN_OFFSET);
  sun.target.position.copy(rig.target);
  space?.update(rig.target);
  // While a stroke goes on: the terrain it touched, often; what stands on it (heights, units) once it ends, except for
  // the tools that place things.
  if (!building && (groundDirty || (dirty && (painting < 0 || tool !== 'relief'))) && (painting < 0 || now - lastBuild > 60)) {
    const things = painting < 0 ? dirty : tool === 'relief' ? false : dirty && 'quick';
    if (things) dirty = false;
    lastBuild = now;
    void rebuild(things);
  }
  const ts = performance.now();
  if (world && units) units.sync(world, 1, new Set(), 0, () => true, () => true);
  times.sync = Math.max(times.sync * 0.9, performance.now() - ts);
  renderer.render(scene, rig.camera);
  paintTop();
  requestAnimationFrame(frame);
};
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  rig.maxView = rig.overview(aspect());
});
reframe();
requestAnimationFrame(frame);
if (import.meta.env.DEV) Object.assign(window, { editor: { get file() { return f; }, get rig() { return rig; }, get state() { return { building, dirty, groundDirty, buildMs, times, chunks: chunks.length }; }, gameFile: () => toFormat1(f), screenOf: (x: number, y: number) => {
  const v = new Vector3(x + 0.5, heightAt(map, x + 0.5, y + 0.5), y + 0.5).project(rig.camera);
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}, set: (next: MapFile2) => { f = next; reframe(); } } });
