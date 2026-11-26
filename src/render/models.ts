import {
  Sprite, SpriteMaterial, AdditiveBlending, Box3, BufferAttribute, DoubleSide, CanvasTexture, SRGBColorSpace, Color, BoxGeometry, CapsuleGeometry, Vector3, ConeGeometry, CylinderGeometry, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, AnimationMixer, type AnimationClip, SkinnedMesh, Skeleton, Matrix4, RingGeometry, SphereGeometry, BufferGeometry,
  ShaderMaterial, ShaderChunk, Raycaster, PlaneGeometry, type Material, type Texture, LatheGeometry, TorusGeometry, IcosahedronGeometry, Vector2, TubeGeometry, CatmullRomCurve3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DEFS, LOOKS, type UnitDef } from '../data';
import { graffiti, rimLight, weather } from './weathering';
import { LIFE_GLSL } from './life';
import { procRig, RIGS } from './godrig';

/** Player colours: blue, red, green, purple. */
export const TEAM_COLORS = [0x3a7bd5, 0xc8402f, 0x38b04c, 0x9a52d8];
/** Blender models for mineral fields; the renderer picks one per field. */
export const MINERAL_VARIANTS = ['minerai', 'minerai_1', 'minerai_2', 'minerai_3'];

const mat = (color: number, extra: MeshStandardMaterialParameters = {}) => new MeshStandardMaterial({ color, roughness: 0.8, ...extra });
export const teamMaterials = TEAM_COLORS.map((c) => mat(c, { roughness: 0.6 }));
/** Team colour for Blender models, keeping their hand-painted vertex colours. */
// Team colour glows a little, so armies read at a glance.
const teamPainted = TEAM_COLORS.map((c) => mat(c, { roughness: 0.5, vertexColors: true, emissive: new Color(c).multiplyScalar(0.18) }));
teamPainted.forEach((m) => {
  weather(m, 0.8);
  rimLight(m, 0.4);
});

/** Team-coloured light (veins, cores): `team_glow` in Blender models. */
const teamGlow = TEAM_COLORS.map((c) => veinGlow(mat(c, { roughness: 0.35, emissive: c, emissiveIntensity: 1.6 })));
/** Light breathing along a material's emission (VEIN_PULSE). */
function veinGlow(m: MeshStandardMaterial): MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.veinTime = veinTime;
    shader.vertexShader = `varying float vVein;\nuniform float veinTime;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vVein = veinPulse(modelMatrix, position, veinTime);`).replace('void main() {', `${VEIN_PULSE}\nvoid main() {`);
    shader.fragmentShader = `varying float vVein;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= vVein;`);
  };
  m.customProgramCacheKey = () => 'team-vein';
  return m;
}
/** Seconds, shared by every vein so one uniform drives them all. */
export const veinTime = { value: 0 };
/**
 * Alchemical light breathing in the veins: a slow wave climbing them, a second slower swell and a little
 * flicker, phased by the mesh's place on the map so no two buildings beat together.
 */
const VEIN_PULSE = `float veinPulse(mat4 model, vec3 p, float t) {
  vec3 o = model[3].xyz;
  float h = fract(sin(dot(floor(o.xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453);
  float y = (model * vec4(p, 1.0)).y;
  return 0.78 + 0.22 * sin(t * (1.1 + h * 0.8) - y * 5.0 + h * 6.28) + 0.12 * sin(t * 0.37 + h * 17.0) + 0.05 * sin(t * 9.0 + h * 40.0);
}`;
/** Soft halo around a vein: a shell pushed out along the normals, densest where it faces the eye, added to the scene's light. */
const veinHalo = TEAM_COLORS.map(
  (c) =>
    new ShaderMaterial({
      uniforms: { color: { value: new Color(c) }, veinTime },
      vertexShader: `uniform float veinTime;
        varying float vEdge;
        varying float vVein;
        ${VEIN_PULSE}
        void main() {
          vec3 p = position + normal * 0.13;
          vec4 world = modelMatrix * vec4(p, 1.0);
          vec3 n = normalize(mat3(modelMatrix) * normal);
          vEdge = abs(dot(n, normalize(cameraPosition - world.xyz)));
          vVein = veinPulse(modelMatrix, position, veinTime);
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: `uniform vec3 color;
        varying float vEdge;
        varying float vVein;
        void main() {
          // Thick in the middle of the tube, fading to nothing at its rim: reads as light bleeding into the air.
          gl_FragColor = vec4(color * 1.8 * vVein, pow(vEdge, 1.5) * 0.65 * vVein);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
);
const teamCanvas = new Map<Texture, MeshStandardMaterial[]>();
/** Team colour over a woven texture (`team_canvas`: the market's awning), with its hand-painted vertex colours. */
function teamCloth(map: Texture, team: number): MeshStandardMaterial {
  let set = teamCanvas.get(map);
  if (!set) {
    set = TEAM_COLORS.map((c) => {
      const m = mat(c, { map, roughness: 0.9, vertexColors: true, emissive: new Color(c).multiplyScalar(0.12) });
      rimLight(m, 0.4);
      return m;
    });
    teamCanvas.set(map, set);
  }
  return set[team] ?? set[0];
}

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
export const neutral = mat(0x9a8f7a);
const skin = mat(0xd9b48f);
export const steel = mat(0x8c949c, { metalness: 0.6, roughness: 0.4 });
const stone = mat(0xb9ae94);
const darkStone = mat(0x7d7464);
const wood = mat(0x7a5634);
export const ore = mat(0xffc070, { emissive: 0xa0400c, roughness: 0.5 }); // a lump of glowing geode
const wellGlow = mat(0x9b5cff, { emissive: 0x5a20c0, roughness: 0.3 });
const toxic = mat(0x9aff4a, { emissive: 0x3a9a10, roughness: 0.35 }); // the chemical mine's charge
/** Models built by tools/blender/models.py, by entity type. */
export const templates = new Map<string, Group>();
/**
 * Geometries and skeletons shared between views (the models' own, halo shells, mined-out geode slices): never
 * freed with a view.
 */
export const SHARED = new WeakSet<object>();
/**
 * Z modules modelled on a round base of their own, which doubled the socle or roof under them (module units, from the
 * module's root, measured on the models): the faces of that disc, below `y` and beyond `r` from its axis, go, and the
 * module sits down onto what is left (its neck).
 */
const WEAPON_DISCS: Record<string, { y: number; r: number }> = {
  zw_reparateur: { y: 0.06, r: 0.27 },
  zw_accumulateur: { y: 0.15, r: 0.22 },
  zw_mitrailleuse: { y: 0.125, r: 0.24 },
};
function trimDisc(root: Object3D, cut: { y: number; r: number }): void {
  root.updateMatrixWorld(true);
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as Mesh;
    const index = m.isMesh ? m.geometry.index : null;
    if (!index) return;
    const pos = m.geometry.getAttribute('position');
    const kept = (i: number) => (v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld), v.y >= cut.y || Math.hypot(v.x, v.z) <= cut.r);
    const faces: number[] = [];
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      if (kept(a) || kept(b) || kept(c)) faces.push(a, b, c);
    }
    m.geometry.setIndex(faces);
  });
  for (const c of root.children) c.position.y -= cut.y;
}

function share<T extends Object3D>(root: T): T {
  root.traverse((o) => {
    if ((o as Mesh).geometry) SHARED.add((o as Mesh).geometry);
    if ((o as SkinnedMesh).isSkinnedMesh) SHARED.add((o as SkinnedMesh).skeleton);
  });
  return root;
}
/**
 * Frees what a view, or a part of one, allocated for itself: its geometries but the shared ones, the bone textures
 * of its cloned skeletons, and the materials (with their textures) marked owned, on it or in `extra`.
 */
export function free(root: Object3D, extra: (Material | Material[])[] = []): void {
  const materials = new Set<Material>();
  const add = (m: Material | Material[]) => {
    for (const x of Array.isArray(m) ? m : [m]) if (x.userData.owned) materials.add(x);
  };
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.geometry && !SHARED.has(m.geometry)) m.geometry.dispose();
    if (m.material) add(m.material);
    const skeleton = (o as SkinnedMesh).isSkinnedMesh ? (o as SkinnedMesh).skeleton : undefined;
    if (skeleton && !SHARED.has(skeleton)) skeleton.dispose();
  });
  extra.forEach(add);
  for (const m of materials) {
    for (const t of Object.values(m)) if ((t as Texture | null)?.isTexture && (t as Texture).userData.owned) (t as Texture).dispose();
    m.dispose();
  }
}

