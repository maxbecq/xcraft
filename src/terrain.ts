import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, Group, LinearFilter, Mesh, MeshStandardMaterial, RedFormat,
  Vector2, Vector3,
} from 'three';
import { type GameMap, LEVEL_HEIGHT, cornerHeights, cutCorner, cutLevel, tileAt } from './map';
import { fbm, groundTextures, rockTextures } from './render/textures';

// Wasteland palette per cliff level, plus darker patches blended in by noise.
const LEVEL_COLORS = [new Color(0xb08f5e), new Color(0xa48a62), new Color(0xbcad8c)];
const PATCH = new Color(0x6e5a3e);
const SAND = new Color(0xd2b47e);
const ROCK = new Color(0x9a7a5e);
const ROCK_DARK = new Color(0x4a382c);
/** How far a cliff's foot leans out from its top, in tiles. */
const SLANT = 0.32;
const WALL_SEGMENTS = 4;
const WALL_ROWS = 5;

/** Smooth noise over world positions (not tileable), 0..1. */
const noise = (x: number, z: number, scale: number, seed: number) => fbm((x / scale) % 1024 / 1024, (z / scale) % 1024 / 1024, 3, 1024, seed);

/** Colour of a tile for the minimap. */
export function tileColor(map: GameMap, x: number, y: number): Color {
  const t = tileAt(map, x, y)!;
  const c = LEVEL_COLORS[t.level].clone();
  if (t.ramp) c.lerp(LEVEL_COLORS[t.level + 1], 0.5);
  return c.lerp(PATCH, noise(x, y, 9, 3) * 0.5);
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
  const onEdge = (vx: number, vz: number) => {
    const l = levelAt(vx, vz);
    return levelAt(vx - 1, vz) !== l || levelAt(vx, vz - 1) !== l || levelAt(vx - 1, vz - 1) !== l;
  };
  const groundVertex = (vx: number, h: number, vz: number, level: number): [Vector3, Color] => {
    const edge = onEdge(vx, vz);
    const bump = edge ? 0 : (noise(vx, vz, 3, 7) - 0.5) * 0.14;
    const c = LEVEL_COLORS[Math.min(2, level)].clone().lerp(PATCH, Math.max(0, noise(vx, vz, 9, 3) - 0.3) * 1.6).lerp(SAND, Math.max(0, noise(vx, vz, 14, 9) - 0.55) * 1.8);
    c.multiplyScalar((edge ? 0.82 : 1) * (0.94 + noise(vx, vz, 2, 5) * 0.12));
    return [new Vector3(vx, h + bump, vz), c];
  };

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = tileAt(map, x, y)!;
      const h = cornerHeights(map, x, y);
      const cut = cutCorner(map, x, y);
      const v = CORNER_POS.map(([cx, cy], i) => groundVertex(x + cx, h[i], y + cy, t.level + (t.ramp && h[i] > t.level * LEVEL_HEIGHT ? 1 : 0)));
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
  untile(groundMat);
  const groundMesh = ground.mesh(groundMat);
  const cliffMesh = cliffs.mesh(new MeshStandardMaterial({ vertexColors: true, map: rMap, normalMap: rNormal, normalScale: new Vector2(1.4, 1.4), roughness: 0.9, flatShading: true }));
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
      crow.push(ROCK.clone().lerp(ROCK_DARK, s * 0.7).multiplyScalar(0.85 + (n + m) * 0.35));
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
function untile(m: MeshStandardMaterial): void {
  m.customProgramCacheKey = () => 'untile';
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.37 + 0.31;
        vec4 texelColor = mix(texture2D(map, vMapUv), texture2D(map, uv2), 0.45);
        diffuseColor *= texelColor;
      #endif`,
    );
  };
}

/** Darkens unexplored and out-of-sight ground. Write 0 / 128 / 255 per tile into the texture, then set needsUpdate. */
export function addFog(terrain: Group, map: GameMap): DataTexture {
  const fog = new DataTexture(new Uint8Array(map.width * map.height), map.width, map.height, RedFormat);
  fog.magFilter = LinearFilter;
  fog.minFilter = LinearFilter;
  fog.needsUpdate = true;
  terrain.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = o.material as MeshStandardMaterial;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      prev?.call(mat, shader, r);
      shader.uniforms.fogMap = { value: fog };
      shader.uniforms.mapSize = { value: new Vector2(map.width, map.height) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform vec2 mapSize;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogUv = position.xz / mapSize;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= 0.12 + 0.88 * texture2D(fogMap, vFogUv).r;');
    };
  });
  return fog;
}
