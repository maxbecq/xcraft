import {
  AdditiveBlending, Box3, CanvasTexture, Color, PlaneGeometry, BoxGeometry, CapsuleGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, RingGeometry, SphereGeometry, type BufferGeometry, type Material, type Scene, type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { graffiti, rimLight, weather } from './weathering';
import { type GameMap, heightAt } from '../map';
import { FP, ticks } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

export const TEAM_COLORS = [0x3a7bd5, 0xc8402f];
/** Turning speed of units, in radians per second. */
const TURN_SPEED = 9;

/** Turns angle `from` towards `to` by at most `max`, the short way round. */
function turnToward(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}
/** Blender models for mineral fields; the renderer picks one per field. */
export const MINERAL_VARIANTS = ['minerai', 'minerai_1', 'minerai_2', 'minerai_3'];
const UNIT_SCALE = 1.65;

const mat = (color: number, extra: MeshStandardMaterialParameters = {}) => new MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const teamMaterials = TEAM_COLORS.map((c) => mat(c, { roughness: 0.6 }));
/** Team colour for Blender models, keeping their hand-painted vertex colours. */
// Team colour glows a little, so armies read at a glance.
const teamPainted = TEAM_COLORS.map((c) => mat(c, { roughness: 0.5, vertexColors: true, emissive: new Color(c).multiplyScalar(0.18) }));
teamPainted.forEach((m) => {
  weather(m, 0.8);
  rimLight(m, 0.4);
});

const tagMaterials = new Map<Texture, MeshStandardMaterial>();
/** Graffiti on a wall: transparent, drawn just in front of it. */
function tagMaterial(map: Texture): MeshStandardMaterial {
  let m = tagMaterials.get(map);
  if (!m) {
    m = new MeshStandardMaterial({ map, transparent: true, alphaTest: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.9 });
    tagMaterials.set(map, m);
  }
  return m;
}
const neutral = mat(0x9a8f7a);
const skin = mat(0xd9b48f);
const steel = mat(0x8c949c, { metalness: 0.6, roughness: 0.4 });
const stone = mat(0xb9ae94);
const darkStone = mat(0x7d7464);
const wood = mat(0x7a5634);
const crystal = mat(0x56c8ff, { emissive: 0x0f4d80, roughness: 0.25, metalness: 0.1 });
const wellGlow = mat(0x9b5cff, { emissive: 0x5a20c0, roughness: 0.3 });
const ring = (color: number, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending });
const RINGS = {
  own: [ring(0x4dff6a, 0.95), ring(0x4dff6a, 0.22)],
  enemy: [ring(0xff4a3a, 0.95), ring(0xff4a3a, 0.22)],
  neutral: [ring(0xffe27a, 0.95), ring(0xffe27a, 0.22)],
};
const scaffoldMaterial = new LineBasicMaterial({ color: 0xd9a420 });

/** Pools of light on the ground around glowing things: [x, z offset, radius, colour]. */
const POOLS: Record<string, [number, number, number, number][]> = {
  conseil: [[0.2, 1.9, 1.7, 0xffa040], [-1.4, 2.0, 0.9, 0xff7020]],
  caserne: [[0, 1.6, 1.3, 0xffb050]],
  grenier: [[0, 1.0, 0.8, 0xffc070]],
  mine: [[1.0, -0.9, 1.0, 0xff8030], [0.3, 0.6, 1.0, 0xb060ff]],
  obelisque: [[0, 0, 3.2, 0x40d8ff]],
  emetteur: [[0, 0, 1.6, 0x40d8ff]],
  reservepsy: [[0, 0, 1.5, 0xb070ff]],
  portail: [[0, 0.4, 1.8, 0x40d8ff]],
  recepteur: [[0, 0, 1.6, 0xb070ff]],
  minerai: [[0, 0, 1.0, 0x3aa8ff]],
  puits: [[0, 0, 2.4, 0xb060ff]],
};
let poolTexture: Texture | null = null;
function pool(radius: number, color: number): Mesh {
  if (!poolTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    poolTexture = new CanvasTexture(c);
  }
  const m = new Mesh(
    new PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({ map: poolTexture, color, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false }),
  );
  m.renderOrder = 1;
  return m;
}

/** Models built by tools/blender/models.py, by entity type. */
const templates = new Map<string, Group>();

