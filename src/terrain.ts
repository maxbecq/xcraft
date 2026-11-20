import {
  BufferGeometry, Color, DataTexture, type Texture, Float32BufferAttribute, Group, LinearFilter, type Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  type Object3D, RedFormat, Vector2, Vector3,
} from 'three';
import { type GameMap, LEVEL_HEIGHT, cornerHeights, cutCorner, cutLevel, reliefAt, setRelief, tileAt } from './map';
import { type Biome, BIOMES } from './render/biome';
import { weather } from './render/weathering';
import { crackMask, fbm, groundImages, groundTextures, lavaTexture, rockTextures } from './render/textures';

// Wasteland palette per cliff level, plus darker patches blended in by noise.
/** Current planet look; set before building the terrain. */
let B: Biome = BIOMES.desert;
export function setBiome(b: Biome): void {
  B = b;
  // Dunes: long asymmetric ridges across the wind, bent by noise, with smaller ripples on top.
  const a = b.dunes ?? 0;
  setRelief(
    a
      ? (x, z) => {
          const phase = ((x * 0.8 + z * 0.6) / 7) * Math.PI * 2 + noise(x, z, 11, 13) * 5;
          const ridge = Math.pow(0.5 + 0.5 * Math.sin(phase), 2.2);
          return a * (ridge + noise(x, z, 3, 17) * 0.35 - 0.3);
        }
      : null,
  );
}
/** How far a cliff's foot leans out from its top, in tiles. */
const SLANT = 0.32;
/** City map: height of the lower city's deck, seen through the chasms. */
export const UNDER_DECK = -6;
/** City map: thickness of the playable deck's slab, seen at the edge of the chasms. */
export const DECK_SLAB = 0.45;
const WALL_SEGMENTS = 7;
const WALL_ROWS = 6;

/** Smooth noise over world positions (not tileable), 0..1. */
const noise = (x: number, z: number, scale: number, seed: number) => fbm((x / scale) % 1024 / 1024, (z / scale) % 1024 / 1024, 3, 1024, seed);

/** Colour of a tile for the minimap. */
export function tileColor(map: GameMap, x: number, y: number): Color {
  if (map.chasm?.[y * map.width + x]) return B.chasm.floor.clone().lerp(new Color(0), B.chasm.glossy ? 0 : 0.4);
  const t = tileAt(map, x, y)!;
  const c = B.levels[t.level].clone();
  if (t.ramp) c.lerp(B.levels[t.level + 1], 0.5);
  return c.lerp(B.patch, noise(x, y, 9, 3) * 0.5);
}

/** Corner order [nw, ne, se, sw]; each edge lists its two corners going clockwise, and its outward direction. */
const EDGES = [
  { dx: 0, dy: -1, c: [0, 1] },
  { dx: 1, dy: 0, c: [1, 2] },
  { dx: 0, dy: 1, c: [2, 3] },
  { dx: -1, dy: 0, c: [3, 0] },
];
const CORNER_POS: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Corner heights as drawn: a cut tile's removed corner and its two edges sit at the lower level. */
function drawnEdge(map: GameMap, x: number, y: number, edge: number): [number, number] {
  const h = cornerHeights(map, x, y);
  const [a, b] = EDGES[edge].c;
  const cut = cutCorner(map, x, y);
  if (cut >= 0 && (a === cut || b === cut)) {
    const low = cutLevel(map, x, y, cut) * LEVEL_HEIGHT;
    return [low, low];
  }
  return [h[a], h[b]];
}

