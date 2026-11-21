import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, Quaternion, SRGBColorSpace, Texture, Vector3 } from 'three';
import { isoOffset } from '../camera';

/**
 * A few Z buildings drawn as a painted picture instead of their 3D model (`?sprites=0` turns them back). The camera never
 * turns, so a building is always seen from the same side: one image, painted over a render of the model from that
 * exact angle (tools/sprites), can stand in for it.
 *
 * The picture is not a flat card: it is a grid laid on the camera's plane, each vertex pushed along the line of sight
 * by the depth of the 3D model at that pixel (baked with the image). On screen the grid is exactly the image; in
 * depth it is the model's front surface, so units pass in front and behind it right, and a world-height clipping
 * plane (the Z fabrication) cuts it at the right height. The model itself stays, invisible: it casts the shadow, is
 * hit by clicks and carries the hover halo and the fabrication armature.
 */
export const SPRITES = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sprites') !== '0';
/** Buildings drawn as their picture (public/sprites/<type>.png, <type>-depth.png, <type>.json); the others stay 3D. */
export const SPRITE_TYPES = ['pod', 'intelligence', 'podsup', 'supreme', 'assimilateur', 'centrerecherche', 'centresocles', 'optimisation', 'vacarme'];
/**
 * A picture's size against the model it stands on. The Intelligence suprême's model is drawn 10 % larger
 * (LOOK_SCALE); its picture is painted over the Intelligence centrale's with the same base, and keeps it.
 */
const SPRITE_SCALE: Record<string, number> = { supreme: 1 / 1.1 };
/**
 * Where the model under a picture painted over another building's sits, fitted on the picture by their bases
 * (printed by tools/sprites/depth.py): its scale and its shift on the ground, in its building's units.
 */
const SPRITE_PROXY: Record<string, { scale: number; x: number; z: number }> = {
  podsup: { scale: 1.073, x: -0.079, z: 0.046 },
  supreme: { scale: 0.891, x: -0.177, z: 0.08 },
};
/**
 * The model's turn when baked and when drawn: none, as the 3D buildings stand (a corner to the camera). A picture
 * drawn from another side (a 2D concept) would turn the model under it to match.
 */
export const SPRITE_YAW: Record<string, number> = {};
/** Image pixels per world unit, when baked. */
export const SPRITE_PPU = 144;
/** Depth span coded in the depth image (world units, centred on the building's origin). */
export const DEPTH_RANGE = 16;

/** The camera's axes: right, up (on screen) and towards the viewer. */
export function cameraAxes(): { right: Vector3; up: Vector3; back: Vector3 } {
  const back = isoOffset(1).normalize();
  const right = new Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right);
  return { right, up, back };
}

/** What the bake writes beside the images. */
export interface SpriteMeta {
  w: number;
  h: number;
  /** Pixel of the building's origin (centre of its footprint, on the ground). */
  ax: number;
  ay: number;
  ppu: number;
}

const loaded = new Map<string, { color: Texture; geometry: BufferGeometry }>();
const skins = new Map<string, MeshStandardMaterial>();

/** Invisible stand-in for the model: casts its shadow, takes clicks; drawn in no colour nor depth. */
const PROXY = new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });

const image = (url: string) => new Promise<HTMLImageElement>((ok, ko) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = ko;
  i.src = url;
});

const pixels = (i: HTMLImageElement) => {
  const c = document.createElement('canvas');
  [c.width, c.height] = [i.width, i.height];
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(i, 0, 0);
  return g.getImageData(0, 0, i.width, i.height).data;
};

/** Grid step (image pixels) of the relief: fine, or the ambient occlusion shaded its edge cells over the ground in steps. */
const STEP = 3;

/**
 * The relief: a grid over the image, cells fully transparent dropped, each vertex at its pixel's place on screen and
 * its depth (background vertices take their nearest painted neighbour's, so edges do not slope away).
 */
