/**
 * Map editor: /xcraft/editeur/ (editeur/index.html), a second page of the build, reached by its address only. The view
 * is the game's own renderer (terrain, cliffs, planet, models) under the game's camera, on a format 2 file
 * (format2.ts); a button (or Tab) turns the camera to look straight down, the same scene, to paint precisely. Around it, panels (shell.ts, panels.ts) docked with
 * dockview: palettes, players, minimap, properties, layers.
 */
import {
  ACESFilmicToneMapping, BufferGeometry, OrthographicCamera, Cache, CanvasTexture, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, LineBasicMaterial,
  LineSegments, type Material, Mesh, MeshBasicMaterial, type Object3D, PCFShadowMap, Plane, PlaneGeometry, Raycaster, Scene, Sprite, SpriteMaterial, Vector2,
  Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// terrain first: it and render/biome import each other, and terrain needs BIOMES ready (as in the game's main.ts).
import { buildTerrain, setBiome, tileColor } from '../terrain';
import { CameraRig } from '../camera';
import { type GameMap, heightAt, rotateFootprint, rotateTile } from '../map';
import { CORNERS } from '../maps';
import { BIOMES } from '../render/biome';
import { Decor } from '../render/decor';
import { addDeposits } from '../render/deposits';
import { loadModels, MINERAL_VARIANTS, TEAM_COLORS } from '../render/models';
import { EntityRenderer, WEAPON_MODELS } from '../render/units';
import { Space } from '../render/space';
import { DEFS, FACTIONS, LOOKS } from '../data';
import { checkMap } from '../mapcheck';
import { unplayable } from '../mapplay';
import { DECOR, type MapFile2, type Ramp2, rampTiles, tileOf, toFormat1, toGameMap, turnRamp, turnsOfSymmetry } from './format2';
import { previewWorld } from './world';
import { act, changed, ed, REGION_COLORS, type Selection, startNumbers, TOOL_LAYER, TOOL_NAMES, triggersOf } from './state';
import { buildShell, type Shell } from './shell';

Cache.enabled = true; // the doodads file, read again at each rebuild

// ---- scene ----
const canvas = document.createElement('canvas');
canvas.className = 'view3d';
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
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

let f = ed.f;
let rig = new CameraRig(f.size, f.size);
let map: GameMap = toGameMap(f);
let layer = new Scene(); // everything built from the file, thrown away at each rebuild
let units: EntityRenderer | null = null;
let world: ReturnType<typeof previewWorld>['world'] | null = null;
let space: Space | null = null;
scene.add(layer);

// Placed scenery: the game's doodads file, cloned by name.
let doodads: Object3D | null = null;
export const doodadNames: string[] = [];
new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/doodads.glb`).then((g) => {
  doodads = g.scene;
  doodadNames.push(...g.scene.children.map((c) => c.name).filter((n) => DECOR.includes(n)).sort());
  dirty = 'full';
  changed();
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
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

function label(text: string, color: number): Sprite {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000a';
  g.fillRect(0, 8, 128, 48);
  g.font = 'bold 34px system-ui';
  g.textAlign = 'center';
  g.fillStyle = hex(color);
  g.fillText(text, 64, 45);
  const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false }));
  s.scale.set(3, 1.5, 1);
  s.renderOrder = 10;
  return s;
}

/** A start's number in a ring of its player's colour; the one chosen in the players' table, larger and lit. */
function badge(text: string, color: number, on: boolean): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(48, 48, on ? 44 : 34, 0, Math.PI * 2);
  g.fillStyle = on ? '#e3a33b' : '#0b0d10dd';
  g.fill();
  g.lineWidth = on ? 6 : 5;
  g.strokeStyle = on ? '#fff' : hex(color);
  g.stroke();
  g.font = `bold ${on ? 48 : 40}px system-ui`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = on ? '#111' : '#fff';
  g.fillText(text, 48, 51);
  const s = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), depthTest: false }));
  s.scale.set(on ? 3.4 : 2.4, on ? 3.4 : 2.4, 1);
  s.renderOrder = 11;
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
/** Bumped at each change of the file: the playability check runs again a moment after. */
let version = 0;

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
  version++;
}
/** Tiles [x0, y0, x1, y1) changed: the terrain there and around is drawn again, and the things on it. */
function touched(x0: number, y0: number, x1: number, y1: number): void {
  if (groundDirty !== 'all') {
    const r: [number, number, number, number] = [x0 - REACH, y0 - REACH, x1 + REACH, y1 + REACH];
    groundDirty = groundDirty ? [Math.min(groundDirty[0], r[0]), Math.min(groundDirty[1], r[1]), Math.max(groundDirty[2], r[2]), Math.max(groundDirty[3], r[3])] : r;
  }
  dirty ||= 'quick';
  version++;
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

/** Resources, units, buildings, scenery and markers, drawn again from the file (hidden layers left out). */
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
  const shown = ed.hidden;
  const view = { ...f, minerals: shown.has('resources') ? [] : f.minerals, wells: shown.has('resources') ? [] : f.wells, units: shown.has('units') ? [] : f.units };
  const built = previewWorld(view, map);
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
  if (full && !shown.has('decorSeeded')) {
    const decor = new Decor(map, world, b.decorTint, !!b.greyStones, undefined, !!b.space, b.decorSkip);
    void decor.load(layer, noFog);
  }
  // Scenery placed by hand.
  if (doodads && !shown.has('decorPlaced')) {
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
  // Markers: starts by number, the chosen player's lit; free bases.
  if (!shown.has('starts')) {
    const num = startNumbers(f);
    f.players.forEach((p, i) => {
      layer.add(square(p.start[0], p.start[1], 4, 4, markMat(TEAM_COLORS[i], i === ed.seat ? 0.45 : 0.25)));
      const s = badge(String(num[i]), TEAM_COLORS[i], i === ed.seat);
      s.position.set(p.start[0] + 2, heightAt(map, p.start[0] + 2, p.start[1] + 2) + 5, p.start[1] + 2);
      layer.add(s);
    });
    for (const [x, y] of f.bases) {
      layer.add(square(x, y, 4, 4, markMat(0xffffff, 0.22)));
      const l = label('base', 0xffffff);
      l.position.set(x + 2, heightAt(map, x + 2, y + 2) + 3, y + 2);
      layer.add(l);
    }
  }
  if (!shown.has('regions')) {
    (f.triggers?.regions ?? []).forEach((g, i) => {
      const c = REGION_COLORS[i % REGION_COLORS.length];
      const [x, y, w, hh] = g.rect;
      layer.add(square(x, y, w, hh, markMat(c, 0.22)));
      const l = label(g.id, c);
      l.position.set(x + w / 2, heightAt(map, x + w / 2, y + hh / 2) + 2, y + hh / 2);
      layer.add(l);
    });
  }
  if (!shown.has('grid')) layer.add(grid());
  const sel = selectionBox();
  if (sel) layer.add(sel);
  drawTop();
}

/** Tile edges, following the ground. */
function grid(): LineSegments {
  const n = f.size;
  const pts: number[] = [];
  const h = (x: number, y: number) => heightAt(map, Math.min(n - 0.01, x), Math.min(n - 0.01, y)) + 0.05;
  for (let y = 0; y <= n; y++) for (let x = 0; x < n; x++) pts.push(x, h(x, y), y, x + 1, h(x + 1, y), y);
  for (let x = 0; x <= n; x++) for (let y = 0; y < n; y++) pts.push(x, h(x, y), y, x, h(x, y + 1), y + 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pts, 3));
  const l = new LineSegments(g, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
  l.renderOrder = 4;
  return l;
}

// ---- selection ----
/** Footprint of a selected thing: [x, y, w, h], or null if it is gone. */
function footprintOf(s: Selection): [number, number, number, number] | null {
  switch (s.kind) {
    case 'unit': {
      const u = f.units[s.i];
      if (!u) return null;
      const d = DEFS[u.type];
      const size = d?.kind === 'building' ? d.size : 1;
      return [u.at[0], u.at[1], size, size];
    }
    case 'decor': return f.decor[s.i] ? [...f.decor[s.i].at, 1, 1] : null;
    case 'base': return f.bases[s.i] ? [...f.bases[s.i], 4, 4] : null;
    case 'start': return f.players[s.i] ? [...f.players[s.i].start, 4, 4] : null;
    case 'well': return f.wells[s.i] ? [...f.wells[s.i], 3, 3] : null;
    case 'mineral': return f.minerals[s.i] ? [...f.minerals[s.i], 1, 1] : null;
    case 'region': {
      const g = f.triggers?.regions[s.i];
      return g ? [...g.rect] : null;
    }
    case 'ramp': {
      const r = f.ramps[s.i];
      if (!r) return null;
      const t = rampTiles(r);
      const xs = t.map((p) => p[0]);
      const ys = t.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
    }
  }
}
function selectionBox(): Object3D | null {
  const s = ed.selection && footprintOf(ed.selection);
  if (!s) return null;
  const [x, y, w, h] = s;
  const box = square(x, y, w, h, markMat(0x5fbf6a, 0.35));
  box.position.y += 0.1;
  return box;
}
/** The last item of a list that passes (the one drawn on top). */
function lastIndex<T>(a: T[], ok: (x: T) => boolean): number {
  for (let i = a.length - 1; i >= 0; i--) if (ok(a[i])) return i;
  return -1;
}
/** The thing at tile (x, y), the smallest first. */
function pick(x: number, y: number): Selection | null {
  const inside = (fx: number, fy: number, w: number, h: number) => x >= fx && y >= fy && x < fx + w && y < fy + h;
  const near = (a: [number, number], r: number) => Math.abs(a[0] - x) <= r && Math.abs(a[1] - y) <= r;
  let i = f.decor.findIndex((d) => near(d.at, 0));
  if (i >= 0) return { kind: 'decor', i };
  i = f.units.findIndex((u) => {
    const d = DEFS[u.type];
    const s = d?.kind === 'building' ? d.size : 1;
    return inside(u.at[0], u.at[1], s, s);
  });
  if (i >= 0) return { kind: 'unit', i };
  i = f.minerals.findIndex((m) => near(m, 0));
  if (i >= 0) return { kind: 'mineral', i };
  i = f.wells.findIndex((w) => inside(w[0], w[1], 3, 3));
  if (i >= 0) return { kind: 'well', i };
  i = f.players.findIndex((p) => inside(p.start[0], p.start[1], 4, 4));
  if (i >= 0) return { kind: 'start', i };
  i = f.bases.findIndex((b) => inside(b[0], b[1], 4, 4));
  if (i >= 0) return { kind: 'base', i };
  i = f.ramps.findIndex((r) => rampTiles(r).some(([rx, ry]) => rx === x && ry === y));
  if (i >= 0) return { kind: 'ramp', i };
  if (!ed.hidden.has('regions')) {
    i = lastIndex(f.triggers?.regions ?? [], (g) => inside(...g.rect));
    if (i >= 0) return { kind: 'region', i };
  }
  return null;
}
/** Takes the selected thing out of the file. */
function removeSelected(): void {
  const s = ed.selection;
  if (!s || !footprintOf(s)) return;
  const layerOf = { unit: 'units', decor: 'decorPlaced', base: 'starts', start: 'starts', well: 'resources', mineral: 'resources', ramp: 'ramps', region: 'regions' } as const;
  if (ed.locked.has(layerOf[s.kind])) return say('Calque verrouillé.');
  if (s.kind === 'start') return say('Un départ ne s\'enlève pas : baisser le nombre de joueurs.');
  snapshot();
  if (s.kind === 'ramp') {
    const [r] = f.ramps.splice(s.i, 1);
    touchRamp(r);
  } else ({ unit: f.units, decor: f.decor, base: f.bases, well: f.wells, mineral: f.minerals, region: triggersOf(f).regions } as Record<string, unknown[]>)[s.kind].splice(s.i, 1);
  ed.selection = null;
  dirty = 'full';
  changed();
}

// ---- the map from above, one pixel per tile (the minimap's picture) ----
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
  if (!ed.hidden.has('resources')) {
    for (const [x, y] of f.minerals) dot(x, y, [255, 170, 60]);
    for (const [x, y] of f.wells) for (let k = 0; k < 9; k++) dot(x + (k % 3), y + Math.floor(k / 3), [190, 90, 255]);
  }
  if (!ed.hidden.has('decorPlaced')) for (const d of f.decor) dot(d.at[0], d.at[1], [90, 90, 90]);
  g.putImageData(img, 0, 0);
  if (!ed.hidden.has('starts')) {
    for (const [x, y] of f.bases) {
      g.strokeStyle = '#fff';
      g.strokeRect(x + 0.5, y + 0.5, 3, 3);
    }
    f.players.forEach((p, i) => {
      g.fillStyle = hex(TEAM_COLORS[i]);
      g.fillRect(p.start[0], p.start[1], 4, 4);
    });
  }
  if (!ed.hidden.has('units')) {
    for (const u of f.units) {
      g.fillStyle = u.owner < 0 ? '#ddd' : hex(TEAM_COLORS[u.owner]);
      g.fillRect(u.at[0], u.at[1], 2, 2);
    }
  }
}

/** The view from above: the same scene, under a camera looking straight down (north up), to paint precisely. */
const topCam = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
topCam.up.set(0, 0, -1);
/** Its centre (tiles) and the height it shows (tiles). */
const above = { x: 0, z: 0, h: 40 };
/** The camera of the view shown. */
const cam = () => (ed.view === '3d' ? rig.camera : topCam);
function updateAbove(): void {
  const n = f.size;
  above.h = Math.max(6, Math.min(n * 1.3, above.h));
  above.x = Math.max(0, Math.min(n, above.x));
  above.z = Math.max(0, Math.min(n, above.z));
  const [a, hh] = [aspect(), above.h / 2];
  Object.assign(topCam, { left: -hh * a, right: hh * a, top: hh, bottom: -hh });
  topCam.position.set(above.x, 300, above.z);
  topCam.lookAt(above.x, 0, above.z);
  topCam.updateProjectionMatrix();
}
/** The view switched: the other camera takes over where this one looked. */
let shownView = ed.view;
function followView(): void {
  if (shownView === ed.view) return;
  if (ed.view === 'top') Object.assign(above, { x: rig.target.x, z: rig.target.z, h: rig.viewHeight * 1.2 });
  else rig.lookAt(above.x, above.z);
  shownView = ed.view;
}
let shell: Shell;
function paintMinimap(): void {
  const top = shell.minimap;
  if (!top.width) return;
  const c = top.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  c.fillStyle = '#0b0d10';
  c.fillRect(0, 0, top.width, top.height);
  const s = Math.min(top.width, top.height);
  const [ox, oy] = [(top.width - s) / 2, (top.height - s) / 2];
  c.drawImage(topImage, ox, oy, s, s);
  const k = s / f.size;
  const hw = (above.h * aspect()) / 2;
  const pts = ed.view === '3d' ? rig.footprint() : [[-hw, -above.h / 2], [hw, -above.h / 2], [hw, above.h / 2], [-hw, above.h / 2]].map(([dx, dz]) => ({ x: above.x + dx, z: above.z + dz }));
  c.strokeStyle = '#fff';
  c.lineWidth = 1.5;
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(ox + p.x * k, oy + p.z * k) : c.moveTo(ox + p.x * k, oy + p.z * k)));
  c.closePath();
  c.stroke();
}
function minimapTile(e: PointerEvent): [number, number] {
  const top = shell.minimap;
  const r = top.getBoundingClientRect();
  const s = Math.min(r.width, r.height);
  return [((e.clientX - r.left - (r.width - s) / 2) / s) * f.size, ((e.clientY - r.top - (r.height - s) / 2) / s) * f.size];
}

// ---- editing ----
const turns = () => turnsOfSymmetry(f.symmetry);
function snapshot(): void {
  ed.undo.push(JSON.stringify(f));
  if (ed.undo.length > 100) ed.undo.shift();
  ed.redo.length = 0;
  ed.saved = false;
  version++;
}
function restore(from: string[], to: string[]): void {
  const s = from.pop();
  if (!s) return;
  to.push(JSON.stringify(f));
  f = ed.f = JSON.parse(s);
  ed.selection = null;
  ed.seat = Math.min(ed.seat, f.players.length - 1);
  redrawAll();
  changed();
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

/** The brush's tiles around (x, y): a square, or a disc. */
function brushTiles(x: number, y: number): [number, number][] {
  const n = ed.brush;
  const h = Math.floor((n - 1) / 2);
  const out: [number, number][] = [];
  const r = n / 2;
  for (let dy = -h; dy < n - h; dy++) {
    for (let dx = -h; dx < n - h; dx++) {
      if (ed.round && n > 2 && (dx + 0.5 - (n % 2 ? 0.5 : 0)) ** 2 + (dy + 0.5 - (n % 2 ? 0.5 : 0)) ** 2 > r * r) continue;
      out.push([x + dx, y + dy]);
    }
  }
  return out;
}

/** The level a relief stroke leaves on a tile that is `c` now. */
function painted(c: string, erase: boolean): string {
  if (erase) return '0';
  if (ed.paint === 'up') return c === 'x' ? '0' : String(Math.min(2, Number(c) + 1));
  if (ed.paint === 'down') return c === 'x' || c === '0' ? c : String(Number(c) - 1);
  return ed.paint;
}

function apply(x: number, y: number, erase: boolean, first: boolean): void {
  switch (ed.tool) {
    case 'relief': {
      const seen = new Set<number>();
      for (const [bx, by] of brushTiles(x, y)) {
        for (const [cx, cy] of copies(bx, by)) {
          if (seen.has(cy * f.size + cx)) continue;
          seen.add(cy * f.size + cx);
          // Raising or lowering: one step per stroke, not one per frame the pointer stays.
          if ((ed.paint === 'up' || ed.paint === 'down') && strokeSeen.has(cy * f.size + cx)) continue;
          strokeSeen.add(cy * f.size + cx);
          setTile(cx, cy, painted(tileOf(f, cx, cy), erase));
        }
      }
      break;
    }
    case 'minerai':
      for (const [bx, by] of brushTiles(x, y)) {
        for (const c of copies(bx, by)) {
          const at = f.minerals.findIndex((m) => same(m, c));
          if (erase && at >= 0) f.minerals.splice(at, 1);
          if (!erase && at < 0 && c[0] >= 0 && c[1] >= 0 && c[0] < f.size && c[1] < f.size) f.minerals.push(c);
        }
      }
      version++;
      break;
    default:
      if (!first) return; // the other tools act once per click
      place(x, y, erase);
      version++;
  }
  dirty ||= 'quick';
}
const strokeSeen = new Set<number>();

const touchRamp = (r: Ramp2) => {
  const t = rampTiles(r);
  touched(Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[1])), Math.max(...t.map((p) => p[0])) + 1, Math.max(...t.map((p) => p[1])) + 1);
};

function place(x: number, y: number, erase: boolean): void {
  switch (ed.tool) {
    case 'select':
      ed.selection = pick(x, y);
      dirty = 'quick';
      changed();
      break;
    case 'ramp': {
      if (erase) {
        const [gone, kept] = [f.ramps.filter((r) => rampTiles(r).some(([rx, ry]) => copies(x, y).some((c) => same(c, [rx, ry])))), [] as Ramp2[]];
        for (const r of f.ramps) if (!gone.includes(r)) kept.push(r);
        f.ramps = kept;
        gone.forEach(touchRamp);
        break;
      }
      // Its foot: one level below the ground just above its top tile.
      const [dx, dy] = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }[ed.rampDir];
      const upper = Number(tileOf(f, x + dx, y + dy)) || 1;
      const [ax, ay] = dx === 0 ? [Math.floor(ed.rampWidth / 2), 0] : [0, Math.floor(ed.rampWidth / 2)];
      const r = { at: [x - ax, y - ay] as [number, number], up: ed.rampDir, width: ed.rampWidth, level: Math.max(0, Math.min(1, upper - 1)) };
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
      f.players[ed.seat].start = s;
      if (ed.seat === 0 && f.symmetry !== 'none') {
        f.players.forEach((p, i) => {
          if (i && turns().includes(CORNERS[i])) p.start = rotateFootprint(f.size, s[0], s[1], 4, CORNERS[i]);
        });
      }
      changed();
      break;
    }
    case 'decor':
      if (erase) {
        const at = f.decor.findIndex((d) => near(d.at, x, y, 1));
        if (at >= 0) f.decor.splice(at, 1);
      } else for (const at of copies(x, y)) f.decor.push({ type: ed.decorType, at, yaw: Math.round(Math.random() * 628) / 100 });
      break;
    case 'unite': {
      if (erase) {
        const at = f.units.findIndex((u) => near(u.at, x, y, 2));
        if (at >= 0) f.units.splice(at, 1);
        break;
      }
      const def = DEFS[ed.unitType];
      const s = def.kind === 'building' ? def.size : 1;
      const at: [number, number] = [x - Math.floor((s - 1) / 2), y - Math.floor((s - 1) / 2)];
      // Neutral ones follow the symmetry; a player's are placed once.
      if (ed.unitOwner < 0) for (const c of footCopies(at[0], at[1], s)) f.units.push({ type: ed.unitType, owner: -1, at: c });
      else f.units.push({ type: ed.unitType, owner: ed.unitOwner, at });
      break;
    }
  }
}

// ---- pointer ----
const raycaster = new Raycaster();
const ground = new Plane(new Vector3(0, 1, 0), 0);
function tileUnder(e: { clientX: number; clientY: number }): [number, number] | null {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), cam());
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
  if (ed.tool === 'relief' || ed.tool === 'minerai') return ed.brush;
  if (ed.tool === 'puits') return 3;
  if (ed.tool === 'depart' || ed.tool === 'base') return 4;
  if (ed.tool === 'unite') return DEFS[ed.unitType]?.kind === 'building' ? (DEFS[ed.unitType] as { size: number }).size : 1;
  if (ed.tool === 'ramp') return ed.rampWidth;
  return 1;
}
/** The tool's footprint under tile t: [x, y, w, h]. */
function cursorRect(t: [number, number]): [number, number, number, number] {
  if (ed.tool === 'region' && regionDrag) return dragRect(regionDrag);
  const s = footprint();
  const off = ed.tool === 'puits' ? 1 : ed.tool === 'depart' || ed.tool === 'base' ? 2 : Math.floor((s - 1) / 2);
  if (ed.tool === 'ramp') {
    const ns = ed.rampDir === 'N' || ed.rampDir === 'S';
    const [w, h] = ns ? [ed.rampWidth, 4] : [4, ed.rampWidth];
    return [ns ? t[0] - off : ed.rampDir === 'E' ? t[0] - 3 : t[0], ns ? (ed.rampDir === 'S' ? t[1] - 3 : t[1]) : t[1] - off, w, h];
  }
  return [t[0] - off, t[1] - off, s, s];
}
/** A region being drawn: the tile where the drag began and the one under the pointer. */
let regionDrag: [number, number, number, number] | null = null;
const dragRect = ([x0, y0, x1, y1]: [number, number, number, number]): [number, number, number, number] => [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1];
function moveCursor(t: [number, number] | null): void {
  cursor.visible = !!t && ed.tool !== 'select';
  if (t) {
    const [x, y, w, h] = cursorRect(t);
    cursor.scale.set(w, 1, h);
    cursor.position.set(x + w / 2, heightAt(map, t[0] + 0.5, t[1] + 0.5) + 0.15, y + h / 2);
    const c = tileOf(f, t[0], t[1]);
    ed.hover = `Curseur (${t[0]}, ${t[1]}) · ${c === 'x' ? 'gouffre' : `niveau ${c}`}${map.ramp[t[1] * f.size + t[0]] ? ' · rampe' : ''}`;
  } else ed.hover = '';
  shell.status();
}

let painting = -1; // button held, or -1
let lastTile: [number, number] | null = null;
let panning = false;
const held = new Set<string>();
function down(e: PointerEvent): void {
  const el = e.currentTarget as HTMLElement;
  (el.closest('.viewroot') as HTMLElement | null)?.focus(); // the keys then move the view
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // a pointer the browser does not know (a scripted one): no capture
  }
  if (e.button === 1 || held.has(' ')) {
    panning = true;
    return;
  }
  const t = tileUnder(e);
  if (!t) return;
  const lay = TOOL_LAYER[ed.tool];
  if (lay && ed.locked.has(lay)) return say(`Calque « ${lay === 'starts' ? 'Départs et bases libres' : lay} » verrouillé : le déverrouiller dans Calques.`);
  if (ed.tool !== 'select') snapshot();
  painting = e.button;
  lastTile = t;
  strokeSeen.clear();
  if (ed.tool === 'region') {
    if (e.button === 2) {
      const regs = triggersOf(f).regions;
      const i = lastIndex(regs, (g) => t[0] >= g.rect[0] && t[1] >= g.rect[1] && t[0] < g.rect[0] + g.rect[2] && t[1] < g.rect[1] + g.rect[3]);
      if (i >= 0) {
        regs.splice(i, 1);
        ed.selection = null;
        say('Région enlevée. Les déclencheurs qui la nomment sont signalés dans leur fenêtre.');
      }
      dirty = 'full';
      painting = -1;
      return;
    }
    regionDrag = [t[0], t[1], t[0], t[1]];
    return;
  }
  apply(t[0], t[1], e.button === 2, true);
}
function move(e: PointerEvent): void {
  if (panning) {
    const r = canvas.getBoundingClientRect();
    if (ed.view === '3d') rig.panPixels((e.movementX * innerHeight) / r.height, (e.movementY * innerHeight) / r.height);
    else {
      above.x -= (e.movementX * above.h) / r.height;
      above.z -= (e.movementY * above.h) / r.height;
    }
    return;
  }
  const t = tileUnder(e);
  if (regionDrag && t) [regionDrag[2], regionDrag[3]] = t;
  moveCursor(t);
  if (painting >= 0 && t && ed.tool !== 'select' && ed.tool !== 'region') {
    // Every tile between the last one and this one: a quick stroke leaves no gaps.
    const [lx, ly] = lastTile ?? t;
    const n = Math.max(Math.abs(t[0] - lx), Math.abs(t[1] - ly), 1);
    for (let k = 1; k <= n; k++) apply(Math.round(lx + ((t[0] - lx) * k) / n), Math.round(ly + ((t[1] - ly) * k) / n), painting === 2, false);
    lastTile = t;
  }
}
function up(): void {
  if (regionDrag) {
    const regs = triggersOf(f).regions;
    let n = regs.length + 1;
    while (regs.some((g) => g.id === `zone${n}`)) n++;
    regs.push({ id: `zone${n}`, rect: dragRect(regionDrag) });
    regionDrag = null;
    ed.selection = { kind: 'region', i: regs.length - 1 };
    say(`Région « zone${n} » ajoutée : la renommer dans Propriétés, l'utiliser dans les déclencheurs.`);
  }
  if (painting >= 0 && ed.tool !== 'select') {
    dirty = 'full';
    changed();
  }
  painting = -1;
  panning = false;
}
function wheel(e: WheelEvent): void {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  if (ed.view === 'top') {
    // The ground under the pointer stays put.
    const [dx, dz] = [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2];
    const [wx, wz] = [above.x + (dx * above.h) / r.height, above.z + (dz * above.h) / r.height];
    above.h = Math.max(6, Math.min(f.size * 1.3, above.h * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
    above.x = wx - (dx * above.h) / r.height;
    above.z = wz - (dz * above.h) / r.height;
    return;
  }
  const px = innerWidth / 2 + ((e.clientX - r.left - r.width / 2) * innerHeight) / r.height;
  const py = ((e.clientY - r.top) / r.height) * innerHeight;
  rig.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12, px, py);
}

// ---- messages ----
function say(text: string): void {
  shell.say(text);
}

// ---- the game's check, a moment after each change ----
let checked = -1;
let checkAt = 0;
function checkPlayable(): void {
  checked = version;
  try {
    const { map: def } = toFormat1(f);
    const c = checkMap(JSON.parse(JSON.stringify(def)));
    ed.playable = typeof c === 'string' ? c : (unplayable(c) ?? true);
  } catch (e) {
    ed.playable = (e as Error).message;
  }
  changed();
}

/** A new file: a new camera for its size, the view rebuilt. */
function reframe(): void {
  rig = new CameraRig(f.size, f.size);
  rig.maxView = rig.overview(aspect());
  rig.viewHeight = Math.min(rig.maxView, 60);
  const s = f.players[0].start;
  rig.lookAt(s[0] + 2, s[1] + 2);
  ed.seat = 0;
  ed.selection = null;
  ed.unitOwner = Math.min(ed.unitOwner, f.players.length - 1);
  redrawAll();
  changed();
}

// ---- loop ----
/** The view's shape (a panel not laid out yet has no size). */
function aspect(): number {
  const r = canvas.parentElement?.getBoundingClientRect();
  return r && r.width > 0 && r.height > 0 ? r.width / r.height : 1.5;
}
let lastBuild = 0;
let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const k = (a: string, b: string, c: string) => (held.has(a) || held.has(b) || held.has(c) ? 1 : 0);
  followView();
  const [px, py] = [k('ArrowRight', 'd', 'D') - k('ArrowLeft', 'q', 'Q'), k('ArrowUp', 'z', 'Z') - k('ArrowDown', 's', 'S')];
  if (shell.viewFocused() && ed.view === '3d') rig.pan(px, py, dt);
  if (shell.viewFocused() && ed.view === 'top') {
    above.x += px * above.h * 0.8 * dt;
    above.z -= py * above.h * 0.8 * dt;
  }
  rig.update(aspect());
  updateAbove();
  const centre = ed.view === '3d' ? rig.target : new Vector3(above.x, 0, above.z);
  sun.position.copy(centre).add(SUN_OFFSET);
  sun.target.position.copy(centre);
  space?.update(centre);
  // While a stroke goes on: the terrain it touched, often; what stands on it (heights, units) once it ends, except for
  // the tools that place things.
  if (!building && (groundDirty || (dirty && (painting < 0 || ed.tool !== 'relief'))) && (painting < 0 || now - lastBuild > 60)) {
    const things = painting < 0 ? dirty : ed.tool === 'relief' ? false : dirty && 'quick';
    if (things) dirty = false;
    lastBuild = now;
    void rebuild(things);
  }
  if (version !== checked && painting < 0 && now > checkAt) {
    checkAt = now + 1500;
    if (now - lastBuild > 400) checkPlayable();
  }
  const ts = performance.now();
  if (world && units) units.sync(world, 1, new Set(), 0, () => true, () => true);
  times.sync = Math.max(times.sync * 0.9, performance.now() - ts);
  renderer.render(scene, cam());
  paintMinimap();
  requestAnimationFrame(frame);
};