/** `roads`: streets to paint on the ground, a texture over the whole map (see cityRoads). */
export function buildTerrain(map: GameMap, roads?: Texture): Group {
  leanMap = map;
  rimCache.clear();
  const ground = new Builder();
  const cliffs = new Builder();
  const up = new Vector3(0, 1, 0);

  // Ground vertices: tinted by level and noise, darkened along cliff edges, gently bumped away from them.
  const levelAt = (x: number, y: number) => drawnLevel(map, Math.min(map.width - 1, Math.max(0, x)), Math.min(map.height - 1, Math.max(0, y)));
  const around = (vx: number, vz: number) => [levelAt(vx, vz), levelAt(vx - 1, vz), levelAt(vx, vz - 1), levelAt(vx - 1, vz - 1)];
  const groundVertex = (vx: number, h: number, vz: number, level: number): [Vector3, Color] => {
    const ls = around(vx, vz);
    const edge = Math.min(...ls) !== Math.max(...ls);
    // Painted cliffs: a light rim along the top, a dark band at the foot.
    const rim = edge ? (level >= Math.max(...ls) ? 1.18 : 0.72) : 1;
    const bump = edge ? 0 : (noise(vx, vz, 3, 7) - 0.5) * 0.14;
    const c = B.levels[Math.min(2, level)].clone().lerp(B.patch, Math.max(0, noise(vx, vz, 9, 3) - 0.3) * 1.6).lerp(B.sand, Math.max(0, noise(vx, vz, 14, 9) - 0.55) * 1.8);
    c.multiplyScalar(rim * (0.94 + noise(vx, vz, 2, 5) * 0.12));
    // Dune crests a little paler than the hollows.
    const dune = reliefAt(map, vx, vz);
    if (dune) c.multiplyScalar(1 + (dune / (B.dunes ?? 1)) * 0.25);
    // On a cliff top, the corner is pushed out or in a little, so the plateau's edge is not a ruled line.
    const top = edge && level >= Math.max(...ls);
    const shift = top ? rimShift(vx, vz) : null;
    return [new Vector3(vx + (shift?.x ?? 0), h + bump + dune - (top ? rimDrop(vx, vz) : 0), vz + (shift?.y ?? 0)), c];
  };

  const chasm = (x: number, y: number) => !!map.chasm?.[y * map.width + x];
  // Natural chasms have a floor far below (city ones open onto the lower city).
  const pit = B.style !== 'city';
  const floorY = -B.chasm.depth * LEVEL_HEIGHT;
  const floor = new Builder();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (chasm(x, y)) {
        if (!pit || B.space) continue; // open onto the void (the city's lower levels, space under the asteroids)
        const v = CORNER_POS.map(([cx, cy]): [Vector3, Color] => {
          const n = noise(x + cx, y + cy, 4, 61);
          // Ice: drifts of snow and darker clear patches; rock: dark scree.
          const c = B.chasm.lava
            ? // Lava: glowing, under drifting plates of dark crust.
              B.chasm.floor.clone().lerp(new Color(0xffc040), Math.max(0, 0.5 - n)).lerp(new Color(0x1a0804), Math.min(1, Math.max(0, noise(x + cx, y + cy, 3, 67) - 0.45) * 3))
            : B.chasm.glossy
            ? B.chasm.floor.clone().lerp(new Color(0xf4f8fc), Math.max(0, noise(x + cx, y + cy, 7, 67) - 0.45) * 1.6).multiplyScalar(0.8 + n * 0.35)
            : B.chasm.floor.clone().multiplyScalar(0.6 + n * 0.8);
          return [new Vector3(x + cx, floorY + (B.chasm.glossy ? 0 : (n - 0.5) * 0.5), y + cy), c];
        });
        // Rock floors take the ground's texture; ice keeps its own smooth, glossy sheet.
        (B.chasm.glossy ? floor : ground).quad(v.map((p) => p[0]), v.map((p) => p[1]), up);
        continue;
      }
      const t = tileAt(map, x, y)!;
      const h = cornerHeights(map, x, y);
      const cut = cutCorner(map, x, y);
      const v = CORNER_POS.map(([cx, cy], i) => groundVertex(x + cx, h[i], y + cy, t.level + (t.ramp && h[i] > t.level * LEVEL_HEIGHT ? 1 : 0)));
      if (t.ramp) for (const [, c] of v) c.lerp(B.ramp, 0.6); // packed-dirt track
      if (cut < 0) {
        ground.quad(v.map((p) => p[0]), v.map((p) => p[1]), up);
        continue;
      }
      // Diagonal cliff: the high half of the tile, the low half, and a slanted wall between them.
      const a = (cut + 1) % 4;
      const b = (cut + 3) % 4;
      const low = cutLevel(map, x, y, cut);
      const lowV = [cut, a, b].map((i) => groundVertex(x + CORNER_POS[i][0], low * LEVEL_HEIGHT, y + CORNER_POS[i][1], low));
      ground.tri([v[a][0], v[(cut + 2) % 4][0], v[b][0]], [v[a][1], v[(cut + 2) % 4][1], v[b][1]], up);
      ground.tri(lowV.map((p) => p[0]), lowV.map((p) => p[1]), up);
      const pa = new Vector2(x + CORNER_POS[a][0], y + CORNER_POS[a][1]);
      const pb = new Vector2(x + CORNER_POS[b][0], y + CORNER_POS[b][1]);
      const out = new Vector2(CORNER_POS[cut][0] - 0.5, CORNER_POS[cut][1] - 0.5).normalize();
      // Keep walls clockwise around the plateau (top on the left when looking from outside).
      cliffWall(cliffs, pb, pa, t.level * LEVEL_HEIGHT, t.level * LEVEL_HEIGHT, low * LEVEL_HEIGHT, low * LEVEL_HEIGHT, out);
    }
  }

  // Straight cliff walls along tile edges, from each tile down to any lower neighbour (or off the map).
  const skirt = B.space ? B.chasm.depth * LEVEL_HEIGHT : 2.5;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (chasm(x, y) && !pit) continue;
      for (let e = 0; e < 4; e++) {
        const { dx, dy, c } = EDGES[e];
        const [ta, tb] = chasm(x, y) ? [floorY, floorY] : drawnEdge(map, x, y, e);
        let ba: number;
        let bb: number;
        // A chasm: down to its floor, or (city) only the deck's slab edge; the parking levels below are drawn by cityUnderdeck.
        if (tileAt(map, x + dx, y + dy) && chasm(x + dx, y + dy)) [ba, bb] = pit ? [floorY, floorY] : [-DECK_SLAB, -DECK_SLAB];
        else if (tileAt(map, x + dx, y + dy)) [bb, ba] = drawnEdge(map, x + dx, y + dy, (e + 2) % 4);
        else [ba, bb] = [Math.min(ta, tb) - skirt, Math.min(ta, tb) - skirt]; // skirt around the map (an asteroid's thick edge)
        if (ta <= ba + 0.01 && tb <= bb + 0.01) continue;
        const p0 = new Vector2(x + CORNER_POS[c[0]][0], y + CORNER_POS[c[0]][1]);
        const p1 = new Vector2(x + CORNER_POS[c[1]][0], y + CORNER_POS[c[1]][1]);
        cliffWall(cliffs, p0, p1, ta, tb, Math.min(ta, ba), Math.min(tb, bb), new Vector2(dx, dy));
      }
    }
  }

  const [gMap, gNormal] = B.ground ? groundImages(B.ground) : groundTextures(B.style);
  const [rMap, rNormal] = rockTextures(B.style);
  const groundMat = new MeshStandardMaterial({ vertexColors: true, map: gMap, normalMap: gNormal, normalScale: new Vector2(B.ground ? 1.5 : 0.8, B.ground ? 1.5 : 0.8), roughness: 0.95 });
  if (B.veins) {
    // Strange worlds: light glows up through the cracks.
    groundMat.emissiveMap = crackMask(B.style);
    groundMat.emissive = B.veins;
    groundMat.emissiveIntensity = B.style === 'city' ? 1.2 : B.ground === 'volcan' ? 1.6 : 2.2;
  }
  untile(groundMat, rMap, B.rock.clone().lerp(new Color(B.greyStones || B.style ? 0x86888d : 0x8a8378), 0.55), B.style === 'city', roads, map);
  const groundMesh = ground.mesh(groundMat);
  const cliffMat = new MeshStandardMaterial({ vertexColors: true, map: rMap, normalMap: rNormal, normalScale: new Vector2(1.4, 1.4), roughness: 0.9, flatShading: true });
  weather(cliffMat, 0.45); // mineral stains and damp streaks down the rock
  const cliffMesh = cliffs.mesh(cliffMat);
  groundMesh.receiveShadow = true;
  cliffMesh.receiveShadow = true;
  cliffMesh.castShadow = true;
  const g = new Group();
  g.add(groundMesh, cliffMesh);
  if (pit && !B.space) g.add(outskirts(map, gMap, gNormal, rMap));
  if (pit && map.chasm && B.chasm.glossy) {
    const { glow, glossy, lava } = B.chasm;
    // Lava gives its own light: drawn as it is, bright where molten, dark where crusted over.
    const floorMat = lava
      ? moltenLava(new MeshBasicMaterial({ vertexColors: true, map: lavaTexture() }))
      : new MeshStandardMaterial({ vertexColors: true, roughness: glossy ? 0.25 : 1, metalness: glossy ? 0.05 : 0, emissive: glow ?? new Color(0), emissiveIntensity: 0.2 });
    const floorMesh = floor.mesh(floorMat);
    floorMesh.receiveShadow = true;
    g.add(floorMesh);
  }
  return g;
}

