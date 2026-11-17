import { BufferAttribute, BufferGeometry, CanvasTexture, type DataTexture, Group, Mesh, MeshStandardMaterial, type Object3D, RepeatWrapping, SRGBColorSpace } from 'three';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';
import { fogMaterial } from '../terrain';

/** Texture size in pixels, and the world tiles one repeat covers. */
const S = 512;
const TILE = 5;
/** Paving round each building beyond its footprint, how gradually it frays out, half-width of the streets. */
const PLAZA = 2;
const FRAY = 1.6;
const STREET = 0.9;
const NOISE = 0.55;

const hash = (a: number, b: number, c = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Smooth value noise, tiling every `per` cells. */
function vnoise(x: number, y: number, per: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const sx = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const sy = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const h = (i: number, j: number) => hash(((i % per) + per) % per, ((j % per) + per) % per, seed);
  return (h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx) * (1 - sy) + (h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx) * sy;
}

/**
 * Worn cobbles in greys (pigeon, slate, pale stone), dark joints. The alpha holds each stone's threshold of
 * appearance, so the edge of the paving frays stone by stone. Returns the colour map and, for the higher
 * levels, a normal map of the domed stones.
 */
function cobbles(relief: boolean): [CanvasTexture, CanvasTexture | null] {
  const N = 16;
  const C = S / N;
  const img = new ImageData(S, S);
  const height = new Float32Array(S * S);
  const TONES: [number, number, number][] = [[116, 122, 130], [94, 102, 112], [78, 84, 94], [128, 128, 127], [104, 108, 112]];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // Voronoi on a jittered grid that wraps: distance to the nearest seed and to the joint with the next one.
      const cx = Math.floor(x / C);
      const cy = Math.floor(y / C);
      let d1 = 1e9;
      let d2 = 1e9;
      let id = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const wi = (((cx + i) % N) + N) % N;
          const wj = (((cy + j) % N) + N) % N;
          const d = Math.hypot(x + 0.5 - (cx + i + 0.15 + 0.7 * hash(wi, wj, 1)) * C, y + 0.5 - (cy + j + 0.15 + 0.7 * hash(wi, wj, 2)) * C);
          if (d < d1) [d2, d1, id] = [d1, d, wi + wj * N];
          else if (d < d2) d2 = d;
        }
      const edge = (d2 - d1) / 2 - 2.2;
      const grain = vnoise(x / 3, y / 3, S / 3, 7) - 0.5;
      const k = y * S + x;
      if (edge > 0) {
        const dome = Math.sqrt(Math.min(1, edge / 7));
        height[k] = dome;
        const shade = 0.72 + 0.28 * dome + grain * 0.12;
        // Darker, sootier stones in patches.
        const soot = vnoise(x / 40, y / 40, S / 40, 9) * 0.3;
        const tone = TONES[Math.floor(hash(id, 3) * TONES.length)];
        img.data.set([...tone.map((v) => (v * (1 - soot) + 60 * soot) * shade), (0.04 + 0.9 * hash(id, 5)) * 255], k * 4);
      } else img.data.set([54 + grain * 16, 55 + grain * 16, 58 + grain * 16, 0.6 * 255], k * 4);
    }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  c.getContext('2d')!.putImageData(img, 0, 0);
  const map = new CanvasTexture(c);
  map.colorSpace = SRGBColorSpace;
  let normal: CanvasTexture | null = null;
  if (relief) {
    const nimg = new ImageData(S, S);
    const H = (x: number, y: number) => height[((y + S) % S) * S + ((x + S) % S)];
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = (H(x + 1, y) - H(x - 1, y)) * 2.5;
        const dy = (H(x, y + 1) - H(x, y - 1)) * 2.5;
        const l = Math.hypot(dx, dy, 1);
        nimg.data.set([(-dx / l) * 127 + 128, (dy / l) * 127 + 128, (1 / l) * 127 + 128, 255], (y * S + x) * 4);
      }
    const n = document.createElement('canvas');
    n.width = n.height = S;
    n.getContext('2d')!.putImageData(nimg, 0, 0);
    normal = new CanvasTexture(n);
  }
  for (const t of [map, normal]) {
    if (!t) continue;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 4;
  }
  return [map, normal];
}

/**
 * Humans: cobbles spread round their finished buildings and along streets from each building to its
 * neighbour, like a town growing out of the ground. Decoration only. One draped mesh per player, rebuilt
 * when their buildings change.
 */
