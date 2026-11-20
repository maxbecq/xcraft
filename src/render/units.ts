import { occluder, unxray, xrayable } from './xray';
import {
  AdditiveBlending, Box3, Matrix4, Plane, BufferAttribute, DoubleSide, CanvasTexture, BoxGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  Object3D, Raycaster, AnimationMixer, type AnimationClip, LoopOnce, SkinnedMesh, RingGeometry, SphereGeometry, BufferGeometry, type Material, type Scene, Points, PointsMaterial,
} from 'three';
import { stableShadowDepth } from './shadowdepth';
import { dressSprite, spriteOf } from './sprites';
import { type BuildingDef, DEFS, FLY_HEIGHT, LOOK_SCALE, LOOKS, type UnitDef, WEAPONS } from '../data';
import { armillaries } from './life';
import { type GameMap, heightAt } from '../map';
import { FP, GAME_SPEED, ticks } from '../sim/fixed';
import { type Entity, type World, soars } from '../sim/world';
import { TEAM_COLORS, MINERAL_VARIANTS, teamMaterials, veinTime, neutral, ore, templates, SHARED, free, owned, CHARACTERS, model, CLIP } from './models';
import { smoothstep, GAIT_SWING, gaitCycle, insectLegs, legRig, WALK_STRIDE, play, stepGait, walk, walkCrouch } from './gait';
import { ghost, type View, FLASH_S, hitTint, toCorpse, toGhost, fromGhost, unflash, dropCorpse, HALO_FADE, smooth, type Halo, makeHalo, dropHalo } from './views';
import { scaffoldMaterial, buildingSite, POOLS, PLAZAS, plaza, pool, contactShadow, podDock } from './sites';
import { dropTexture, spark, reserveFx, assimFx, forgeFx, wellFx, rallyFlag, animateRally } from './unitfx';

// Kept for main.ts, which imports them from here.

/** Turning speed of units, in radians per second. */
const TURN_SPEED = 9;

/** Turns angle `from` towards `to` by at most `max`, the short way round. */
function turnToward(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}
const UNIT_SCALE = 1.65;

const ring = (color: number, opacity: number) => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending });
const RINGS = {
  own: [ring(0x4dff6a, 0.95), ring(0x4dff6a, 0.22)],
  enemy: [ring(0xff4a3a, 0.95), ring(0xff4a3a, 0.22)],
  ally: [ring(0x5ad8ff, 0.95), ring(0x5ad8ff, 0.22)],
  neutral: [ring(0xffe27a, 0.95), ring(0xffe27a, 0.22)],
};
/** Graduation ticks around the selection ring (a compass dial), turning slowly. */
let tickTexture: CanvasTexture | null = null;
const tickMaterials = new Map<MeshBasicMaterial, MeshBasicMaterial>();
function dialMaterial(core: MeshBasicMaterial): MeshBasicMaterial {
  if (!tickTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const long = i % 6 === 0;
      g.lineWidth = long ? 5 : 3;
      g.globalAlpha = long ? 1 : 0.7;
      const r0 = long ? 100 : 108;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
      g.lineTo(128 + Math.cos(a) * 122, 128 + Math.sin(a) * 122);
      g.stroke();
    }
    tickTexture = new CanvasTexture(c);
  }
  let m = tickMaterials.get(core);
  if (!m) {
    m = new MeshBasicMaterial({ map: tickTexture, color: core.color, transparent: true, opacity: 0.5, depthWrite: false, blending: AdditiveBlending });
    tickMaterials.set(core, m);
  }
  return m;
}

/**
 * Selection ring radius (tiles) for squat buildings that fill their footprint: from the camera's low pitch the body
 * hides the back of a ring drawn hugging it, so the ring looks pushed toward the viewer; a wider one shows all round.
 */
const RING_RADIUS: Record<string, number> = { reservepsy: 1.4, trone: 2.5 };

/** Not drawn, but hit by the click raycast. */
const PICK_PROXY = new MeshBasicMaterial({ visible: false });
/** Height of the Z Plate-forme's deck, where the socles are built. */
const PLATFORM_DECK = 0.37;
/**
 * Z socle weapons: one module per weapon, public/models/zw_<weapon>.glb, the same on every socle; a socle built
 * without a weapon carries the free default machine gun. The nine weapons are Rodin Low Poly models (fal), made from
 * the chosen boards and normalised by concepts-z/normweapon.py; the machine gun is a Blender stand-in
 * (tools/blender/models.py). Convention for a module, and for any model replacing one: centred over its origin, its
 * base on the ground plane, 0.9 across at its widest, pointing glTF +Z. A replacement that comes out turned or sized
 * otherwise is set right in WEAPON_TUNE, the code needing nothing else.
 */
export const WEAPON_MODELS = [...Object.keys(WEAPONS), 'mitrailleuse'].map((k) => `zw_${k}`);
/** Buildings that buy a weapon carry it on a mount of their own (tools/blender/models.py zsupport_<type>): built 1
 * across for the building's width, its origin on the roof, the weapon on its plate `top` higher. */
const ZSUPPORTS: Record<string, { model: string; top: number }> = {
  assimilateur: { model: 'zsupport_assimilateur', top: 0.068 },
  tourelle: { model: 'zsupport_tourelle', top: 0.085 },
};
WEAPON_MODELS.push(...Object.values(ZSUPPORTS).map((s) => s.model));
/** Per socle: how wide its module is against the body's own width, and how far forward of the back's centre it sits. */
const WEAPON_MOUNTS: Record<
  string,
  { size?: number; forward?: number; apex?: boolean; meleeSize?: number; saw?: number; grow?: Record<string, number>; sink?: Record<string, number> }
> = {
  // Its modules sank onto its back where they stood on its ridge (module units), the Jet sonique a little smaller.
  mastodonte: { size: 0.5, grow: { zw_jetsonique: 0.85 }, sink: { zw_laser: 0.08, zw_arc: 0.12 } },
  // Its modules at the Quadripode's proportion to its body (the Déchiqueteur aside: its rule is still open).
  coleoptere: { grow: { '*': 0.7 }, sink: { zw_arc: 0.07 } },
  // The Déchiqueteur in the same proportion to its body as the Quadripode's; the other modules larger (the rocket pod
  // most), towards the front of its long back.
  octopode: { size: 0.5, meleeSize: 0.7, forward: 0.08, grow: { '*': 1.3, zw_roquettes: 1.5 } },
  hexapode: { saw: 1.22, grow: { '*': 1.18, zw_jetsonique: 1, zw_reparateur: 1 } },
  // Buildings: a turret on the roof, not a module the width of the whole building.
  // Centred on its dome's axis: its bounding box takes in the capsules on its sides.
  assimilateur: { size: 0.4, apex: true },
  tourelle: { size: 0.6 },
};
/** Melee modules: on a walker's head, their arm reaching down in front of it (see mount). */
const MELEE = new Set(['zw_dechiqueteur']);
/** The Déchiqueteur's saw on a walker: its radius as modelled (module units), and how much larger it is drawn. */
const SAW_RADIUS = 0.14;
const SAW_GROWTH = 2;
/** Per module, after import: a turn about the vertical (radians) and a scale, for a model that is not to the convention. */
const WEAPON_TUNE: Record<string, { yaw?: number; scale?: number }> = {};
/** The weapon module an entity shows: its kit, the default gun for an unarmed socle, none for an unarmed building. */
function weaponModule(e: Entity): string {
  if (e.type === 'dronecombat') return 'zw_mitrailleuse'; // its one gun, a module like the others: no socle keeps a built-in one
  if (!(e.def as { weapons?: string[] }).weapons) return '';
  if (e.kit) return `zw_${e.kit}`;
  return e.def.kind === 'unit' ? 'zw_mitrailleuse' : '';
}

/** Buildings seated into the ground (how far they sink, in tiles): the Z headquarters looked set down on the sand. */
const SEATED: Record<string, number> = { intelligence: 0.08, supreme: 0.08 };
/** Seconds a Z drone takes to scuttle to the centre of the site it raised. */
const DEPLOY_WALK = 0.6;
/** Seconds it takes to settle and spread its legs into a base. */
const DEPLOY_SPREAD = 1.2;

/** How far a ground ring may rise above its unit's feet to clear a ramp or a dune round it (world units). */
const RING_RISE = 0.35;
/** Ground this much higher than the owner's feet is a cliff, not a slope: the ring does not climb to it (it would
 * float in mid-air, as by a building at a cliff's foot); the wall hides the part of the ring behind it. */
const RING_CLIFF = 0.6;

/** Soldiers whose death clip ends kneeling or hunched: they are tipped onto their back as they fall. */
const FALL_FLAT = new Map([['soigneur', 1], ['alchimiste', -1], ['belluaire', -1], ['discobole', 1], ['assassin', 1]]); // which way: +1 face down, -1 on the back
/** A death burst's material: sparks for a machine, dark drops for the living. */
function burstMaterial(mechanical: boolean): PointsMaterial {
  return mechanical
    ? new PointsMaterial({ map: spark(), size: 9, sizeAttenuation: false, color: 0xffc070, transparent: true, depthWrite: false, blending: AdditiveBlending })
    : new PointsMaterial({ map: dropTexture(), size: 8, sizeAttenuation: false, transparent: true, depthWrite: false, alphaTest: 0.3 });
}

