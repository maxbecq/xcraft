import {
  SpriteMaterial, AdditiveBlending, BackSide, Plane, Color, LineBasicMaterial, LineSegments, Vector3, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, AnimationMixer, type AnimationAction,
  SkinnedMesh, ShaderMaterial, type Material, PointsMaterial,
} from 'three';
import { owned, haloShape } from './models';
import type { InsectLeg } from './gait';

/** Invisible units are drawn see-through (only their owner, or a detecting enemy, sees them at all). */
export function ghost(body: Object3D): void {
  body.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = owned((o.material as Material).clone());
    m.transparent = true;
    m.opacity = 0.3;
    m.depthWrite = false;
    o.material = m;
    o.castShadow = false;
  });
}
export interface View {
  /** Animation time not yet played while the view was off screen (s), caught up when it comes back. */
  idle?: number;
  /** Entity type it was built for: a building turned into another gets a new view. */
  type: string;
  /** Z socle: the tier it is drawn at (each one a little larger). */
  tier?: number;
  /** Player whose colours it wears: a machine taken by a Canon IEM gets a new view. */
  owner: number;
  /** Hit flash: hit points (and shield) last seen, and while flashing, the materials to put back. */
  hp?: number;
  flash?: { left: number; saved: [Mesh, Material | Material[]][] };
  /** An enemy building out of sight: drawn grey, frozen as last seen; its own materials, to put back. */
  ghost?: [Mesh, Material | Material[]][];
  /** Its lights and glows, hidden while a ghost. */
  dimmed?: Object3D[];
  /** Z walkers: where the gait was last stepped, its phase, and the ground covered by one cycle; with knees, the
   * ground speed (tiles a second, smoothed) and the stride it sets. */
  gait?: { x: number; z: number; phase: number; cycle: number; hip: number; crouch: number; speed: number; stride: number };
  /** Z socle: the weapon module mounted on its back (see weaponModule), and the module's name. */
  /** `sawR`: the Déchiqueteur's blade radius, world units. */
  weapon?: { name: string; o: Object3D; arm?: Object3D; saw?: Object3D; reach?: number; mod?: Object3D; tip?: Vector3; sawR?: number };
  /** Z flyers' lift fans (zrotor_<k>), spinning on their own axes; `spin` is their current rate, rad/s. */
  rotors?: { list: Object3D[]; spin: number };
  /** Z wheels (zwheel_<k>), rolling on their hubs; `r` is the tyre radius in world units. */
  wheels?: { o: Object3D; r: number }[];
  root: Object3D;
  model: Group;
  ring: Object3D;
  scaffold?: Object3D;
  /** Human building site: the footing, and the scaffolding storeys from the ground up. */
  site?: { footing: Object3D; storeys: Object3D[] };
  /** Z building being fabricated: a ring of cyan light at the height being laid. */
  seam?: Mesh;
  /** Z building being fabricated: its own materials cut by a plane rising from `bottom` to `top`. */
  /** Z Pod: docking ports pulsing on its sides while it has no add-on, and the gantry reaching out to the add-on it has. */
  dock?: { ports: Object3D; arm: Object3D; glow: MeshBasicMaterial; y: number; reach: number };
  /** Z Plate-forme: its robot arms (upper part, forearm with the welding spark), animated while it builds. */
  arms?: { upper: Object3D; tip?: Object3D }[];
  /** Z Plate-forme: the socle being built on its deck, fabricated layer by layer as training goes on. */
  fab?: { type: string; model: Object3D; plane: Plane; line: Mesh; bottom: number; top: number; total: number };
  /** The unit just finished on a Plate-forme's deck, waiting for its own view to take its place. */
  handoff?: { type: string; owner: number; at: Vector3; yaw: number; time: number };
  /** A unit leaving the Plate-forme's deck: it rolls or walks from where it was built to its place outside. */
  emerge?: { from: Vector3; age: number; time: number };
  print?: { plane: Plane; frame: Plane; frameMaterial: LineBasicMaterial; lines: LineSegments[]; bottom: number; top: number; originals: [Mesh, Material | Material[]][] };
  /** Light pools on the ground, lit once the building stands. */
  pools?: Object3D;
  /** Energy well: its living pool (see wellFx). */
  fx?: { group: Object3D; update(dt: number, t: number): void };
  heading: number;
  /** Flyers: ground height under them, eased so they glide over cliffs instead of jumping. */
  ground?: number;
  /** Direction the unit wants to face; `heading` turns towards it. */
  target: number;
  cargo?: Object3D;
  /** Enemy buildings stay on screen once spotted. */
  seen: boolean;
  unit: boolean;
  /** Animated parts from the Blender model, if any. */
  limbs: { legL?: Object3D; legR?: Object3D; armL?: Object3D; armR?: Object3D; insect?: InsectLeg[] };
  /** Skeletal animation of Meshy characters. */
  mixer?: AnimationMixer;
  clips?: Map<string, AnimationAction>;
  playing?: AnimationAction;
}
/**
 * A struck unit lights up this long (s), its own textures kept: who is under fire reads at a glance in a melee,
 * without turning into a flat white shape. Each of its materials is swapped for a brightened copy, made once.
 */