/** Marks a material or texture as a view's own copy, freed with the view (see EntityRenderer.release). Clones keep the mark. */
export function owned<T extends { userData: Record<string, unknown> }>(x: T): T {
  x.userData.owned = true;
  return x;
}

/**
 * Models made with Meshy (tools/meshy), `<type>-meshy.glb`, preferred over the Blender ones
 * (`?proc` keeps the Blender ones). Rigged characters carry their animation clips, named by role,
 * and a weapon prop (`<weapon>-meshy.glb`, along +Z, grip at the origin) in the right hand:
 * a `rifle` points at the left hand, a `pole` (hammer, axe, staff) stands up and forward, a `drill`
 * (jackhammer) points down and forward.
 * Static ones (robots, beasts) are plain textured meshes, already sized by normalize.py.
 */
/** How a held prop sits: a gun at the hip (rifle), a staff upright (pole), a jackhammer (drill), or a pole arm held in
 * both hands, the right one back on the shaft and the left one forward (hast: the Belluaire's trident). */
type Grip = 'rifle' | 'pole' | 'drill' | 'hast';
export const CHARACTERS: Record<string, { height: number; weapon?: string; grip?: Grip; basket?: boolean; shield?: string }> = {
  auxiliaire: { height: 0.86, weapon: 'fusil', grip: 'rifle' },
  serf: { height: 0.72, weapon: 'piqueur', grip: 'drill', basket: true }, // puny next to the soldiers; a wicker basket on its back
  legionnaire: { height: 0.95, weapon: 'scie', grip: 'pole', shield: 'scutum' }, // a scutum on the left arm, in the team's colour
  soigneur: { height: 0.86, weapon: 'cristal', grip: 'pole' }, // a monk's staff, its cyan crystal up
  alchimiste: { height: 0.86 }, // empty-handed: it throws its flasks from the right hand
  archer: { height: 0.92, weapon: 'rayon', grip: 'rifle' },
  druide: { height: 0.95, weapon: 'baton', grip: 'pole' },
  phalangiste: { height: 0.9, weapon: 'lancegrenades', grip: 'rifle' },
  // The saurians rigged in Blender from their Rodin models (tools/meshy/saurian.py): their riders ride their spines.
  ankylosaure: { height: 1.01 },
  allosaure: { height: 1.21 },
  belluaire: { height: 0.95, weapon: 'trident', grip: 'hast' }, // a heavy gladiator: its guard is its aim clip, its thrust its attack
  discobole: { height: 1.0 },
  creature: { height: 0.45 }, // four legs, rigged in Blender (tools/meshy/quadruped.py)
  assassin: { height: 0.9 },
};
const STATIC_MESHY = ['moissonneur', 'conseil', 'grenier', 'caserne', 'mine', 'obelisque', 'portail', 'recepteur', 'forge', 'tour', 'orbe', 'nanoassembleur', 'fortin', 'recepteurarme', 'chimere', 'metallurgie', 'bourdon', 'pegase', 'alchimisterie', 'creaturium', 'plesiosaure',
  // the Dieux redone from their concept boards (recherches-visuelles, TRELLIS.2 on this Mac)
  'minotaure', 'temple', 'gaia',
  // Z redone from their chosen boards (concepts-z, TRELLIS.2 on this Mac), sized like the Blender sketches
  'barge', 'zespion', 'centrerecherche', 'pod', 'tourelle',
  // and with Meshy (smart topology t2.5 for units, t2 for buildings, 3000 faces, n1 texture)
  'octopode', 'mastodonte', 'centrek', 'supreme', 'centresocles', 'optimisation',
  // and with Rodin (fal) or Tripo: the last Blender sketches
  'intelligence', 'assimilateur', 'plateforme', 'armement', 'vacarme', 'podsup', 'drone', 'dronecombat', 'quadripode', 'hexapode', 'coleoptere', 'minechimique', 'grandealchimisterie', 'casernevolante', 'scarabee', 'cuve', 'minealchimique',
  // the Grand Conseil, the Conseil des échevins raised with a Brussels-style openwork belfry (Rodin, from its chosen board)
  'grandconseil',
  // Isdaris buildings modelled in Blender by Fable from their chosen boards (tools/meshy/fable.mjs): see fableLights
  'trone'];
/** Units whose silhouette keeps a plain rim, not one in the team colour: the large Mastodonte, its team colour on one
 * wide band only (a coloured outline round it read as a border). */
const NO_TEAM_RIM = new Set(['mastodonte']);
/** Models whose team-colour mask takes one fixed colour instead: the Assimilateur's tank is living green, as its picture. */
const FIXED_TEAM: Record<string, number> = { assimilateur: 0x2cff50 };
/** Meshy buildings with Blender parts fitted on them (`<type>-dress.glb`, tools/blender/models.py DRESS). */
// The Alchimisterie redone from its chosen board (Rodin) carries its own cyan lines: its old dress no longer fits it.
const DRESSED = ['conseil', 'caserne', 'grenier', 'mine', 'forge', 'metallurgie'];
/** Turn (radians) to face +Z, for static Meshy models that came out facing another way. */
const STATIC_YAW: Record<string, number> = { chimere: Math.PI / 2, bourdon: -Math.PI / 2 };
export const rigged = new Map<string, { scene: Group; clips: AnimationClip[]; skins: MeshStandardMaterial[]; shields?: MeshStandardMaterial[] }>();
/** Team-coloured materials of the static Meshy models, by type. */
const meshySkins = new Map<string, MeshStandardMaterial[]>();

/**
 * Repaints the texture's blue team stripes in the team colour, with a faint glow. `vivid` lifts
 * dull rust-and-dust textures (Human buildings): more saturation and light, so they read on the ground.
 */