/** Seconds of lava flow, advanced each frame by main.ts (rendering only). */
export const lavaTime = { value: 0 };

/**
 * Lava that moves, slowly: the crust's cracks drift and swirl (the texture read twice, warped and drifting apart),
 * and its bright seams breathe, brighter and dimmer in slow waves that roll across the pool.
 */
function moltenLava(m: MeshBasicMaterial): MeshBasicMaterial {
  m.customProgramCacheKey = () => 'lava';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.lavaTime = lavaTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lavaTime;')
      .replace(
        '#include <map_fragment>',
        `vec2 lavaW = vMapUv * 5.0; // world x, z (the floor's uv is position / 5)
        float lt = lavaTime;
        vec2 lavaDrift = vec2(0.009, 0.005) * lt;
        vec2 lavaSwirl = vec2(sin(lavaW.y * 0.8 + lt * 0.21), cos(lavaW.x * 0.7 - lt * 0.17)) * 0.03;
        vec4 lavaA = texture2D(map, vMapUv + lavaDrift + lavaSwirl);
        vec4 lavaB = texture2D(map, vMapUv * 0.73 - lavaSwirl.yx * 1.4 - lavaDrift * 0.6 + vec2(0.37, 0.11));
        // Mostly one reading or the other, so the cracks stay sharp; where they meet, they flow into each other.
        float lavaMix = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(dot(lavaW, vec2(0.23, 0.17)) + lt * 0.11));
        vec4 sampledDiffuseColor = mix(lavaA, lavaB, lavaMix);
        float lavaBreath = 0.5 + 0.5 * sin(lt * 0.8 + dot(lavaW, vec2(0.41, 0.29)) + sin(lavaW.x * 0.27 - lavaW.y * 0.19) * 2.5);
        sampledDiffuseColor.rgb *= 1.0 + smoothstep(0.35, 0.9, sampledDiffuseColor.r) * (lavaBreath - 0.35) * 0.45;
        diffuseColor *= sampledDiffuseColor;`,
      );
  };
  return m;
}