export const FLASH_S = 0.12;
const HIT_FLASH = new MeshBasicMaterial({ color: 0xfff2e6 });
const lit = new WeakMap<Material, Material>();
export function hitTint(m: Material): Material {
  let t = lit.get(m);
  if (!t) {
    const s = m as MeshStandardMaterial;
    if (s.isMeshStandardMaterial) {
      const c = s.clone();
      // A clone drops the shader patches (team paint, rims): the flash showed without them, and compiled a program
      // of its own mid-fight. The same patches, so the same program (but for an emissive map taken off).
      c.onBeforeCompile = s.onBeforeCompile;
      c.customProgramCacheKey = s.customProgramCacheKey;
      c.emissive.setHex(0xfff0e0);
      c.emissiveMap = null;
      c.emissiveIntensity = 0.22;
      t = c;
    } else t = HIT_FLASH;
    lit.set(m, t);
  }
  return t;
}

/** What a fallen unit's team paint and silhouette glow turn to: dull grey, so a corpse never reads as a fighter. */
const CORPSE_TEAM = new Color(0x2a2724);
const NO_RIM = [0, 0, 0];

/**
 * A fallen unit's look: each mesh gets its own copy of its material, darkened, with team colour, silhouette
 * glow and emissive lights put out, and glowing parts hidden. The copies keep the living unit's shader hooks and
 * cache key, so the compiled programs are reused: no shader compiles in the middle of a battle.
 */
export function toCorpse(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const dull = (m: Material): Material => {
      if (m.blending === AdditiveBlending) {
        o.visible = false; // glows and halos go out
        return m;
      }
      const c = m.clone();
      c.onBeforeCompile = (shader, r) => {
        m.onBeforeCompile.call(c, shader, r);
        if (shader.uniforms.teamColor) shader.uniforms.teamColor.value = CORPSE_TEAM;
        if (shader.uniforms.rimColor) shader.uniforms.rimColor.value = NO_RIM;
      };
      c.customProgramCacheKey = () => m.customProgramCacheKey(); // the living unit's key, whatever it is made of
      const k = c as MeshStandardMaterial;
      // Grey (Z machines carry their team colour as plain paint), at about a third of the brightness on screen.
      if (k.color) {
        const l = 0.12 * (k.color.r * 0.3 + k.color.g * 0.59 + k.color.b * 0.11);
        k.color.setRGB(l, l * 0.95, l * 0.9);
      }
      k.emissive?.setRGB(0, 0, 0);
      c.userData.corpse = true;
      if (m.userData.owned) m.dispose(); // a cloaked unit's own copy, replaced
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(dull) : dull(o.material);
  });
}

/** Grey copies of materials for ghosts (FOG_GLSL's explored grey), one per material. */
const GREY = new WeakMap<Material, Material>();
function grey(m: Material): Material {
  let g = GREY.get(m);
  if (!g) {
    g = m.clone();
    const prev = m.onBeforeCompile;
    g.onBeforeCompile = (shader, r) => {
      prev.call(g, shader, r);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\ngl_FragColor.rgb = vec3(dot(gl_FragColor.rgb, vec3(0.3, 0.59, 0.11)) * 0.55);',
      );
    };
    g.customProgramCacheKey = () => `${m.customProgramCacheKey()}|ghost`;
    GREY.set(m, g);
  }
  return g;
}

