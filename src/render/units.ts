import {
  AdditiveBlending, Box3, CanvasTexture, SRGBColorSpace, Color, PlaneGeometry, BoxGeometry, CapsuleGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, AnimationMixer, type AnimationAction, type AnimationClip, LoopOnce, SkinnedMesh, RingGeometry, SphereGeometry, type BufferGeometry, type Material, type Scene, type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { type BuildingDef, DEFS, type UnitDef } from '../data';
import { graffiti, rimLight, weather } from './weathering';
import { type GameMap, heightAt } from '../map';
import { FP, GAME_SPEED, ticks } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

/** Player colours: blue, red, green, purple. */
export const TEAM_COLORS = [0x3a7bd5, 0xc8402f, 0x38b04c, 0x9a52d8];
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
const scaffoldMaterial = new LineBasicMaterial({ color: 0xd9a420 });

/** Pools of light on the ground around glowing things: [x, z offset, radius, colour]. */
const POOLS: Record<string, [number, number, number, number][]> = {
  conseil: [[0.2, 1.9, 1.7, 0xffa040], [-1.4, 2.0, 0.9, 0xff7020]],
  caserne: [[0, 1.6, 1.3, 0xffb050]],
  grenier: [[0, 1.0, 0.8, 0xffc070]],
  mine: [[1.0, -0.9, 1.0, 0xff8030], [0.3, 0.6, 1.0, 0xb060ff]],
  obelisque: [[0, 0, 2.6, 0xffd070]],
  emetteur: [[0, 0, 1.6, 0x40d8ff]],
  reservepsy: [[0, 0, 1.5, 0xb070ff]],
  portail: [[0, 0.4, 1.8, 0x40d8ff]],
  recepteur: [[0, 0, 1.6, 0xb070ff]],
  minerai: [[0, 0, 1.0, 0x3aa8ff]],
  puits: [[0, 0, 2.4, 0xb060ff]],
};
let poolTexture: Texture | null = null;
/** Buildings standing on a paved plaza wider than their model: [plaza width, raised inner step width]. */
const PLAZAS: Record<string, [number, number]> = { obelisque: [4.7, 3.1] };
let plazaMaterials: [MeshStandardMaterial, MeshStandardMaterial] | null = null;

/** An Art Deco forecourt: ivory slabs with gold inlays, a sunburst and blue enamel corners, in two low steps. */
function plaza(width: number, inner: number): Group {
  if (!plazaMaterials) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d')!;
    g.fillStyle = '#e4d9c1';
    g.fillRect(0, 0, 512, 512);
    // Slab joints.
    g.strokeStyle = 'rgba(120, 100, 70, 0.35)';
    g.lineWidth = 2;
    for (let i = 64; i < 512; i += 64) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 512);
      g.moveTo(0, i);
      g.lineTo(512, i);
      g.stroke();
    }
    // Sunburst from the centre, then concentric gold frames.
    g.strokeStyle = '#c9a23e';
    g.lineWidth = 5;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      g.beginPath();
      g.moveTo(256 + Math.cos(ang) * 70, 256 + Math.sin(ang) * 70);
      g.lineTo(256 + Math.cos(ang) * 230, 256 + Math.sin(ang) * 230);
      g.stroke();
    }
    for (const [m, w] of [[14, 10], [40, 5], [150, 6]] as const) {
      g.lineWidth = w;
      g.strokeRect(m, m, 512 - 2 * m, 512 - 2 * m);
    }
    // Blue enamel corners.
    g.fillStyle = '#2a4ea8';
    for (const [x, y, dx, dy] of [[0, 0, 1, 1], [512, 0, -1, 1], [0, 512, 1, -1], [512, 512, -1, -1]] as const) {
      g.beginPath();
      g.moveTo(x + dx * 22, y + dy * 22);
      g.lineTo(x + dx * 110, y + dy * 22);
      g.lineTo(x + dx * 22, y + dy * 110);
      g.closePath();
      g.fill();
    }
    const map = new CanvasTexture(c);
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    plazaMaterials = [
      new MeshStandardMaterial({ map, color: 0x9a927f, roughness: 0.8 }),
      new MeshStandardMaterial({ color: 0x8e8572, roughness: 0.85 }),
    ];
  }
  const [top, side] = plazaMaterials;
  const group = new Group();
  for (const [w, y, h] of [[width, 0, 0.14], [inner, 0.14, 0.1]] as const) {
    // Top face textured, sides plain stone.
    const slab = new Mesh(new BoxGeometry(w, h, w), [side, side, top, side, side, side]);
    slab.position.y = y + h / 2;
    slab.receiveShadow = true;
    group.add(slab);
  }
  return group;
}

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