function teamSkin(source: MeshStandardMaterial, color: number, rim = 0.45, vivid = false, unit = false, ivory = false, matte = false, human = false): MeshStandardMaterial {
  const m = source.clone();
  const team = new Color(color);
  const living = vivid && !unit;
  const shiny = unit && !ivory && !matte; // the Z's rusted steel stays matte
  m.onBeforeCompile = (shader) => {
    shader.uniforms.teamColor = { value: team };
    shader.fragmentShader = `uniform vec3 teamColor;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 paint = diffuseColor.rgb;
        ${matte && unit ? `// Z units darker and more saturated, like the painted Z buildings (gamma 1.4, saturation 1.5); their team
        // paint and cyan glows untouched. The Mastodonte has it in its texture (and no team rim, so unit is false here).
        float zKeep = max(smoothstep(0.03, 0.12, paint.b - max(paint.r * 1.5, paint.g)), step(0.5, paint.g) * step(0.5, paint.b) * step(paint.r, 0.6 * paint.g));
        vec3 zGraded = pow(paint, vec3(1.4));
        float zLum = dot(zGraded, vec3(0.3, 0.59, 0.11));
        paint = mix(clamp(zLum + (zGraded - zLum) * 1.5, 0.0, 1.0), paint, zKeep);
        diffuseColor.rgb = paint;` : ''}
        float teamMask = smoothstep(0.03, 0.12, paint.b - max(paint.r * 1.5, paint.g));
        ${shiny ? `// Human soldiers: livelier colours, and polished steel that catches the light.
        float lum0 = dot(paint, vec3(0.3, 0.59, 0.11));
        float steel = (1.0 - smoothstep(0.04, 0.1, max(paint.r, max(paint.g, paint.b)) - min(paint.r, min(paint.g, paint.b)))) * smoothstep(0.12, 0.3, lum0) * (1.0 - smoothstep(0.45, 0.6, lum0));
        // Steel brighter; dark warm tones (leather, straps) pushed back, so steel and team colour stand out.
        // Pale cloth (the Soigneur's ivory robe) is left alone: saturated, it turned yellow.
        float leather = smoothstep(0.04, 0.12, paint.r - paint.b) * (1.0 - smoothstep(0.35, 0.5, lum0)) * (1.0 - teamMask);
        paint = mix(paint, vec3(0.72, 0.74, 0.78), steel * 0.7) * (1.0 - 0.45 * leather);` : ''}
        ${vivid ? 'paint = min(mix(vec3(dot(paint, vec3(0.3, 0.59, 0.11))), paint, 1.35) * 1.3 + 0.01, 1.0);' : ''}
        diffuseColor.rgb = mix(paint, teamColor * (dot(paint, vec3(0.3, 0.59, 0.11)) * ${shiny ? '2.2 + 0.04' : '2.4 + 0.08'}), teamMask);
        ${living ? 'vec4 life = lifeGlow(paint, vLife, vSeed, veinTime);\n        diffuseColor.rgb *= life.a;' : ''}
        ${ivory ? `// Isdaris armour is mostly ivory: tint the pale, unsaturated plates too, or sides blur in a melee.
        float lum = dot(paint, vec3(0.3, 0.59, 0.11));
        float chroma = 1.0 - min(paint.r, min(paint.g, paint.b)) / max(max(paint.r, max(paint.g, paint.b)), 0.001);
        float ivoryMask = smoothstep(0.2, 0.4, lum) * (1.0 - smoothstep(0.5, 0.7, chroma)) * (1.0 - teamMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, teamColor * (lum * 1.5 + 0.1), ivoryMask * 0.6);
        teamMask = max(teamMask, ivoryMask * 0.35);` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += teamColor * teamMask * ${shiny ? '0.2' : unit ? '0.7' : '0.3'};${living ? '\n        totalEmissiveRadiance += life.rgb;' : ''}`);
    if (living) {
      // Human buildings come alive: windows and vats (render/life.ts).
      shader.uniforms.veinTime = veinTime;
      shader.vertexShader = `varying vec3 vLife;\nvarying float vSeed;\n${shader.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
        vLife = (modelMatrix * vec4(transformed, 1.0)).xyz - modelMatrix[3].xyz;
        vSeed = fract(sin(dot(floor(modelMatrix[3].xz), vec2(12.9898, 78.233))) * 43758.5453);`);
      shader.fragmentShader = `varying vec3 vLife;\nvarying float vSeed;\nuniform float veinTime;\n${LIFE_GLSL}\n${shader.fragmentShader}`;
    }
  };
  if (shiny) {
    m.envMapIntensity = 3.5;
    const compile = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => {
      compile.call(m, shader, r);
      // Bare steel lightly polished; team paint, leather and cloth stay matte (gloss streaks read as clutter).
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.3, steel);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.6, steel);`);
    };
  }
  m.customProgramCacheKey = () => `team-${color}-${vivid}-${unit}-${ivory}-${matte}`;
  // Units glow in their team colour along the silhouette, so sides read at a glance in a melee. Human soldiers
  // are at 0.3: at 1.0 a bright blue outline ran round every figure and vehicle, which read as dirty from afar.
  // The Dieux keep 1.0: on their white marble (the Minotaure) it is most of their team colour.
  if (unit) rimLight(m, shiny ? (human ? 0.3 : 1.0) : 0.5, team.toArray());
  else rimLight(m, rim);
  return m;
}

/**
 * The Grand Conseil's belfry, from its chosen board (light science-fiction touch, the discreet dose): its few cyan
 * windows lit from inside, and the cyan LED points up its spire blinking each at its own pace. Heights are fractions
 * of the model's (the windows from 0.43 up, the LEDs from 0.73), above the cyan energy lines round its base.
 */
function belfryGlow(m: MeshStandardMaterial, low: number, high: number): void {
  const compile = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    compile.call(m, shader, r);
    // veinTime is already declared and bound by teamSkin's living Human skin.
    shader.vertexShader = `varying vec3 vBelfry;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBelfry = vec3(position.xz, (position.y - ${low.toFixed(4)}) / ${(high - low).toFixed(4)});`);
    shader.fragmentShader = `varying vec3 vBelfry;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float belfryCyan = smoothstep(0.05, 0.2, paint.g - paint.r) * smoothstep(0.05, 0.2, paint.b - paint.r) * smoothstep(0.4, 0.55, paint.g);
      float belfryWindow = belfryCyan * step(0.43, vBelfry.z) * (1.0 - step(0.73, vBelfry.z));
      float belfryCell = fract(sin(dot(floor(vec3(vBelfry.xy * 24.0, vBelfry.z * 60.0)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float belfryBlink = step(0.45, fract(veinTime * (0.5 + belfryCell) + belfryCell * 7.0));
      float belfryLed = belfryCyan * step(0.73, vBelfry.z) * belfryBlink;
      totalEmissiveRadiance += vec3(0.25, 0.95, 1.0) * (belfryWindow * 0.9 + belfryLed * 2.2);`);
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `belfry-${key()}`;
}

/**
 * The light of Fable's Blender Isdaris buildings, by material: cyan lines (`*_lueur`) breathing as the veins do, held to
 * a strength the bloom haloes without whitening; halos (`*_halo`, a disc or square under a floating part) a faint cyan
 * glow fading from the middle; the Portail's veil of lightning and its spires' glass (`voile`, `verre`) rippling, and a
 * blue light hung under its lintel. The marble is toned down from pure white and gets the buildings' faint rim. Their blue bands are `team` (model()); `float_*` levitate (life.ts floaters).
 */
function fableLights(scene: Object3D): void {
  const halos = new Map<Material, ShaderMaterial>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    if (m.name === 'marbre' && !m.userData.dim) {
      // Pure white marble flared in the bloom, past the other Isdaris buildings (the user's remark, 0.9.173).
      m.userData.dim = true;
      m.color.multiplyScalar(0.72);
      // Matte as the Meshy buildings (0.8): at Blender's 0.42 the sun's glint on the terraces and stairs, swollen by the
      // bloom, whitened the Obélisque's whole foot (the user's captures, 0.9.174).
      m.roughness = 0.85;
      rimLight(m, 0.22);
    } else if (m.name.endsWith('_lueur') && !m.userData.vein) {
      m.userData.vein = true;
      m.emissiveIntensity = Math.min(m.emissiveIntensity, 1.1); // the Portail's was 4: it whitened the lintel
      veinGlow(m);
    } else if (m.name === 'orbe_halo') {
      // The Orbe's pool of light on the ground under it: laid a little higher, so the relief does not swallow it.
      o.material = orbGround ??= groundGlow();
      o.position.y += 0.03 / (o.parent?.getWorldScale(new Vector3()).y ?? 1);
      o.userData.noPick = true;
      o.userData.noShadow = true;
    } else if (m.name === 'orbe_coeur' && !m.userData.ripple) {
      // The Orbe's plasma: its Voronoi cells drift round the sphere and ripple, like currents inside it.
      m.userData.ripple = true;
      ripple(m, 1.5, 0.02);
    } else if (m.name.endsWith('_halo')) {
      o.material = halos.get(m) ?? halos.set(m, fableHalo()).get(m)!;
      o.userData.noPick = true;
      o.userData.noShadow = true;
    } else if ((m.name === 'voile' || m.name === 'verre') && !m.userData.ripple) {
      m.userData.ripple = true;
      // Brighter than at first (0.75, 0.5): the user wanted the veil and the glass to shine more (0.9.176), the bloom haloes them.
      m.emissiveIntensity = m.name === 'voile' ? 1.5 : 1.1;
      ripple(m, m.name === 'voile' ? 1 : 0.5);
    }
  });
  const lintel = scene.getObjectByName('float_linteau');
  if (lintel) lintelBeam(scene, lintel);
  footGlow(scene);
  for (const name of ['fx_voile', 'fx_verre_g', 'fx_verre_d']) {
    const o = scene.getObjectByName(name);
    if (o) glowCard(scene, o, name === 'fx_voile' ? 0.5 : 0.3);
  }
}

let cardMaterial: ShaderMaterial | undefined;
/**
 * A soft cyan glow round a flat light (the Portail's veil, its spires' glass), so it radiates past its frame (the user's
 * remark, 0.9.176): a card a little wider and taller than it, standing in its plane, fading to nothing at its edges.
 */
function glowCard(scene: Object3D, light: Object3D, pad: number): void {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(light);
  const size = box.getSize(new Vector3());
  cardMaterial ??= new ShaderMaterial({
    uniforms: { veinTime },
    vertexShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vVein;
      ${VEIN_PULSE}
      void main() {
        vUv = uv;
        vVein = veinPulse(modelMatrix, position, veinTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      varying float vVein;
      void main() {
        float a = (1.0 - smoothstep(0.25, 1.0, abs(vUv.x - 0.5) * 2.0)) * (1.0 - smoothstep(0.55, 1.0, abs(vUv.y - 0.5) * 2.0));
        gl_FragColor = vec4(vec3(0.1, 0.6, 1.0) * 1.5, a * 0.4 * vVein);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const card = new Mesh(new PlaneGeometry(size.x + pad, size.y + pad * 0.6), cardMaterial);
  card.position.copy(box.getCenter(new Vector3()));
  card.userData.noPick = true;
  card.userData.noShadow = true;
  light.attach(card);
}

/**
 * The Obélisque's halo, the square under its floating shaft: Blender laid it on the terrace, under the plinth the shaft
 * hangs over (0.55 against 0.69) and narrower than the shaft's foot, so nothing of it showed (the user's remark,
 * 0.9.175). Laid on the plinth now, widened round the foot, as a crisp cyan glow hugging it, as on the board.
 */
function footGlow(scene: Object3D): void {
  scene.updateMatrixWorld(true);
  const base = scene.getObjectByName('base');
  const quads: Mesh[] = [];
  scene.traverse((o) => o instanceof Mesh && o.name.startsWith('fx_halo') && o.geometry.getAttribute('position').count <= 4 && quads.push(o));
  for (const o of quads) {
    const box = new Box3().setFromObject(o);
    const c = box.getCenter(new Vector3());
    let foot: Box3 | undefined;
    scene.traverse((f) => {
      if (foot || !f.name.startsWith('float_')) return;
      const b = new Box3().setFromObject(f);
      if (c.x > b.min.x && c.x < b.max.x && c.z > b.min.z && c.z < b.max.z && b.min.y > c.y) foot = b;
    });
    if (!foot || !base) continue;
    const hit = new Raycaster(new Vector3(c.x, foot.min.y - 0.01, c.z), new Vector3(0, -1, 0)).intersectObject(base, true)[0];
    const k = ((foot.max.x - foot.min.x) * FOOT_GLOW) / (box.max.x - box.min.x);
    const move = new Matrix4().makeTranslation(c.x, (hit ? hit.point.y : c.y) + 0.015, c.z)
      .multiply(new Matrix4().makeScale(k, 1, k))
      .multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    new Matrix4().copy(o.parent!.matrixWorld).invert().multiply(move).multiply(o.matrixWorld).decompose(o.position, o.quaternion, o.scale);
    o.material = footMaterial ??= glowSquare();
  }
}
/** How wide the Obélisque's foot glow is against the foot itself. */
const FOOT_GLOW = 1.8;
let footMaterial: ShaderMaterial | undefined;
/** A square of light round a square foot: full under it, a bright rim at its edge, fading fast outside. */
function glowSquare(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { veinTime },
    vertexShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vVein;
      ${VEIN_PULSE}
      void main() {
        vUv = uv;
        vVein = veinPulse(modelMatrix, position, veinTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      varying float vVein;
      void main() {
        float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0;
        float edge = ${(1 / FOOT_GLOW).toFixed(4)};
        float glow = d < edge ? 0.85 : 0.85 * exp(-(d - edge) * 14.0);
        float rim = exp(-abs(d - edge) * 50.0) * 0.4;
        // Laid over the marble rather than added to it: added, cyan on white marble only turned white.
        gl_FragColor = vec4(vec3(0.15, 0.95, 1.4) * (0.9 + 0.5 * rim), min(1.0, (glow + rim) * (0.6 + 0.4 * vVein)));
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

let orbGround: ShaderMaterial | undefined;
/** A cyan pool of light on the ground, laid over it (added, it vanished on pale ground): full in the middle, fading out. */
function groundGlow(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { veinTime },
    vertexShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vVein;
      ${VEIN_PULSE}
      void main() {
        vUv = uv;
        vVein = veinPulse(modelMatrix, position, veinTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec2 vUv;
      varying float vVein;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        gl_FragColor = vec4(vec3(0.15, 0.85, 1.3), pow(max(0.0, 1.0 - d), 1.6) * 0.75 * (0.7 + 0.3 * vVein));
      }`,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** A thin cyan glow under a floating part (the Obélisque's shaft, the Trône's crown): small, faint, fading from the middle. */
function fableHalo(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(0.1, 0.65, 1.0) }, veinTime },
    vertexShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vVein;
      ${VEIN_PULSE}
      void main() {
        vUv = uv;
        vVein = veinPulse(modelMatrix, position, veinTime);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 color;
      varying vec2 vUv;
      varying float vVein;
      void main() {
        float a = pow(max(0.0, 1.0 - length(vUv - 0.5) * 2.6), 2.0) * 0.3 * vVein;
        gl_FragColor = vec4(color, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/**
 * The Portail's blue light falling from under its floating lintel onto the arch, as on its board: an open, tapering
 * sleeve hung under the lintel (so it floats with it), bright at the top and fading down, in faint vertical streaks.
 */
function lintelBeam(scene: Object3D, lintel: Object3D): void {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(lintel);
  const size = box.getSize(new Vector3());
  const material = new ShaderMaterial({
    uniforms: { veinTime },
    vertexShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vEdge;
      varying float vVein;
      ${VEIN_PULSE}
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vEdge = abs(dot(normalize(mat3(modelMatrix) * normal), normalize(cameraPosition - world.xyz)));
        vVein = veinPulse(modelMatrix, position, veinTime);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `uniform float veinTime;
      varying vec2 vUv;
      varying float vEdge;
      varying float vVein;
      void main() {
        float streak = 0.55 + 0.45 * sin(vUv.x * 56.5 + veinTime * 0.7);
        float a = pow(vUv.y, 1.6) * streak * pow(vEdge, 1.2) * 0.5 * vVein;
        gl_FragColor = vec4(0.25, 0.6, 1.0, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const beam = new Mesh(new CylinderGeometry(0.5, 0.3, 1, 20, 1, true).translate(0, -0.5, 0), material);
  beam.scale.set(size.x * 0.85, size.x * 0.6, size.z * 0.85);
  beam.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  beam.userData.noPick = true;
  beam.userData.noShadow = true;
  lintel.attach(beam);
}

/** An emissive texture rippling slowly (the lightning bending, the glass shimmering), `amount` 1 for the veil. */
function ripple(m: MeshStandardMaterial, amount: number, scroll = 0): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.veinTime = veinTime;
    shader.vertexShader = `varying float vRipple;\n${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
      vRipple = fract(sin(dot(floor(modelMatrix[3].xz * 2.0), vec2(12.9898, 78.233))) * 43758.5453) * 6.28;`);
    const sample = ShaderChunk.emissivemap_fragment.replace(
      'texture2D( emissiveMap, vEmissiveMapUv )',
      `texture2D( emissiveMap, vEmissiveMapUv + vec2(veinTime * ${scroll.toFixed(4)}, 0.0) + ${(0.012 * amount).toFixed(4)} * vec2(sin(veinTime * 1.7 + vEmissiveMapUv.y * 14.0 + vRipple), sin(veinTime * 0.9 + vEmissiveMapUv.x * 6.0 + vRipple)) )`,
    );
    shader.fragmentShader = `uniform float veinTime;\nvarying float vRipple;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `${sample}
      totalEmissiveRadiance *= 0.9 + 0.15 * sin(veinTime * 2.3 + vRipple) + 0.05 * sin(veinTime * 11.0 + vRipple * 3.0);`);
  };
  m.customProgramCacheKey = () => `ripple-${amount}-${scroll}`;
}

// Pale plates take the team colour on Isdaris armour only: the Dieux keep their marble white, and on the Z's
// rusted steel it blurred into a blue sheen.
const isIsdaris = (type: string) => (DEFS[type] as { faction?: string } | undefined)?.faction === 'isdaris';
const isZ = (type: string) => (DEFS[type] as { faction?: string } | undefined)?.faction === 'z';
const isHuman = (type: string) => (DEFS[type] as { faction?: string } | undefined)?.faction === 'humains';

/** Loads the Blender models; types without one keep their placeholder. */
export async function loadModels(types: string[], onProgress?: (done: number, total: number) => void): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // Meshy models are meshopt-compressed
  let done = 0;
  const count = <T,>(p: Promise<T>, total: number) => p.finally(() => onProgress?.(++done, total));
  // A type drawn with another's model (LOOKS) is loaded only if it has a Meshy model of its own.
  const todo = types.filter((type) => !LOOKS[type] || STATIC_MESHY.includes(type));
  await Promise.all(
    todo.map((type) => count((async () => {
      const character = CHARACTERS[type];
      const meshy = !new URLSearchParams(location.search).has('proc');
      if (meshy && STATIC_MESHY.includes(type)) {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-meshy.glb`);
          gltf.scene.traverse((o) => {
            // From the model's own textured material, not whichever part comes first (a plain added part, the
            // Drone's bin floor, made it the whole model's skin).
            if (o instanceof Mesh && (o.material as Material).name === 'meshy' && !meshySkins.has(type)) meshySkins.set(type, TEAM_COLORS.map((c) => teamSkin(o.material as MeshStandardMaterial, FIXED_TEAM[type] ?? c, DEFS[type]?.kind === 'building' || NO_TEAM_RIM.has(type) ? 0.22 : 0.45, isHuman(type), DEFS[type]?.kind === 'unit' && !NO_TEAM_RIM.has(type), DEFS[type]?.kind === 'unit' && isIsdaris(type), isZ(type), isHuman(type))));
            if (type === 'grandconseil' && o instanceof Mesh && o.material.name === 'meshy') {
              o.geometry.computeBoundingBox();
              meshySkins.get(type)!.forEach((m) => belfryGlow(m, o.geometry.boundingBox!.min.y, o.geometry.boundingBox!.max.y));
            }
          });
          // Some models come out of Meshy facing sideways: turned in a holder, which the animation leaves alone.
          if (DRESSED.includes(type)) {
            try {
              gltf.scene.add((await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-dress.glb`)).scene);
            } catch {
              // not built yet: the bare Meshy model
            }
          }
          if (RIGS[type] && DEFS[type]?.kind === 'unit') procRig(gltf.scene, RIGS[type]);
          fableLights(gltf.scene);
          const holder = new Group();
          gltf.scene.rotation.y = STATIC_YAW[type] ?? 0;
          holder.add(gltf.scene);
          templates.set(type, share(STATIC_YAW[type] ? holder : gltf.scene));
          return;
        } catch {
          // no Meshy model: use the Blender one
        }
      }
      if (meshy && character) {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-meshy.glb`);
          const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
          gltf.scene.scale.setScalar(character.height / size.y);
          centerHips(gltf.scene, gltf.animations);
          let skin: MeshStandardMaterial | undefined;
          gltf.scene.traverse((o) => {
            if (o instanceof SkinnedMesh) skin = o.material as MeshStandardMaterial;
          });
          if (skin && character.weapon) {
            const weapon = (await loader.loadAsync(`${import.meta.env.BASE_URL}models/${character.weapon}-meshy.glb`)).scene;
            weapon.traverse((o) => o instanceof Mesh && litProp(o.material as MeshStandardMaterial));
            if (isHuman(type)) weapon.traverse((o) => o instanceof Mesh && (o.material as MeshStandardMaterial).color.multiplyScalar(1.4));
            arm(gltf.scene, gltf.animations, weapon, character.grip ?? 'rifle');
          }
          if (character.basket) backBasket(gltf.scene, gltf.animations);
          let shield: MeshStandardMaterial | undefined;
          if (skin && character.shield) {
            const board = (await loader.loadAsync(`${import.meta.env.BASE_URL}models/${character.shield}-meshy.glb`)).scene;
            board.traverse((o) => {
              if (!(o instanceof Mesh)) return;
              shield = o.material as MeshStandardMaterial;
              litProp(shield); // and so the team colour, which repaints the base colour's blue, can take
              o.userData.shield = true; // model() gives it the team's copy of its material
            });
            brace(gltf.scene, gltf.animations, board);
          }
          if (skin) {
            // Culling bounds from the rest pose, widened so a lunge or a fall stays inside them; copies inherit them.
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.traverse((o) => {
              if (!(o instanceof SkinnedMesh)) return;
              o.skeleton.update();
              o.computeBoundingSphere();
              o.boundingSphere!.radius *= 2.5;
            });
            rigged.set(type, {
              scene: share(gltf.scene),
              clips: gltf.animations,
              skins: TEAM_COLORS.map((c) => teamSkin(skin!, c, 0.45, false, true, !isHuman(type), false, isHuman(type))),
              // The shield's blue face in each team's colour, as the body's tabard (no rim: the body has one).
              shields: shield && TEAM_COLORS.map((c) => teamSkin(shield!, c, 0)),
            });
            return;
          }
        } catch {
          // no Meshy model: use the Blender one
        }
      }
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}.glb`);
        // Rust, damp and grime: heavy on buildings, light on soldiers, none on mineral fields.
        // Isdaris technology stays almost pristine.
        const d = DEFS[type];
        if (type.startsWith('zw_')) {
          // A Z weapon module: the light wear of the Z machines it sits on, and only a faint rim (a strong warm one read as a
          // pale yellow outline round every module).
          gltf.scene.traverse((o) => o instanceof Mesh && (weather(o.material as Material, 0.05), rimLight(o.material as Material, 0.1)));
          if (WEAPON_DISCS[type]) trimDisc(gltf.scene, WEAPON_DISCS[type]);
          templates.set(type, share(gltf.scene));
          return;
        }
        const isdaris = !!d && 'faction' in d && d.faction !== 'humains'; // Isdaris and Z
        const amount = type.startsWith('minerai') || type === 'puits' ? 0 : (d?.kind === 'unit' ? 0.35 : 1) * (isdaris ? 0.15 : 1);
        if (amount) gltf.scene.traverse((o) => o instanceof Mesh && weather(o.material as Material, amount));
        // Bright silhouette edges on everything but mineral fields, stronger on units.
        if (!type.startsWith('minerai')) gltf.scene.traverse((o) => o instanceof Mesh && rimLight(o.material as Material, d?.kind === 'unit' ? 0.45 : 0.22));
        if (isdaris && d.faction === 'z' && d.kind === 'unit') rigidSkin(gltf.scene);
        if (RIGS[type] && d?.kind === 'unit') procRig(gltf.scene, RIGS[type]);
        templates.set(type, share(type.startsWith('minerai') ? mergeGeodes(gltf.scene) : gltf.scene));
      } catch {
        // keep the placeholder
      }
    })(), todo.length)),
  );
}

