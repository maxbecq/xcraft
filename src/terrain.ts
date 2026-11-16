import {
  BufferGeometry, Color, DataTexture, type Texture, Float32BufferAttribute, Group, LinearFilter, type Material, Mesh, MeshStandardMaterial,
  type Object3D, RedFormat, Vector2, Vector3,
} from 'three';
import { type GameMap, LEVEL_HEIGHT, cornerHeights, cutCorner, cutLevel, reliefAt, setRelief, tileAt } from './map';
import { type Biome, BIOMES } from './render/biome';
import { weather } from './render/weathering';
import { crackMask, fbm, groundTextures, rockTextures } from './render/textures';

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
const WALL_SEGMENTS = 4;
const WALL_ROWS = 5;

/** Smooth noise over world positions (not tileable), 0..1. */
const noise = (x: number, z: number, scale: number, seed: number) => fbm((x / scale) % 1024 / 1024, (z / scale) % 1024 / 1024, 3, 1024, seed);

/** Colour of a tile for the minimap. */
export function tileColor(map: GameMap, x: number, y: number): Color {
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

export function buildTerrain(map: GameMap): Group {
  leanMap = map;
  const ground = new Builder();
  const cliffs = new Builder();
  const up = new Vector3(0, 1, 0);

  // Ground vertices: tinted by level and noise, darkened along cliff edges, gently bumped away from them.
  const levelAt = (x: number, y: number) => tileAt(map, Math.min(map.width - 1, Math.max(0, x)), Math.min(map.height - 1, Math.max(0, y)))!.level;
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
    return [new Vector3(vx, h + bump + dune, vz), c];
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
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
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      for (let e = 0; e < 4; e++) {
        const { dx, dy, c } = EDGES[e];
        const [ta, tb] = drawnEdge(map, x, y, e);
        let ba: number;
        let bb: number;
        if (tileAt(map, x + dx, y + dy)) [bb, ba] = drawnEdge(map, x + dx, y + dy, (e + 2) % 4);
        else [ba, bb] = [-2.5, -2.5]; // skirt around the map
        if (ta <= ba + 0.01 && tb <= bb + 0.01) continue;
        const p0 = new Vector2(x + CORNER_POS[c[0]][0], y + CORNER_POS[c[0]][1]);
        const p1 = new Vector2(x + CORNER_POS[c[1]][0], y + CORNER_POS[c[1]][1]);
        cliffWall(cliffs, p0, p1, ta, tb, Math.min(ta, ba), Math.min(tb, bb), new Vector2(dx, dy));
      }
    }
  }

  const [gMap, gNormal] = groundTextures();
  const [rMap, rNormal] = rockTextures();
  const groundMat = new MeshStandardMaterial({ vertexColors: true, map: gMap, normalMap: gNormal, normalScale: new Vector2(0.8, 0.8), roughness: 0.95 });
  if (B.veins) {
    // Strange worlds: light glows up through the cracks.
    groundMat.emissiveMap = crackMask();
    groundMat.emissive = B.veins;
    groundMat.emissiveIntensity = 2.2;
  }
  untile(groundMat, rMap, B.rock.clone().lerp(new Color(B.greyStones ? 0x86888d : 0x8a8378), 0.55));
  const groundMesh = ground.mesh(groundMat);
  const cliffMat = new MeshStandardMaterial({ vertexColors: true, map: rMap, normalMap: rNormal, normalScale: new Vector2(1.4, 1.4), roughness: 0.9, flatShading: true });
  weather(cliffMat, 0.45); // mineral stains and damp streaks down the rock
  const cliffMesh = cliffs.mesh(cliffMat);
  groundMesh.receiveShadow = true;
  cliffMesh.receiveShadow = true;
  cliffMesh.castShadow = true;
  const g = new Group();
  g.add(groundMesh, cliffMesh);
  return g;
}

let leanMap: GameMap;