let leanMap: GameMap;

/** A tile's level as drawn: a natural chasm counts as its floor, far below, so its rim and walls lean like a cliff's. */
function drawnLevel(map: GameMap, x: number, y: number): number {
  return B.style !== 'city' && map.chasm?.[y * map.width + x] ? -B.chasm.depth : tileAt(map, x, y)!.level;
}

/**
 * How far a cliff-top corner moves (outwards mostly, along the downhill direction): the ground's rim and the
 * cliff's top use the same shift, so they still meet. Zero at the map's edge.
 */
function rimShift(vx: number, vz: number): Vector2 {
  if (B.style === 'city' || !Number.isInteger(vx) || !Number.isInteger(vz) || vx <= 0 || vz <= 0 || vx >= leanMap.width || vz >= leanMap.height) return new Vector2();
  const key = vz * (leanMap.width + 1) + vx;
  let s = rimCache.get(key);
  if (!s) rimCache.set(key, (s = smoothRim(vx, vz).add(downhill(vx, vz, new Vector2()).multiplyScalar((noise(vx * 1.9, vz * 1.9, 1, 47) - 0.5) * 0.3))));
  return s;
}
const rimCache = new Map<number, Vector2>();

/**
 * How far a cliff-top corner sinks, in places: the plateau's ground slopes gently down into the wall there, so
 * the lip looks worn round instead of cut. Same rules as rimShift (none in the city, at the map's edge, by ramps).
 */
function rimDrop(vx: number, vz: number): number {
  const m = leanMap;
  if (B.style === 'city' || vx <= 0 || vz <= 0 || vx >= m.width || vz >= m.height) return 0;
  for (let y = vz - 1; y <= vz; y++) for (let x = vx - 1; x <= vx; x++) if (m.ramp[y * m.width + x]) return 0;
  const n = noise(vx, vz, 4, 71);
  const t = Math.min(1, Math.max(0, (n - 0.42) / 0.25));
  return t * t * (3 - 2 * t) * 0.24;
}

/** Blur radius of the plateau outline, in tiles: staircases become slopes, square corners round off. */
const RIM_SIGMA = 1;
/**
 * Where a cliff-top corner moves so the plateau's outline follows a blurred copy of the tile grid (its 0.5 contour,
 * one Newton step), instead of the tiles' square steps. Zero next to ramps and cut tiles, which keep their shape.
 */