/** Layer no camera draws: parts kept only to be measured (legs, wheels, the body's box). */
const MEASURED_ONLY = 31;

/**
 * A Z machine as one skinned mesh per material: a Hexapode's 51 parts become 10 draw calls. Each part is a bone
 * moving only its own vertices, so the legs, shins and wheels the animation turns carry their parts as before.
 * The parts stay where they were, for measuring, on a layer no camera, light or ray sees.
 */
function rigidSkin(scene: Group): void {
  scene.updateMatrixWorld(true);
  const all: Object3D[] = [];
  scene.traverse((o) => all.push(o));
  const bones: Object3D[] = [];
  const parts = new Map<Material, BufferGeometry[]>();
  const hidden: Mesh[] = [];
  for (const o of all) {
    if (!(o instanceof Mesh)) continue;
    hidden.push(o);
    // A node with several materials loads as a group of meshes that do not move on their own: the group is the bone.
    const node = o.parent !== scene && o.matrix.equals(new Matrix4()) ? o.parent! : o;
    const bone = bones.includes(node) ? bones.indexOf(node) : bones.push(node) - 1;
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(o.geometry.attributes as Record<string, BufferAttribute>)) {
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new BufferAttribute(out, a.itemSize));
    }
    g.setIndex(o.geometry.index ? Array.from(o.geometry.index.array) : null);
    g.applyMatrix4(o.matrixWorld);
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new BufferAttribute(new Uint16Array(n * 4).fill(0).map((_, i) => (i % 4 ? 0 : bone)), 4));
    g.setAttribute('skinWeight', new BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
    const list = parts.get(o.material as Material) ?? parts.set(o.material as Material, []).get(o.material as Material)!;
    list.push(g);
  }
  const skins: SkinnedMesh[] = [];
  for (const [material, list] of parts) {
    for (const g of list) for (const name of Object.keys(g.attributes)) if (!list.every((h) => h.getAttribute(name))) g.deleteAttribute(name);
    const geo = mergeGeometries(list);
    if (!geo) return; // parts that do not match: keep the model as it is
    const skin = new SkinnedMesh(geo, material);
    skin.name = (material as Material).name;
    skins.push(skin);
  }
  const skeleton = new Skeleton(bones as never[]);
  for (const skin of skins) {
    scene.add(skin);
    skin.bind(skeleton, new Matrix4());
    skin.skeleton.update();
    skin.computeBoundingBox();
    skin.computeBoundingSphere();
    skin.boundingSphere!.radius *= 1.3; // legs swing out of the rest pose
    skin.userData.rigid = bones.map((b) => all.indexOf(b)); // where each bone sits in the model's traversal order
  }
  for (const o of hidden) o.layers.set(MEASURED_ONLY);
  scene.userData.rigid = true;
}

