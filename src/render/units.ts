import {
  BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, RingGeometry, type BufferGeometry, type Scene,
} from 'three';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

export const TEAM_COLORS = [0x3a7bd5, 0xc8402f];

const teamMaterials = TEAM_COLORS.map((c) => new MeshStandardMaterial({ color: c, roughness: 0.6 }));
const neutral = new MeshStandardMaterial({ color: 0x9a8f7a, roughness: 0.9 });
const skin = new MeshStandardMaterial({ color: 0xd9b48f, roughness: 0.8 });
const steel = new MeshStandardMaterial({ color: 0x8c949c, metalness: 0.6, roughness: 0.4 });
const ringMaterial = new MeshBasicMaterial({ color: 0x55ff66, transparent: true, opacity: 0.85 });
const enemyRingMaterial = new MeshBasicMaterial({ color: 0xff5544, transparent: true, opacity: 0.85 });

/** Placeholder models, until the Blender pipeline provides real ones. */
function placeholder(type: string, team: MeshStandardMaterial): Object3D {
  const g = new Group();
  const add = (geo: BufferGeometry, mat: MeshStandardMaterial, x: number, y: number, z: number) => {
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  const body = (h: number) => add(new CapsuleGeometry(0.2, h, 4, 8), team, 0, 0.2 + h / 2, 0);
  const head = (y: number) => add(new BoxGeometry(0.18, 0.18, 0.18), skin, 0, y, 0);
  switch (type) {
    case 'serf':
      body(0.25);
      head(0.62);
      add(new BoxGeometry(0.06, 0.06, 0.4), neutral, 0.2, 0.4, 0.15); // tool
      break;
    case 'auxiliaire':
      body(0.35);
      head(0.72);
      add(new CylinderGeometry(0.035, 0.035, 0.6), steel, 0.18, 0.45, 0.2).rotation.x = Math.PI / 2;
      break;
    case 'legionnaire':
      add(new CapsuleGeometry(0.25, 0.35, 4, 8), team, 0, 0.42, 0);
      head(0.8);
      add(new CylinderGeometry(0.22, 0.22, 0.04, 12), steel, 0.25, 0.45, 0.2).rotation.z = Math.PI / 2; // saw
      break;
    case 'soigneur':
      body(0.3);
      add(new ConeGeometry(0.14, 0.2, 8), skin, 0, 0.72, 0);
      add(new BoxGeometry(0.25, 0.06, 0.06), steel, 0, 0.45, 0.22); // crossbow
      break;
    default:
      body(0.3);
  }
  return g;
}

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  private readonly objects = new Map<number, { root: Object3D; ring: Mesh; heading: number }>();

  constructor(private readonly scene: Scene, private readonly map: GameMap) {}

  sync(world: World, alpha: number, selected: ReadonlySet<number>, player: number): void {
    for (const [id, o] of this.objects) {
      if (!world.entities.has(id)) {
        this.scene.remove(o.root);
        this.objects.delete(id);
      }
    }
    for (const e of world.entities.values()) {
      let o = this.objects.get(e.id);
      if (!o) o = this.create(e, player);
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      if (e.x !== e.px || e.y !== e.py) o.heading = Math.atan2(e.x - e.px, e.y - e.py);
      o.root.position.set(x, heightAt(this.map, x, z), z);
      o.root.children[0].rotation.y = o.heading;
      o.ring.visible = selected.has(e.id);
    }
  }

  private create(e: Entity, player: number) {
    const root = new Group();
    const model = placeholder(e.type, teamMaterials[e.owner] ?? (neutral as MeshStandardMaterial));
    root.add(model);
    const r = e.radius / FP;
    const ring = new Mesh(new RingGeometry(r * 1.15, r * 1.4, 32), e.owner === player ? ringMaterial : enemyRingMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    root.add(ring);
    this.scene.add(root);
    const o = { root, ring, heading: e.owner === 0 ? Math.PI * 0.25 : -Math.PI * 0.75 };
    this.objects.set(e.id, o);
    return o;
  }
}