function smoothRim(vx: number, vz: number): Vector2 {
  const m = leanMap;
  const cx = (x: number) => Math.min(m.width - 1, Math.max(0, x));
  const cy = (y: number) => Math.min(m.height - 1, Math.max(0, y));
  for (let y = vz - 1; y <= vz; y++) for (let x = vx - 1; x <= vx; x++) if (m.ramp[cy(y) * m.width + cx(x)]) return new Vector2();
  const top = Math.max(...[[vx - 1, vz - 1], [vx, vz - 1], [vx, vz], [vx - 1, vz]].map(([x, y]) => drawnLevel(m, cx(x), cy(y))));
  let sw = 0;
  let sh = 0;
  const pts: [number, number, number, number][] = [];
  for (let y = vz - 3; y < vz + 3; y++) {
    for (let x = vx - 3; x < vx + 3; x++) {
      const dx = x + 0.5 - vx;
      const dz = y + 0.5 - vz;
      const w = Math.exp(-(dx * dx + dz * dz) / (2 * RIM_SIGMA * RIM_SIGMA));
      // A tile cut by a diagonal cliff is half plateau.
      const h = drawnLevel(m, cx(x), cy(y)) < top ? 0 : cutCorner(m, cx(x), cy(y)) >= 0 ? 0.5 : 1;
      sw += w;
      sh += w * h;
      pts.push([dx, dz, w, h]);
    }
  }
  const f = sh / sw;
  const g = new Vector2();
  for (const [dx, dz, w, h] of pts) g.add(new Vector2(dx, dz).multiplyScalar((w * (h - f)) / sw));
  if (g.lengthSq() < 1e-6) return new Vector2();
  const step = g.multiplyScalar((0.5 - f) / g.lengthSq());
  return step.clampLength(0, 0.48);
}

/** Highest drawn level among the four tiles around a grid vertex. */
function topLevel(vx: number, vz: number): number {
  const m = leanMap;
  const lv = (x: number, y: number) => drawnLevel(m, Math.min(m.width - 1, Math.max(0, x)), Math.min(m.height - 1, Math.max(0, y)));
  return Math.max(lv(vx - 1, vz - 1), lv(vx, vz - 1), lv(vx, vz), lv(vx - 1, vz));
}

/** Downhill direction at a grid vertex, from the levels of the four tiles around it: where cliffs lean. */
function downhill(vx: number, vz: number, fallback: Vector2): Vector2 {
  const m = leanMap;
  const lv = (x: number, y: number) => drawnLevel(m, Math.min(m.width - 1, Math.max(0, x)), Math.min(m.height - 1, Math.max(0, y)));
  const tiles: [number, number][] = [[vx - 1, vz - 1], [vx, vz - 1], [vx, vz], [vx - 1, vz]];
  const top = Math.max(...tiles.map(([x, y]) => lv(x, y)));
  const d = new Vector2();
  for (const [x, y] of tiles) d.add(new Vector2(x + 0.5 - vx, y + 0.5 - vz).multiplyScalar(top - lv(x, y)));
  return d.lengthSq() > 1e-6 ? d.normalize() : fallback;
}

/**
 * A rocky cliff face from top edge p0→p1 (heights t0, t1) down to b0, b1, leaning out along `out`.
 * Shared end points lean along the terrain's downhill direction, so neighbouring faces always meet.
 */