function relief(meta: SpriteMeta, alpha: Uint8ClampedArray, depth: Uint8ClampedArray): BufferGeometry {
  const { w, h, ax, ay, ppu } = meta;
  const nx = Math.ceil(w / STEP) + 1;
  const ny = Math.ceil(h / STEP) + 1;
  const at = (x: number, y: number) => (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4;
  // Depth per vertex, from the 3D model's own pixels; NaN where it has none.
  const d = new Float32Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const p = at(i * STEP, j * STEP);
      if (depth[p + 3] > 127) d[j * nx + i] = ((depth[p] + depth[p + 1] / 255) / 255 - 0.5) * DEPTH_RANGE;
    }
  // Spread to the empty vertices, ring by ring.
  for (let pass = 0, left = true; left && pass < 200; pass++) {
    left = false;
    const prev = d.slice();
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!Number.isNaN(prev[j * nx + i])) continue;
        let s = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = i + di;
          const y = j + dj;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          const v = prev[y * nx + x];
          if (!Number.isNaN(v)) [s, n] = [s + v, n + 1];
        }
        if (n) d[j * nx + i] = s / n;
        else left = true;
      }
  }
  const { right, up, back } = cameraAxes();
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  const nor = new Float32Array(nx * ny * 3);
  const v = new Vector3();
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const px = Math.min(w, i * STEP);
      const py = Math.min(h, j * STEP);
      // A little towards the viewer, so the ground at its foot does not cut its base.
      v.copy(right).multiplyScalar((px - ax) / ppu).addScaledVector(up, (ay - py) / ppu).addScaledVector(back, 0.06 - (d[k] || 0));
      v.toArray(pos, k * 3);
      back.toArray(nor, k * 3);
      uv[k * 2] = px / w;
      uv[k * 2 + 1] = 1 - py / h;
    }
  const index: number[] = [];
  for (let j = 0; j < ny - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      let opaque = false;
      for (let y = j * STEP; y <= (j + 1) * STEP && !opaque; y += 2) for (let x = i * STEP; x <= (i + 1) * STEP && !opaque; x += 2) opaque = alpha[at(x, y) + 3] > 20;
      if (!opaque) continue;
      const a = j * nx + i;
      index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** Loads the pictures (before the game starts, beside the models). */
export async function loadSprites(types: string[]): Promise<void> {
  if (!SPRITES) return;
  await Promise.all(types.filter((t) => SPRITE_TYPES.includes(t)).map(async (type) => {
    try {
      const base = `${import.meta.env.BASE_URL}sprites/${type}`;
      const [meta, color, depth] = await Promise.all([fetch(`${base}.json`).then((r) => r.json() as Promise<SpriteMeta>), image(`${base}.png`), image(`${base}-depth.png`)]);
      const texture = new Texture(color);
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      loaded.set(type, { color: texture, geometry: relief(meta, pixels(color), pixels(depth)) });
    } catch {
      // no picture: the 3D model
    }
  }));
}

/** Brightness of the painted picture on screen (it is not lit again: its light is painted in). */
const GLOW = 0.95;
/** Seconds, for the lights' life; shared by every picture, set as one is drawn. */
const clock = { value: 0 };

/**
 * The painted lights live: found by their colour (bright and saturated), red ones blink, warm ones (thrusters, the
 * forge) flicker, blue and cyan ones (screens, the gate's glow, light rings) breathe slowly. Each patch of the
 * picture and each building has its own phase, so they never pulse together. Works on the colour before the team's.
 */
const LIGHTS_GLSL = `
      float lMax = max(paint.r, max(paint.g, paint.b));
      float lSat = (lMax - min(paint.r, min(paint.g, paint.b))) / max(lMax, 0.001);
      float lit = smoothstep(0.18, 0.4, lMax) * smoothstep(0.45, 0.7, lSat);
      float red = lit * step(paint.g * 2.5, paint.r) * step(paint.b * 2.5, paint.r);
      // Warm: only the brightest (lit thrusters), not the rust's highlights.
      float warm = lit * smoothstep(0.45, 0.7, lMax) * (1.0 - red) * step(paint.b * 3.0, paint.r) * step(paint.g, paint.r);
      float cool = lit * step(paint.r * 1.6, paint.b);
      // Small lights blink each on its own (a phase per patch); wide glows breathe as one slow wave across the picture.
      vec2 lCell = floor(vMapUv * 9.0) + vSpriteSeed;
      float lPhase = fract(sin(dot(lCell, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
      float lWave = dot(vMapUv, vec2(2.5, 1.5)) + fract(sin(dot(vSpriteSeed, vec2(12.9898, 78.233))) * 43758.5453) * 6.2832;
      float blink = 0.15 + 1.4 * smoothstep(0.1, 0.6, sin(spriteTime * 2.4 + lPhase));
      float flicker = 1.05 + 0.4 * sin(spriteTime * 1.3 + lWave) * (0.6 + 0.4 * sin(spriteTime * 4.7 + lWave * 1.7));
      float breathe = 0.65 + 0.85 * (0.5 + 0.5 * sin(spriteTime * 0.9 + lWave));
      totalEmissiveRadiance *= mix(mix(mix(1.0, blink, red), flicker, warm), breathe, cool);`;

/** The picture in a team's colours: its blue paint (the 3D models' team key) turned to the team colour. */
function skin(type: string, color: number): MeshStandardMaterial {
  const key = `${type}|${color}`;
  let m = skins.get(key);
  if (m) return m;
  const { color: map } = loaded.get(type)!;
  m = new MeshStandardMaterial({ color: 0x000000, map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: GLOW, alphaTest: 0.5, roughness: 1, metalness: 0 });
  m.envMapIntensity = 0;
  const team = new Color(color);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.teamColor = { value: team };
    shader.uniforms.spriteTime = clock;
    shader.vertexShader = `varying vec2 vSpriteSeed;\n${shader.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
      vSpriteSeed = floor(modelMatrix[3].xz);`);
    shader.fragmentShader = `uniform vec3 teamColor;\nuniform float spriteTime;\nvarying vec2 vSpriteSeed;\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      vec3 paint = totalEmissiveRadiance;
      float teamMask = smoothstep(0.03, 0.12, paint.b - max(paint.r * 1.5, paint.g));
      totalEmissiveRadiance = mix(paint, teamColor * (dot(paint, vec3(0.3, 0.59, 0.11)) * 2.4 + 0.08) * ${GLOW.toFixed(2)}, teamMask);${LIGHTS_GLSL}`);
  };
  m.customProgramCacheKey = () => 'sprite-team';
  skins.set(key, m);
  return m;
}