export class Paving {
  private readonly root = new Group();
  private material: MeshStandardMaterial | null = null;
  private key = '';

  constructor(scene: Object3D, private readonly map: GameMap, private readonly fog: DataTexture, private readonly relief: boolean) {
    scene.add(this.root);
  }

  update(world: World, sees: (e: Entity) => boolean): void {
    const built = [...world.entities.values()].filter((e) => e.def.kind === 'building' && e.buildLeft <= 0 && (e.def as BuildingDef).faction === 'humains' && sees(e));
    const key = built.map((e) => e.id).join(',');
    if (key === this.key) return;
    this.key = key;
    for (const m of this.root.children) (m as Mesh).geometry.dispose();
    this.root.clear();
    for (const owner of new Set(built.map((e) => e.owner))) this.build(built.filter((e) => e.owner === owner));
  }

  /** Made on the first Human building, so matches without Humans never pay for the texture. */
  private paving(): MeshStandardMaterial {
    if (this.material) return this.material;
    const [map, normalMap] = cobbles(this.relief);
    const m = new MeshStandardMaterial({ map, normalMap, roughness: 0.9, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = `attribute float aCov;\nvarying float vCov;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCov = aCov;')}`;
      // A stone shows once the coverage passes its own threshold (the map's alpha): the rim frays stone by stone.
      sh.fragmentShader = `varying float vCov;\n${sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float th = sampledDiffuseColor.a;
        diffuseColor.a = smoothstep(th - 0.03, th + 0.03, vCov * 1.15);`,
      )}`;
    };
    fogMaterial(m, this.fog, this.map);
    return (this.material = m);
  }

  private build(own: Entity[]): void {
    const pos = (e: Entity) => [e.x / FP, e.y / FP] as const;
    const reach = (e: Entity) => (e.def as BuildingDef).size / 2 + PLAZA;
    // Streets: each building to the nearest one already linked, starting from the town hall.
    const hall = own.find((e) => (e.def as BuildingDef).dropoff) ?? own[0];
    const linked = [hall, ...own.filter((e) => e !== hall)];
    const streets: [number, number, number, number][] = [];
    for (let i = 1; i < linked.length; i++) {
      const e = linked[i];
      const n = linked.slice(0, i).reduce((a, b) => (Math.hypot(b.x - e.x, b.y - e.y) < Math.hypot(a.x - e.x, a.y - e.y) ? b : a));
      if (Math.hypot(n.x - e.x, n.y - e.y) / FP < 22) streets.push([...pos(e), ...pos(n)]);
    }
    let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of own) {
      const [x, z] = pos(e);
      const r = reach(e) + 1;
      [x0, z0, x1, z1] = [Math.min(x0, x - r), Math.min(z0, z - r), Math.max(x1, x + r), Math.max(z1, z + r)];
    }
    const step = 0.5;
    const nx = Math.ceil((x1 - x0) / step) + 1;
    const nz = Math.ceil((z1 - z0) / step) + 1;
    const p = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const cov = new Float32Array(nx * nz);
    const segDist = (x: number, z: number, [ax, az, bx, bz]: [number, number, number, number]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - ax - dx * t, z - az - dz * t);
    };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const x = x0 + i * step;
        const z = z0 + j * step;
        p.set([x, heightAt(this.map, x, z) + 0.03, z], k * 3);
        uv.set([x / TILE, -z / TILE], k * 2);
        const wobble = (vnoise(x * 0.6, z * 0.6, 1e6, 3) - 0.5) * 2 * NOISE + (vnoise(x * 1.7, z * 1.7, 1e6, 4) - 0.5) * NOISE;
        let c = 0;
        for (const e of own) {
          const [ex, ez] = pos(e);
          c = Math.max(c, (reach(e) - Math.hypot(x - ex, z - ez)) / FRAY);
        }
        for (const s of streets) c = Math.max(c, (STREET - segDist(x, z, s)) / FRAY);
        cov[k] = Math.max(0, Math.min(1, c + wobble));
      }
    const index: number[] = [];
    for (let j = 0; j < nz - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const q = [a, a + 1, a + nx, a + nx + 1];
        if (q.every((v) => cov[v] <= 0)) continue;
        const ys = q.map((v) => p[v * 3 + 1]);
        if (Math.max(...ys) - Math.min(...ys) > 0.6) continue; // not draped down a cliff
        index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(p, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setAttribute('aCov', new BufferAttribute(cov, 1));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new Mesh(geo, this.paving());
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.root.add(mesh);
  }
}