/** Downhill direction at a grid vertex, from the levels of the four tiles around it: where cliffs lean. */
function downhill(vx: number, vz: number, fallback: Vector2): Vector2 {
  const m = leanMap;
  const lv = (x: number, y: number) => tileAt(m, Math.min(m.width - 1, Math.max(0, x)), Math.min(m.height - 1, Math.max(0, y)))!.level;
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
  const grid: Vector3[][] = [];
  const cols: Color[][] = [];
  for (let i = 0; i <= WALL_SEGMENTS; i++) {
    const t = i / WALL_SEGMENTS;
    const ends = i === 0 || i === WALL_SEGMENTS;
    const px = p0.x + (p1.x - p0.x) * t;
    const pz = p0.y + (p1.y - p0.y) * t;
    const top = t0 + (t1 - t0) * t;
    const bottom = b0 + (b1 - b0) * t - 0.08;
    const dir = ends && Number.isInteger(px) && Number.isInteger(pz) ? downhill(px, pz, out) : out;
    const row: Vector3[] = [];
    const crow: Color[] = [];
    for (let j = 0; j <= WALL_ROWS; j++) {
      const s = j / WALL_ROWS;
      const y = top + (bottom - top) * s;
      // Position-only noise: two faces sharing a point displace it the same way.
      const n = noise(px * 2.3 + y * 1.1, pz * 2.3 - y * 1.1, 1, 13) - 0.5 + (noise(px * 5 + y * 3, pz * 5 - y * 3, 1, 29) - 0.5) * 0.6;
      const m = noise(px * 1.3 - y, pz * 1.3 + y, 1, 17) - 0.5;
      const lean = j === 0 ? 0 : SLANT * Math.pow(s, 0.8) + n * 0.42;
      const lift = j === 0 || j === WALL_ROWS ? 0 : m * 0.3;
      row.push(new Vector3(px + dir.x * lean, y + lift, pz + dir.y * lean));
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

  mesh(material: MeshStandardMaterial): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    return new Mesh(g, material);
  }
}

/** Blends the colour texture with a second, rotated and larger sample of itself, so its repetition does not show. */
function untile(m: MeshStandardMaterial, rock: Texture, slab: Color): void {
  m.customProgramCacheKey = () => 'untile';
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.rockMap = { value: rock };
    shader.uniforms.slabColor = { value: slab };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = position.xz;');
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vGround;
      uniform sampler2D rockMap;
      uniform vec3 slabColor;
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
        vec4 texelColor = mix(texture2D(map, vMapUv), texture2D(map, uv2), 0.45);
        // Second material: flat slabs of bedrock breaking through the dirt, outlined like a painting.
        float n = gFbm(vGround * 0.16);
        float slab = smoothstep(0.6, 0.62, n);
        float rim = smoothstep(0.585, 0.6, n) - slab;
        vec4 rockTex = texture2D(rockMap, vGround * 0.33);
        texelColor.rgb = mix(texelColor.rgb, rockTex.rgb * slabColor * 1.6, slab);
        texelColor.rgb *= 1.0 - rim * 0.55;
        // Small scattered gravel.
        texelColor.rgb *= 1.0 - smoothstep(0.82, 0.86, gNoise(vGround * 3.7)) * 0.25;
        diffuseColor *= texelColor;
      #endif`,
    ).replace(
      '#include <emissivemap_fragment>',
      `#ifdef USE_EMISSIVEMAP
        // Glowing veins only in some areas: cracks (red) masked by large patches (green) sampled at another scale.
        vec2 patchUv = mat2(0.6, 0.8, -0.8, 0.6) * vEmissiveMapUv * 0.23 + 0.17;
        float glow = texture2D(emissiveMap, vEmissiveMapUv).r * smoothstep(0.58, 0.78, texture2D(emissiveMap, patchUv).g);
        totalEmissiveRadiance *= glow;
      #endif`,
    );
  };
}

/** Fog-of-war texture: write 0 / 128 / 255 per tile (unseen, explored, visible), then set needsUpdate. */
export function createFog(map: GameMap): DataTexture {
  const fog = new DataTexture(new Uint8Array(map.width * map.height), map.width, map.height, RedFormat);
  fog.magFilter = LinearFilter;
  fog.minFilter = LinearFilter;
  fog.needsUpdate = true;
  return fog;
}

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
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= 0.12 + 0.88 * texture2D(fogMap, vFogUv).r;');
  };
}

/** Applies the fog to every material of an object tree. */
export function addFog(root: Object3D, fog: DataTexture, map: GameMap): void {
  root.traverse((o) => {
    if (o instanceof Mesh) fogMaterial(o.material as Material, fog, map);
  });
}