function cliffWall(w: Builder, p0: Vector2, p1: Vector2, t0: number, t1: number, b0: number, b1: number, out: Vector2): void {
  // The top follows the ground's rim, pushed in and out like the plateau's edge (see rimShift).
  const [c0, c1] = [p0, p1];
  const s0 = rimShift(p0.x, p0.y);
  const s1 = rimShift(p1.x, p1.y);
  // A worn lip (see rimDrop) only where this wall starts from the highest ground at that corner, as the ground does.
  const drop = (c: Vector2, t: number) => (Number.isInteger(c.x) && Number.isInteger(c.y) && t >= topLevel(c.x, c.y) * LEVEL_HEIGHT - 0.01 ? rimDrop(c.x, c.y) : 0);
  t0 -= drop(p0, t0);
  t1 -= drop(p1, t1);
  const grid: Vector3[][] = [];
  const cols: Color[][] = [];
  for (let i = 0; i <= WALL_SEGMENTS; i++) {
    const t = i / WALL_SEGMENTS;
    const ends = i === 0 || i === WALL_SEGMENTS;
    const sh = s0.clone().lerp(s1, t);
    const px = c0.x + (c1.x - c0.x) * t + sh.x;
    const pz = c0.y + (c1.y - c0.y) * t + sh.y;
    const top = t0 + (t1 - t0) * t;
    const bottom = b0 + (b1 - b0) * t - 0.08;
    // Shared end points lean along the downhill direction of their (unshifted) grid corner.
    const corner = i === 0 ? c0 : c1;
    const dir = ends && Number.isInteger(corner.x) && Number.isInteger(corner.y) ? downhill(corner.x, corner.y, out) : out;
    const row: Vector3[] = [];
    const crow: Color[] = [];
    for (let j = 0; j <= WALL_ROWS; j++) {
      const s = j / WALL_ROWS;
      const y = top + (bottom - top) * s;
      // Position-only noise: two faces sharing a point displace it the same way.
      // The city's walls are built: straight and plumb, no rock noise.
      const built = B.style === 'city' ? 0 : 1;
      const n = (noise(px * 2.3 + y * 1.1, pz * 2.3 - y * 1.1, 1, 13) - 0.5 + (noise(px * 5 + y * 3, pz * 5 - y * 3, 1, 29) - 0.5) * 0.6) * built;
      const m = (noise(px * 1.3 - y, pz * 1.3 + y, 1, 17) - 0.5) * built;
      // Broad bulges and hollows along the cliff, so its foot meanders instead of following the tile edge.
      const bulge = Math.max(-0.12, (noise(px * 0.55, pz * 0.55, 1, 41) - 0.4) * 1.5 + (noise(px * 1.7, pz * 1.7, 1, 43) - 0.5) * 0.4) * built;
      const lean = j === 0 ? 0 : (built ? SLANT * Math.pow(s, 0.8) : 0.04 * s) + n * 0.6 + bulge * Math.pow(s, 0.6);
      const lift = j === 0 || j === WALL_ROWS ? 0 : m * 0.4;
      // A rim pulled in (rounded corner) slopes back out to the foot, so the foot still meets the lower ground.
      const back = lean + Math.max(0, -sh.dot(dir)) * s;
      row.push(new Vector3(px + dir.x * back, y + lift, pz + dir.y * back));
      crow.push(B.rock.clone().lerp(B.rockDark, s * 0.7).multiplyScalar(0.85 + (n + m) * 0.35));
    }
    grid.push(row);
    cols.push(crow);
  }
  const facing = new Vector3(out.x, 0.4, out.y);
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    for (let j = 0; j < WALL_ROWS; j++) {
      w.quad([grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]], [cols[i][j], cols[i + 1][j], cols[i + 1][j + 1], cols[i][j + 1]], facing, true);
    }
  }
}

/** Accumulates triangles with colours and world-mapped UVs. */
class Builder {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly uv: number[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  tri(p: Vector3[], c: Color[], facing: Vector3, wallUv = false): void {
    this.a.subVectors(p[1], p[0]);
    this.b.subVectors(p[2], p[0]);
    const order = this.a.cross(this.b).dot(facing) >= 0 ? [0, 1, 2] : [0, 2, 1];
    for (const i of order) {
      this.pos.push(p[i].x, p[i].y, p[i].z);
      this.col.push(c[i].r, c[i].g, c[i].b);
      // Ground: planar mapping from above. Walls: along the face, and up it.
      if (wallUv) this.uv.push((p[i].x + p[i].z) / 3, p[i].y / 3);
      else this.uv.push(p[i].x / 5, p[i].z / 5);
    }
  }

  quad(p: Vector3[], c: Color[], facing: Vector3, wallUv = false): void {
    this.tri([p[0], p[1], p[2]], [c[0], c[1], c[2]], facing, wallUv);
    this.tri([p[0], p[2], p[3]], [c[0], c[2], c[3]], facing, wallUv);
  }

  mesh(material: Material): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return new Mesh(g, material);
  }
}

