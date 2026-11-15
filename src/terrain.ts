import {
  BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, Mesh, MeshStandardMaterial, RedFormat, Vector3,
} from 'three';
import { type GameMap, cornerHeights, tileAt } from './map';

const LEVEL_COLORS = [new Color(0x5b6b3c), new Color(0x7d7247), new Color(0x948d6c)];
const CLIFF_TOP = new Color(0x6b5a48);
const CLIFF_BOTTOM = new Color(0x3d3229);

/** Deterministic 0..1 noise per tile, for colour variation. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function tileColor(map: GameMap, x: number, y: number): Color {
  const t = tileAt(map, x, y)!;
  const c = LEVEL_COLORS[t.level].clone();
  if (t.ramp) c.lerp(LEVEL_COLORS[t.level + 1], 0.5);
  return c.multiplyScalar(0.94 + hash(x, y) * 0.12);
}

/** Corners of each tile edge, as indices into [nw, ne, se, sw], plus the neighbour's matching corners. */
const EDGES = [
  { dx: 0, dy: -1, mine: [0, 1], theirs: [3, 2] }, // north
  { dx: 1, dy: 0, mine: [1, 2], theirs: [0, 3] }, // east
  { dx: 0, dy: 1, mine: [2, 3], theirs: [1, 0] }, // south
  { dx: -1, dy: 0, mine: [3, 0], theirs: [2, 1] }, // west
];

export function buildTerrain(map: GameMap): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const a = new Vector3();
  const b = new Vector3();

  // Adds a quad as two triangles, wound so it faces `facing`.
  const quad = (p: Vector3[], c: Color[], facing: Vector3) => {
    a.subVectors(p[1], p[0]);
    b.subVectors(p[2], p[0]);
    const order = a.cross(b).dot(facing) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const i of order) {
      positions.push(p[i].x, p[i].y, p[i].z);
      colors.push(c[i].r, c[i].g, c[i].b);
    }
  };

  const up = new Vector3(0, 1, 0);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const h = cornerHeights(map, x, y);
      const corners = [
        new Vector3(x, h[0], y),
        new Vector3(x + 1, h[1], y),
        new Vector3(x + 1, h[2], y + 1),
        new Vector3(x, h[3], y + 1),
      ];
      const color = tileColor(map, x, y);
      quad(corners, [color, color, color, color], up);

      // Cliff walls drop from this tile down to any lower neighbour.
      for (const e of EDGES) {
        if (!tileAt(map, x + e.dx, y + e.dy)) continue;
        const n = cornerHeights(map, x + e.dx, y + e.dy);
        const [i, j] = e.mine;
        const top = [h[i], h[j]];
        const bottom = [Math.min(h[i], n[e.theirs[0]]), Math.min(h[j], n[e.theirs[1]])];
        if (top[0] <= bottom[0] && top[1] <= bottom[1]) continue;
        const p = corners[i];
        const q = corners[j];
        quad(
          [new Vector3(p.x, top[0], p.z), new Vector3(q.x, top[1], q.z), new Vector3(q.x, bottom[1], q.z), new Vector3(p.x, bottom[0], p.z)],
          [CLIFF_TOP, CLIFF_TOP, CLIFF_BOTTOM, CLIFF_BOTTOM],
          new Vector3(e.dx, 0, e.dy),
        );
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Darkens unexplored and out-of-sight ground. Write 0 / 128 / 255 per tile into `data`, then set needsUpdate. */
export function addFog(mesh: Mesh, map: GameMap): DataTexture {
  const fog = new DataTexture(new Uint8Array(map.width * map.height), map.width, map.height, RedFormat);
  fog.magFilter = LinearFilter;
  fog.minFilter = LinearFilter;
  fog.needsUpdate = true;
  const material = mesh.material as MeshStandardMaterial;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.fogMap = { value: fog };
    shader.uniforms.mapSize = { value: [map.width, map.height] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform vec2 mapSize;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogUv = position.xz / mapSize;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb *= 0.12 + 0.88 * texture2D(fogMap, vFogUv).r;');
  };
  return fog;
}