/** Loads the Blender models; types without one keep their placeholder. */
export async function loadModels(types: string[]): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(
    types.map(async (type) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}.glb`);
        // Rust, damp and grime: heavy on buildings, light on soldiers, none on crystals.
        // Isdaris technology stays almost pristine.
        const d = DEFS[type];
        const isdaris = !!d && 'faction' in d && d.faction === 'isdaris';
        const amount = type.startsWith('minerai') || type === 'puits' ? 0 : (d?.kind === 'unit' ? 0.35 : 1) * (isdaris ? 0.15 : 1);
        if (amount) gltf.scene.traverse((o) => o instanceof Mesh && weather(o.material as Material, amount));
        // Bright silhouette edges on everything but crystals, stronger on units.
        if (!type.startsWith('minerai')) gltf.scene.traverse((o) => o instanceof Mesh && rimLight(o.material as Material, d?.kind === 'unit' ? 0.45 : 0.22));
        templates.set(type, gltf.scene);
      } catch {
        // keep the placeholder
      }
    }),
  );
}

/** A copy of a Blender model; `seed` picks its graffiti. */
function model(type: string, team: Material, seed = 0): Group {
  const t = templates.get(type);
  if (!t) return placeholder(type, team);
  const g = t.clone(true);
  let tagIndex = 0;
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const name = (o.material as Material).name;
    if (name === 'team') o.material = o.geometry.getAttribute('color') ? (teamPainted[teamMaterials.indexOf(team as MeshStandardMaterial)] ?? team) : team;
    if (name === 'tag') {
      const tags = graffiti();
      o.material = tagMaterial(tags[(seed * 7 + tagIndex++) % tags.length]);
      o.castShadow = false;
    }
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
  ring: Object3D;
  scaffold?: Object3D;
  /** Light pools on the ground, lit once the building stands. */
  pools?: Object3D;
  heading: number;
  /** Direction the unit wants to face; `heading` turns towards it. */
  target: number;
  cargo?: Object3D;
  /** Enemy buildings stay on screen once spotted. */
  seen: boolean;
  unit: boolean;
  /** Animated parts from the Blender model, if any. */
  limbs: { legL?: Object3D; legR?: Object3D; armL?: Object3D; armR?: Object3D };
}

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  private readonly views = new Map<number, View>();
  private dying: { v: View; age: number; side: number }[] = [];
  private last = performance.now();

  /** Called when a building first appears (to clear scenery under it). */
  onBuilding: (e: Entity) => void = () => {};

  constructor(private readonly scene: Scene, private readonly map: GameMap) {}

  /** All entity roots, for picking; each carries its entity id in userData. */
  get roots(): Object3D[] {
    return [...this.views.values()].map((v) => v.root);
  }

  sync(world: World, alpha: number, selected: ReadonlySet<number>, player: number, sees: (e: Entity) => boolean): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    for (const [id, v] of this.views) {
      if (!world.entities.has(id)) {
        this.views.delete(id);
        // Fallen soldiers topple over and sink into the ground; buildings just go (they explode).
        if (v.unit && v.root.visible) {
          v.ring.visible = false;
          this.dying.push({ v, age: 0, side: id % 2 ? 1 : -1 });
        } else this.scene.remove(v.root);
      }
    }
    this.dying = this.dying.filter((d) => {
      d.age += dt;
      const f = Math.min(1, d.age / 0.45);
      d.v.model.rotation.z = d.side * (Math.PI / 2) * f * f;
      d.v.model.position.y = 0.12 * f - Math.max(0, d.age - 2.5) * 0.4;
      if (d.age < 4) return true;
      this.scene.remove(d.v.root);
      return false;
    });
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
      if (e.x !== e.px || e.y !== e.py) v.target = Math.atan2(e.x - e.px, e.y - e.py);
      if (e.def.kind === 'unit') v.heading = turnToward(v.heading, v.target, dt * TURN_SPEED);
      v.root.position.set(x, heightAt(this.map, x, z), z);
      v.ring.visible = selected.has(e.id);
      if (e.def.kind === 'unit') {
        v.model.rotation.y = v.heading;
        this.animate(v, e);
      }
      if (v.cargo) v.cargo.visible = e.carry > 0;
      if (e.type === 'minerai') {
        // Fields shrink as they are mined out.
        const body = v.model.children[0];
        body.scale.setScalar(body.userData.base * (0.5 + 0.5 * Math.min(1, e.amount / (e.def as { amount: number }).amount)));
      }
      if (e.def.kind === 'building') {
        const total = ticks((e.def as BuildingDef).buildTime);
        v.model.scale.y = e.buildLeft > 0 ? 0.15 + 0.85 * (1 - e.buildLeft / total) : 1;
        if (v.scaffold) v.scaffold.visible = e.buildLeft > 0;
        if (v.pools) v.pools.visible = e.buildLeft === 0;
      }
    }
  }

  /**
   * Walk cycle (legs, counter-swinging arms, bob, forward lean, sway), breathing when idle,
   * aiming and recoil for gunners, a full-body swing for melee. Everything is eased so poses never snap.
   */
  private animate(v: View, e: Entity): void {
    const t = performance.now() / 1000;
    const moving = e.x !== e.px || e.y !== e.py;
    const speed = (e.def as UnitDef).speed;
    const phase = t * speed * 4.2 + e.id;
    const a = (e.def as UnitDef).attack;
    const fighting = !!a && !moving && e.cooldown > 0 && (e.order?.kind === 'attack' || e.order?.kind === 'attackMove');
    const fired = fighting && a ? e.cooldown / ticks(a.cooldown) : 0;
    const melee = !!a && a.range < 1;
    const ease = (o: Object3D | undefined, axis: 'x' | 'y' | 'z', target: number, rate = 0.25) => {
      if (o) o.rotation[axis] += (target - o.rotation[axis]) * rate;
    };
    const step = moving ? Math.sin(phase) : 0;
    ease(v.limbs.legL, 'x', step * 0.75);
    ease(v.limbs.legR, 'x', -step * 0.75);
    ease(v.limbs.armL, 'x', fighting && !melee ? -0.9 : -step * 0.6);
    let armR = moving ? step * 0.35 : 0;
    if (fighting && !melee) armR = -0.8 - (fired > 0.8 ? (fired - 0.8) * 2 : 0); // shouldered weapon, kick on each shot
    if (melee && fighting) armR = fired > 0.7 ? -2.4 * (1 - fired) / 0.3 + 0.6 : -2.2 * fired; // wind up, then hack down
    ease(v.limbs.armR, 'x', armR, melee ? 0.45 : 0.25);
    const body = v.model.children[0];
    // Body: bounce twice per stride, lean into the walk, sway from side to side, breathe at rest.
    // Hovering robots float; walkers bounce with their stride.
    const hover = e.type === 'moissonneur' ? 0.12 + Math.sin(t * 2.5 + e.id) * 0.04 : 0;
    const bob = hover + (hover ? 0 : moving ? Math.abs(Math.sin(phase)) * 0.045 : Math.sin(t * 2 + e.id) * 0.008);
    v.model.position.y += (bob - v.model.position.y) * 0.4;
    ease(body, 'x', moving ? 0.14 : fighting && !melee ? 0.06 : 0, 0.15);
    ease(body, 'z', moving ? Math.sin(phase) * 0.05 : 0, 0.2);
    ease(body, 'y', melee && fighting ? (fired - 0.5) * 0.8 : 0, 0.3);
    const kick = fighting && !melee && fired > 0.8 ? (fired - 0.8) * 0.3 : 0;
    body.position.z += (-kick - body.position.z) * 0.5;
  }

  private create(e: Entity, player: number): View {
    if (e.def.kind === 'building') this.onBuilding(e);
    const root = new Group();
    root.userData.id = e.id;
    // Mineral fields use one of several crystal clusters, turned and sized at random (stable per field).
    const variant = e.type === 'minerai' ? MINERAL_VARIANTS[e.id % MINERAL_VARIANTS.length] : e.type;
    const body = model(variant, teamMaterials[e.owner] ?? neutral, e.id);
    if (e.type === 'minerai') {
      body.rotation.y = ((e.id * 2654435761) % 1000) / 1000 * Math.PI * 2;
      body.userData.base = 0.85 + ((e.id * 40503) % 100) / 330;
    }
    const pivot = new Group(); // animated wrapper, so the model keeps its own transform
    pivot.add(body);
    // Units are drawn larger than their collision size, as in classic RTS, to stay readable.
    if (e.def.kind === 'unit') body.scale.setScalar(UNIT_SCALE);
    root.add(pivot);
    // Selection: a bright ring with a soft halo outside it.
    const r = (e.radius / FP) * (e.def.kind === 'unit' ? 1.5 : 0.95);
    if ((e.def as { worker?: boolean }).worker && !pivot.getObjectByName('cargo')) {
      const cargo = new Mesh(new SphereGeometry(0.11, 6, 4), crystal);
      cargo.name = 'cargo';
      cargo.position.set(0, 0.62, -0.2);
      pivot.add(cargo);
    }
    const [core, halo] = e.owner === player ? RINGS.own : e.owner < 0 ? RINGS.neutral : RINGS.enemy;
    const ring = new Group();
    for (const [inner, outer, m] of [[r, r + 0.09, core], [r + 0.09, r + 0.3, halo]] as const) {
      const mesh = new Mesh(new RingGeometry(inner, outer, 48), m);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.06;
      mesh.renderOrder = 2;
      ring.add(mesh);
    }
    root.add(ring);
    let pools: Object3D | undefined;
    if (POOLS[e.type]) {
      pools = new Group();
      for (const [x, z, r, c] of POOLS[e.type]) {
        const p = pool(r, c);
        p.position.set(x, 0.05, z);
        pools.add(p);
      }
      root.add(pools);
    }
    let scaffold: Object3D | undefined;
    if (e.def.kind === 'building') {
      // Scaffolding shown while under construction.
      const size = new Box3().setFromObject(body).getSize(new Vector3());
      scaffold = new LineSegments(new EdgesGeometry(new BoxGeometry(size.x * 1.05, size.y * 1.02, size.z * 1.05, 3, 2, 3)), scaffoldMaterial);
      scaffold.position.y = (size.y * 1.02) / 2;
      root.add(scaffold);
    }
    this.scene.add(root);
    const facing = e.owner === 0 ? Math.PI * 0.25 : -Math.PI * 0.75;
    const v: View = { root, model: pivot, ring, scaffold, pools, heading: facing, target: facing, cargo: pivot.getObjectByName('cargo'), seen: false, unit: e.def.kind === 'unit',
      limbs: { legL: body.getObjectByName('leg_l'), legR: body.getObjectByName('leg_r'), armL: body.getObjectByName('arm_l'), armR: body.getObjectByName('arm_r') } };
    this.views.set(e.id, v);
    return v;
  }
}