/**
 * Keeps its parent's place and size but not its turn: the picture and the model under it face the camera the way
 * they were baked, whichever way the building was turned.
 */
class Upright extends Group {
  private static readonly t = new Vector3();
  private static readonly q = new Quaternion();
  private static readonly s = new Vector3();

  updateMatrixWorld(force?: boolean): void {
    if (this.matrixWorldAutoUpdate) this.updateMatrix();
    const p = this.parent;
    if (p) {
      p.matrixWorld.decompose(Upright.t, Upright.q, Upright.s);
      this.matrixWorld.compose(Upright.t, Upright.q.identity(), Upright.s).multiply(this.matrix);
    } else this.matrixWorld.copy(this.matrix);
    this.matrixWorldNeedsUpdate = false;
    for (const c of this.children) c.updateMatrixWorld(true);
    void force;
  }
}

/** Whether a type is drawn as its picture in this game. */
export const spriteOf = (type: string): boolean => SPRITES && loaded.has(type);

/**
 * A model copy turned into its picture: its meshes kept as the invisible stand-in, the relief added. Returns false
 * (model untouched) for a type without a picture.
 */
export function dressSprite(model: Object3D, type: string, teamColor: number): boolean {
  const s = SPRITES && loaded.get(type);
  if (!s) return false;
  const holder = new Upright();
  const turned = new Group();
  turned.rotation.y = SPRITE_YAW[type] ?? 0;
  const fit = SPRITE_PROXY[type];
  if (fit) {
    turned.scale.setScalar(fit.scale);
    turned.position.set(fit.x, 0, fit.z);
  }
  for (const c of [...model.children]) turned.add(c);
  turned.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.material = PROXY;
    o.receiveShadow = false;
  });
  const picture = new Mesh(s.geometry, skin(type, teamColor));
  picture.scale.setScalar(SPRITE_SCALE[type] ?? 1);
  picture.castShadow = false;
  picture.receiveShadow = false;
  picture.userData.sprite = true;
  picture.onBeforeRender = () => (clock.value = performance.now() / 1000);
  holder.add(turned, picture);
  model.add(holder);
  return true;
}