/** Blends the colour texture with a second, rotated and larger sample of itself, so its repetition does not show. */
function untile(m: MeshStandardMaterial, rock: Texture, slab: Color, grid = false, roads?: Texture, map?: GameMap): void {
  // grid: deck plates, kept aligned (no rotated second sample, no bedrock slabs, only darker grimy plates).
  // A ground picture (B.ground) has its own rock and stones: no painted bedrock slabs over it.
  const plain = !!B.ground;
  m.customProgramCacheKey = () => (grid ? 'untile-grid' : 'untile') + (roads ? '-roads' : '') + (plain ? '-plain' : '');
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.rockMap = { value: rock };
    shader.uniforms.slabColor = { value: slab };
    shader.uniforms.roadMap = { value: roads ?? null };
    shader.uniforms.mapSize = { value: new Vector2(map?.width ?? 1, map?.height ?? 1) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vGround;
      uniform sampler2D rockMap;
      uniform vec3 slabColor;
      uniform sampler2D roadMap;
      uniform vec2 mapSize;
      float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y);
      }
      float gFbm(vec2 p) { return gNoise(p) * 0.55 + gNoise(p * 2.03) * 0.3 + gNoise(p * 4.1) * 0.15; }`,
    ).replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + 0.31;
        vec4 texelColor = mix(texture2D(map, vMapUv), texture2D(map, uv2), ${grid ? '0.0' : '0.45'});
        // Second material: flat slabs of bedrock breaking through the dirt, outlined like a painting.
        float n = gFbm(vGround * 0.16);
        float slab = ${plain ? '0.0' : 'smoothstep(0.6, 0.62, n)'};
        float rim = ${plain ? '0.0' : 'smoothstep(0.585, 0.6, n) - slab'};
        vec4 rockTex = texture2D(rockMap, vGround * 0.33);
        texelColor.rgb = ${grid ? 'texelColor.rgb * (1.0 - slab * 0.3)' : 'mix(texelColor.rgb, rockTex.rgb * slabColor * 1.6, slab)'};
        texelColor.rgb *= 1.0 - rim * 0.55;
        // Small scattered gravel.
        texelColor.rgb *= 1.0 - smoothstep(0.82, 0.86, gNoise(vGround * 3.7)) * 0.25;
        ${roads ? `// Streets: worn asphalt, faded white dashes and yellow edge lines, paint gone in patches.
        vec3 road = texture2D(roadMap, vGround / mapSize).rgb;
        float wear = smoothstep(0.3, 0.55, gNoise(vGround * 1.7));
        texelColor.rgb = mix(texelColor.rgb, vec3(0.075, 0.08, 0.09) * (0.8 + texelColor.g * 0.5), road.r * 0.9);
        texelColor.rgb = mix(texelColor.rgb, vec3(0.62, 0.62, 0.58), road.g * wear * 0.75);
        texelColor.rgb = mix(texelColor.rgb, vec3(0.7, 0.55, 0.15), road.b * wear * 0.8);` : ''}
        diffuseColor *= texelColor;
      #endif`,
    ).replace(
      '#include <emissivemap_fragment>',
      `#ifdef USE_EMISSIVEMAP
        // Glowing veins only in some areas: cracks (red) masked by large patches (green) sampled at another scale.
        vec2 patchUv = mat2(0.6, 0.8, -0.8, 0.6) * vEmissiveMapUv * 0.23 + 0.17;
        float glow = texture2D(emissiveMap, vEmissiveMapUv).r * smoothstep(0.58, 0.78, texture2D(emissiveMap, patchUv).g);
        ${roads ? 'glow *= 1.0 - texture2D(roadMap, vGround / mapSize).r;' : ''}
        totalEmissiveRadiance *= glow;
      #endif`,
    );
  };
}

/** How far the land goes on beyond the map's edges, in tiles: past the fade to black (see fogMaterial). */
const OUT_R = 6; // a multiple of the outskirts' grid step
const smooth01 = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
/** Distance from a point to the map's rectangle (0 inside). */
const outDist = (map: GameMap, x: number, z: number) => Math.hypot(Math.max(0, -x, x - map.width), Math.max(0, -z, z - map.height));

/**
 * Ground height outside the map (rendering only): the nearest edge tile's level at first, then rolling land.
 * Just under the map's own edge, whose skirt hides the seam.
 */
export function outskirtHeight(map: GameMap, x: number, z: number): number {
  const d = outDist(map, x, z);
  const edge = tileAt(map, Math.min(map.width - 1, Math.max(0, Math.floor(x))), Math.min(map.height - 1, Math.max(0, Math.floor(z))))!.level * LEVEL_HEIGHT;
  const t = smooth01(d / 9);
  const far = (noise(x, z, 9, 81) * 2.4 - 0.75) * LEVEL_HEIGHT + (noise(x, z, 3, 83) - 0.5) * 0.5;
  return edge * (1 - t) + far * t - 0.08;
}