// ---- what the panels may ask ----
Object.assign(act, {
  snapshot,
  undo: () => restore(ed.undo, ed.redo),
  redo: () => restore(ed.redo, ed.undo),
  redrawAll: () => {
    redrawAll();
    changed();
  },
  redrawThings: () => {
    dirty = 'full';
    version++;
    changed();
  },
  open: (next: MapFile2, name?: string) => {
    f = ed.f = next;
    ed.file = name ?? next.id;
    ed.saved = true;
    ed.undo.length = ed.redo.length = 0;
    reframe();
  },
  lookAt: (x: number, y: number) => (ed.view === '3d' ? rig.lookAt(x, y) : Object.assign(above, { x, z: y })),
  removeSelected,
  picture: () => topImage,
  say,
});

shell = buildShell({
  canvas,
  pointer: { down, move, up, wheel, leave: () => moveCursor(null) },
  minimapLook: (e: PointerEvent) => {
    const [x, y] = minimapTile(e);
    act.lookAt(x, y);
  },
  resize: (w: number, h: number) => {
    renderer.setSize(w, h, false);
    rig.maxView = rig.overview(aspect());
  },
  removeSelected,
  keys: held,
  stats: () => ({ building, buildMs, ...times }),
});
reframe();
requestAnimationFrame(frame);
addEventListener('beforeunload', (e) => {
  if (!ed.saved) e.preventDefault();
});
// The format 1 export and a few probes, from the browser's console (to build a scenario by script).
Object.assign(window, { editor: { get file() { return f; }, get rig() { return rig; }, get state() { return { building, dirty, groundDirty, buildMs, times, chunks: chunks.length, tool: TOOL_NAMES[ed.tool] }; }, gameFile: () => toFormat1(f), set: (next: MapFile2) => act.open(next) } });