/**
 * A mineral field as one mesh per material (4 draw calls instead of 16, 30 fields on a map). The small geodes
 * come after the main cluster, the first to be mined out last of all, so mining shortens what is drawn: with k
 * small geodes left, each mesh draws `userData.geodeCounts[k]` indices.
 */
function mergeGeodes(scene: Group): Group {
  scene.updateMatrixWorld(true);
  const order = ['', 'geode_c', 'geode_b', 'geode_a'];
  const parts = new Map<Material, BufferGeometry[][]>();
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    let p: Object3D | null = o;
    while (p && !order.includes(p.name)) p = p.parent;
    const slot = Math.max(0, order.indexOf(p?.name ?? ''));
    // Floats throughout (the packed models quantise normals), placed where the node puts them.
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(o.geometry.attributes as Record<string, BufferAttribute>)) {
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new BufferAttribute(out, a.itemSize));
    }
    g.setIndex(o.geometry.index ? Array.from(o.geometry.index.array) : null);
    g.applyMatrix4(o.matrixWorld);
    const slots = parts.get(o.material as Material) ?? parts.set(o.material as Material, [[], [], [], []]).get(o.material as Material)!;
    slots[slot].push(g);
  });
  const field = new Group();
  for (const [material, slots] of parts) {
    // Only the attributes every part has (the main cluster carries a second UV set nothing reads).
    const all = slots.flat();
    for (const g of all) for (const name of Object.keys(g.attributes)) if (!all.every((h) => h.getAttribute(name))) g.deleteAttribute(name);
    const geo = mergeGeometries(all);
    if (!geo) return scene; // parts that do not match: keep the model as it is
    const counts = [0, 0, 0, 0];
    let n = 0;
    slots.forEach((list, k) => {
      for (const g of list) n += g.index ? g.index.count : g.getAttribute('position').count;
      counts[k] = n;
    });
    const mesh = new Mesh(geo, material);
    mesh.userData.geodeCounts = counts;
    field.add(mesh);
  }
  return field;
}