/**
 * Models made with Meshy (tools/meshy), `<type>-meshy.glb`, preferred over the Blender ones
 * (`?proc` keeps the Blender ones). Rigged characters carry their animation clips, named by role,
 * and a weapon prop (`<weapon>-meshy.glb`, along +Z, grip at the origin) in the right hand:
 * a `rifle` points at the left hand, a `pole` (hammer, axe, staff) stands up and forward, a `drill`
 * (jackhammer) points down and forward.
 * Static ones (robots, beasts) are plain textured meshes, already sized by normalize.py.
 */
type Grip = 'rifle' | 'pole' | 'drill';
const CHARACTERS: Record<string, { height: number; weapon?: string; grip?: Grip }> = {
  auxiliaire: { height: 0.86, weapon: 'fusil', grip: 'rifle' },
  serf: { height: 0.72, weapon: 'piqueur', grip: 'drill' }, // puny next to the soldiers
  legionnaire: { height: 0.95, weapon: 'scie', grip: 'pole' },
  soigneur: { height: 0.86, weapon: 'injecteur', grip: 'rifle' },
  archer: { height: 0.92, weapon: 'rayon', grip: 'rifle' },
  druide: { height: 0.95, weapon: 'baton', grip: 'pole' },
  phalangiste: { height: 0.9, weapon: 'lancegrenades', grip: 'rifle' },
  discobole: { height: 1.0 },
  creature: { height: 0.45 }, // four legs, rigged in Blender (tools/meshy/quadruped.py)
  assassin: { height: 0.9 },
};
const STATIC_MESHY = ['moissonneur', 'conseil', 'grenier', 'caserne', 'mine', 'obelisque', 'emetteur', 'reservepsy', 'portail', 'recepteur', 'forge', 'tour', 'orbe', 'nanoassembleur', 'fortin', 'recepteurarme', 'pylonesanglant'];
const rigged = new Map<string, { scene: Group; clips: AnimationClip[]; skins: MeshStandardMaterial[] }>();
/** Team-coloured materials of the static Meshy models, by type. */
const meshySkins = new Map<string, MeshStandardMaterial[]>();

/**
 * Repaints the texture's blue team stripes in the team colour, with a faint glow. `vivid` lifts
 * dull rust-and-dust textures (Human buildings): more saturation and light, so they read on the ground.
 */
function teamSkin(source: MeshStandardMaterial, color: number, rim = 0.45, vivid = false, unit = false, ivory = false): MeshStandardMaterial {
  const m = source.clone();
  const team = new Color(color);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.teamColor = { value: team };
    shader.fragmentShader = `uniform vec3 teamColor;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec3 paint = diffuseColor.rgb;
        float teamMask = smoothstep(0.03, 0.12, paint.b - max(paint.r * 1.5, paint.g));
        ${vivid ? 'paint = min(mix(vec3(dot(paint, vec3(0.3, 0.59, 0.11))), paint, 1.35) * 1.3 + 0.01, 1.0);' : ''}
        diffuseColor.rgb = mix(paint, teamColor * (dot(paint, vec3(0.3, 0.59, 0.11)) * 2.4 + 0.08), teamMask);
        ${ivory ? `// Isdaris armour is mostly ivory: tint the pale, unsaturated plates too, or sides blur in a melee.
        float lum = dot(paint, vec3(0.3, 0.59, 0.11));
        float chroma = 1.0 - min(paint.r, min(paint.g, paint.b)) / max(max(paint.r, max(paint.g, paint.b)), 0.001);
        float ivoryMask = smoothstep(0.2, 0.4, lum) * (1.0 - smoothstep(0.5, 0.7, chroma)) * (1.0 - teamMask);
        diffuseColor.rgb = mix(diffuseColor.rgb, teamColor * (lum * 1.5 + 0.1), ivoryMask * 0.6);
        teamMask = max(teamMask, ivoryMask * 0.35);` : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += teamColor * teamMask * ${unit ? '0.7' : '0.3'};`);
  };
  m.customProgramCacheKey = () => `team-${color}-${vivid}-${unit}-${ivory}`;
  // Units glow in their team colour along the silhouette, so sides read at a glance in a melee.
  if (unit) rimLight(m, 0.5, team.toArray());
  else rimLight(m, rim);
  return m;
}