/** A short band of land beyond the map's edges, under the edge's fog, fading to black (see fogMaterial). Not playable. */
function outskirts(map: GameMap, gMap: Texture, gNormal: Texture, rMap: Texture): Group {
  const b = new Builder();
  const up = new Vector3(0, 1, 0);
  const STEP = 3; // coarse: gentle land, soon in the dark
  const cache = new Map<number, [Vector3, Color]>();
  const vert = (x: number, z: number): [Vector3, Color] => {
    const key = (z + OUT_R) * 4096 + x + OUT_R;
    const hit = cache.get(key);
    if (hit) return hit;
    const h = outskirtHeight(map, x, z);
    const lv = Math.min(2, Math.max(0, Math.round(h / LEVEL_HEIGHT)));
    const c = B.levels[lv].clone().lerp(B.patch, Math.max(0, noise(x, z, 9, 3) - 0.3) * 1.6 * (1 - smooth01(outDist(map, x, z) / 20) * 0.6)).lerp(B.sand, Math.max(0, noise(x, z, 14, 9) - 0.55) * 1.8);
    c.multiplyScalar(0.94 + noise(x, z, 2, 5) * 0.12);
    const v: [Vector3, Color] = [new Vector3(x, h, z), c];
    cache.set(key, v);
    return v;
  };
  for (let z = -OUT_R; z < map.height + OUT_R; z += STEP) {
    for (let x = -OUT_R; x < map.width + OUT_R; x += STEP) {
      if (x >= 0 && z >= 0 && x + STEP <= map.width && z + STEP <= map.height) continue;
      const v = [vert(x, z), vert(x + STEP, z), vert(x + STEP, z + STEP), vert(x, z + STEP)];
      b.quad(v.map((p) => p[0]), v.map((p) => p[1]), up);
    }
  }
  const mat = new MeshStandardMaterial({ vertexColors: true, map: gMap, normalMap: gNormal, normalScale: new Vector2(0.8, 0.8), roughness: 0.95 });
  untile(mat, rMap, B.rock.clone().lerp(new Color(0x86888d), 0.55), false, undefined, map);
  const g = new Group();
  const land = b.mesh(mat);
  land.userData.noPick = true;
  // Beyond the land, a plain black sheet, so the background never shows.
  const sheet = new Mesh(new PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
  sheet.position.set(map.width / 2, -6, map.height / 2);
  sheet.material.userData.fogged = true;
  sheet.userData.noPick = true;
  g.add(land, sheet);
  return g;
}

/** Fog-of-war texture: write 0 / 128 / 255 per tile (unseen, explored, visible), then set needsUpdate. */
export function createFog(map: GameMap): DataTexture {
  const fog = new DataTexture(new Uint8Array(map.width * map.height), map.width, map.height, RedFormat);
  fog.magFilter = LinearFilter;
  fog.minFilter = LinearFilter;
  fog.needsUpdate = true;
  return fog;
}

/**
 * The two levels of the fog of war, from the fog texture's value `f` (0 never explored, 0.5 explored, 1 in sight):
 * black where never explored, grey and dim where explored but out of sight, full colour in sight.
 */
export const FOG_GLSL = (f: string) => `{
  float fogF = ${f};
  float fogLum = dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11));
  gl_FragColor.rgb = mix(vec3(fogLum) * 0.55, gl_FragColor.rgb, smoothstep(0.55, 0.95, fogF)) * smoothstep(0.08, 0.45, fogF);
}`;

/** Makes a material darker where the player has no vision (works for instanced meshes too). */
export function fogMaterial(mat: Material, fog: DataTexture, map: GameMap): void {
  if (mat.userData.fogged) return;
  mat.userData.fogged = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.fogMap = { value: fog };
    shader.uniforms.mapSize = { value: new Vector2(map.width, map.height) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform vec2 mapSize;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 fogWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fogWorld = instanceMatrix * fogWorld;
        #endif
        vFogUv = (modelMatrix * fogWorld).xz / mapSize;`,
      );
    shader.fragmentShader = shader.fragmentShader
      // mapSize is already declared on the ground (untile).
      .replace('#include <common>', `#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;${shader.fragmentShader.includes('uniform vec2 mapSize') ? '' : '\nuniform vec2 mapSize;'}`)
      // The tile's fog; beyond the map's edges (the land out there, its rocks), the nearest edge tile's, then black
      // two to four tiles out: the map ends in the dark.
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        vec2 fogLo = 0.5 / mapSize;
        ${FOG_GLSL('texture2D(fogMap, clamp(vFogUv, fogLo, 1.0 - fogLo)).r')}
        gl_FragColor.rgb *= 1.0 - smoothstep(2.0, 4.0, length((vFogUv - clamp(vFogUv, 0.0, 1.0)) * mapSize));`,
      );
  };
}

/** Applies the fog to every material of an object tree. */
export function addFog(root: Object3D, fog: DataTexture, map: GameMap): void {
  root.traverse((o) => {
    if (o instanceof Mesh) fogMaterial(o.material as Material, fog, map);
  });
}
