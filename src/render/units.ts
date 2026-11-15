import {
  BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, RingGeometry, SphereGeometry, type BufferGeometry, type Material, type Scene,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP, ticks } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

export const TEAM_COLORS = [0x3a7bd5, 0xc8402f];
const UNIT_SCALE = 1.35;

const mat = (color: number, extra: MeshStandardMaterialParameters = {}) => new MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const teamMaterials = TEAM_COLORS.map((c) => mat(c, { roughness: 0.6 }));
const neutral = mat(0x9a8f7a);
const skin = mat(0xd9b48f);
const steel = mat(0x8c949c, { metalness: 0.6, roughness: 0.4 });
const stone = mat(0xb9ae94);
const darkStone = mat(0x7d7464);
const wood = mat(0x7a5634);
const crystal = mat(0x56c8ff, { emissive: 0x0f4d80, roughness: 0.25, metalness: 0.1 });
const wellGlow = mat(0x9b5cff, { emissive: 0x5a20c0, roughness: 0.3 });
const ringMaterial = new MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.85 });
const enemyRingMaterial = new MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.85 });
const neutralRingMaterial = new MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0.85 });

/** Models built by tools/blender/models.py, by entity type. */
const templates = new Map<string, Group>();

/** Loads the Blender models; types without one keep their placeholder. */
export async function loadModels(types: string[]): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    types.map(async (type) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}.glb`);
        templates.set(type, gltf.scene);
      } catch {
        // keep the placeholder
      }
    }),
  );
}

function model(type: string, team: Material): Group {
  const t = templates.get(type);
  if (!t) return placeholder(type, team);
  const g = t.clone(true);
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if ((o.material as Material).name === 'team') o.material = team;
  });
  return g;
}

/** Fallback models, used when a Blender model is missing. Units face +Z. */
function placeholder(type: string, team: Material): Group {
  const g = new Group();
  const add = (geo: BufferGeometry, m: Material, x: number, y: number, z: number) => {
    const mesh = new Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const body = (h: number) => add(new CapsuleGeometry(0.2, h, 4, 8), team, 0, 0.2 + h / 2, 0);
  const head = (y: number) => add(new BoxGeometry(0.18, 0.18, 0.18), skin, 0, y, 0);
  switch (type) {
    case 'serf':
      body(0.25);
      head(0.62);
      add(new BoxGeometry(0.06, 0.06, 0.4), wood, 0.2, 0.4, 0.15);
      add(new SphereGeometry(0.12, 6, 4), crystal, 0, 0.55, -0.22).name = 'cargo';
      break;
    case 'auxiliaire':
      body(0.35);
      head(0.72);
      add(new CylinderGeometry(0.035, 0.035, 0.6), steel, 0.18, 0.45, 0.2).rotation.x = Math.PI / 2;
      break;
    case 'legionnaire':
      add(new CapsuleGeometry(0.25, 0.35, 4, 8), team, 0, 0.42, 0);
      head(0.8);
      add(new CylinderGeometry(0.22, 0.22, 0.04, 12), steel, 0.25, 0.45, 0.2).rotation.z = Math.PI / 2;
      break;
    case 'soigneur':
      body(0.3);
      add(new ConeGeometry(0.14, 0.2, 8), skin, 0, 0.72, 0);
      add(new BoxGeometry(0.25, 0.06, 0.06), steel, 0, 0.45, 0.22);
      break;
    case 'conseil': {
      add(new BoxGeometry(4.8, 0.4, 4.8), darkStone, 0, 0.2, 0);
      add(new BoxGeometry(3.6, 1.6, 3.6), stone, 0, 1.2, 0);
      const roof = add(new ConeGeometry(2.9, 1.4, 4), team, 0, 2.7, 0);
      roof.rotation.y = Math.PI / 4;
      for (const [x, z] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) add(new CylinderGeometry(0.18, 0.2, 2, 8), stone, x, 1.2, z);
      break;
    }
    case 'grenier':
      add(new CylinderGeometry(0.75, 0.85, 1.2, 12), wood, 0, 0.6, 0);
      add(new SphereGeometry(0.78, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), team, 0, 1.2, 0);
      break;
    case 'caserne':
      add(new BoxGeometry(2.8, 1.3, 2.8), stone, 0, 0.65, 0);
      for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) add(new BoxGeometry(0.5, 0.5, 0.5), darkStone, i * 1.15, 1.55, j * 1.15);
      add(new BoxGeometry(0.05, 1.2, 0.7), team, 0, 1.9, 0).position.x = 0.6;
      add(new CylinderGeometry(0.04, 0.04, 1.4), wood, 0.6, 1.9, -0.35);
      break;
    case 'mine':
      add(new CylinderGeometry(1.4, 1.5, 0.5, 16), darkStone, 0, 0.25, 0);
      add(new BoxGeometry(1.2, 2.2, 1.2), stone, 0, 1.3, 0);
      add(new BoxGeometry(1.3, 0.3, 1.3), team, 0, 2.5, 0);
      add(new CylinderGeometry(0.15, 0.15, 1.6), wellGlow, 0.9, 0.9, 0.5);
      break;
    case 'minerai':
      add(new ConeGeometry(0.28, 0.9, 5), crystal, -0.12, 0.45, 0.05);
      add(new ConeGeometry(0.22, 0.65, 5), crystal, 0.2, 0.32, -0.1).rotation.z = -0.3;
      add(new ConeGeometry(0.18, 0.5, 5), crystal, 0.05, 0.25, 0.25).rotation.x = 0.4;
      break;
    case 'puits':
      add(new CylinderGeometry(1.4, 1.5, 0.12, 20), darkStone, 0, 0.06, 0);
      add(new CylinderGeometry(0.8, 0.8, 0.14, 20), wellGlow, 0, 0.08, 0);
      break;
    default:
      body(0.3);
  }
  return g;
}

interface View {
  root: Object3D;
  model: Group;
  ring: Mesh;
  heading: number;
  cargo?: Object3D;
  /** Enemy buildings stay on screen once spotted. */
  seen: boolean;
}

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  private readonly views = new Map<number, View>();

  constructor(private readonly scene: Scene, private readonly map: GameMap) {}

  /** All entity roots, for picking; each carries its entity id in userData. */
  get roots(): Object3D[] {
    return [...this.views.values()].map((v) => v.root);
  }

  sync(world: World, alpha: number, selected: ReadonlySet<number>, player: number, sees: (e: Entity) => boolean): void {
    for (const [id, v] of this.views) {
      if (!world.entities.has(id)) {
        this.scene.remove(v.root);
        this.views.delete(id);
      }
    }
    for (const e of world.entities.values()) {
      const v = this.views.get(e.id) ?? this.create(e, player);
      if (e.owner >= 0 && e.owner !== player) {
        const now = sees(e);
        v.seen ||= now;
        v.root.visible = e.def.kind === 'unit' ? now : v.seen;
        if (!v.root.visible) continue;
      }
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      if (e.x !== e.px || e.y !== e.py) v.heading = Math.atan2(e.x - e.px, e.y - e.py);
      v.root.position.set(x, heightAt(this.map, x, z), z);
      v.ring.visible = selected.has(e.id);
      if (e.def.kind === 'unit') {
        v.model.rotation.y = v.heading;
        // Walking bob.
        const moving = e.x !== e.px || e.y !== e.py;
        v.model.position.y = moving ? Math.abs(Math.sin(performance.now() / 90 + e.id)) * 0.05 : 0;
      }
      if (v.cargo) v.cargo.visible = e.carry > 0;
      if (e.def.kind === 'building') {
        const total = ticks((e.def as BuildingDef).buildTime);
        v.model.scale.y = e.buildLeft > 0 ? 0.15 + 0.85 * (1 - e.buildLeft / total) : 1;
      }
    }
  }

  private create(e: Entity, player: number): View {
    const root = new Group();
    root.userData.id = e.id;
    const body = model(e.type, teamMaterials[e.owner] ?? neutral);
    const pivot = new Group(); // animated wrapper, so the model keeps its own transform
    pivot.add(body);
    // Units are drawn larger than their collision size, as in classic RTS, to stay readable.
    if (e.def.kind === 'unit') body.scale.setScalar(UNIT_SCALE);
    root.add(pivot);
    const r = e.radius / FP;
    if ((e.def as { worker?: boolean }).worker && !pivot.getObjectByName('cargo')) {
      const cargo = new Mesh(new SphereGeometry(0.11, 6, 4), crystal);
      cargo.name = 'cargo';
      cargo.position.set(0, 0.62, -0.2);
      pivot.add(cargo);
    }
    const ringMat = e.owner === player ? ringMaterial : e.owner < 0 ? neutralRingMaterial : enemyRingMaterial;
    const ring = new Mesh(new RingGeometry(r * 1.1, r * 1.1 + 0.08, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    root.add(ring);
    this.scene.add(root);
    const v: View = { root, model: pivot, ring, heading: e.owner === 0 ? Math.PI * 0.25 : -Math.PI * 0.75, cargo: pivot.getObjectByName('cargo'), seen: false };
    this.views.set(e.id, v);
    return v;
  }
}
