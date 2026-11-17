import { Color, InstancedMesh, Matrix4, Mesh, type MeshStandardMaterial, Object3D, Quaternion, type Scene, Vector3, type Material } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type GameMap, cutCorner, heightAt, tileAt } from '../map';
import { expansion } from '../sim/setup';
import { weather } from './weathering';
import type { World } from '../sim/world';

/** Scenery by context, as [doodad, chance per tile]. */
/** Dead city: street furniture lined up along the streets, low enough never to hide a unit. */
const KERB = ['techbox', 'billboard', 'vending', 'terminal', 'trash', 'crates', 'barrier'];
/** City props tall enough to hide a unit from the south-east camera: kept off the south and east edges. */
const TALL = ['streetlamp', 'billboard'];
/** Fixtures on the cliff walls the camera sees: doors, power boxes, exhaust ducts, little shops. */
const WALL = ['walldoor', 'wallpanel', 'wallpipe', 'shopfront'];
const URBAN = [...KERB, ...WALL, 'streetlamp', 'hovercar'];
/** Doodads that are plain stone. */
const STONES = ['rocks_a', 'rocks_b', 'pebbles'];
const CLIFF_FOOT: [string, number][] = [['rocks_a', 0.22], ['rocks_b', 0.1], ['pebbles', 0.18]];
/** Rocks along the top edge of cliffs, as on SC maps. */
const CLIFF_TOP: [string, number][] = [['rocks_a', 0.14], ['pebbles', 0.16], ['rocks_b', 0.04]];
const BORDER: [string, number][] = [['rocks_b', 0.12], ['dead_tree', 0.06], ['wreck', 0.03], ['rocks_a', 0.08]];
const OPEN: [string, number][] = [
  ['pebbles', 0.08], ['dry_bush', 0.06], ['bones', 0.008], ['tire_pile', 0.006], ['barrels', 0.006],
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
  private readonly city: boolean;

  constructor(private readonly map: GameMap, world: World, private readonly tint = new Color(1, 1, 1), private readonly greyStones = false, streets?: [number, number][][]) {
    this.city = !!streets;
    const keepClear = new Set<number>();
    const clear = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) keepClear.add(y * map.width + x);
    };
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource') clear(e.tx + 1, e.ty + 1, 3);
      if (e.def.kind === 'building' && e.def.dropoff) clear(e.tx + 2, e.ty + 2, 6);
    }
    for (const p of world.players) {
      const [tx, ty] = expansion(world, p.id);
      clear(tx + 2, ty + 2, 5);
    }
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.ramp[y * map.width + x]) clear(x, y, 2);

    if (streets) {
      this.lineStreets(streets, keepClear);
      return;
    }
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (keepClear.has(y * map.width + x) || cutCorner(map, x, y) >= 0 || map.chasm?.[y * map.width + x]) continue;
        const level = tileAt(map, x, y)!.level;
        const higher = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (tileAt(map, x + dx, y + dy)?.level ?? -1) > level);
        const lower = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => (tileAt(map, x + dx, y + dy)?.level ?? 99) < level);
        const border = x < 3 || y < 3 || x >= map.width - 3 || y >= map.height - 3;
        const table = higher ? CLIFF_FOOT : lower ? CLIFF_TOP : border ? BORDER : OPEN;
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

  /**
   * City: props in order along each street. A lamp every few metres on both kerbs (staggered), furniture between
   * them facing the road, now and then an abandoned car pulled up at the kerb. Nothing on another street's asphalt,
   * across a level change, on a ramp or base, nor stacked where two streets share a stretch.
   */
  private lineStreets(streets: [number, number][][], keepClear: Set<number>): void {
    const map = this.map;
    const STEP = 1.3; // metres between slots
    const KERB_OFF = 1.75; // asphalt is 2.6 wide
    const taken: [number, number][] = [];
    // Cliff walls facing the south-east camera (the higher tile north or west of this one); the rest are out of sight.
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        const i = ty * map.width + tx;
        if (keepClear.has(i) || map.chasm?.[i] || map.ramp[i] || cutCorner(map, tx, ty) >= 0) continue;
        const level = tileAt(map, tx, ty)!.level;
        for (const [ox, oz] of [[0, 1], [1, 0]]) {
          const j = (ty - oz) * map.width + tx - ox;
          const up = tileAt(map, tx - ox, ty - oz);
          if (!up || up.level <= level || map.ramp[j] || map.chasm?.[j] || cutCorner(map, tx - ox, ty - oz) >= 0) continue;
          const r = rand(tx, ty, 11 + ox);
          if (r > 0.45) continue;
          const type = WALL[Math.floor(rand(tx, ty, 13 + ox) * WALL.length)];
          const [x, z] = ox ? [tx + 0.04, ty + 0.5] : [tx + 0.5, ty + 0.04];
          taken.push([x + ox * 0.5, z + oz * 0.5]);
          // Height from the tile's middle: right at the wall the deck height blends into the level above.
          this.place(type, tx, ty, x, z, Math.atan2(ox, oz), heightAt(map, tx + 0.5, ty + 0.5));
        }
      }
    }
    const onRoad = (x: number, z: number) => streets.some((w) => w.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 1.45 ** 2));
    const free = (x: number, z: number, level: number) => {
      const tx = Math.floor(x);
      const ty = Math.floor(z);
      const t = tileAt(map, tx, ty);
      return !!t && t.level === level && !keepClear.has(ty * map.width + tx) && !map.chasm?.[ty * map.width + tx] && cutCorner(map, tx, ty) < 0 && !taken.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 1.1 ** 2);
    };
    streets.forEach((way, wi) => {
      let carry = 0;
      let slot = 0;
      for (let i = 0; i < way.length - 1; i++) {
        const [x0, z0] = way[i];
        const [x1, z1] = way[i + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (!len) continue;
        const [dx, dz] = [(x1 - x0) / len, (z1 - z0) / len];
        for (let d = carry; d < len; d += STEP, slot++) {
          const [cx, cz] = [x0 + dx * d, z0 + dz * d];
          const level = tileAt(map, Math.floor(cx), Math.floor(cz))?.level ?? -1;
          for (const side of [-1, 1]) {
            const [nx, nz] = [-dz * side, dx * side]; // outward, away from the road
            const r = rand(slot, wi * 2 + (side + 1) / 2, 7);
            const lamp = (slot + (side > 0 ? 3 : 0)) % 6 === 0;
            const car = !lamp && r < 0.05;
            const type = lamp ? 'streetlamp' : car ? 'hovercar' : r < 0.3 ? KERB[Math.floor(rand(slot, wi, side + 9) * KERB.length)] : '';
            if (!type) continue;
            const off = car ? 1.1 : KERB_OFF + (lamp ? 0 : 0.35);
            const [x, z] = [cx + nx * off, cz + nz * off];
            if (!free(x, z, level) || (!car && onRoad(x, z))) continue;
            if (TALL.includes(type) && (x >= map.width - 4 || z >= map.height - 4)) continue;
            // Yaw so the lamp arm (+x) leans over the road, fronts (+z) face it, and cars lie along it.
            const yaw = car ? Math.atan2(-dz, dx) : type === 'streetlamp' ? Math.atan2(nz, -nx) : Math.atan2(-nx, -nz);
            taken.push([x, z]);
            this.place(type, Math.floor(x), Math.floor(z), x, z, yaw);
          }
        }
        carry = (carry - len) % STEP;
        if (carry < 0) carry += STEP;
      }
    });
  }

  private place(type: string, tx: number, ty: number, px?: number, pz?: number, yaw?: number, py?: number): void {
    const x = px ?? tx + 0.5 + (rand(tx, ty, 2) - 0.5) * 0.6;
    const z = pz ?? ty + 0.5 + (rand(tx, ty, 3) - 0.5) * 0.6;
    const s = yaw === undefined ? 0.8 + rand(tx, ty, 4) * 0.5 : 1;
    const m = new Matrix4().compose(
      new Vector3(x, (py ?? heightAt(this.map, x, z)) - 0.02, z),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw ?? rand(tx, ty, 5) * Math.PI * 2),
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
      // The Moon (grey stones): nothing but stones, no plants, wrecks or scrap.
      if (!node || (this.greyStones && !STONES.includes(type)) || (this.city && !URBAN.includes(type))) continue;
      const parts: Mesh[] = [];
      node.traverse((o) => o instanceof Mesh && parts.push(o));
      const ims = parts.map((part) => {
        // Tinted copy so scenery matches the planet.
        const m = (part.material as MeshStandardMaterial).clone();
        m.color.multiply(this.tint);
        part.material = m;
        if (this.greyStones && STONES.includes(type)) {
          // Grey rock (the Moon): no hue left in the colour nor the painted vertices, and no rust.
          const grey = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
          m.color.setScalar(grey(m.color.r, m.color.g, m.color.b) * 1.15);
          const col = part.geometry.getAttribute('color');
          if (col) {
            part.geometry = part.geometry.clone();
            const c = part.geometry.getAttribute('color');
            for (let i = 0; i < c.count; i++) {
              const v = grey(c.getX(i), c.getY(i), c.getZ(i));
              c.setXYZ(i, v, v, v);
            }
          }
        } else weather(m, 1);
        fog(m);
        const im = new InstancedMesh(part.geometry, part.material, list.length);
        // Parts keep their offset inside the doodad (whose origin is the file origin).
        const local = part.matrixWorld.clone(); // the doodad node sits at its first part: keep that offset too
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
