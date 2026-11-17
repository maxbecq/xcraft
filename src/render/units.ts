import {
  AdditiveBlending, Box3, Plane, BufferAttribute, DoubleSide, CanvasTexture, SRGBColorSpace, Color, PlaneGeometry, BoxGeometry, CapsuleGeometry, EdgesGeometry, LineBasicMaterial, LineSegments, Vector3, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, type MeshStandardMaterialParameters, Object3D, AnimationMixer, type AnimationAction, type AnimationClip, LoopOnce, SkinnedMesh, RingGeometry, SphereGeometry, BufferGeometry, ShaderMaterial, type Material, type Scene, type Texture, Points, PointsMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type BuildingDef, DEFS, FLY_HEIGHT, LOOK_SCALE, LOOKS, type UnitDef } from '../data';
import { graffiti, rimLight, weather } from './weathering';
import { type GameMap, heightAt } from '../map';
import { FP, GAME_SPEED, ticks } from '../sim/fixed';
import { type Entity, type World, flies } from '../sim/world';

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

/** Team-coloured light (veins, cores): `team_glow` in Blender models. */
const teamGlow = TEAM_COLORS.map((c) => {
  const m = mat(c, { roughness: 0.35, emissive: c, emissiveIntensity: 1.6 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.veinTime = veinTime;
    shader.vertexShader = `varying float vVein;\nuniform float veinTime;\n${shader.vertexShader}`.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vVein = veinPulse(modelMatrix, position, veinTime);`).replace('void main() {', `${VEIN_PULSE}\nvoid main() {`);
    shader.fragmentShader = `varying float vVein;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= vVein;`);
  };
  m.customProgramCacheKey = () => 'team-vein';
  return m;
});
/** Seconds, shared by every vein so one uniform drives them all. */
const veinTime = { value: 0 };
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
const timber = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });
const canvasCloth = new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide });
const footing = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });

/**
 * Low walls of weathered rubble stone along segments [x0, z0, x1, z1]: two or three courses of uneven blocks,
 * each its own shade of grey-brown, a little askew. Seeded by `seed`, so a site looks the same every time.
 */
function rubbleWalls(lines: [number, number, number, number][], seed: number): BufferGeometry {
  let r = (seed * 9301 + 49297) % 233280;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const stones: BufferGeometry[] = [];
  const shade = new Color();
  for (const [x0, z0, x1, z1] of lines) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    const courses = 2 + (rand() < 0.4 ? 1 : 0);
    for (let c = 0; c < courses; c++) {
      let t = c % 2 ? 0.07 : 0;
      while (t < len) {
        const l = 0.12 + rand() * 0.12;
        const h = 0.07 + rand() * 0.05;
        const g = new BoxGeometry(Math.min(l, len - t + 0.02), h, 0.13 + rand() * 0.07);
        g.rotateX((rand() - 0.5) * 0.25).rotateZ((rand() - 0.5) * 0.3).rotateY(yaw + (rand() - 0.5) * 0.25);
        const k = (t + l / 2) / len;
        g.translate(x0 + (x1 - x0) * k, c * 0.085 + h / 2, z0 + (z1 - z0) * k);
        // Old stone: greys and ochres, darker low down where the damp gets in.
        shade.setHSL(0.07 + rand() * 0.05, 0.12 + rand() * 0.18, 0.06 + rand() * 0.12 + c * 0.02);
        const n = g.getAttribute('position').count;
        g.setAttribute('color', new BufferAttribute(new Float32Array(Array.from({ length: n * 3 }, (_, i) => [shade.r, shade.g, shade.b][i % 3])), 3));
        stones.push(g);
        t += l + 0.015;
      }
    }
  }
  return mergeGeometries(stones);
}

/**
 * Human building site: a stone footing the size of the footprint, and scaffolding round the model's bounds,
 * one group per storey (poles, ledgers, a plank deck and a few canvas sheets), so storeys can go up and come down.
 */
function buildingSite(footprint: number, size: Vector3): { footing: Mesh; storeys: Object3D[] } {
  // Footing: low rubble-stone walls along the outline and across the middle, as old dug foundations.
  const half = footprint * 0.46;
  const lines: [number, number, number, number][] = [[-half, -half, half, -half], [-half, half, half, half], [-half, -half, -half, half], [half, -half, half, half]];
  lines.push(footprint >= 3 ? [-half, -half / 3, half, -half / 3] : [-half, 0, half, 0]);
  if (footprint >= 3) lines.push([half / 4, -half / 3, half / 4, half]);
  const slab = new Mesh(rubbleWalls(lines, footprint), footing);
  const w = size.x / 2 + 0.18;
  const d = size.z / 2 + 0.18;
  const count = Math.max(2, Math.min(5, Math.round(size.y / 0.75)));
  const step = (size.y + 0.15) / count;
  const bays = (len: number) => Math.max(1, Math.round((2 * len) / 1.1));
  const storeys: Object3D[] = [];
  let r = (Math.round(size.x * 1000) * 7919 + Math.round(size.y * 1000)) % 233280;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const shade = new Color();
  for (let k = 0; k < count; k++) {
    const parts: BufferGeometry[] = [];
    const y0 = k * step;
    // Old timber: each piece its own weathered shade (grey-brown, sun-bleached or dark with damp), a little out of true.
    const add = (g: BufferGeometry, x: number, y: number, z: number, rotY = 0, rotZ = 0) => {
      g.rotateX((rand() - 0.5) * 0.05).rotateZ(rotZ + (rand() - 0.5) * 0.05).rotateY(rotY).translate(x, y, z);
      shade.setHSL(0.06 + rand() * 0.035, 0.22 + rand() * 0.25, 0.035 + rand() * 0.08);
      // Grain and stains: every vertex a little lighter or darker than the piece.
      const n = g.getAttribute('position').count;
      const colors = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = 0.6 + rand() * 0.7;
        colors.set([shade.r * k, shade.g * k, shade.b * k], i * 3);
      }
      g.setAttribute('color', new BufferAttribute(colors, 3));
      parts.push(g);
    };
    // A run of boards end to end along x (or z), each its own length, sagging, warped and a little out of line.
    const boards = (len: number, wid: number, thick: number, x: number, y: number, z: number, alongZ = false) => {
      for (let t = 0; t < len - 0.05; ) {
        const l = Math.min(len - t, 0.5 + rand() * 0.5);
        const g = new BoxGeometry(Math.max(0.05, l - 0.025), thick, wid, 5, 1, 1);
        const pos = g.getAttribute('position');
        const sag = 0.006 + rand() * 0.02;
        for (let i = 0; i < pos.count; i++) {
          const u = pos.getX(i) / l + 0.5;
          pos.setY(i, pos.getY(i) - sag * 4 * u * (1 - u) + (rand() - 0.5) * 0.006);
          pos.setZ(i, pos.getZ(i) + (rand() - 0.5) * 0.006);
        }
        const c = -len / 2 + t + l / 2;
        add(g, alongZ ? x : x + c, y + (rand() - 0.5) * 0.02, alongZ ? z + c : z, alongZ ? Math.PI / 2 : 0, (rand() - 0.5) * 0.025);
        t += l;
      }
    };
    // Poles round the outline, one bay apart.
    const nx = bays(w);
    const nz = bays(d);
    const pole = () => new CylinderGeometry(0.028 + rand() * 0.012, 0.035 + rand() * 0.012, step + 0.04, 6, 3);
    for (let i = 0; i <= nx; i++) for (const z of [-d, d]) add(pole(), -w + (2 * w * i) / nx, y0 + step / 2, z);
    for (let i = 1; i < nz; i++) for (const x of [-w, w]) add(pole(), x, y0 + step / 2, -d + (2 * d * i) / nz);
    // Ledgers on top of the storey, a plank deck on each long side, and a cross brace on two faces.
    boards(2 * w + 0.1, 0.05, 0.05, 0, y0 + step, -d);
    boards(2 * w + 0.1, 0.05, 0.05, 0, y0 + step, d);
    boards(2 * d + 0.1, 0.05, 0.05, -w, y0 + step, 0, true);
    boards(2 * d + 0.1, 0.05, 0.05, w, y0 + step, 0, true);
    // Walkways of three loose boards on the two camera-facing sides.
    for (const o of [0.03, 0.135, 0.24]) {
      boards(2 * w + 0.2, 0.095, 0.03, 0, y0 + step - 0.01, d + o);
      boards(2 * d + 0.2, 0.095, 0.03, w + o, y0 + step - 0.01, 0, true);
    }
    const brace = Math.hypot(2 * w / nx, step);
    add(new BoxGeometry(brace, 0.04, 0.04), -w + w / nx, y0 + step / 2, d + 0.02, 0, Math.atan2(step, (2 * w) / nx));
    add(new BoxGeometry(brace, 0.04, 0.04), w + 0.02, y0 + step / 2, -d + d / nz, Math.PI / 2, Math.atan2(step, (2 * d) / nz));
    const storey = new Group();
    storey.add(new Mesh(mergeGeometries(parts), timber));
    // Canvas sheets hang on the camera-facing sides, alternating, so the work behind is half hidden.
    // Old canvas: billowing, faded in patches, stained darker towards the hem.
    const sheet = (len: number) => {
      const g = new PlaneGeometry(len * 0.92, step * 0.8, 6, 3);
      const pos = g.getAttribute('position');
      const cloth = new Color().setHSL(0.14 + rand() * 0.04, 0.18 + rand() * 0.12, 0.13 + rand() * 0.06);
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const low = 0.5 - pos.getY(i) / (step * 0.8);
        pos.setZ(i, Math.sin((pos.getX(i) / len) * 9 + k) * 0.03 + (rand() - 0.5) * 0.02);
        const f = (0.7 + rand() * 0.5) * (1 - 0.35 * low);
        colors.set([cloth.r * f, cloth.g * f, cloth.b * f], i * 3);
      }
      g.setAttribute('color', new BufferAttribute(colors, 3));
      return g;
    };
    const front = new Mesh(sheet(2 * w), canvasCloth);
    front.position.set(0, y0 + step * 0.5, d + 0.03);
    const side = new Mesh(sheet(2 * d), canvasCloth);
    side.position.set(w + 0.03, y0 + step * 0.5, 0);
    side.rotation.y = Math.PI / 2;
    storey.add(k % 2 ? side : front);
    storeys.push(storey);
  }
  return { footing: slab, storeys };
}

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
const STATIC_MESHY = ['moissonneur', 'conseil', 'grenier', 'caserne', 'mine', 'obelisque', 'emetteur', 'portail', 'recepteur', 'forge', 'tour', 'orbe', 'nanoassembleur', 'fortin', 'recepteurarme', 'pylonesanglant', 'chimere', 'metallurgie', 'bourdon', 'pegase', 'alchimisterie', 'alchimiste', 'creaturium', 'plesiosaure', 'ankylosaure', 'allosaure', 'belluaire'];
/** Meshy buildings with Blender parts fitted on them (`<type>-dress.glb`, tools/blender/models.py DRESS). */
const DRESSED = ['conseil', 'caserne', 'grenier', 'mine', 'forge', 'fortin', 'tour', 'metallurgie', 'alchimisterie', 'creaturium'];
/** Turn (radians) to face +Z, for static Meshy models that came out facing another way. */
const STATIC_YAW: Record<string, number> = { chimere: Math.PI / 2, bourdon: -Math.PI / 2, pegase: Math.PI / 2 };
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
    // Types drawn with another's model (LOOKS) have no file of their own.
    types.filter((type) => !LOOKS[type]).map(async (type) => {
      const character = CHARACTERS[type];
      const meshy = !new URLSearchParams(location.search).has('proc');
      if (meshy && STATIC_MESHY.includes(type)) {
        try {
          const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-meshy.glb`);
          gltf.scene.traverse((o) => {
            if (o instanceof Mesh && !meshySkins.has(type)) meshySkins.set(type, TEAM_COLORS.map((c) => teamSkin(o.material as MeshStandardMaterial, c, DEFS[type]?.kind === 'building' ? 0.22 : 0.45, isHuman(type), DEFS[type]?.kind === 'unit', DEFS[type]?.kind === 'unit' && !isHuman(type))));
          });
          // Some models come out of Meshy facing sideways: turned in a holder, which the animation leaves alone.
          if (DRESSED.includes(type)) {
            try {
              gltf.scene.add((await loader.loadAsync(`${import.meta.env.BASE_URL}models/${type}-dress.glb`)).scene);
            } catch {
              // not built yet: the bare Meshy model
            }
          }
          const holder = new Group();
          gltf.scene.rotation.y = STATIC_YAW[type] ?? 0;
          holder.add(gltf.scene);
          templates.set(type, STATIC_YAW[type] ? holder : gltf.scene);
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
        const isdaris = !!d && 'faction' in d && d.faction !== 'humains'; // Isdaris and Z
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
  type = LOOKS[type] ?? type;
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
  const veins: [Mesh, ShaderMaterial][] = [];
  g.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.castShadow = true;
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
  return g;
}

const haloShapes = new WeakMap<BufferGeometry, BufferGeometry>();
/** A vein's shape with its seams welded and normals smoothed, so the halo swells as one soft tube instead of splitting at hard edges. */
function haloShape(geo: BufferGeometry): BufferGeometry {
  let shape = haloShapes.get(geo);
  if (!shape) {
    const bare = new BufferGeometry().setAttribute('position', geo.getAttribute('position'));
    bare.setIndex(geo.getIndex());
    shape = mergeVertices(bare, 1e-3);
    shape.computeVertexNormals();
    haloShapes.set(geo, shape);
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
  /** Z walkers: where the gait was last stepped, its phase, and the ground covered by one cycle. */
  gait?: { x: number; z: number; phase: number; cycle: number; hip: number };
  root: Object3D;
  model: Group;
  ring: Object3D;
  scaffold?: Object3D;
  /** Human building site: the footing, and the scaffolding storeys from the ground up. */
  site?: { footing: Object3D; storeys: Object3D[] };
  /** Z building being fabricated: a ring of cyan light at the height being laid. */
  seam?: Mesh;
  /** Z building being fabricated: its own materials cut by a plane rising from `bottom` to `top`. */
  /** Z Plate-forme: its robot arms (upper part, forearm with the welding spark), animated while it builds. */
  arms?: { upper: Object3D; tip?: Object3D }[];
  /** Z Plate-forme: the socle being built on its deck, fabricated layer by layer as training goes on. */
  fab?: { type: string; model: Object3D; plane: Plane; line: Mesh; bottom: number; top: number; total: number };
  print?: { plane: Plane; frame: Plane; frameMaterial: LineBasicMaterial; lines: LineSegments[]; bottom: number; top: number; originals: [Mesh, Material | Material[]][] };
  /** Light pools on the ground, lit once the building stands. */
  pools?: Object3D;
  /** Energy well: its living pool (see wellFx). */
  fx?: { update(dt: number, t: number): void };
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

/** A Z walker's leg (zleg_<pair>_<l|r>), pivoting at the hip; legs of one group step together. */
interface InsectLeg {
  o: Object3D;
  /** The shin, hanging from the femur `o`, pivoting at the knee. */
  shin?: Object3D;
  /** How far the femur rises above level, and the shin drops below it, at rest (radians). */
  alpha: number;
  beta: number;
  /** Pair index, from the front. */
  pair: number;
  group: number;
  side: number;
}

/** Not drawn, but hit by the click raycast. */
const PICK_PROXY = new MeshBasicMaterial({ visible: false });
/** Height of the Z Plate-forme's deck, where the socles are built. */
const PLATFORM_DECK = 0.37;
/** Seconds a Z drone takes to scuttle to the centre of the site it raised. */
const DEPLOY_WALK = 0.6;
/** Seconds it takes to settle and spread its legs into a base. */
const DEPLOY_SPREAD = 1.2;
const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** How far a Z leg turns either way while walking, in radians. */
const GAIT_SWING = 0.35;

/**
 * Ground covered by one full gait cycle: each leg group sweeps its feet back by one stride while planted,
 * and the groups take turns, so the body moves two strides a cycle. A stride is the arc the foot sweeps:
 * twice the leg's reach times the sine of the swing.
 */
function gaitCycle(body: Object3D, legs: InsectLeg[]): number {
  body.updateMatrixWorld(true);
  // Angles that unfold each leg straight and level (see the drone's deployment), found by bisection on the
  // model itself: the femur turned down until the knee is level with the hip, then the shin turned up until
  // it is level with the knee.
  const y = (o: Object3D) => {
    o.updateWorldMatrix(true, true);
    return o.getWorldPosition(new Vector3()).y;
  };
  const centreY = (o: Object3D) => {
    o.updateWorldMatrix(true, true);
    const b = new Box3().setFromObject(o);
    return (b.min.y + b.max.y) / 2;
  };
  const solve = (set: (a: number) => void, above: () => boolean, hi: number) => {
    let [lo, top] = [0, hi];
    for (let i = 0; i < 24; i++) {
      const mid = (lo + top) / 2;
      set(mid);
      if (above()) lo = mid;
      else top = mid;
    }
    return (lo + top) / 2;
  };
  for (const l of legs) {
    const shin = l.shin;
    if (!shin) continue;
    l.alpha = solve((a) => (l.o.rotation.z = -l.side * a), () => y(shin) > y(l.o), 1.5);
    l.o.rotation.z = -l.side * l.alpha;
    l.beta = solve((b) => (shin.rotation.z = l.side * b), () => centreY(shin) < y(shin), 3) - l.alpha;
    l.o.rotation.z = 0;
    shin.rotation.z = 0;
  }
  body.updateMatrixWorld(true);
  const pivot = new Vector3();
  const reach =
    legs.reduce((sum, l) => {
      const box = new Box3().setFromObject(l.o);
      l.o.getWorldPosition(pivot);
      return sum + Math.max(Math.abs(box.min.x - pivot.x), Math.abs(box.max.x - pivot.x));
    }, 0) / legs.length;
  return 2 * (2 * reach * Math.sin(GAIT_SWING));
}

function insectLegs(body: Object3D): InsectLeg[] | undefined {
  const legs: InsectLeg[] = [];
  body.traverse((o) => {
    const m = /^zleg_(\d+)_([lr])$/.exec(o.name);
    if (m) legs.push({ o, shin: o.getObjectByName(`zshin_${m[1]}_${m[2]}`), alpha: 0, beta: 0, pair: Number(m[1]), group: (Number(m[1]) + (m[2] === 'r' ? 1 : 0)) % 2, side: m[2] === 'r' ? 1 : -1 });
  });
  return legs.length ? legs : undefined;
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

/** A soft round spark, for the well's stars and geysers. */
let sparkTexture: CanvasTexture | undefined;
function spark(): CanvasTexture {
  if (sparkTexture) return sparkTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(230,200,255,0.8)');
  grad.addColorStop(1, 'rgba(160,80,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return (sparkTexture = new CanvasTexture(c));
}

/** Swirling eddies drawn as spiral arcs, turned slowly over the pool. */
let eddyTexture: CanvasTexture | undefined;
function eddies(): CanvasTexture {
  if (eddyTexture) return eddyTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  for (let k = 0; k < 5; k++) {
    g.rotate((Math.PI * 2) / 5);
    g.beginPath();
    for (let a = 0; a < 3.2; a += 0.1) g.lineTo(Math.cos(a) * (8 + a * 15), Math.sin(a) * (8 + a * 15));
    g.strokeStyle = `rgba(255,220,255,${0.35 + 0.1 * k})`;
    g.lineWidth = 3;
    g.stroke();
  }
  eddyTexture = new CanvasTexture(c);
  eddyTexture.center.set(0.5, 0.5);
  return eddyTexture;
}

/**
 * The life of an energy well: the glow at the bottom breathes unevenly, eddies turn on the pool, stars drift up
 * out of it and now and then a little geyser of sparks shoots up and falls back. Render only, seeded by the well.
 */
function wellFx(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } {
  const group = new Group();
  group.userData.noPick = true;
  // Its own copies of the glowing materials, so each well breathes on its own.
  const glows: MeshStandardMaterial[] = [];
  body.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as MeshStandardMaterial;
    if (m.emissive && m.emissive.getHex() !== 0) {
      o.material = m.clone();
      glows.push(o.material as MeshStandardMaterial);
    }
  });
  const base = glows.map((m) => m.emissiveIntensity);
  const swirl = eddies().clone();
  swirl.needsUpdate = true;
  const eddy = new Mesh(new PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new MeshBasicMaterial({ map: swirl, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending, color: 0xd8a0ff }));
  eddy.position.y = 0.09;
  group.add(eddy);
  // Particles: n stars drifting up, and a geyser of the same sparks from time to time.
  const n = 36;
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const wild = new Uint8Array(n); // geyser sparks, under gravity
  let r = seed * 9301 + 49297;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const reset = (i: number, geyser?: [number, number]) => {
    const a = rand() * Math.PI * 2;
    const d = geyser ? 0.05 : rand() * 0.6;
    pos.set([(geyser?.[0] ?? 0) + Math.cos(a) * d, 0.08, (geyser?.[1] ?? 0) + Math.sin(a) * d], i * 3);
    vel.set(geyser ? [(rand() - 0.5) * 0.6, 1.6 + rand() * 1.2, (rand() - 0.5) * 0.6] : [(rand() - 0.5) * 0.08, 0.25 + rand() * 0.35, (rand() - 0.5) * 0.08], i * 3);
    wild[i] = geyser ? 1 : 0;
  };
  for (let i = 0; i < n; i++) {
    reset(i);
    pos[i * 3 + 1] = 0.08 + rand() * 2;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(pos, 3));
  const stars = new Points(geom, new PointsMaterial({ map: spark(), size: 0.16, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xe8c8ff }));
  stars.frustumCulled = false;
  group.add(stars);
  let nextGeyser = 1 + rand() * 4;
  return {
    group,
    update(dt, t) {
      // Uneven breathing: two slow waves and a faster flicker.
      const pulse = 0.75 + 0.2 * Math.sin(t * 1.3 + seed) + 0.12 * Math.sin(t * 3.7 + seed * 2) + 0.06 * Math.sin(t * 11 + seed);
      glows.forEach((m, i) => (m.emissiveIntensity = base[i] * pulse));
      swirl.rotation += dt * 0.35;
      (eddy.material as MeshBasicMaterial).opacity = 0.2 + 0.18 * pulse;
      nextGeyser -= dt;
      if (nextGeyser <= 0) {
        // A geyser: a dozen sparks leap from one spot of the pool.
        const a = rand() * Math.PI * 2;
        const spot: [number, number] = [Math.cos(a) * rand() * 0.45, Math.sin(a) * rand() * 0.45];
        for (let k = 0; k < 12; k++) reset(Math.floor(rand() * n), spot);
        nextGeyser = 2 + rand() * 5;
      }
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        if (wild[i]) vel[j + 1] -= dt * 3; // geyser sparks arc up and fall back into the pool
        pos[j] += vel[j] * dt;
        pos[j + 1] += vel[j + 1] * dt;
        pos[j + 2] += vel[j + 2] * dt;
        if (pos[j + 1] > 2.4 || pos[j + 1] < 0.05) reset(i);
      }
      geom.getAttribute('position').needsUpdate = true;
    },
  };
}

/** Rally point marker: a pole with a green pennant, its cloth hinged on the pole. */
function rallyFlag(): Group {
  const flag = new Group();
  const pole = new Mesh(new CylinderGeometry(0.03, 0.04, 1.5, 6), new MeshBasicMaterial({ color: 0x5a4630 }));
  pole.position.y = 0.75;
  const cloth = new Group();
  cloth.position.y = 1.28;
  const pennant = new Mesh(new BoxGeometry(0.6, 0.38, 0.02), new MeshBasicMaterial({ color: 0x4dff6a }));
  pennant.position.x = 0.3;
  cloth.add(pennant);
  flag.add(pole, cloth);
  flag.traverse((o) => (o.userData.noPick = true));
  return flag;
}

/** Keeps one 3D object per simulated entity, interpolated between ticks. */
export class EntityRenderer {
  private readonly views = new Map<number, View>();
  private dying: { v: View; age: number; side: number }[] = [];
  /** Z drones merging into the building they raised. */
  private merging: { v: View; age: number; building: number; from: Vector3; to: Vector3 }[] = [];
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
    veinTime.value = now / 1000;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.syncRallyFlags(world, selected, player, now);
    for (const [id, v] of this.views) {
      if (!world.entities.has(id)) {
        this.views.delete(id);
        // Fallen soldiers topple over and sink into the ground; buildings just go (they explode).
        const into = v.unit && [...world.entities.values()].find((b) => b.absorbed === id);
        if (into && v.root.visible) {
          // A Z drone merging into the building it raised: it folds and sinks into it, it does not die.
          v.ring.visible = false;
          this.merging.push({ v, age: 0, building: into.id, to: new Vector3(into.x / FP, heightAt(this.map, into.x / FP, into.y / FP), into.y / FP), from: v.root.position.clone() });
        } else if (v.unit && v.root.visible) {
          v.ring.visible = false;
          if (v.mixer) play(v, CLIP.die);
          this.dying.push({ v, age: 0, side: id % 2 ? 1 : -1 });
        } else this.scene.remove(v.root);
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
        return false;
      }
      const walk = Math.min(1, m.age / DEPLOY_WALK);
      m.v.root.position.lerpVectors(m.from, m.to, walk * walk * (3 - 2 * walk));
      const legs = m.v.limbs.insect ?? [];
      if (walk < 1) {
        const ph = this.stepGait(m.v);
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
      // Flyers drop out of the sky first.
      const alt: number = (d.v.model.userData.alt ??= d.v.model.position.y);
      const air = alt > 0.5 ? Math.max(0, alt - 5 * d.age * d.age) : 0.12 * f;
      d.v.model.position.y = air - Math.max(0, d.age - 2.5) * 0.4;
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
      const ground = heightAt(this.map, x, z);
      v.ground = !flies(e) || v.ground === undefined ? ground : v.ground + (ground - v.ground) * Math.min(1, dt * 3);
      v.root.position.set(x, v.ground, z);
      const picked = selected.has(e.id);
      if (picked && !v.ring.visible) v.ring.userData.since = performance.now();
      v.ring.visible = picked;
      if (v.ring.visible) {
        // The dial ticks flash on selection, turning, then fade out quickly: only the ring stays.
        const dialMat = (v.ring.userData.dial as Mesh).material as MeshBasicMaterial;
        dialMat.map!.rotation += dt * (e.owner === player ? 2.2 : -2.2);
        const age = performance.now() - v.ring.userData.since;
        const fresh = Math.max(0, 1 - age / 1200);
        // The ring fades in, then gives a short flash of light before settling: slow and bright round a
        // building, quick and soft round a unit.
        const [fadeMs, flashAt, flashWidth, flashPower, grow] = e.def.kind === 'building' ? [450, 560, 170, 1, 0.18] : [150, 230, 110, 0.4, 0.08];
        const fadeIn = Math.min(1, age / fadeMs) ** 2;
        const flash = flashPower * Math.max(0, 1 - Math.abs(age - flashAt) / flashWidth) ** 1.5;
        // It also closes in a little as it fades in.
        // Round a human building site it widens to take in the scaffolding while it stands.
        const wide = v.site?.storeys.some((s) => s.visible) ? (v.ring.userData.site as number) : 1;
        v.ring.userData.wide = v.ring.userData.wide === undefined ? wide : v.ring.userData.wide + (wide - v.ring.userData.wide) * Math.min(1, dt * 5);
        const k = (1 + grow - grow * Math.min(1, age / fadeMs)) * v.ring.userData.wide;
        v.ring.scale.set(k, 1, k);
        dialMat.opacity = 0.6 * fresh * fadeIn;
        // The halo goes with the ticks; the ring itself settles a little dimmer.
        (v.ring.userData.halo as MeshBasicMaterial).opacity = 0.22 * fresh * fadeIn + 0.45 * flash;
        (v.ring.userData.core as MeshBasicMaterial).opacity = (0.55 + 0.4 * fresh) * fadeIn + 0.6 * flash;
        (v.ring.userData.dial as Mesh).visible = dialMat.opacity > 0;
        this.drape(v.ring, x, z, v.root.position.y);
      }
      if (e.def.kind === 'unit') {
        v.model.rotation.y = v.heading;
        this.animate(v, e, dt);
      }
      if (v.cargo) v.cargo.visible = e.carry > 0;
      v.fx?.update(dt, now / 1000);
      if (e.type === 'minerai') {
        // Fields shrink as they are mined out.
        const body = v.model.children[0];
        body.scale.setScalar(body.userData.base * (0.5 + 0.5 * Math.min(1, e.amount / (e.def as { amount: number }).amount)));
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
              // Done: back to the shared materials, no cut.
              for (const [mesh, material] of v.print.originals) mesh.material = material;
              for (const l of v.print.lines) {
                l.removeFromParent();
                l.geometry.dispose();
              }
              v.seam?.removeFromParent();
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
        if (v.arms) this.assemble(v, e, now / 1000);
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
      v.fab.model.removeFromParent();
      v.fab.line.removeFromParent();
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
          const c = m.clone();
          c.clippingPlanes = [plane];
          c.clipShadows = true;
          c.side = DoubleSide;
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cut) : cut(mesh.material);
      });
      const size = box.getSize(new Vector3());
      const r = Math.max(size.x, size.z) * 0.3; // round the body, inside the splayed legs
      const line = new Mesh(new RingGeometry(r * 0.94, r, 4, 1), new MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
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
    v.arms!.forEach((a, i) => {
      const ease = (o: Object3D | undefined, axis: 'x' | 'y' | 'z', to: number) => {
        if (o) o.rotation[axis] += (to - o.rotation[axis]) * 0.12;
      };
      const k = i * 2.3;
      ease(a.upper, 'y', working ? Math.sin(t * 1.3 + k) * 0.35 : 0);
      ease(a.upper, 'x', working ? Math.sin(t * 2.1 + k) * 0.08 : 0);
      ease(a.tip, 'x', working ? Math.sin(t * 3.7 + k) * 0.25 : 0);
      ease(a.tip, 'z', working ? Math.cos(t * 2.9 + k) * 0.2 : 0);
    });
  }

  /** Advances a Z walker's gait by the distance its view moved since the last frame; returns the phase. */
  private stepGait(v: View): number {
    const { x, z } = v.root.position;
    const g = v.gait!;
    const moved = Math.hypot(x - g.x, z - g.z);
    if (moved < 1) g.phase += (moved / g.cycle) * Math.PI * 2; // a longer jump is a teleport, not a step
    g.x = x;
    g.z = z;
    return g.phase;
  }

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
    // Z walkers: the gait follows the ground actually covered, so feet stay planted whatever the speed.
    const gait = v.gait && this.stepGait(v);
    const phase = gait ?? t * speed * 4.2 + e.id;
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
    // Insect gait: alternating tripods (diagonal pairs on four legs); a leg lifts while it swings forward.
    for (const [i, l] of (v.limbs.insect ?? []).entries()) {
      const ph = phase + l.group * Math.PI;
      // Each side sweeps its foot forwards while lifted (cos > 0), backwards while planted.
      ease(l.o, 'y', moving ? -l.side * Math.sin(ph) * GAIT_SWING : Math.sin(t * 1.3 + i * 2.1 + e.id) * 0.03, moving ? 0.7 : 0.2);
      ease(l.o, 'z', moving ? l.side * Math.max(0, Math.cos(ph)) * 0.4 : 0, moving ? 0.7 : 0.2);
    }
    const body = v.model.children[0];
    // Body: bounce twice per stride, lean into the walk, sway from side to side, breathe at rest.
    // Hovering robots float; walkers bounce with their stride.
    const flying = flies(e);
    const hover = flying ? FLY_HEIGHT + Math.sin(t * 1.6 + e.id) * 0.07 : e.type === 'moissonneur' ? 0.12 + Math.sin(t * 2.5 + e.id) * 0.04 : 0;
    const bob = hover + (hover ? 0 : moving ? Math.abs(Math.sin(phase)) * 0.045 : Math.sin(t * 2 + e.id) * 0.008);
    v.model.position.y += (bob - v.model.position.y) * 0.4;
    ease(body, 'x', moving ? 0.14 : fighting && !melee ? 0.06 : 0, 0.15);
    // Flyers bank into their turns instead of swaying.
    const turn = Math.atan2(Math.sin(v.target - v.heading), Math.cos(v.target - v.heading));
    ease(body, 'z', flying ? Math.max(-0.5, Math.min(0.5, -turn * 0.8)) : moving ? Math.sin(phase) * 0.05 : 0, flying ? 0.08 : 0.2);
    ease(body, 'y', melee && fighting ? (fired - 0.5) * 0.8 : 0, 0.3);
    const kick = fighting && !melee && fired > 0.8 ? (fired - 0.8) * 0.3 : 0;
    body.position.z += (-kick - body.position.z) * 0.5;
  }

  /** Lays a selection ring's meshes on the ground around (x, z), over dunes and slopes; only when it moved. */
  /** A small flag planted on the rally point of each selected building of ours that has one. */
  private readonly rallyFlags: Group[] = [];

  private syncRallyFlags(world: World, selected: ReadonlySet<number>, player: number, now: number): void {
    const points = [...selected]
      .map((id) => world.entities.get(id))
      .filter((e): e is Entity => !!e && e.owner === player && e.def.kind === 'building' && !!e.rally)
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
      flag.children[1].rotation.y = Math.sin(now / 260 + i) * 0.25; // the cloth flutters
    });
  }

  private drape(ring: Object3D, x: number, z: number, baseY: number): void {
    const k = ring.scale.x;
    const at = `${x.toFixed(2)},${z.toFixed(2)},${k.toFixed(2)}`;
    if (ring.userData.at === at) return;
    ring.userData.at = at;
    for (const m of ring.children as Mesh[]) {
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(this.map, x + k * pos.getX(i), z + k * pos.getZ(i)) - baseY + m.userData.lift);
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
    body.scale.multiplyScalar(LOOK_SCALE[e.type] ?? 1);
    if (e.type === 'minerai') {
      body.rotation.y = ((e.id * 2654435761) % 1000) / 1000 * Math.PI * 2;
      body.userData.base = 0.85 + ((e.id * 40503) % 100) / 330;
    }
    const pivot = new Group(); // animated wrapper, so the model keeps its own transform
    pivot.add(body);
    // Units are drawn larger than their collision size, as in classic RTS, to stay readable.
    // A unit drawn with a building's model (Caserne volante in flight) keeps the building's size.
    if (e.def.kind === 'unit' && DEFS[LOOKS[e.type] ?? e.type]?.kind !== 'building') body.scale.setScalar(UNIT_SCALE);
    if ((e.def as UnitDef).cloaked) ghost(body);
    root.add(pivot);
    // Selection: a bright ring with a soft halo outside it.
    const r = (e.radius / FP) * (e.def.kind === 'unit' ? 1.5 : 1.1);
    if ((e.def as { worker?: boolean }).worker && !pivot.getObjectByName('cargo')) {
      const cargo = new Mesh(new SphereGeometry(0.11, 6, 4), crystal);
      cargo.name = 'cargo';
      cargo.position.set(0, 0.62, -0.2);
      pivot.add(cargo);
    }
    const [core, halo] = e.owner === player ? RINGS.own : e.owner < 0 ? RINGS.neutral : this.hostile(e.owner, player) ? RINGS.enemy : RINGS.ally;
    const ring = new Group();
    // Floats a little above the ground, higher round buildings, so their plinths do not hide it.
    const lift = e.def.kind === 'building' ? 0.3 : 0.12;
    // Flat on the ground (rotation baked in), so its vertices can follow the terrain (see drape).
    // Own copies of the materials: the halo fades and the ring dims after selection (see sync).
    for (const [inner, outer, m, role] of [[r, r + 0.09, core, 'core'], [r + 0.09, r + 0.3, halo, 'halo']] as const) {
      const mesh = new Mesh(new RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2), m.clone());
      mesh.userData.lift = lift;
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
        const frameMaterial = new LineBasicMaterial({ color: 0x7ff5ff, transparent: true, opacity: 0.8, depthWrite: false, clippingPlanes: [frame] });
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
            const c = m.clone();
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
        seam = new Mesh(new RingGeometry(half * 0.98, half * 1.04, 4, 1), new MeshBasicMaterial({ color: 0x7ff5ff, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
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
    const insect = insectLegs(body);
    // Measured before the view is placed or turned; the first move is a jump from the origin, not a step.
    const gait = insect && { x: 0, z: 0, phase: e.id, cycle: gaitCycle(body, insect), hip: insect[0].o.getWorldPosition(new Vector3()).y };
    if (insect) {
      // Z walkers are mostly thin legs: an invisible box round the whole body catches clicks between them.
      const box = new Box3().setFromObject(body);
      const hit = new Mesh(new BoxGeometry(...box.getSize(new Vector3()).toArray()), PICK_PROXY);
      hit.position.copy(box.getCenter(new Vector3()));
      pivot.add(hit);
    }
    const arms = ['zarm_0', 'zarm_1'].map((n) => body.getObjectByName(n)).filter((o): o is Object3D => !!o).map((upper) => ({ upper, tip: upper.getObjectByName(`${upper.name}_tip`) }));
    const v: View = { type: e.type, gait, arms: arms.length ? arms : undefined, root, model: pivot, ring, scaffold, site, seam, print, pools, fx, heading: facing, target: facing, cargo: pivot.getObjectByName('cargo'), seen: false, unit: e.def.kind === 'unit',
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
    this.views.set(e.id, v);
    return v;
  }
}