const isHuman = (type: string) => (DEFS[type] as { faction?: string } | undefined)?.faction === 'humains';

/** Loads the Blender models; types without one keep their placeholder. */
export async function loadModels(types: string[]): Promise<void> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // Meshy models are meshopt-compressed
  await Promise.all(
    types.map(async (type) => {
      const character = CHARACTERS[type];
      const meshy = !new URLSearchParams(location.search).has('proc');
      if (meshy && STATIC_MESHY.includes(type)) {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-meshy.glb`);
          gltf.scene.traverse((o) => {
            if (o instanceof Mesh && !meshySkins.has(type)) meshySkins.set(type, TEAM_COLORS.map((c) => teamSkin(o.material as MeshStandardMaterial, c, DEFS[type]?.kind === 'building' ? 0.22 : 0.45, isHuman(type), DEFS[type]?.kind === 'unit', DEFS[type]?.kind === 'unit' && !isHuman(type))));
          });
          templates.set(type, gltf.scene);
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
          let skin: MeshStandardMaterial | undefined;
          gltf.scene.traverse((o) => {
            if (o instanceof SkinnedMesh) skin = o.material as MeshStandardMaterial;
          });
          if (skin && character.weapon) {
            const weapon = (await loader.loadAsync(`${import.meta.env.BASE_URL}models/${character.weapon}-meshy.glb`)).scene;
            if (isHuman(type)) weapon.traverse((o) => o instanceof Mesh && (o.material as MeshStandardMaterial).color.multiplyScalar(1.4));
            arm(gltf.scene, gltf.animations, weapon, character.grip ?? 'rifle');
          }
          if (skin) {
            rigged.set(type, { scene: gltf.scene, clips: gltf.animations, skins: TEAM_COLORS.map((c) => teamSkin(skin!, c, 0.45, false, true, !isHuman(type))) });
            return;
          }
        } catch {
          // no Meshy model: use the Blender one
        }
      }
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

/**
 * Puts the weapon in the character's right hand, posed as in the idle clip: a rifle's barrel points at
 * the left hand, a pole stands up and forward, a drill points down. Parented to the hand bone, it follows every animation.
 */
function arm(character: Group, clips: AnimationClip[], weapon: Group, grip: Grip): void {
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
  const aim = { rifle: left.getWorldPosition(new Vector3()), pole: weapon.position.clone().add(new Vector3(0, 1, 0.45)), drill: weapon.position.clone().add(new Vector3(0, -1, 0.35)) };
  weapon.lookAt(aim[grip]);
  weapon.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    rimLight(o.material as Material, 0.45);
  });
  weapon.updateMatrixWorld();
  right.attach(weapon);
  mixer.stopAllAction();
}

/** A fresh copy of a type's model in a team's colours, with its clips when rigged (HUD portrait). */
export function preview(type: string, owner: number): { object: Group; clips: AnimationClip[] } {
  const object = model(type, teamMaterials[owner] ?? teamMaterials[0]);
  return { object, clips: (object.userData.clips as AnimationClip[] | undefined) ?? [] };
}

/** A copy of a Blender model; `seed` picks its graffiti. */
function model(type: string, team: Material, seed = 0): Group {
  const r = rigged.get(type);
  if (r) {
    const g = new Group();
    const character = cloneSkinned(r.scene);
    character.traverse((o) => {
      if (!(o instanceof SkinnedMesh)) return;
      o.material = r.skins[teamMaterials.indexOf(team as MeshStandardMaterial)] ?? r.skins[0];
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // the bind-pose bounds do not follow the animation
    });
    g.add(character);
    g.userData.clips = r.clips;
    return g;
  }
  const t = templates.get(type);
  if (!t) return placeholder(type, team);
  const g = t.clone(true);
  let tagIndex = 0;
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const name = (o.material as Material).name;
    if (name === 'meshy') o.material = meshySkins.get(type)?.[teamMaterials.indexOf(team as MeshStandardMaterial)] ?? o.material;
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

/** Invisible units are drawn see-through (only their owner, or a detecting enemy, sees them at all). */
function ghost(body: Object3D): void {
  body.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = (o.material as Material).clone();
    m.transparent = true;
    m.opacity = 0.3;
    m.depthWrite = false;
    o.material = m;
    o.castShadow = false;
  });
}

interface View {
  /** Entity type it was built for: a building turned into another gets a new view. */
  type: string;
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
  /** Skeletal animation of Meshy characters. */
  mixer?: AnimationMixer;
  clips?: Map<string, AnimationAction>;
  playing?: AnimationAction;
}

/** Clip roles baked by tools/meshy/pack.py; only idle, walk and die are always there. */
const CLIP = { idle: 'idle', walk: 'walk', attack: 'attack', fire: 'fire', work: 'work', carry: 'carry', die: 'die' };
/** Ground covered by one second of the walk clip at its natural pace, in tiles. */
const WALK_STRIDE = 1.1;

/** Cross-fades a character to clip `name`, if it has it. */
function play(v: View, name: string, timeScale = 1): void {
  const next = v.clips?.get(name);
  if (!next) return;
  next.timeScale = timeScale;
  if (v.playing === next) return;
  next.reset().play();
  if (v.playing) next.crossFadeFrom(v.playing, 0.2, false);
  v.playing = next;
}

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  private readonly views = new Map<number, View>();
  private dying: { v: View; age: number; side: number }[] = [];
  private last = performance.now();

  /** Called when a building first appears (to clear scenery under it). */
  onBuilding: (e: Entity) => void = () => {};

  /** Whether two players are at war (set from the world at each sync). */
  private hostile = (a: number, b: number) => a !== b;

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
          if (v.mixer) play(v, CLIP.die);
          this.dying.push({ v, age: 0, side: id % 2 ? 1 : -1 });
        } else this.scene.remove(v.root);
      }
    }
    this.dying = this.dying.filter((d) => {
      d.age += dt;
      if (d.v.mixer) {
        // Animated characters play their own fall, then sink.
        d.v.mixer.update(dt);
        d.v.model.position.y = -Math.max(0, d.age - 2.5) * 0.4;
        if (d.age < 4) return true;
        this.scene.remove(d.v.root);
        return false;
      }
      const f = Math.min(1, d.age / 0.45);
      d.v.model.rotation.z = d.side * (Math.PI / 2) * f * f;
      d.v.model.position.y = 0.12 * f - Math.max(0, d.age - 2.5) * 0.4;
      if (d.age < 4) return true;
      this.scene.remove(d.v.root);
      return false;
    });
    this.hostile = (a, b) => world.hostile(a, b);
    for (const e of world.entities.values()) {
      const old = this.views.get(e.id);
      if (old && old.type !== e.type) {
        this.scene.remove(old.root);
        this.views.delete(e.id);
      }
      const v = this.views.get(e.id) ?? this.create(e, player);
      // In a bunker: not drawn (the Fortin shows its occupants in its command card).
      v.root.visible = !e.inside;
      if (e.inside) continue;
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
      const picked = selected.has(e.id);
      if (picked && !v.ring.visible) v.ring.userData.since = performance.now();
      v.ring.visible = picked;
      if (v.ring.visible) {
        // The dial ticks flash on selection, turning, then fade out quickly: only the ring stays.
        const dialMat = (v.ring.userData.dial as Mesh).material as MeshBasicMaterial;
        dialMat.map!.rotation += dt * (e.owner === player ? 2.2 : -2.2);
        const fresh = Math.max(0, 1 - (performance.now() - v.ring.userData.since) / 600);
        dialMat.opacity = 0.6 * fresh;
        // The halo goes with the ticks; the ring itself settles a little dimmer.
        (v.ring.userData.halo as MeshBasicMaterial).opacity = 0.22 * fresh;
        (v.ring.userData.core as MeshBasicMaterial).opacity = 0.55 + 0.4 * fresh;
        (v.ring.userData.dial as Mesh).visible = dialMat.opacity > 0;
        this.drape(v.ring, x, z, v.root.position.y);
      }
      if (e.def.kind === 'unit') {
        v.model.rotation.y = v.heading;
        this.animate(v, e, dt);
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
  private animate(v: View, e: Entity, dt: number): void {
    const t = performance.now() / 1000;
    const moving = e.x !== e.px || e.y !== e.py;
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
        v.mixer.update(dt);
        // A light judder, not a bounce: the sparks show the work.
        v.model.position.y = Math.abs(Math.sin(t * 47 + e.id)) * 0.008;
        v.model.children[0].rotation.x = 0.12 + Math.sin(t * 61 + e.id) * 0.006; // leaning forward, whatever the heading
        return;
      } else if ((kind === 'gather' || kind === 'construct' || kind === 'build') && has(CLIP.work)) play(v, CLIP.work, 1.6);
      else play(v, CLIP.idle, attacking ? 1.4 : 0.8);
      v.model.position.y = 0;
      v.model.children[0].rotation.x = 0;
      v.mixer.update(dt);
      return;
    }
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

  /** Lays a selection ring's meshes on the ground around (x, z), over dunes and slopes; only when it moved. */
  private drape(ring: Object3D, x: number, z: number, baseY: number): void {
    const at = `${x.toFixed(2)},${z.toFixed(2)}`;
    if (ring.userData.at === at) return;
    ring.userData.at = at;
    for (const m of ring.children as Mesh[]) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(this.map, x + pos.getX(i), z + pos.getZ(i)) - baseY + m.userData.lift);
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
    }
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
    if ((e.def as UnitDef).cloaked) ghost(body);
    root.add(pivot);
    // Selection: a bright ring with a soft halo outside it.
    const r = (e.radius / FP) * (e.def.kind === 'unit' ? 1.5 : 0.95);
    if ((e.def as { worker?: boolean }).worker && !pivot.getObjectByName('cargo')) {
      const cargo = new Mesh(new SphereGeometry(0.11, 6, 4), crystal);
      cargo.name = 'cargo';
      cargo.position.set(0, 0.62, -0.2);
      pivot.add(cargo);
    }
    const [core, halo] = e.owner === player ? RINGS.own : e.owner < 0 ? RINGS.neutral : this.hostile(e.owner, player) ? RINGS.enemy : RINGS.ally;
    const ring = new Group();
    // Flat on the ground (rotation baked in), so its vertices can follow the terrain (see drape).
    // Own copies of the materials: the halo fades and the ring dims after selection (see sync).
    for (const [inner, outer, m, role] of [[r, r + 0.09, core, 'core'], [r + 0.09, r + 0.3, halo, 'halo']] as const) {
      const mesh = new Mesh(new RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2), m.clone());
      mesh.userData.lift = 0.06;
      mesh.renderOrder = 2;
      ring.add(mesh);
      ring.userData[role] = mesh.material;
    }
    // Ticks just outside the ring, turning (see sync).
    // A ring, not a square: a flat quad shows up in the ambient occlusion and ink passes as a pale rectangle.
    // RingGeometry's planar UVs line the round tick texture up with it.
    // It turns by turning its texture, so the mesh itself can follow the terrain too.
    const dialMat = dialMaterial(core).clone();
    dialMat.map = dialMat.map!.clone();
    dialMat.map.center.set(0.5, 0.5);
    dialMat.map.needsUpdate = true;
    const dial = new Mesh(new RingGeometry((r + 0.42) * 0.74, r + 0.42, 64).rotateX(-Math.PI / 2), dialMat);
    dial.userData.lift = 0.07;
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
    if (e.def.kind === 'building') {
      // Scaffolding shown while under construction.
      const size = new Box3().setFromObject(body).getSize(new Vector3());
      scaffold = new LineSegments(new EdgesGeometry(new BoxGeometry(size.x * 1.05, size.y * 1.02, size.z * 1.05, 3, 2, 3)), scaffoldMaterial);
      scaffold.position.y = (size.y * 1.02) / 2;
      scaffold.userData.noPick = true;
      root.add(scaffold);
    }
    this.scene.add(root);
    // Buildings and new units face the map centre.
    const facing = Math.atan2(this.map.width / 2 - e.x / FP, this.map.height / 2 - e.y / FP);
    const v: View = { type: e.type, root, model: pivot, ring, scaffold, pools, heading: facing, target: facing, cargo: pivot.getObjectByName('cargo'), seen: false, unit: e.def.kind === 'unit',
      limbs: { legL: body.getObjectByName('leg_l'), legR: body.getObjectByName('leg_r'), armL: body.getObjectByName('arm_l'), armR: body.getObjectByName('arm_r') } };
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
    this.views.set(e.id, v);
    return v;
  }
}
