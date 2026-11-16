import { Color, InstancedMesh, Matrix4, Mesh, type MeshStandardMaterial, Object3D, Quaternion, type Scene, Vector3, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type GameMap, cutCorner, heightAt, tileAt } from '../map';
import { EXPANSIONS } from '../sim/setup';
import { weather } from './weathering';
import type { World } from '../sim/world';

/** Scenery by context, as [doodad, chance per tile]. */
const CLIFF_FOOT: [string, number][] = [['rocks_a', 0.22], ['rocks_b', 0.1], ['pebbles', 0.18]];
const BORDER: [string, number][] = [['rocks_b', 0.12], ['dead_tree', 0.06], ['wreck', 0.03], ['rocks_a', 0.08]];
const OPEN: [string, number][] = [
  ['pebbles', 0.05], ['dry_bush', 0.05], ['bones', 0.008], ['tire_pile', 0.006], ['barrels', 0.006],
  ['scrap_pile', 0.01], ['dead_tree', 0.008], ['wreck', 0.003], ['rocks_a', 0.01],
];

function rand(x: number, y: number, k: number): number {
  let h = Math.imul(x, 2246822519) ^ Math.imul(y, 3266489917) ^ Math.imul(k, 668265263);
  h = Math.imul(h ^ (h >>> 15), 2654435761);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

interface Placed {
  type: string;
  tx: number;
  ty: number;
  matrix: Matrix4;
}

/** Rocks, wrecks and dead plants. Pure decoration: the simulation never sees them. */
export class Decor {
  private readonly placed: Placed[] = [];
  private readonly meshes = new Map<string, InstancedMesh[]>();
  readonly root = new Object3D();

  constructor(private readonly map: GameMap, world: World, private readonly tint = new Color(1, 1, 1)) {
    const keepClear = new Set<number>();
    const clear = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) keepClear.add(y * map.width + x);
    };
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource') clear(e.tx + 1, e.ty + 1, 3);
      if (e.def.kind === 'building' && e.def.dropoff) clear(e.tx + 2, e.ty + 2, 6);
    }
    for (const [tx, ty] of EXPANSIONS) clear(tx + 2, ty + 2, 5);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.ramp[y * map.width + x]) clear(x, y, 2);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (keepClear.has(y * map.width + x) || cutCorner(map, x, y) >= 0) continue;
        const level = tileAt(map, x, y)!.level;
        const higher = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (tileAt(map, x + dx, y + dy)?.level ?? -1) > level);
        const border = x < 3 || y < 3 || x >= map.width - 3 || y >= map.height - 3;
        const table = higher ? CLIFF_FOOT : border ? BORDER : OPEN;
        let r = rand(x, y, 1);
        for (const [type, p] of table) {
          if (r < p) {
            this.place(type, x, y);
            break;
          }
          r -= p;
        }
      }
    }
  }

  private place(type: string, tx: number, ty: number): void {
    const x = tx + 0.5 + (rand(tx, ty, 2) - 0.5) * 0.6;
    const z = ty + 0.5 + (rand(tx, ty, 3) - 0.5) * 0.6;
    const s = 0.8 + rand(tx, ty, 4) * 0.5;
    const m = new Matrix4().compose(
      new Vector3(x, heightAt(this.map, x, z) - 0.02, z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rand(tx, ty, 5) * Math.PI * 2),
      new Vector3(s, s, s),
    );
    this.placed.push({ type, tx, ty, matrix: m });
  }

  async load(scene: Scene, fog: (m: Material) => void): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/doodads.glb`).catch(() => null);
    if (!gltf) return;
    gltf.scene.updateMatrixWorld(true);
    const byType = new Map<string, Placed[]>();
    for (const p of this.placed) byType.set(p.type, [...(byType.get(p.type) ?? []), p]);
    for (const [type, list] of byType) {
      const node = gltf.scene.getObjectByName(type);
      if (!node) continue;
      const parts: Mesh[] = [];
      node.traverse((o) => o instanceof Mesh && parts.push(o));
      const ims = parts.map((part) => {
        // Tinted copy so scenery matches the planet.
        const m = (part.material as MeshStandardMaterial).clone();
        m.color.multiply(this.tint);
        part.material = m;
        weather(m, 1);
        fog(m);
        const im = new InstancedMesh(part.geometry, part.material, list.length);
        // Parts keep their offset inside the doodad.
        const local = part.matrixWorld.clone().premultiply(new Matrix4().copy(node.matrixWorld).invert());
        list.forEach((p, i) => im.setMatrixAt(i, p.matrix.clone().multiply(local)));
        im.castShadow = true;
        im.receiveShadow = true;
        this.root.add(im);
        return im;
      });
      this.meshes.set(type, ims);
    }
    scene.add(this.root);
  }

  /** Hides scenery under a new building's footprint. */
  hideUnder(tx: number, ty: number, size: number): void {
    const zero = new Matrix4().makeScale(0, 0, 0);
    const counters = new Map<string, number>();
    for (const p of this.placed) {
      const i = counters.get(p.type) ?? 0;
      counters.set(p.type, i + 1);
      if (p.tx < tx - 1 || p.ty < ty - 1 || p.tx > tx + size || p.ty > ty + size) continue;
      for (const im of this.meshes.get(p.type) ?? []) {
        im.setMatrixAt(i, zero);
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