/** Kept, never disposed: while they stand, so do the death bursts' two shader programs (see burstSamples). */
const BURST_KEEP: PointsMaterial[] = [];

/**
 * A point of each kind of death burst at `at`, for the warm-up to draw (render/prewarm.ts): the first unit to die
 * compiled both programs mid-game, a small freeze. Their materials are kept for good, so the programs are never let
 * go either (each burst disposes its own material when it fades, which freed them after a quiet spell).
 */
export function burstSamples(at: Vector3): Points[] {
  return [false, true].map((mechanical) => {
    const m = burstMaterial(mechanical);
    BURST_KEEP.push(m);
    const p = new Points(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([at.x, at.y, at.z]), 3)), m);
    p.userData.noPick = true;
    return p;
  });
}

/** How long a unit takes to fall when it dies, and its death burst lasts (s). */
const DIE_S = 0.3;
const BURST_S = 0.4;

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  /**
   * Whether a ground point (tiles) is in view or near it: off screen, skeletons wait. Animating every unit of the
   * map, seen or not, cost a share of the frame and the most garbage left (about 10 MB a second in a fight).
   */
  inView: (x: number, z: number) => boolean = () => true;
  /** The building wearing the hover halo, and the one whose halo is fading out (see glow). */
  private halo: Halo | null = null;
  private fading: Halo | null = null;
  private glowAt = 0;
  private readonly views = new Map<number, View>();
  private dying: { v: View; age: number; side: number }[] = [];
  /** Death bursts: a few dark drops for the living, sparks for machines. */
  private bursts: { pts: Points; vel: Float32Array; age: number }[] = [];
  /** Z drones merging into the building they raised. */
  private merging: { v: View; age: number; building: number; from: Vector3; to: Vector3 }[] = [];
  private last = performance.now();

  /** Called when a building first appears (to clear scenery under it). */
  onBuilding: (e: Entity) => void = () => {};

  /** Whether two players are at war (set from the world at each sync). */
  private hostile = (a: number, b: number) => a !== b;

  constructor(private readonly scene: Scene, private readonly map: GameMap) {}

  /** A view gone for good: what it allocated for itself (not what it shares with the models) is freed. */
  /** A view's model size, measured once (the tower a Pod's gantry reaches); undefined while it has no view yet. */
  private measure(id: number): Vector3 | undefined {
    const m = this.views.get(id)?.model;
    if (!m) return undefined;
    const box = new Box3().setFromObject(m.children[0] ?? m, true);
    return (m.userData.size = box.getSize(new Vector3()));
  }

  /** Height of the top of a view's model in the world (its full height, measured once, above where it stands);
   * undefined while it has no view yet. The overlay hangs a building's health bar just above it. */
  /** Where a Z Plate-forme's welding torch ends (world), for its sparks; none if its model has no cut-out arm. */
  /** Where a unit's or building's weapon module has its muzzle (world); none if it shows none. */
  muzzle(id: number): Vector3 | undefined {
    const w = this.views.get(id)?.weapon;
    return w?.mod && w.tip ? w.mod.localToWorld(w.tip.clone()) : undefined;
  }

  weld(id: number): Vector3 | undefined {
    return this.views.get(id)?.model.getObjectByName('zarm_0_weld')?.getWorldPosition(new Vector3());
  }

  top(id: number, built = true): number | undefined {
    const v = this.views.get(id);
    if (!v) return undefined;
    let h = v.model.userData.top as number | undefined;
    if (h === undefined) {
      v.root.updateWorldMatrix(true, true);
      h = new Box3().setFromObject(v.model, true).max.y - v.root.position.y;
      // Kept once built only: a building site's model is still rising (kept then, the bar stayed at its foot).
      if (built) v.model.userData.top = h;
    }
    return v.root.position.y + h;
  }

  /**
   * Takes every view off the scene, freeing geometry and skeletons but not materials: a throwaway renderer's, made only
   * to compile each type's programs (main.ts compileScene), which must outlive it for the real views to come.
   */
  clear(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      v.root.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry && !SHARED.has(m.geometry)) m.geometry.dispose();
        const skeleton = (o as SkinnedMesh).isSkinnedMesh ? (o as SkinnedMesh).skeleton : undefined;
        if (skeleton && !SHARED.has(skeleton)) skeleton.dispose();
      });
    }
    this.views.clear();
  }

  /**
   * Puts weapon module `name` on a socle's back ('' takes it off): found by a ray dropped on the body's centre (legs,
   * fans and the pick box left out), sized against the body's width, on the body so it walks, leans, grows and falls with it.
   */
  private mount(v: View, e: Entity, name: string): void {
    if (v.weapon) {
      v.weapon.o.removeFromParent();
      free(v.weapon.o);
      v.weapon = undefined;
    }
    if (!name || !templates.has(name)) return;
    const body = v.model.children[0];
    const parts: Object3D[] = [];
    // The model only: not its effects (the Assimilateur's bubbles and glow stand above its roof).
    const fx = new Set<Object3D>();
    v.fx?.group.traverse((o) => fx.add(o));
    body.traverse((o) => {
      if ((o as Mesh).isMesh && !fx.has(o) && !/^z(leg|shin|rotor|wheel)_/.test(o.name) && !/^z(leg|shin|rotor|wheel)_/.test(o.parent?.name ?? '')) parts.push(o);
    });
    v.root.updateMatrixWorld(true);
    // Measured in the body's own frame (glTF +Z forward), whatever way the unit faces.
    const toBody = body.matrixWorld.clone().invert();
    const box = new Box3();
    const points: Vector3[] = [];
    for (const o of parts) {
      const m = o as Mesh;
      const local = new Matrix4().multiplyMatrices(toBody, m.matrixWorld);
      for (let i = 0; i < m.geometry.getAttribute('position').count; i++) points.push(m.getVertexPosition(i, new Vector3()).applyMatrix4(local));
    }
    box.setFromPoints(points);
    const centre = box.getCenter(new Vector3());
    const tune = WEAPON_MOUNTS[e.type] ?? {};
    if (tune.apex) {
      // The middle of its highest points: the top of the dome.
      const high = points.filter((p) => p.y > box.max.y - 0.03 * (box.max.y - box.min.y));
      centre.x = high.reduce((sum, p) => sum + p.x, 0) / high.length;
      centre.z = high.reduce((sum, p) => sum + p.z, 0) / high.length;
    }
    const size = box.getSize(new Vector3());
    const bodyScale = body.getWorldScale(new Vector3()).x;
    const across = Math.min(size.x, size.z) * bodyScale;
    const fit = WEAPON_TUNE[name] ?? {};
    // A walker's melee module sits on its head, its arm reaching down in front of it (see below).
    const melee = MELEE.has(name) && e.def.kind === 'unit' && !ZSUPPORTS[e.type];
    // `grow`: how much larger than `size` a socle draws each module (the melee one keeps its own size).
    const grow = melee ? 1 : (tune.grow?.[name] ?? tune.grow?.['*'] ?? 1);
    const scale = ((((melee ? tune.meleeSize : undefined) ?? tune.size ?? 0.7) * grow * across) / 0.64 / bodyScale) * (fit.scale ?? 1);
    const spot = new Vector3(centre.x, 0, melee ? box.max.z - 0.2 * scale : centre.z + (tune.forward ?? 0) * size.z);
    // On the highest of the rays dropped round its foot: on a mounting ring's rim, not down its hole.
    const down = new Vector3(0, -1, 0).transformDirection(body.matrixWorld);
    let top = -Infinity;
    for (let k = 0; k <= 8; k++) {
      const a = (k * Math.PI) / 4;
      const r = k ? (melee ? 0.1 : 0.25) * scale : 0;
      const from = body.localToWorld(new Vector3(spot.x + r * Math.cos(a), box.max.y + 1, spot.z + r * Math.sin(a)));
      const hit = new Raycaster(from, down).intersectObjects(parts, false)[0];
      if (hit) top = Math.max(top, body.worldToLocal(hit.point.clone()).y);
    }
    const at = body.localToWorld(spot.setY(top > -Infinity ? top : box.max.y));
    let o: Object3D = model(name, teamMaterials[e.owner] ?? teamMaterials[0]);
    // Its muzzle, in its own frame: the middle of its front, halfway up (the Lance-flammes' jet starts there).
    const mod = o;
    const own = new Box3().setFromObject(mod, true);
    const tip = new Vector3((own.min.x + own.max.x) / 2, (own.min.y + own.max.y) / 2, own.max.z);
    // In the body's frame (which faces glTF +Z, as the module does): it follows its heading, gait, lean, tier and fall.
    o.rotation.y = fit.yaw ?? 0;
    const support = ZSUPPORTS[e.type];
    if (support && templates.has(support.model)) {
      // On the building's mount: the weapon is the mount's child, at its plate.
      const holder = model(support.model, teamMaterials[e.owner] ?? teamMaterials[0]);
      holder.position.copy(body.worldToLocal(at.clone()));
      holder.scale.setScalar(across / bodyScale);
      o.position.set(0, support.top, 0);
      o.scale.setScalar((scale * bodyScale) / across);
      holder.add(o);
      o = holder;
    } else {
      o.position.copy(body.worldToLocal(at.clone()));
      o.position.y -= (tune.sink?.[name] ?? 0) * scale;
      o.scale.setScalar(scale);
    }
    o.traverse((m) => (m.userData.noPick = true));
    body.add(o);
    delete v.model.userData.top; // the health bar goes above the weapon (see top)
    // The Déchiqueteur's moving parts (concepts-z/splitsaw.py): its arm and the saw blade at its tip.
    const arm = o.getObjectByName('zw_arm');
    const saw = o.getObjectByName('zw_saw');
    let reach: number | undefined;
    if (melee && arm && saw) {
      // From the box on the head, the arm dives forwards and down so a saw twice its modelled size comes in front of the
      // head at the height of the front knees, where it can reach what it fights: the arm's length fitted to it, the saw
      // kept round.
      const growth = SAW_GROWTH * (tune.saw ?? 1);
      saw.scale.multiplyScalar(growth);
      const sawR = SAW_RADIUS * growth * scale;
      const knee = body.getObjectByName('zshin_0_l') ?? body.getObjectByName('zshin_0_r');
      const kneeY = knee ? body.worldToLocal(knee.getWorldPosition(new Vector3())).y : box.min.y + 0.3 * size.y;
      const target = new Vector3(centre.x, Math.max(kneeY, box.min.y + sawR), box.max.z + sawR + 0.03 * size.z).sub(o.position).divideScalar(scale).sub(arm.position);
      const tip = saw.position.clone();
      const k = Math.max(0.5, Math.sqrt(Math.max(1e-4, target.y * target.y + target.z * target.z - tip.y * tip.y)) / tip.z);
      for (const c of arm.children) if (c !== saw) [c.position.z, c.scale.z] = [c.position.z * k, c.scale.z * k];
      saw.position.z *= k;
      reach = Math.atan2(tip.y, tip.z * k) - Math.atan2(target.y, target.z);
    }
    v.weapon = { name, o, arm, saw, reach, mod, tip };
  }

  private release(v: View): void {
    free(v.root, [...(v.flash?.saved ?? []), ...(v.ghost ?? [])].map(([, m]) => m));
  }

  /** Ghosts of enemy buildings destroyed or changed out of sight: they stay, as last seen, until the place is seen. */
  private ghosts: View[] = [];

  /** All entity roots, for picking; each carries its entity id in userData. */
  get roots(): Object3D[] {
    return [...this.views.values()].map((v) => v.root);
  }

  /** The hover halo on this building (null: none); its pulse follows the clock. It fades in and out over HALO_FADE,
   * so moving from one building to the next fades the old one out while the new one comes in: two at most. */
  glow(id: number | null, now: number): void {
    const dt = Math.min(0.1, Math.max(0, (now - this.glowAt) / 1000));
    this.glowAt = now;
    const v = id === null ? undefined : this.views.get(id);
    const same = (h: Halo | null) => !!h && h.id === id && h.model === v?.model;
    if (this.halo && !same(this.halo)) {
      if (this.fading) dropHalo(this.fading);
      this.fading = this.halo;
      this.halo = null;
    }
    if (v && !this.halo) {
      // Back onto the one fading out: it comes back from where it was.
      if (same(this.fading)) [this.halo, this.fading] = [this.fading, null];
      else this.halo = makeHalo(id!, v.model);
    }
    // Gentle: between 0.7 and 1.3 of its strength, once a second.
    const pulse = 0.3 * (1 + 0.3 * Math.sin(now / 1000 * Math.PI * 2));
    const step = dt / HALO_FADE;
    if (this.halo) {
      this.halo.level = Math.min(1, this.halo.level + step);
      this.halo.strength.value = pulse * smooth(this.halo.level);
    }
    if (this.fading) {
      this.fading.level -= step;
      this.fading.strength.value = pulse * smooth(Math.max(0, this.fading.level));
      if (this.fading.level <= 0) {
        dropHalo(this.fading);
        this.fading = null;
      }
    }
  }

  sync(world: World, alpha: number, selected: ReadonlySet<number>, player: number, sees: (e: Entity) => boolean, seenAt: (x: number, y: number) => boolean): void {
    const now = performance.now();
    veinTime.value = now / 1000;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.syncRallyFlags(world, selected, player, now);
    this.ghosts = this.ghosts.filter((v) => {
      if (!seenAt(v.root.position.x * FP, v.root.position.z * FP)) return true;
      this.scene.remove(v.root);
      this.release(v);
      return false;
    });
    for (const [id, v] of this.views) {
      if (!world.entities.has(id)) {
        this.views.delete(id);
        if (v.ghost) {
          this.ghosts.push(v);
          continue;
        }
        // Fallen soldiers topple over and sink into the ground; buildings just go (they explode).
        const into = v.unit && [...world.entities.values()].find((b) => b.absorbed === id);
        if (into && v.root.visible) {
          // A Z drone merging into the building it raised: it folds and sinks into it, it does not die.
          v.ring.visible = false;
          this.merging.push({ v, age: 0, building: into.id, to: new Vector3(into.x / FP, heightAt(this.map, into.x / FP, into.y / FP), into.y / FP), from: v.root.position.clone() });
        } else if (v.unit && v.root.visible) {
          // Out of the fight at once: no ring, a quick fall (a quarter of a second), a dark corpse and a burst.
          v.ring.visible = false;
          const die = v.clips?.get(CLIP.die);
          if (v.mixer && die) {
            v.mixer.stopAllAction();
            die.reset().play();
            die.timeScale = die.getClip().duration / DIE_S;
            v.playing = die;
          }
          unflash(v);
          unxray(v.model);
          toCorpse(v.model);
          const d = DEFS[v.type] as UnitDef | undefined;
          this.burst(v.root.position.clone().setY(v.root.position.y + (v.model.position.y > 0.5 ? v.model.position.y : 0) + 0.5), !!d?.mechanical || d?.faction === 'z');
          this.dying.push({ v, age: 0, side: id % 2 ? 1 : -1 });
        } else {
          this.scene.remove(v.root);
          this.release(v);
        }
      }
    }
    this.merging = this.merging.filter((m) => {
      // A Z drone becomes the base of the building it raised: it scuttles to the site's centre, settles on
      // the ground and stretches its legs out flat to the footprint's corners as anchoring struts, and
      // stays there under the machine being fabricated until it is done (or destroyed).
      m.age += dt;
      const b = world.entities.get(m.building);
      if (!b || b.buildLeft === 0) {
        this.scene.remove(m.v.root);
        this.release(m.v);
        return false;
      }
      const walk = Math.min(1, m.age / DEPLOY_WALK);
      m.v.root.position.lerpVectors(m.from, m.to, walk * walk * (3 - 2 * walk));
      const legs = m.v.limbs.insect ?? [];
      // A drone without legs to fold (a static model) just walks over and settles.
      if (!m.v.gait) return true;
      if (walk < 1) {
        const ph = stepGait(m.v);
        for (const w of m.v.wheels ?? []) w.o.rotation.x = ph / w.r;
        for (const l of legs) {
          const q = ph + l.group * Math.PI;
          l.o.rotation.y = -l.side * Math.sin(q) * GAIT_SWING;
          l.o.rotation.z = l.side * Math.max(0, Math.cos(q)) * 0.4;
        }
        return true;
      }
      const k = smoothstep((m.age - DEPLOY_WALK) / DEPLOY_SPREAD);
      const g = m.v.gait!;
      // Legs unfold straight and flat: the femur comes down level, the shin swings out in line with it, and
      // the pairs spread evenly round the body, a star of struts on the ground.
      const pairs = Math.max(...legs.map((l) => l.pair)) + 1;
      for (const l of legs) {
        const along = pairs > 1 ? l.pair / (pairs - 1) - 0.5 : 0;
        l.o.rotation.y = -l.side * along * 1.6 * k;
        l.o.rotation.z = -l.side * l.alpha * k;
        if (l.shin) l.shin.rotation.z = l.side * (l.alpha + l.beta) * k;
      }
      // The body comes down with them until the struts lie on the ground, a light judder as it locks in.
      m.v.model.position.y = -g.hip * 0.92 * k + (k < 1 ? 0 : Math.sin(m.age * 40) * 0.004);
      return true;
    });
    this.dying = this.dying.filter((d) => {
      d.age += dt;
      const sink = Math.max(0, d.age - 2.5) * 0.4; // the corpse lies a while, then sinks into the ground
      if (d.v.mixer && d.v.playing === d.v.clips?.get(CLIP.die)) {
        // Animated characters play their own fall, sped up to DIE_S, and settle a little lower, so a clip that
        // ends kneeling still reads as down.
        d.v.mixer.update(dt);
        const e = Math.min(1, d.age / DIE_S);
        d.v.model.scale.y = (d.v.model.userData.sy ??= d.v.model.scale.y) * (1 - 0.3 * e);
        d.v.model.position.y = -sink;
      } else {
        // The others give way: they slump, flatten and tilt in a fifth of a second.
        const f = Math.min(1, d.age / 0.2);
        const e = 1 - (1 - f) * (1 - f);
        d.v.model.rotation.z = d.side * 0.4 * e;
        d.v.model.scale.y = (d.v.model.userData.sy ??= d.v.model.scale.y) * (1 - 0.55 * e);
        // Flyers drop out of the sky first, fast.
        const alt: number = (d.v.model.userData.alt ??= d.v.model.position.y);
        const air = alt > 0.5 ? Math.max(0, alt - 14 * d.age * d.age) : 0;
        d.v.model.position.y = air - sink;
      }
      // Those whose own fall ends kneeling or hunched go on over, onto their face or their back.
      const flat = FALL_FLAT.get(d.v.type);
      if (flat) d.v.model.rotation.x = flat * (Math.PI / 2) * 0.8 * (1 - (1 - Math.min(1, d.age / DIE_S)) ** 2);
      if (d.age < 4) return true;
      this.scene.remove(d.v.root);
      dropCorpse(d.v.model);
      this.release(d.v);
      return false;
    });
    this.bursts = this.bursts.filter((b) => {
      b.age += dt;
      const pos = b.pts.geometry.getAttribute('position') as BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        b.vel[i * 3 + 1] -= 9 * dt;
        pos.setXYZ(i, pos.getX(i) + b.vel[i * 3] * dt, Math.max(0.03, pos.getY(i) + b.vel[i * 3 + 1] * dt), pos.getZ(i) + b.vel[i * 3 + 2] * dt);
      }
      pos.needsUpdate = true;
      (b.pts.material as PointsMaterial).opacity = Math.max(0, 1 - b.age / BURST_S);
      if (b.age < BURST_S) return true;
      this.scene.remove(b.pts);
      b.pts.geometry.dispose();
      (b.pts.material as PointsMaterial).dispose();
      return false;
    });
    this.hostile = (a, b) => world.hostile(a, b);
    const hosted = new Map<number, Entity>(); // Z Pod id -> its add-on
    for (const e of world.entities.values()) if (e.host) hosted.set(e.host, e);
    // Energy wells under a building drawn as a picture: their rocks go, the picture's own base takes their place.
    const covered = new Set<number>();
    for (const e of world.entities.values()) if (e.def.kind === 'building' && spriteOf(e.type)) covered.add(e.tx * 4096 + e.ty);
    for (const e of world.entities.values()) {
      const old = this.views.get(e.id);
      if (old && (old.type !== e.type || old.owner !== e.owner)) {
        if (old.ghost) this.ghosts.push(old);
        else {
          this.scene.remove(old.root);
          this.release(old);
        }
        this.views.delete(e.id);
      }
      const v = this.views.get(e.id) ?? this.create(e, player);
      if (e.tier !== (v.tier ?? 1)) {
        // Z socle evolved: 12 % larger a tier.
        v.model.children[0]?.scale.multiplyScalar((1 + 0.12 * (e.tier - 1)) / (1 + 0.12 * ((v.tier ?? 1) - 1)));
        v.tier = e.tier;
      }
      // In a bunker: not drawn (the Fortin shows its occupants in its command card).
      v.root.visible = !e.inside;
      if (e.inside) continue;
      // Others' things, and the minerals and wells, only once found.
      if (e.owner !== player) {
        const now = sees(e);
        v.seen ||= now;
        v.root.visible = e.def.kind === 'unit' ? now : v.seen;
        if (!v.root.visible) continue;
        // A building (or a mineral, a well) seen before, out of sight now: a frozen grey ghost of what was last seen.
        if (!now) {
          if (!v.ghost) toGhost(v);
          continue;
        }
        if (v.ghost) fromGhost(v);
      }
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      // Fighting (or healing) something within reach: face it, even while nudged aside by others or standing to
      // shoot; otherwise face the way it moves. Render only: the simulation keeps no facing.
      const o = e.order;
      const foe = o && (o.kind === 'attack' || o.kind === 'attackMove' || o.kind === 'heal') && o.target ? world.entities.get(o.target) : undefined;
      const reach = foe && ((world.weapon(e)?.range ?? 2) + 1.5) * FP + foe.radius + e.radius;
      if (foe && reach && Math.hypot(foe.x - e.x, foe.y - e.y) <= reach) v.target = Math.atan2(foe.x - e.x, foe.y - e.y);
      else if (e.x !== e.px || e.y !== e.py) v.target = Math.atan2(e.x - e.px, e.y - e.py);
      else if (o?.kind === 'gather' && o.phase === 'mine') {
        const field = world.entities.get(o.target);
        if (field) v.target = Math.atan2(field.x - e.x, field.y - e.y); // a miner faces the crystal it works
      }
      if (e.def.kind === 'unit') v.heading = turnToward(v.heading, v.target, dt * TURN_SPEED);
      const ground = heightAt(this.map, x, z);
      v.ground = !soars(e) || v.ground === undefined ? ground : v.ground + (ground - v.ground) * Math.min(1, dt * 3);
      v.root.position.set(x, v.ground, z);
      const hp = e.hp + e.shield;
      if (e.def.kind === 'unit' && v.hp !== undefined && hp < v.hp && !v.flash) {
        const saved: [Mesh, Material | Material[]][] = [];
        v.model.traverse((o) => {
          // Only what is drawn: not the hidden boxes some models carry (a Z machine's material.visible = false hull).
          const mats = ([] as Material[]).concat(o instanceof Mesh ? o.material : []);
          if (o instanceof Mesh && o.visible && mats.every((m) => m.visible && !m.transparent)) {
            saved.push([o, o.material]);
            o.material = Array.isArray(o.material) ? o.material.map(hitTint) : hitTint(o.material);
          }
        });
        v.flash = { left: FLASH_S, saved };
      }
      v.hp = hp;
      if (v.flash && (v.flash.left -= dt) <= 0) unflash(v);
      if (v.emerge) {
        // Off the deck: a ramp down from where it was built to where the simulation put it.
        v.emerge.age += dt;
        const k = smoothstep(v.emerge.age / v.emerge.time);
        v.root.position.lerpVectors(v.emerge.from, v.root.position, k);
        if (k >= 1) v.emerge = undefined;
      }
      const picked = selected.has(e.id);
      if (picked && !v.ring.visible) v.ring.userData.since = performance.now();
      v.ring.visible = picked;
      if (v.ring.visible) {
        // The dial ticks flash on selection, turning, then fade out quickly: only the ring stays.
        const dialMat = (v.ring.userData.dial as Mesh).material as MeshBasicMaterial;
        dialMat.map!.rotation += dt * (e.owner === player ? 2.2 : -2.2);
        const age = performance.now() - v.ring.userData.since;
        const fresh = Math.max(0, 1 - age / 1200);
        // The ring is there at full strength in the very frame of the click (a fade-in read as lag), then gives a
        // short flash of light: bright round a building, soft round a unit.
        const [flashWidth, flashPower] = e.def.kind === 'building' ? [170, 1] : [110, 0.4];
        const flash = flashPower * Math.max(0, 1 - Math.abs(age - flashWidth) / flashWidth) ** 1.5;
        // Round a human building site it widens to take in the scaffolding while it stands.
        const wide = v.site?.storeys.some((s) => s.visible) ? (v.ring.userData.site as number) : 1;
        v.ring.userData.wide = v.ring.userData.wide === undefined ? wide : v.ring.userData.wide + (wide - v.ring.userData.wide) * Math.min(1, dt * 5);
        const k = v.ring.userData.wide;
        v.ring.scale.set(k, 1, k);
        dialMat.opacity = 0.6 * fresh;
        // The halo goes with the ticks; the ring itself settles a little dimmer.
        (v.ring.userData.halo as MeshBasicMaterial).opacity = 0.22 * fresh + 0.45 * flash;
        (v.ring.userData.core as MeshBasicMaterial).opacity = 0.55 + 0.4 * fresh + 0.6 * flash;
        (v.ring.userData.dial as Mesh).visible = dialMat.opacity > 0;
        const air = soars(e);
        if (air !== !!v.ring.userData.air) this.airRing(v.ring, air);
        if (air) {
          // In flight: the ring rides just under the model, tied to the ground by a faint thread.
          const h = Math.max(0.3, v.model.position.y - 0.1);
          v.ring.position.y = h;
          const thread = v.ring.userData.thread as Mesh;
          thread.scale.y = h;
          (thread.material as MeshBasicMaterial).opacity = 0.25 * (v.ring.userData.core as MeshBasicMaterial).opacity;
          (v.ring.userData.spot as Mesh).position.y = 0.06 - h;
        } else this.drape(v.ring, x, z, v.root.position.y);
      }
      if (e.def.kind === 'unit') {
        v.model.rotation.y = v.heading;
        this.animate(v, e, dt);
      }
      if (v.cargo) v.cargo.visible = e.carry > 0;
      v.fx?.update(dt, now / 1000);
      const wanted = weaponModule(e);
      if (wanted !== (v.weapon?.name ?? '')) this.mount(v, e, wanted);
      if (v.dock) {
        const addon = hosted.get(e.id);
        const ready = e.buildLeft <= 0;
        v.dock.ports.visible = ready && !addon;
        v.dock.glow.opacity = 0.45 + 0.4 * Math.sin(now / 300);
        v.dock.arm.visible = ready && !!addon;
        if (addon) {
          // From the Pod's side to the add-on's, unfolding as the add-on rises.
          const dx = (addon.x - e.x) / FP, dz = (addon.y - e.y) / FP;
          const gap = Math.hypot(dx, dz);
          // A tower (Tourelle, Vacarme) is met halfway up its side, sloping; the Plate-forme's flat deck at the Pod's height.
          const tower = (LOOKS[addon.type] ?? addon.type) === 'tourelle';
          const size = tower ? this.views.get(addon.id)?.model.userData.size as Vector3 | undefined ?? this.measure(addon.id) : undefined;
          const from = v.dock.reach, to = size ? gap - Math.min(size.x, size.z) * 0.4 : gap - (addon.def as BuildingDef).size / 2 + 0.6;
          const rise = size ? size.y * 0.5 - v.dock.y : 0;
          const grown = addon.buildLeft > 0 ? 1 - addon.buildLeft / world.buildTicks(addon) : 1;
          v.dock.arm.rotation.set(0, Math.atan2(-dz, dx), Math.atan2(rise, to - from), 'YZX');
          v.dock.arm.position.set((dx / gap) * from, v.dock.y, (dz / gap) * from);
          v.dock.arm.scale.x = Math.max(0.01, Math.hypot(to - from, rise) * grown);
        }
      }
      if (e.type === 'puits') v.model.visible = !covered.has(e.tx * 4096 + e.ty);
      if (e.type === 'minerai') {
        // Fields shrink as they are mined out, and their small geodes go one by one.
        const body = v.model.children[0];
        const left = Math.min(1, e.amount / (e.def as { amount: number }).amount);
        body.scale.setScalar(body.userData.base * (0.7 + 0.3 * left));
        // Each field draws its own share of the merged meshes (mergeGeodes): its geometry shares the buffers.
        body.userData.geodes ??= body.children.filter((m): m is Mesh => m instanceof Mesh && !!m.userData.geodeCounts).map((m) => {
          const g = new BufferGeometry();
          g.setIndex(m.geometry.index);
          for (const [name, a] of Object.entries(m.geometry.attributes)) g.setAttribute(name, a);
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          g.boundingSphere = m.geometry.boundingSphere;
          SHARED.add(g); // its buffers are the template's
          m.geometry = g;
          return m;
        });
        const k = (left > 0.25 ? 1 : 0) + (left > 0.5 ? 1 : 0) + (left > 0.75 ? 1 : 0);
        for (const m of body.userData.geodes as Mesh[]) m.geometry.setDrawRange(0, m.userData.geodeCounts[k]);
      }
      if (e.def.kind === 'building') {
        const total = ticks((e.def as BuildingDef).buildTime);
        const p = e.buildLeft > 0 ? 1 - e.buildLeft / total : 1;
        if ((e.def as BuildingDef).absorbs) {
          // Z, in stages round the drone deployed at its heart: a cyan armature of the building's edges
          // rises first, the plates are fabricated layer by layer behind it (a line of light at the height
          // being laid), then the armature goes out and the drone is left inside, the machine's core.
          if (v.print) {
            const span = v.print.top - v.print.bottom;
            const armature = Math.min(1, p / 0.4);
            const plates = Math.min(1, Math.max(0, (p - 0.2) / 0.72));
            v.print.frame.constant = v.root.position.y + v.print.bottom + span * armature;
            v.print.frameMaterial.opacity = 0.8 * Math.min(1, Math.max(0, (1 - p) / 0.08));
            const h = v.print.bottom + span * plates;
            v.print.plane.constant = v.root.position.y + h;
            if (v.seam) {
              v.seam.position.y = h + 0.02;
              (v.seam.material as MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.abs(Math.sin(now / 120));
            }
            if (p >= 1) {
              // Done: back to the shared materials, no cut; the cut copies, the frame and the seam are freed.
              const cuts = v.print.originals.map(([mesh]) => mesh.material);
              for (const [mesh, material] of v.print.originals) mesh.material = material;
              for (const l of v.print.lines) {
                l.removeFromParent();
                free(l);
              }
              for (const m of cuts.flat()) m.dispose();
              v.seam?.removeFromParent();
              if (v.seam) free(v.seam);
              v.print = undefined;
              v.seam = undefined;
            }
          }
        } else if (v.site) {
          // Footing first, then storeys of scaffolding going up round an empty site; the building appears
          // inside once they are all up, then the scaffolding comes down storey by storey from the top.
          const n = v.site.storeys.length;
          v.site.footing.visible = p < 1;
          v.site.storeys.forEach((s, i) => (s.visible = p >= 0.08 + (0.42 * i) / n && p < 0.62 + (0.36 * (n - i)) / n && p < 1));
          v.model.visible = p >= 0.5;
        } else {
          v.model.scale.y = e.buildLeft > 0 ? 0.15 + 0.85 * p : 1;
        }
        if (v.scaffold) v.scaffold.visible = e.buildLeft > 0;
        if (v.pools) v.pools.visible = e.buildLeft === 0;
        // The Plate-forme builds on its deck, with its robot arms when its model has them (the Blender one did).
        if (v.arms || e.type === 'plateforme') this.assemble(v, e, now / 1000);
      }
    }
  }

  /**
   * Walk cycle (legs, counter-swinging arms, bob, forward lean, sway), breathing when idle,
   * aiming and recoil for gunners, a full-body swing for melee. Everything is eased so poses never snap.
   */
  /**
   * Z Plate-forme at work: its arms sweep and weld over the deck, sparks flickering at their tips, while the
   * socle in training is fabricated on it layer by layer from the deck up, a cyan line at the height laid.
   */
  private assemble(v: View, e: Entity, t: number): void {
    const type = e.buildLeft === 0 && e.queue.length && DEFS[e.queue[0]]?.kind === 'unit' ? e.queue[0] : '';
    if (v.fab && v.fab.type !== type) {
      // Finished (not cancelled): the new unit drives off from here rather than appearing outside.
      if (v.fab.total > 0 && v.fab.plane.constant >= v.fab.top - (v.fab.top - v.fab.bottom) * 0.2)
        v.handoff = { type: v.fab.type, owner: e.owner, at: v.fab.model.getWorldPosition(new Vector3()), yaw: v.model.rotation.y + v.fab.model.rotation.y, time: performance.now() };
      v.fab.model.removeFromParent();
      v.fab.line.removeFromParent();
      free(v.fab.model);
      free(v.fab.line);
      v.fab = undefined;
    }
    if (type && !v.fab) {
      const ghost = model(type, teamMaterials[e.owner] ?? teamMaterials[0]);
      ghost.scale.setScalar(UNIT_SCALE * (LOOK_SCALE[type] ?? 1));
      ghost.position.set(0, PLATFORM_DECK, 0.1); // on the deck, between the arms
      ghost.rotation.y = Math.PI * 0.15;
      v.model.add(ghost);
      v.root.updateMatrixWorld(true); // placed this frame: its world matrix may not be up to date yet
      const box = new Box3().setFromObject(ghost);
      const plane = new Plane(new Vector3(0, -1, 0), box.min.y);
      ghost.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.noPick = true;
        const cut = (m: Material) => {
          const c = owned(m.clone());
          c.clippingPlanes = [plane];
          c.clipShadows = true;
          c.side = DoubleSide;
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cut) : cut(mesh.material);
      });
      const size = box.getSize(new Vector3());
      const r = Math.max(size.x, size.z) * 0.3; // round the body, inside the splayed legs
      const line = new Mesh(new RingGeometry(r * 0.94, r, 4, 1), owned(new MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })));
      line.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      line.scale.setScalar(Math.SQRT2);
      line.userData.noPick = true;
      v.root.add(line); // goes with the building if it is destroyed
      const centre = box.getCenter(new Vector3()).sub(v.root.position);
      line.position.set(centre.x, box.min.y - v.root.position.y, centre.z);
      v.fab = { type, model: ghost, plane, line, bottom: box.min.y, top: box.max.y, total: e.trainLeft };
    }
    const working = !!v.fab;
    if (v.fab) {
      v.fab.total = Math.max(v.fab.total, e.trainLeft);
      const p = v.fab.total > 0 ? 1 - e.trainLeft / v.fab.total : 0;
      const h = v.fab.bottom + (v.fab.top - v.fab.bottom) * p;
      v.fab.plane.constant = h;
      v.fab.line.position.y = h - v.root.position.y + 0.01;
      (v.fab.line.material as MeshBasicMaterial).opacity = 0.5 + 0.3 * Math.abs(Math.sin(t * 8));
    }
    v.arms?.forEach((a, i) => {
      const ease = (o: Object3D | undefined, axis: 'x' | 'y' | 'z', to: number) => {
        if (o) o.rotation[axis] += (to - o.rotation[axis]) * 0.12;
      };
      const k = i * 2.3;
      if (e.type === 'plateforme') {
        // The Plate-forme's one arm sweeps its torch to and fro over the socle on the deck, bent down onto it,
        // rocking in and out as it goes, a quick jitter at the torch while it welds.
        ease(a.upper, 'y', working ? Math.sin(t * 0.9) * 0.55 : 0);
        ease(a.upper, 'x', working ? 0.12 + Math.sin(t * 1.7) * 0.1 : 0);
        ease(a.tip, 'x', working ? 0.35 + Math.sin(t * 2.3) * 0.15 + Math.sin(t * 23) * 0.02 : 0);
        return;
      }
      ease(a.upper, 'y', working ? Math.sin(t * 1.3 + k) * 0.35 : 0);
      ease(a.upper, 'x', working ? Math.sin(t * 2.1 + k) * 0.08 : 0);
      ease(a.tip, 'x', working ? Math.sin(t * 3.7 + k) * 0.25 : 0);
      ease(a.tip, 'z', working ? Math.cos(t * 2.9 + k) * 0.2 : 0);
    });
  }

  /** Moves a skeleton on by `dt`, or, off screen, keeps the time for when it is seen again. */
  private pose(v: View, dt: number): void {
    if (!this.inView(v.root.position.x, v.root.position.z)) {
      v.idle = (v.idle ?? 0) + dt;
      return;
    }
    v.mixer!.update(dt + (v.idle ?? 0));
    v.idle = 0;
  }

  private animate(v: View, e: Entity, dt: number): void {
    const t = performance.now() / 1000;
    const moving = e.x !== e.px || e.y !== e.py || !!v.emerge;
    if (v.mixer) {
      const kind = e.order?.kind;
      const def = e.def as UnitDef;
      const attacking = e.cooldown > 0 && (kind === 'attack' || kind === 'attackMove' || kind === 'heal');
      const has = (role: string) => v.clips!.has(role);
      if (moving) {
        const pace = (def.speed * GAME_SPEED) / WALK_STRIDE;
        // Serfs keep walking with their jackhammer when loaded (their carry clip has no legs moving).
        if (e.carry > 0 && has(CLIP.carry) && CHARACTERS[e.type]?.grip !== 'drill') play(v, CLIP.carry, pace);
        else play(v, attacking && has(CLIP.fire) ? CLIP.fire : CLIP.walk, pace);
      } else if (attacking && has(CLIP.attack)) {
        // One swing or cast per attack.
        const clip = v.clips!.get(CLIP.attack)!.getClip();
        play(v, CLIP.attack, def.attack ? clip.duration / (def.attack.cooldown / GAME_SPEED) : 1);
      } else if ((kind === 'gather' || kind === 'construct' || kind === 'build') && CHARACTERS[e.type]?.grip === 'drill') {
        // Jackhammer: lean on it and shudder fast, rather than the slow hammer swing of the work clip.
        play(v, CLIP.idle, 0.3);
        this.pose(v, dt);
        // A light judder, not a bounce: the sparks show the work.
        v.model.position.y = Math.abs(Math.sin(t * 47 + e.id)) * 0.008;
        v.model.children[0].rotation.x = 0.12 + Math.sin(t * 61 + e.id) * 0.006; // leaning forward, whatever the heading
        return;
      } else if ((kind === 'gather' || kind === 'construct' || kind === 'build') && has(CLIP.work)) play(v, CLIP.work, 1.6);
      else play(v, CLIP.idle, attacking ? 1.4 : 0.8);
      v.model.position.y = 0;
      v.model.children[0].rotation.x = 0;
      this.pose(v, dt);
      return;
    }
    const speed = (e.def as UnitDef).speed;
    // Z walkers: the gait follows the ground actually covered, so feet stay planted whatever the speed.
    const gait = v.gait && stepGait(v, dt);
    const phase = gait ?? t * speed * 4.2 + e.id;
    for (const w of v.wheels ?? []) w.o.rotation.x = (gait ?? 0) / w.r;
    if (v.rotors) {
      // Fans race while flying somewhere and idle down when it hovers in place.
      v.rotors.spin += ((moving ? 28 : 7) - v.rotors.spin) * Math.min(1, dt * 1.5);
      for (const r of v.rotors.list) r.rotation.y += v.rotors.spin * dt;
    }
    const a = (e.def as UnitDef).attack;
    // A Z drone mining leans into the crystal with a drill's judder (the sparks come from main.ts).
    const mining = e.type === 'drone' && !moving && e.order?.kind === 'gather' && e.order.phase === 'mine';
    const fighting = !!a && !moving && e.cooldown > 0 && (e.order?.kind === 'attack' || e.order?.kind === 'attackMove');
    const fired = fighting && a ? e.cooldown / ticks(a.cooldown) : 0;
    const melee = !!a && a.range < 1;
    const ease = (o: Object3D | undefined, axis: 'x' | 'y' | 'z', target: number, rate = 0.25) => {
      if (o) o.rotation[axis] += (target - o.rotation[axis]) * rate;
    };
    // A shredder holds its saw up and lowers it to the ground in front to cut, spinning hard.
    const reach = v.weapon?.reach;
    if (v.weapon?.arm) ease(v.weapon.arm, 'x', reach === undefined ? (fighting ? 0.3 : -0.45) : reach - (fighting ? 0 : 0.35), 0.12);
    if (v.weapon?.saw) v.weapon.saw.rotation.x += dt * (fighting ? 18 : 3);
    const step = moving ? Math.sin(phase) : 0;
    ease(v.limbs.legL, 'x', step * 0.75);
    ease(v.limbs.legR, 'x', -step * 0.75);
    ease(v.limbs.armL, 'x', fighting && !melee ? -0.9 : -step * 0.6);
    let armR = moving ? step * 0.35 : 0;
    if (fighting && !melee) armR = -0.8 - (fired > 0.8 ? (fired - 0.8) * 2 : 0); // shouldered weapon, kick on each shot
    if (melee && fighting) armR = fired > 0.7 ? -2.4 * (1 - fired) / 0.3 + 0.6 : -2.2 * fired; // wind up, then hack down
    ease(v.limbs.armR, 'x', armR, melee ? 0.45 : 0.25);
    // Insect gait: alternating tripods (diagonal pairs on four legs); a leg lifts while it swings forward.
    for (const [i, l] of (v.limbs.insect ?? []).entries()) {
      if (l.ik) continue; // walked by walk(), once the body is posed
      const ph = phase + l.group * Math.PI;
      // Each side sweeps its foot forwards while lifted (cos > 0), backwards while planted.
      ease(l.o, 'y', moving ? -l.side * Math.sin(ph) * GAIT_SWING : Math.sin(t * 1.3 + i * 2.1 + e.id) * 0.03, moving ? 0.7 : 0.2);
      ease(l.o, 'z', moving ? l.side * Math.max(0, Math.cos(ph)) * 0.4 : 0, moving ? 0.7 : 0.2);
    }
    const body = v.model.children[0];
    // Body: bounce twice per stride, lean into the walk, sway from side to side, breathe at rest.
    // Hovering robots float; walkers bounce with their stride.
    const flying = soars(e);
    const hover = flying ? FLY_HEIGHT + Math.sin(t * 1.6 + e.id) * 0.07 : e.type === 'moissonneur' ? 0.12 + Math.sin(t * 2.5 + e.id) * 0.04 : 0;
    // Wheeled robots rumble over the ground rather than bounce.
    const rolling = !!v.wheels;
    // Walkers with knees crouch as they walk, and rise a little on each step.
    const crouch = moving && v.limbs.insect?.[0]?.ik ? -v.gait!.crouch : 0;
    const bob = hover + crouch + (hover ? 0 : moving ? (rolling ? Math.abs(Math.sin(t * 31 + e.id)) * 0.006 : Math.abs(Math.sin(phase)) * 0.045) : Math.sin(t * 2 + e.id) * 0.008);
    v.model.position.y += (bob - v.model.position.y) * 0.4;
    ease(body, 'x', mining ? 0.22 + Math.sin(t * 53 + e.id) * 0.02 : moving ? (rolling ? 0.04 : 0.14) : fighting && !melee ? 0.06 : 0, mining ? 0.5 : 0.15);
    // Flyers bank into their turns instead of swaying.
    const turn = Math.atan2(Math.sin(v.target - v.heading), Math.cos(v.target - v.heading));
    ease(body, 'z', flying ? Math.max(-0.5, Math.min(0.5, -turn * 0.8)) : moving && !rolling ? Math.sin(phase) * 0.05 : 0, flying ? 0.08 : 0.2);
    ease(body, 'y', melee && fighting ? (fired - 0.5) * 0.8 : 0, 0.3);
    const kick = fighting && !melee && fired > 0.8 ? (fired - 0.8) * 0.3 : 0;
    body.position.z += (-kick - body.position.z) * 0.5;
    if (v.limbs.insect?.[0]?.ik) walk(v, dt, moving, this.inView(v.root.position.x, v.root.position.z));
  }

  /** Lays a selection ring's meshes on the ground around (x, z), over dunes and slopes; only when it moved. */
  /** A short burst where a unit falls: a dozen dark drops (soberly, no gore), or sparks for a machine. */
  private burst(at: Vector3, mechanical: boolean): void {
    const n = mechanical ? 14 : 12;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (mechanical ? 1.2 : 0.6) + Math.random() * (mechanical ? 1.8 : 1);
      pos.set([at.x, at.y, at.z], i * 3);
      vel.set([Math.cos(a) * r, (mechanical ? 2 : 1.4) + Math.random() * 1.6, Math.sin(a) * r], i * 3);
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(pos, 3));
    // Sizes in pixels: the camera is orthographic, where point sizes do not follow the zoom anyway.
    const pts = new Points(geom, burstMaterial(mechanical));
    pts.userData.noPick = true;
    this.scene.add(pts);
    this.bursts.push({ pts, vel, age: 0 });
  }

  /** A small flag planted on the rally point of each selected thing of ours that has one (a flying Caserne keeps its own). */
  private readonly rallyFlags: Group[] = [];

  private syncRallyFlags(world: World, selected: ReadonlySet<number>, player: number, now: number): void {
    const points = [...selected]
      .map((id) => world.entities.get(id))
      .filter((e): e is Entity => !!e && e.owner === player && !!e.rally)
      .map((e) => e.rally!);
    while (this.rallyFlags.length < points.length) {
      const flag = rallyFlag();
      this.scene.add(flag);
      this.rallyFlags.push(flag);
    }
    this.rallyFlags.forEach((flag, i) => {
      flag.visible = i < points.length;
      if (!flag.visible) return;
      const x = points[i].x / FP;
      const z = points[i].y / FP;
      flag.position.set(x, heightAt(this.map, x, z), z);
      animateRally(flag, now, i * 0.37);
    });
  }

  /**
   * A selection ring taking off or landing: in the air it lies flat under the flyer and is drawn over everything
   * (the ground below may be crowded), with a thread down to a spot on the ground marking where the flyer is.
   */
  private airRing(ring: Object3D, on: boolean): void {
    ring.userData.air = on;
    if (!ring.userData.thread) {
      const color = (ring.userData.core as MeshBasicMaterial).color;
      const glow = { color, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending };
      const thread = new Mesh(new CylinderGeometry(0.012, 0.012, 1, 4).translate(0, -0.5, 0), owned(new MeshBasicMaterial(glow)));
      const spot = new Mesh(new RingGeometry(0.1, 0.17, 24).rotateX(-Math.PI / 2), owned(new MeshBasicMaterial({ ...glow, opacity: 0.6 })));
      for (const m of [thread, spot]) {
        m.userData.air = true;
        m.userData.noPick = true;
        m.renderOrder = 10;
        ring.add(m);
      }
      ring.userData.thread = thread;
      ring.userData.spot = spot;
    }
    (ring.userData.thread as Mesh).visible = (ring.userData.spot as Mesh).visible = on;
    for (const m of ring.children as Mesh[]) {
      if (m.userData.air) continue;
      // Depth-tested in flight too: the flyer's own body hides the part of the ring behind it (never drawn over it).
      (m.material as Material).depthTest = true;
      m.renderOrder = on ? 10 : 2;
      if (!on) continue;
      // Flat again (it was laid over the ground).
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, 0);
      pos.needsUpdate = true;
      m.userData.flat = false; // lifted again on landing (see drape)
    }
    ring.userData.at = undefined; // lays itself over the ground again on landing
    if (!on) ring.position.y = 0;
  }

  /**
   * Lays a ground ring flat at its owner's height, never bent over the relief (by a cliff it would stretch up the
   * wall). It rises a little, up to RING_RISE, over a gentle rise round it (a ramp, a dune) so it does not sink into
   * it; a cliff it ignores (RING_CLIFF), so it never floats at the cliff top: the wall hides what is behind it.
   */
  private drape(ring: Object3D, x: number, z: number, baseY: number): void {
    const k = ring.scale.x;
    const at = `${x.toFixed(2)},${z.toFixed(2)},${k.toFixed(2)}`;
    if (ring.userData.at === at) return;
    ring.userData.at = at;
    const core = (ring.children as Mesh[]).find((m) => m.material === ring.userData.core)!;
    const r = k * (core.geometry as RingGeometry).parameters.outerRadius;
    let top = 0;
    for (let i = 0; i < 32; i++) {
      const a = (i / 16) * Math.PI * 2; // two rounds: the outer edge, then halfway in
      const d = i < 16 ? r : r * 0.75;
      const h = heightAt(this.map, x + d * Math.cos(a), z + d * Math.sin(a)) - baseY;
      if (h <= RING_CLIFF) top = Math.max(top, h); // a cliff beyond: not followed, it hides that bit instead
    }
    ring.position.y = Math.min(top, RING_RISE);
    for (const m of ring.children as Mesh[]) {
      if (m.userData.air || m.userData.flat) continue; // the flyer's thread and ground spot; already flat
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, m.userData.lift);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      m.userData.flat = true;
    }
  }

  private create(e: Entity, player: number): View {
    if (e.def.kind === 'building') this.onBuilding(e);
    const root = new Group();
    root.userData.id = e.id;
    // Mineral fields use one of several geode clusters, turned and sized at random (stable per field).
    const variant = e.type === 'minerai' ? MINERAL_VARIANTS[e.id % MINERAL_VARIANTS.length] : e.type;
    const body = model(variant, teamMaterials[e.owner] ?? neutral, e.id);
    dressSprite(body, variant, TEAM_COLORS[e.owner] ?? 0x9a8f7a); // `?sprites=1` prototype
    body.scale.multiplyScalar(LOOK_SCALE[e.type] ?? 1);
    if (e.type === 'minerai') {
      body.rotation.y = ((e.id * 2654435761) % 1000) / 1000 * Math.PI * 2;
      body.userData.base = 0.85 + ((e.id * 40503) % 100) / 330;
    }
    const pivot = new Group(); // animated wrapper, so the model keeps its own transform
    pivot.add(body);
    if (SEATED[e.type] !== undefined) {
      // Set into the ground rather than standing on it: sunk a little, a soft contact shadow round its foot.
      body.position.y -= SEATED[e.type];
      root.add(contactShadow((e.def as BuildingDef).size));
    }
    // Units are drawn larger than their collision size, as in classic RTS, to stay readable.
    // A unit drawn with a building's model (Caserne volante in flight) keeps the building's size.
    if (e.def.kind === 'unit' && DEFS[LOOKS[e.type] ?? e.type]?.kind !== 'building') body.scale.setScalar(UNIT_SCALE);
    if ((e.def as UnitDef).cloaked) ghost(body);
    // Static unit models are marked for the ink pass (see Post), like the skinned characters.
    if (e.def.kind === 'unit')
      body.traverse((o) => {
        if (o instanceof Mesh && !(o instanceof SkinnedMesh) && !o.geometry.getAttribute('aUnit')) o.geometry.setAttribute('aUnit', new BufferAttribute(new Float32Array(o.geometry.getAttribute('position').count).fill(1), 1));
      });
    root.add(pivot);
    // Selection: a bright ring with a soft halo outside it.
    const r = RING_RADIUS[e.type] ?? (e.radius / FP) * (e.def.kind === 'unit' ? 1.5 : 1.1);
    if ((e.def as { worker?: boolean }).worker && !pivot.getObjectByName('cargo')) {
      const cargo = new Mesh(new SphereGeometry(0.11, 6, 4), ore);
      cargo.name = 'cargo';
      cargo.position.set(0, 0.62, -0.2);
      pivot.add(cargo);
    } else if (e.type === 'drone') {
      // The Drone's load, cut out of its bin (concepts-z/splitcargo.py): golden like the ore it digs, not the
      // crystal blue Rodin painted it.
      pivot.getObjectByName('cargo')?.traverse((m) => {
        if ((m as Mesh).isMesh) (m as Mesh).material = ore;
      });
    }
    const [core, halo] = e.owner === player ? RINGS.own : e.owner < 0 ? RINGS.neutral : this.hostile(e.owner, player) ? RINGS.enemy : RINGS.ally;
    const ring = new Group();
    ring.visible = false; // shown by sync, which starts its fade-in clock then (a view made while selected kept a NaN scale)
    // Floats a little above the ground, higher round buildings, so their plinths do not hide it.
    const lift = e.def.kind === 'building' ? 0.3 : 0.12;
    // Flat on the ground (rotation baked in), so its vertices can follow the terrain (see drape).
    // Own copies of the materials: the halo fades and the ring dims after selection (see sync).
    for (const [inner, outer, m, role] of [[r, r + 0.09, core, 'core'], [r + 0.09, r + 0.3, halo, 'halo']] as const) {
      const mesh = new Mesh(new RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2), owned(m.clone()));
      mesh.userData.lift = lift;
      mesh.renderOrder = 2;
      ring.add(mesh);
      ring.userData[role] = mesh.material;
    }
    // Ticks just outside the ring, turning (see sync).
    // A ring, not a square: a flat quad shows up in the ambient occlusion and ink passes as a pale rectangle.
    // RingGeometry's planar UVs line the round tick texture up with it.
    // It turns by turning its texture, so the mesh itself can follow the terrain too.
    const dialMat = owned(dialMaterial(core).clone());
    dialMat.map = owned(dialMat.map!.clone());
    dialMat.map.center.set(0.5, 0.5);
    dialMat.map.needsUpdate = true;
    const dial = new Mesh(new RingGeometry((r + 0.42) * 0.74, r + 0.42, 64).rotateX(-Math.PI / 2), dialMat);
    dial.userData.lift = lift + 0.01;
    dial.renderOrder = 2;
    ring.add(dial);
    ring.userData.dial = dial;
    ring.traverse((o) => (o.userData.noPick = true));
    root.add(ring);
    let pools: Object3D | undefined;
    if (POOLS[e.type]) {
      pools = new Group();
      for (const [x, z, r, c] of POOLS[e.type]) {
        const p = pool(r, c);
        p.userData.noPick = true;
        p.position.set(x, 0.05, z);
        pools.add(p);
      }
      root.add(pools);
    }
    if (PLAZAS[e.type]) {
      root.add(plaza(...PLAZAS[e.type]));
      body.position.y += 0.24; // stands on the plaza's upper step
    }
    let scaffold: Object3D | undefined;
    let site: View['site'];
    let seam: Mesh | undefined;
    let print: View['print'];
    if (e.def.kind === 'building' && (e.def as BuildingDef).absorbs) {
      // Z: assembled by the drone merged into it, it unfolds by itself (see sync); no site, no frame.
      if (e.buildLeft > 0) {
        const box = new Box3().setFromObject(body);
        const plane = new Plane(new Vector3(0, -1, 0), 0);
        // The armature: the building's own edges in cyan, rising ahead of the plates.
        const frame = new Plane(new Vector3(0, -1, 0), 0);
        const frameMaterial = owned(new LineBasicMaterial({ color: 0x7ff5ff, transparent: true, opacity: 0.8, depthWrite: false, clippingPlanes: [frame] }));
        const originals: [Mesh, Material | Material[]][] = [];
        const meshes: Mesh[] = [];
        body.traverse((o) => {
          if ((o as Mesh).isMesh) meshes.push(o as Mesh);
        });
        const lines = meshes.map((mesh) => {
          const l = new LineSegments(new EdgesGeometry(mesh.geometry, 35), frameMaterial);
          l.userData.noPick = true;
          mesh.add(l);
          return l;
        });
        meshes.forEach((mesh) => {
          originals.push([mesh, mesh.material]);
          // Its own copies, cut by the plane; inner faces drawn so the cut reads as solid, not hollow.
          const cut = (m: Material) => {
            const c = owned(m.clone());
            c.clippingPlanes = [plane];
            c.clipShadows = true;
            c.side = DoubleSide;
            return c;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cut) : cut(mesh.material);
        });
        print = { plane, frame, frameMaterial, lines, bottom: box.min.y, top: box.max.y, originals };
        const half = (e.def as BuildingDef).size / 2;
        // A square outline round the footprint (a four-sided ring turned by 45°).
        seam = new Mesh(new RingGeometry(half * 0.98, half * 1.04, 4, 1), owned(new MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })));
        seam.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
        seam.scale.setScalar(Math.SQRT2);
        seam.userData.noPick = true;
        root.add(seam);
      }
    } else if (e.def.kind === 'building' && !(e.def as BuildingDef).warp && e.buildLeft > 0) {
      // Built by workers: a building site (see sync).
      const size = new Box3().setFromObject(body).getSize(new Vector3());
      const made = buildingSite((e.def as BuildingDef).size, size);
      site = made;
      // The scaffolding (poles, walkways) stands about half a cell outside the model; a little more so its corners stay inside.
      ring.userData.site = Math.max(1, ((Math.max(size.x, size.z) / 2 + 0.5) * 1.15) / r);
      root.add(made.footing, ...made.storeys);
    } else if (e.def.kind === 'building') {
      // Warped in (Isdaris): it rises inside a wireframe while it materialises.
      const size = new Box3().setFromObject(body).getSize(new Vector3());
      scaffold = new LineSegments(new EdgesGeometry(new BoxGeometry(size.x * 1.05, size.y * 1.02, size.z * 1.05, 3, 2, 3)), scaffoldMaterial);
      scaffold.position.y = (size.y * 1.02) / 2;
      scaffold.userData.noPick = true;
      root.add(scaffold);
    }
    this.scene.add(root);
    // Buildings and new units face the map centre.
    const facing = Math.atan2(this.map.width / 2 - e.x / FP, this.map.height / 2 - e.y / FP);
    let fx: View['fx'];
    if (e.type === 'puits') {
      const well = wellFx(body, e.id);
      root.add(well.group);
      fx = well;
    }
    fx ??= armillaries(body, e.id) ?? undefined;
    if (e.type === 'assimilateur') fx = assimFx(body, e);
    if (e.type === 'armement') fx = forgeFx(body, e);
    if (e.type === 'reservepsy') {
      const reserve = reserveFx(body, e.id);
      root.add(reserve.group);
      fx = reserve;
    }
    const insect = insectLegs(body);
    // Measured before the view is placed or turned; the first move is a jump from the origin, not a step.
    const wheels: { o: Object3D; r: number }[] = [];
    root.updateMatrixWorld(true); // the unit's scale must be in before the tyres are measured
    body.traverse((o) => {
      if (/^zwheel_\d+$/.test(o.name)) {
        const b = new Box3().setFromObject(o);
        wheels.push({ o, r: (b.max.y - b.min.y) / 2 });
      }
    });
    for (const l of insect ?? []) l.ik = legRig(l, pivot);
    const rigged = !!insect?.every((l) => l.ik);
    if (!rigged) for (const l of insect ?? []) l.ik = undefined;
    if (rigged) {
      // Thin feet cast next to no shadow: soft contact discs under each foot and the body ground the walker.
      for (const l of insect!) root.add((l.ik!.shadow = contactShadow(l.ik!.reach * 0.32)));
      const box = new Box3().setFromObject(body).getSize(new Vector3());
      root.add(contactShadow(Math.min(box.x, box.z) * 0.55));
    }
    // Wheels roll by the ground covered: with a cycle of 2π the phase is the distance itself. Legs with knees set
    // their cycle from their stride as they go (see walk).
    const hip = insect?.[0].o.getWorldPosition(new Vector3()).y ?? 0;
    const gait = insect
      ? { x: 0, z: 0, phase: e.id, cycle: rigged ? 1 : gaitCycle(body, insect), hip, crouch: rigged ? walkCrouch(insect, hip) : 0, speed: 0, stride: 0.5 }
      : wheels.length
        ? { x: 0, z: 0, phase: 0, cycle: Math.PI * 2, hip: 0, crouch: 0, speed: 0, stride: 0 }
        : undefined;
    if (insect || wheels.length) {
      // Z walkers are mostly thin legs: an invisible box round the whole body catches clicks between them.
      const box = new Box3().setFromObject(body);
      const hit = new Mesh(new BoxGeometry(...box.getSize(new Vector3()).toArray()), PICK_PROXY);
      hit.position.copy(box.getCenter(new Vector3()));
      pivot.add(hit);
    }
    let dock: View['dock'];
    if (e.type === 'pod' || e.type === 'podsup') {
      const box = new Box3().setFromObject(body).getSize(new Vector3());
      dock = podDock(Math.min(box.x, box.z) * 0.42, box.y);
      root.add(dock.ports, dock.arm);
    }
    const rotors: Object3D[] = [];
    body.traverse((o) => {
      if (/^zrotor_\d+$/.test(o.name)) rotors.push(o);
    });
    const arms = ['zarm_0', 'zarm_1'].map((n) => body.getObjectByName(n)).filter((o): o is Object3D => !!o).map((upper) => ({ upper, tip: upper.getObjectByName(`${upper.name}_tip`) }));
    const v: View = { type: e.type, owner: e.owner, gait, wheels: wheels.length ? wheels : undefined, arms: arms.length ? arms : undefined, root, model: pivot, ring, scaffold, site, seam, print, pools, fx, dock, rotors: rotors.length ? { list: rotors, spin: 7 } : undefined, heading: facing, target: facing, cargo: pivot.getObjectByName('cargo'), seen: false, unit: e.def.kind === 'unit',
      limbs: { legL: body.getObjectByName('leg_l'), legR: body.getObjectByName('leg_r'), armL: body.getObjectByName('arm_l'), armR: body.getObjectByName('arm_r'), insect } };
    const clips = body.userData.clips as AnimationClip[] | undefined;
    if (clips) {
      v.mixer = new AnimationMixer(body);
      v.clips = new Map(clips.map((c) => [c.name, v.mixer!.clipAction(c)]));
      const die = v.clips.get(CLIP.die);
      if (die) {
        die.setLoop(LoopOnce, 1);
        die.clampWhenFinished = true;
      }
      play(v, CLIP.idle, 0.8);
      v.mixer.setTime((e.id % 17) / 7); // out of step with each other
    }
    if (v.unit) {
      // Just finished on a Plate-forme's deck: start there, facing as it was built, and drive off.
      const to = new Vector3(e.x / FP, 0, e.y / FP);
      const now = performance.now();
      for (const b of this.views.values()) {
        const h = b.handoff;
        if (!h || h.type !== e.type || h.owner !== e.owner || now - h.time > 500 || Math.hypot(h.at.x - to.x, h.at.z - to.z) > 5) continue;
        b.handoff = undefined;
        const d = Math.hypot(h.at.x - to.x, h.at.z - to.z);
        v.emerge = { from: h.at.clone(), age: 0, time: Math.min(1.6, Math.max(0.7, d / 1.5)) };
        v.heading = h.yaw;
        v.target = Math.atan2(to.x - h.at.x, to.z - h.at.z);
        if (v.gait) [v.gait.x, v.gait.z] = [h.at.x, h.at.z];
        break;
      }
    }
    if (v.unit) xrayable(pivot, e.owner);
    else if (e.def.kind === 'building') occluder(pivot);
    stableShadowDepth(root);
    this.views.set(e.id, v);
    return v;
  }
}