/**
 * Keeps a rigged character over its own feet. Some Meshy clips carry the hips well off the origin (the Archer's
 * stance by 0.3 tile), so the body was drawn beside its selection ring and its click zone. Each clip's hips are
 * shifted, on the ground plane only, so that on average they stand where they rest; a clip's own sway is kept.
 * The death clip takes the idle's shift, so the fall starts where the body stood.
 */
function centerHips(character: Group, clips: AnimationClip[]): void {
  const hips = character.getObjectByName('Hips');
  if (!hips?.parent) return;
  character.updateMatrixWorld(true);
  const up = new Vector3(0, 1, 0).transformDirection(hips.parent.matrixWorld.clone().invert()).normalize();
  const shift = (clip: AnimationClip): Vector3 | undefined => {
    const track = clip.tracks.find((t) => t.name === `${hips.name}.position`);
    if (!track) return undefined;
    const n = track.values.length / 3;
    const d = new Vector3();
    for (let i = 0; i < n; i++) d.add(new Vector3().fromArray(track.values, i * 3));
    d.divideScalar(n).sub(hips.position);
    return d.addScaledVector(up, -d.dot(up));
  };
  const apply = (clip: AnimationClip, d: Vector3): void => {
    const track = clip.tracks.find((t) => t.name === `${hips.name}.position`)!;
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] -= d.x;
      track.values[i + 1] -= d.y;
      track.values[i + 2] -= d.z;
    }
  };
  const idle = clips.find((c) => c.name === CLIP.idle);
  const idleShift = idle && shift(idle);
  for (const clip of clips) {
    const d = clip.name === CLIP.die ? idleShift : shift(clip);
    if (d && clip.tracks.some((t) => t.name === `${hips.name}.position`)) apply(clip, d);
  }
}

/**
 * Puts the weapon in the character's right hand, posed as in the idle clip: a rifle's barrel points at
 * the left hand, a pole stands up and forward, a drill points down. Parented to the hand bone, it follows every animation.
 */
export function arm(character: Group, clips: AnimationClip[], weapon: Group, grip: Grip): void {
  const stance = clips.find((c) => c.name === 'idle');
  const right = character.getObjectByName('RightHand');
  const left = character.getObjectByName('LeftHand');
  if (!stance || !right || !left) return;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(stance).play();
  mixer.update(0);
  character.updateMatrixWorld(true);
  weapon.position.copy(right.getWorldPosition(new Vector3()));
  weapon.scale.setScalar(character.scale.x);
  const aim = { rifle: left.getWorldPosition(new Vector3()), hast: left.getWorldPosition(new Vector3()), pole: weapon.position.clone().add(new Vector3(0, 1, 0.45)), drill: weapon.position.clone().add(new Vector3(0, -1, 0.35)) };
  // Its point along +Z (prop.py), in its own units, measured while it is only moved and scaled: a drilling Serf puts it
  // on the ground (units.ts, holdBit).
  weapon.updateMatrixWorld(true);
  weapon.name = 'held';
  weapon.userData.tip = (new Box3().setFromObject(weapon, true).max.z - weapon.position.z) / weapon.scale.z;
  weapon.lookAt(aim[grip]);
  // A prop built of flat faces (tools/meshy/lancegrenades.py, a glTF extra on its node) opts out of the rim light: seen
  // edge-on by the high camera, whole faces went white.
  let rim = true;
  weapon.traverse((o) => {
    if (o.userData.noRim) rim = false;
  });
  weapon.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    if (rim) rimLight(o.material as Material, 0.45);
  });
  weapon.updateMatrixWorld();
  right.attach(weapon);
  // Its pose in the hand, to go back to when a drilling pose let it go.
  weapon.userData.rest = [...weapon.position.toArray(), ...weapon.quaternion.toArray()];
  mixer.stopAllAction();
}

/** A body of revolution standing on y = 0, flattened against the back (the model faces +Z). */
function vessel(profile: number[][], k: number, material: Material, segments: number): Mesh {
  const m = new Mesh(new LatheGeometry(profile.map(([r, y]) => new Vector2(r * k, y * k)), segments), material);
  m.scale.set(0.85, 1, 0.72);
  return m;
}

/** A ring round the carrier at height `y` (a band, a strap), as flattened as the carrier. */
function band(r: number, y: number, tube: number, k: number, material: Material): Mesh {
  const m = new Mesh(new TorusGeometry(r * k, tube * k, 4, 16), material);
  m.rotation.x = Math.PI / 2;
  m.position.y = y * k;
  m.scale.set(0.85, 0.72, 1);
  return m;
}

/**
 * The Serf's back carrier, as on its board but in riveted sheet metal: the steel and brass of its jackhammer with a
 * small glowing cyan cell. Its load, a heap
 * of the field's glowing ore named `cargo`, shows only while the Serf carries (render/units.ts). Two shoulder straps
 * run from its top over the shoulders down the chest. Placed as the idle clip holds the body, then parented to the
 * upper spine: it bends with the drill pose, walks, falls and darkens (toCorpse) with the body.
 */