/** An enemy building gone out of sight: grey, and no longer updated (what was last seen, not what is there). */
export function toGhost(v: View): void {
  unflash(v);
  v.ghost = [];
  v.dimmed = [];
  v.root.traverse((o) => {
    const m = (o as Mesh).material as Material | Material[] | undefined;
    if (!m || !o.visible) return;
    // Lights, glows and shader effects go dark; the rest turns grey.
    const lit = (x: Material) => x.blending === AdditiveBlending || x instanceof ShaderMaterial || x instanceof PointsMaterial || x instanceof SpriteMaterial;
    if (!(o instanceof Mesh) || (Array.isArray(m) ? m.some(lit) : lit(m))) {
      o.visible = false;
      v.dimmed!.push(o);
      return;
    }
    v.ghost!.push([o, m]);
    o.material = Array.isArray(m) ? m.map(grey) : grey(m);
  });
}

/** Back in sight: its own materials (the owned grey copies are dropped). */
export function fromGhost(v: View): void {
  for (const [o, m] of v.ghost ?? []) {
    for (const x of Array.isArray(m) ? m : [m]) {
      if (!x.userData.owned) continue;
      GREY.get(x)?.dispose();
      GREY.delete(x);
    }
    o.material = m;
  }
  for (const o of v.dimmed ?? []) o.visible = true;
  v.ghost = v.dimmed = undefined;
}

/** Ends a hit flash: the unit's own materials go back on. */
export function unflash(v: View): void {
  for (const [o, m] of v.flash?.saved ?? []) o.material = m;
  v.flash = undefined;
}

/** Frees the corpse's own materials once it has sunk. */
export function dropCorpse(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.userData.corpse) m.dispose();
  });
}
/**
 * The hover halo: a soft warm glow spilling out round the building under the cursor, swelling and ebbing once a
 * second, to tell it can be picked. Drawn as a shell: the building's own meshes again, pushed out along smoothed
 * normals and seen from inside (back faces), so only a fringe past the silhouette shows, brightest at the edge and
 * fading outwards. No outline or full-screen pass; added on top, never writing depth.
 */
const HALO_PUSH = 0.22; // world units the shell stands out from the walls
const haloMaterial = new ShaderMaterial({
  uniforms: { strength: { value: 0 }, color: { value: new Color(0xffd9a0) } },
  vertexShader: `#include <clipping_planes_pars_vertex>
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  world.xyz += n * ${HALO_PUSH.toFixed(2)};
  vec4 mvPosition = viewMatrix * world;
  vNormal = normalize((viewMatrix * vec4(n, 0.0)).xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`,
  // The camera is orthographic, looking along -z in view space: the shell is side-on (z near 0) at the silhouette.
  fragmentShader: `#include <clipping_planes_pars_fragment>
uniform float strength;
uniform vec3 color;
varying vec3 vNormal;
void main() {
  #include <clipping_planes_fragment>
  float edge = pow(1.0 - abs(normalize(vNormal).z), 2.0);
  gl_FragColor = vec4(color * strength * edge, 1.0);
}`,
  side: BackSide,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  clipping: true,
});

export const HALO_FADE = 0.13; // seconds to fade a hover halo in or out
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** One building's hover halo: its shell meshes, their own material (its own strength), and how far it has faded in. */
export type Halo = { id: number; model: Object3D; meshes: Mesh[]; strength: { value: number }; level: number };

export function makeHalo(id: number, model: Object3D): Halo {
  const strength = { value: 0 };
  const base = haloMaterial.clone();
  base.uniforms.strength = strength;
  base.uniforms.color = haloMaterial.uniforms.color;
  const pairs: [Mesh, Mesh][] = [];
  model.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (m as SkinnedMesh).isSkinnedMesh || m.userData.noPick || !m.geometry.attributes.position) return;
    // A building being fabricated (Z) is cut by a plane: the halo is cut with it.
    const planes = (Array.isArray(m.material) ? m.material[0] : m.material)?.clippingPlanes;
    const material = planes?.length ? Object.assign(base.clone(), { clippingPlanes: planes }) : base;
    if (material !== base) Object.assign(material.uniforms, { strength, color: base.uniforms.color });
    const halo = new Mesh(haloShape(m.geometry), material);
    halo.userData.noPick = true;
    halo.renderOrder = 2;
    halo.layers.mask = m.layers.mask;
    pairs.push([m, halo]);
  });
  // Children of their mesh, so they follow it and hide with it; added after the walk, which they would join.
  for (const [m, halo] of pairs) m.add(halo);
  return { id, model, meshes: pairs.map(([, h]) => h), strength, level: 0 };
}

export function dropHalo(h: Halo): void {
  const materials = new Set(h.meshes.map((m) => m.material as Material));
  for (const m of h.meshes) m.removeFromParent();
  for (const m of materials) m.dispose();
}