function backBasket(character: Group, clips: AnimationClip[]): void {
  const spine = character.getObjectByName('Spine');
  const shoulders = [character.getObjectByName('LeftArm'), character.getObjectByName('RightArm')].filter((o): o is Object3D => !!o);
  const stance = clips.find((c) => c.name === 'idle');
  if (!spine || !stance || shoulders.length < 2) return;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(stance).play();
  mixer.update(0);
  character.updateMatrixWorld(true);
  const height = new Box3().setFromObject(character, true).getSize(new Vector3()).y;
  const k = height / 0.72; // drawn for a 0.72 Serf
  const leather = mat(0x3d2817, { roughness: 0.85 });
  const brass = mat(0xb08a3a, { metalness: 0.8, roughness: 0.35 });
  const carrier = new Group();
  carrier.name = 'basket';
  const steel = mat(0x9ca2a8, { metalness: 0.6, roughness: 0.45, flatShading: true, side: DoubleSide });
  carrier.add(vessel([[0, 0], [0.068, 0], [0.072, 0.01], [0.09, 0.19], [0.095, 0.2]], k, steel, 8));
  carrier.add(band(0.074, 0.03, 0.009, k, brass), band(0.092, 0.185, 0.01, k, brass));
  // Rivets along the upper band.
  for (let n = 0; n < 8; n++) {
    const a = (n / 8) * Math.PI * 2;
    const rivet = new Mesh(new SphereGeometry(0.006 * k, 4, 3), brass);
    rivet.position.set(Math.cos(a) * 0.094 * k * 0.85, 0.15 * k, Math.sin(a) * 0.094 * k * 0.72);
    carrier.add(rivet);
  }
  // A small power cell on the outside of its back, a touch of the jackhammer's cyan, not a lantern.
  const cell = new Mesh(new CapsuleGeometry(0.009 * k, 0.045 * k, 3, 8), mat(0x3ccbe8, { emissive: 0x1fa8d8, emissiveIntensity: 0.55, roughness: 0.3 }));
  cell.position.set(0, 0.1 * k, -0.072 * k);
  carrier.add(cell);
  for (const y of [0.07, 0.13]) {
    const cap = new Mesh(new CylinderGeometry(0.012 * k, 0.012 * k, 0.008 * k, 8), brass);
    cap.position.set(0, y * k, -0.072 * k);
    carrier.add(cap);
  }
  // The load: lumps of the field's glowing ore heaped above the rim, high enough to show over the shoulders.
  const cargo = new Group();
  cargo.name = 'cargo';
  const top = 0.2;
  const lumps: [number, number, number, number][] = [[0, 0.015, 0, 0.055], [0.04, 0, 0.02, 0.042], [-0.04, 0, -0.015, 0.04], [0.012, 0.05, -0.01, 0.04], [-0.02, 0.01, 0.035, 0.034], [0.02, 0.03, 0.03, 0.03]];
  for (const [x, y, z, r] of lumps) {
    const lump = new Mesh(new IcosahedronGeometry(r * k, 0), ore);
    lump.position.set(x * k, (top + y) * k, z * k);
    lump.rotation.set(x * 40, y * 30, z * 50);
    cargo.add(lump);
  }
  cargo.visible = false;
  carrier.add(cargo);
  // On the back, between the shoulder blades and the waist, its top tipped back a little.
  const at = spine.getWorldPosition(new Vector3());
  carrier.position.set(at.x, at.y - 0.14 * height, at.z - 0.095 * height);
  carrier.rotation.x = -0.18;
  // Shoulder straps (world points, the stance's): from the carrier's top, over each shoulder, down the chest.
  const straps = new Group();
  for (const shoulder of shoulders) {
    const s = shoulder.getWorldPosition(new Vector3());
    const dx = s.x - at.x;
    const pts = [
      new Vector3(at.x + dx * 0.55, at.y + 0.1 * height, at.z - 0.085 * height),
      new Vector3(at.x + dx * 0.7, s.y + 0.03 * height, at.z - 0.03 * height),
      new Vector3(at.x + dx * 0.72, s.y + 0.02 * height, at.z + 0.045 * height),
      new Vector3(at.x + dx * 0.65, s.y - 0.1 * height, at.z + 0.075 * height),
      new Vector3(at.x + dx * 0.6, s.y - 0.22 * height, at.z + 0.07 * height),
    ];
    straps.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 12, 0.006 * k, 4), leather));
  }
  for (const part of [carrier, straps]) {
    part.traverse((o) => {
      if (o instanceof Mesh) o.castShadow = true;
    });
    part.updateMatrixWorld(true);
    spine.attach(part);
  }
  mixer.stopAllAction();
}

/**
 * Rodin Low Poly's 'Shaded' export paints a prop in its emissive map over a black base colour: lit by nothing, a
 * carbine read white. Moved into the base colour, it shades like the body that holds it.
 */
function litProp(m: MeshStandardMaterial): void {
  if (m.map || !m.emissiveMap) return;
  m.map = m.emissiveMap;
  m.emissiveMap = null;
  m.color.set(0xffffff);
  m.emissive.set(0);
  m.needsUpdate = true;
}

/**
 * A shield on the left arm: its face turned forward and a little out to the left, upright, its middle at the left
 * hand as the idle clip holds it, then parented to that hand so it follows every swing and falls with the body.
 * The board comes from prop.py (longest side along +Z, its thinnest across the face).
 */
function brace(character: Group, clips: AnimationClip[], board: Group): void {
  const stance = clips.find((c) => c.name === 'idle');
  const hand = character.getObjectByName('LeftHand');
  if (!stance || !hand) return;
  const mixer = new AnimationMixer(character);
  mixer.clipAction(stance).play();
  mixer.update(0);
  character.updateMatrixWorld(true);
  board.scale.setScalar(character.scale.x);
  board.updateMatrixWorld(true);
  const box = new Box3().setFromObject(board, true);
  const size = box.getSize(new Vector3());
  const centre = box.getCenter(new Vector3());
  // Its axes: tall along Z (prop.py), thin across X or Y; the face looks along the thin one.
  const thin = size.x < size.y ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const wide = size.x < size.y ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  // Into the world: tall up, the face forward (+Z, the model's front) turned 20 degrees out to the left (+X).
  const face = new Vector3(Math.sin(0.35), 0, Math.cos(0.35));
  const up = new Vector3(0, 1, 0);
  const across = new Vector3().crossVectors(up, face);
  // The Rodin board's painted face looks down its thin axis's negative side (its handle is on the positive one).
  const from = new Matrix4().makeBasis(wide.clone().negate(), thin.clone().negate(), new Vector3(0, 0, 1));
  const to = new Matrix4().makeBasis(across, face, up);
  const turn = to.multiply(from.invert());
  const holder = new Group();
  holder.name = 'shield';
  board.position.sub(centre); // its middle on the holder's origin
  board.applyMatrix4(turn);
  holder.add(board);
  // Held a little out from the hand, on the outside of the forearm, the face outwards.
  holder.position.copy(hand.getWorldPosition(new Vector3())).addScaledVector(face, 0.06 * size.z);
  holder.updateMatrixWorld(true);
  hand.attach(holder);
  mixer.stopAllAction();
}

/** Frees what a preview copy allocated for itself (its cloned skeletons' bone textures, a placeholder's shapes). */
export function freePreview(object: Object3D): void {
  free(object);
}

/** A fresh copy of a type's model in a team's colours, with its clips when rigged (HUD portrait). */
export function preview(type: string, owner: number): { object: Group; clips: AnimationClip[] } {
  const object = model(type, teamMaterials[owner] ?? teamMaterials[0]);
  return { object, clips: (object.userData.clips as AnimationClip[] | undefined) ?? [] };
}

/** Frames drawn so far (EntityRenderer.sync counts them). */
export const skinClock = { frame: 0 };
/**
 * A made-up skeleton works its bones out and uploads them once a frame: three does it once a render, and the ambient
 * occlusion's normal pass is a render of its own (160 Dieux: 320 bone uploads a frame instead of 160).
 */
function onceAFrame(s: Skeleton): Skeleton {
  let last = -1;
  const update = s.update.bind(s);
  s.update = () => {
    if (last === skinClock.frame) return;
    last = skinClock.frame;
    update();
  };
  return s;
}

/** A copy of a Blender model; `seed` picks its graffiti. */
export function model(type: string, team: Material, seed = 0): Group {
  if (!templates.has(type)) type = LOOKS[type] ?? type;
  const r = rigged.get(type);
  if (r) {
    const g = new Group();
    const character = cloneSkinned(r.scene);
    const k = Math.max(0, teamMaterials.indexOf(team as MeshStandardMaterial));
    character.traverse((o) => {
      if (o instanceof Mesh && o.userData.shield && r.shields) o.material = r.shields[k] ?? r.shields[0];
      if (!(o instanceof SkinnedMesh)) return;
      o.material = r.skins[k] ?? r.skins[0];
      o.castShadow = true;
      o.receiveShadow = true;
    });
    g.add(character);
    g.userData.clips = r.clips;
    return g;
  }
  const t = templates.get(type);
  if (!t) return placeholder(type, team);
  const g = t.clone(true);
  // The Dieux (godrig): a skeleton of its own, its bones cloned out of the scene as the template's.
  if (t.userData.rig) {
    let own: Skeleton | undefined;
    g.traverse((o) => {
      if (!(o instanceof SkinnedMesh && o.userData.godRig)) return;
      if (!own) {
        const src = o.skeleton;
        const root = src.bones[0].clone(true);
        root.updateMatrixWorld(true);
        own = onceAFrame(new Skeleton(src.bones.map((b, i) => (i ? root.getObjectByName(b.name)! : root)) as never[], src.boneInverses));
      }
      o.bind(own, o.bindMatrix);
    });
  }
  // Z machines (rigidSkin): the copy's skins follow the copy's nodes (the skins come last in the traversal).
  if (t.userData.rigid) {
    const nodes: Object3D[] = [];
    g.traverse((o) => nodes.push(o));
    // One skeleton per copy, shared by its meshes as by the template's: three works it out once a frame.
    const skeletons = new Map<Skeleton, Skeleton>();
    for (const o of nodes) {
      if (!(o instanceof SkinnedMesh && o.userData.rigid)) continue;
      const own = skeletons.get(o.skeleton) ?? skeletons.set(o.skeleton, onceAFrame(new Skeleton((o.userData.rigid as number[]).map((i) => nodes[i]) as never[], o.skeleton.boneInverses))).get(o.skeleton)!;
      o.bind(own, o.bindMatrix);
    }
  }
  let tagIndex = 0;
  const veins: [Mesh, ShaderMaterial][] = [];
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = !o.userData.noShadow;
    o.receiveShadow = true;
    const name = (o.material as Material).name;
    if (name === 'meshy') o.material = meshySkins.get(type)?.[teamMaterials.indexOf(team as MeshStandardMaterial)] ?? o.material;
    const ti = teamMaterials.indexOf(team as MeshStandardMaterial);
    if (name === 'team') o.material = o.geometry.getAttribute('color') ? (teamPainted[ti] ?? team) : team;
    const map = (o.material as MeshStandardMaterial).map;
    if (name === 'team_canvas' && map) o.material = teamCloth(map, ti);
    if (name === 'team_glow' && teamGlow[ti]) {
      o.material = teamGlow[ti];
      veins.push([o, veinHalo[ti]]);
    }
    if (name === 'tag') {
      const tags = graffiti();
      o.material = tagMaterial(tags[(seed * 7 + tagIndex++) % tags.length]);
      o.castShadow = false;
    }
  });
  // Halos added after the walk, so it does not give them shadows.
  for (const [o, m] of veins) {
    const halo = new Mesh(haloShape(o.geometry), m);
    halo.userData.noPick = true;
    o.add(halo);
  }
  const d = DEFS[type];
  if (d && 'faction' in d && d.faction === 'dieux' && d.kind === 'unit' && d.unique) {
    // Only the body selects a god (balance designer 2026-11-22): its circle, halo and aura were caught too, a click
    // well off its figure took it. Its own meshes go see-through for clicks, an unseen column over the body instead.
    g.traverse((o) => (o.userData.noPick = true));
    godAura(g, t);
    // The Blender gods stand in a cyan circle of their own; the image-to-3D ones get it here.
    if (STATIC_MESHY.includes(type)) godRing(g, (d as UnitDef).radius);
    godPick(g, godWidth.get(t)!, godTop.get(t)!);
  }
  return g;
}

/**
 * A god's halo: a soft disc of gold light behind the head and a fainter glow round the body, always facing the
 * camera, so the four gods read as gods among their troops (the user's rule for the Dieux).
 */
const godTop = new WeakMap<Object3D, number>();
let auraTexture: CanvasTexture | undefined;
const godWidth = new WeakMap<Object3D, number>();
let pickMaterial: MeshBasicMaterial | undefined;
/**
 * An unseen column over a god's body, what a click or a box catches it by: a sixth of its model's width (its circle on
 * the ground included) across, up to its shoulders.
 */
function godPick(g: Object3D, width: number, top: number): void {
  pickMaterial ??= new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const [r, h] = [width / 6, top * 0.8];
  const column = new Mesh(new CylinderGeometry(r, r, h, 12).translate(0, h / 2, 0), pickMaterial);
  column.castShadow = false;
  g.add(column);
}

let ringMaterial: MeshBasicMaterial | undefined;
/** A god's cyan circle on the ground, as the Blender gods have (gods.py god_circle). */
function godRing(g: Object3D, radius: number): void {
  ringMaterial ??= new MeshBasicMaterial({ color: 0x7ff0e0, transparent: true, opacity: 0.8, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  for (const [inner, outer] of [[0.86, 0.9], [0.95, 0.99]]) {
    const ring = new Mesh(new RingGeometry(radius * inner, radius * outer, 64).rotateX(-Math.PI / 2), ringMaterial);
    ring.position.y = 0.03;
    ring.userData.noPick = true;
    ring.raycast = () => {};
    g.add(ring);
  }
}

function godAura(g: Object3D, template: Object3D): void {
  let top = godTop.get(template);
  if (top === undefined) {
    const box = new Box3().setFromObject(template);
    godTop.set(template, (top = box.max.y));
    godWidth.set(template, Math.max(box.max.x - box.min.x, box.max.z - box.min.z));
  }
  if (!auraTexture) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    const grad = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,240,200,0.9)');
    grad.addColorStop(0.35, 'rgba(255,214,130,0.45)');
    grad.addColorStop(0.7, 'rgba(120,240,220,0.15)');
    grad.addColorStop(1, 'rgba(120,240,220,0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, 128, 128);
    auraTexture = new CanvasTexture(c);
    auraTexture.colorSpace = SRGBColorSpace;
  }
  const glow = (size: number, y: number, opacity: number) => {
    const s = new Sprite(owned(new SpriteMaterial({ map: auraTexture, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending })));
    s.scale.set(size, size, 1);
    s.position.set(0, y, -0.05 * top!);
    s.userData.noPick = true;
    s.raycast = () => {};
    g.add(s);
  };
  glow(top * 0.6, top * 0.86, 0.75); // behind the head
  glow(top * 0.85, top * 0.55, 0.12); // round the body
}

const haloShapes = new WeakMap<BufferGeometry, BufferGeometry>();
/** A vein's shape with its seams welded and normals smoothed, so the halo swells as one soft tube instead of splitting at hard edges. */
export function haloShape(geo: BufferGeometry): BufferGeometry {
  let shape = haloShapes.get(geo);
  if (!shape) {
    const bare = new BufferGeometry().setAttribute('position', geo.getAttribute('position'));
    bare.setIndex(geo.getIndex());
    shape = mergeVertices(bare, 1e-3);
    shape.computeVertexNormals();
    haloShapes.set(geo, shape);
    SHARED.add(shape);
  }
  return shape;
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
      add(new SphereGeometry(0.12, 6, 4), ore, 0, 0.55, -0.22).name = 'cargo';
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
      add(new ConeGeometry(0.28, 0.9, 5), ore, -0.12, 0.45, 0.05);
      add(new ConeGeometry(0.22, 0.65, 5), ore, 0.2, 0.32, -0.1).rotation.z = -0.3;
      add(new ConeGeometry(0.18, 0.5, 5), ore, 0.05, 0.25, 0.25).rotation.x = 0.4;
      break;
    case 'puits':
      add(new CylinderGeometry(1.4, 1.5, 0.12, 20), darkStone, 0, 0.06, 0);
      add(new CylinderGeometry(0.8, 0.8, 0.14, 20), wellGlow, 0, 0.08, 0);
      break;
    case 'minechimique': {
      // Char Pégase's chemical mine: a squat steel drum half dug in, a team band, a glowing green charge under a grille
      // and three pressure prongs.
      add(new CylinderGeometry(0.26, 0.3, 0.12, 14), steel, 0, 0.04, 0);
      add(new CylinderGeometry(0.265, 0.265, 0.04, 14), team, 0, 0.1, 0);
      add(new CylinderGeometry(0.14, 0.17, 0.08, 12), toxic, 0, 0.14, 0);
      add(new BoxGeometry(0.3, 0.02, 0.03), steel, 0, 0.19, 0);
      add(new BoxGeometry(0.03, 0.02, 0.3), steel, 0, 0.19, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        add(new CylinderGeometry(0.012, 0.012, 0.12, 5), steel, Math.cos(a) * 0.2, 0.18, Math.sin(a) * 0.2);
      }
      break;
    }
    default: {
      // New buildings without a model: a block of their footprint, team-coloured on top.
      const d = DEFS[type];
      if (d?.kind !== 'building') {
        body(0.3);
        break;
      }
      add(new BoxGeometry(d.size * 0.85, 0.9, d.size * 0.85), stone, 0, 0.45, 0);
      add(new SphereGeometry(d.size * 0.25, 12, 8), team, 0, 1.1, 0);
    }
  }
  return g;
}
/** Clip roles baked by tools/meshy/pack.py; only idle, walk and die are always there. */
export const CLIP = { idle: 'idle', walk: 'walk', attack: 'attack', fire: 'fire', work: 'work', carry: 'carry', die: 'die', drill: 'drill', aim: 'aim', crouch: 'crouch' };
