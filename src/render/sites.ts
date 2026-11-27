import {
  AdditiveBlending, BufferAttribute, DoubleSide, CanvasTexture, SRGBColorSpace, Color, PlaneGeometry, BoxGeometry, LineBasicMaterial, Vector3, CylinderGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Object3D, RingGeometry, BufferGeometry, SphereGeometry, type Material, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { owned, SHARED } from './models';
import type { View } from './views';

export const scaffoldMaterial = new LineBasicMaterial({ color: 0xd9a420 });
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
export function buildingSite(footprint: number, size: Vector3): { footing: Mesh; storeys: Object3D[] } {
  // Built once per shape (its hundreds of boards are drawn from the size alone, so two sites of a type are the same):
  // merging them held a frame for 50 ms each time a building was begun, 190 ms on a slow machine. The copies share
  // the geometries, which are never freed with a view.
  const key = `${footprint}|${Math.round(size.x * 1000)}|${Math.round(size.y * 1000)}|${Math.round(size.z * 1000)}`;
  let made = SITES.get(key);
  if (!made) {
    made = makeSite(footprint, size);
    for (const o of [made.footing, ...made.storeys]) o.traverse((m) => (m as Mesh).geometry && SHARED.add((m as Mesh).geometry));
    SITES.set(key, made);
  }
  return { footing: made.footing.clone(), storeys: made.storeys.map((s) => s.clone()) };
}
const SITES = new Map<string, { footing: Mesh; storeys: Object3D[] }>();

function makeSite(footprint: number, size: Vector3): { footing: Mesh; storeys: Object3D[] } {
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
export const POOLS: Record<string, [number, number, number, number][]> = {
  conseil: [[0, 1.4, 1.6, 0xffa040]], // its lit arcades, along its front
  caserne: [[0, 1.6, 1.3, 0xffb050]],
  grenier: [[0, 1.0, 0.8, 0xffc070]],
  mine: [[1.0, -0.9, 1.0, 0xff8030], [0.3, 0.6, 1.0, 0xb060ff]],
  obelisque: [[0, 0, 2.6, 0x40d8ff]],
  emetteur: [[0, 0, 1.6, 0x40d8ff]],
  reservepsy: [[0, 0, 1.5, 0x40d8ff]], // cyan as its vat since Fable's model (was violet)
  recepteur: [[0, 0, 1.6, 0x40d8ff]], // cyan as its lights since Fable's model (was violet)
  minerai: [[0, 0, 1.6, 0xb06020]], // the geodes' halo
  puits: [[0, 0, 2.4, 0xb060ff]],
};
let poolTexture: Texture | null = null;
/** Buildings standing on a paved plaza wider than their model: [plaza width, raised inner step width]. */
// The Obélisque stood on one; its Blender model (Fable) has its own terrace and stairs.
export const PLAZAS: Record<string, [number, number]> = {};
let plazaMaterials: [MeshStandardMaterial, MeshStandardMaterial] | null = null;

/** An Art Deco forecourt: ivory slabs with gold inlays, a sunburst and blue enamel corners, in two low steps. */
export function plaza(width: number, inner: number): Group {
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

export function pool(radius: number, color: number): Mesh {
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
    owned(new MeshBasicMaterial({ map: poolTexture, color, transparent: true, opacity: 0.45, blending: AdditiveBlending, depthWrite: false })),
  );
  m.renderOrder = 1;
  return m;
}
let contactMaterial: MeshBasicMaterial | undefined;
/** A soft dark disc under a building's foot, `size` tiles across, so its base meets the ground. */
export function contactShadow(size: number): Mesh {
  if (!contactMaterial) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const r = g.createRadialGradient(64, 64, 20, 64, 64, 64);
    r.addColorStop(0, 'rgba(0,0,0,0.55)');
    r.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    contactMaterial = new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, depthWrite: false });
  }
  const geo = new PlaneGeometry(size * 1.25, size * 1.25).rotateX(-Math.PI / 2);
  const m = new Mesh(geo, contactMaterial); // shared material; the geometry goes with the view
  m.position.y = 0.03;
  m.renderOrder = -1;
  m.userData.noPick = true;
  return m;
}
const DOCK_STEEL = new MeshStandardMaterial({ color: 0x5a4636, metalness: 0.6, roughness: 0.55 });
const DOCK_CYAN = new MeshBasicMaterial({ color: 0x5ff3ff });
/** The dock arm's gunmetal, as on its sketch. */
const ARM_STEEL = new MeshStandardMaterial({ color: 0x55565c, metalness: 0.75, roughness: 0.4 });

/** A Z Pod's docking gear (see View.dock): four open ports, one a side at the model's edge (`reach`), and a gantry
 * along +x from the Pod's centre. */
export function podDock(reach: number, height: number): NonNullable<View['dock']> {
  const y = Math.min(height * 0.4, 0.55);
  const glow = owned(new MeshBasicMaterial({ color: 0x5ff3ff, transparent: true, depthWrite: false, side: DoubleSide }));
  const ports = new Group();
  for (let k = 0; k < 4; k++) {
    const side = new Group();
    side.rotation.y = (k * Math.PI) / 2;
    const collar = new Mesh(new BoxGeometry(0.2, 0.5, 0.6), DOCK_STEEL);
    collar.position.set(reach, y, 0);
    // Open jaws, waiting for an add-on to clamp.
    const jaws = [-1, 1].map((d) => {
      const jaw = new Mesh(new BoxGeometry(0.36, 0.08, 0.1), DOCK_STEEL);
      jaw.position.set(reach + 0.22, y + d * 0.2, 0);
      jaw.rotation.z = d * 0.35;
      return jaw;
    });
    const ring = new Mesh(new RingGeometry(0.1, 0.18, 24), glow);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(reach + 0.11, y, 0);
    side.add(collar, ...jaws, ring);
    ports.add(side);
  }
  // The four sides' parts, which never move, as one mesh per material.
  ports.updateMatrixWorld(true);
  const byMaterial = new Map<Material, BufferGeometry[]>();
  ports.traverse((o) => {
    if (o instanceof Mesh) (byMaterial.get(o.material) ?? byMaterial.set(o.material, []).get(o.material)!).push(o.geometry.clone().applyMatrix4(o.matrixWorld));
  });
  ports.clear();
  for (const [material, list] of byMaterial) ports.add(new Mesh(mergeGeometries(list), material));
  const arm = dockArm(y);
  for (const o of [ports, arm]) o.traverse((m) => (m.userData.noPick = true));
  return { ports, arm, arms: [arm], glow, y, reach };
}

/**
 * A short articulated arm out to an add-on (its chosen sketch): two round riveted segments bent up at an elbow,
 * a cyan-lit collar at the Pod, at the elbow and at the add-on, and a flange plate where it clamps onto a flat side
 * (the Plate-forme's deck). Laid out along +x by bendDock to the gap's length; one per add-on.
 */
export function dockArm(y: number): Object3D {
  const arm = new Group();
  const segment = () => {
    const g = new Group();
    // A tube, a band round it and a piston along its top, one mesh.
    g.add(new Mesh(mergeGeometries([new CylinderGeometry(0.1, 0.12, 1, 10).translate(0, 0.5, 0), new CylinderGeometry(0.125, 0.125, 0.06, 10).translate(0, 0.5, 0), new CylinderGeometry(0.035, 0.035, 0.8, 6).translate(0.1, 0.5, 0)]), ARM_STEEL));
    return g;
  };
  const collar = () => {
    const g = new Group();
    g.add(new Mesh(new CylinderGeometry(0.17, 0.17, 0.12, 12), ARM_STEEL), new Mesh(new CylinderGeometry(0.11, 0.11, 0.14, 12), DOCK_CYAN));
    return g;
  };
  const elbow = new Group();
  elbow.add(new Mesh(new SphereGeometry(0.16, 12, 8), ARM_STEEL), new Mesh(new CylinderGeometry(0.1, 0.1, 0.36, 10).rotateX(Math.PI / 2), DOCK_CYAN));
  // The flange: a square steel plate flat against the side it clamps, a cyan ring round the arm's end. Faces -x.
  const plate = new Group();
  const ring = new Mesh(new CylinderGeometry(0.2, 0.2, 0.03, 16).rotateZ(Math.PI / 2), DOCK_CYAN);
  ring.position.x = -0.03;
  plate.add(new Mesh(new BoxGeometry(0.05, 0.42, 0.42), ARM_STEEL), ring);
  plate.visible = false;
  const parts = { a: segment(), b: segment(), from: collar(), to: collar(), elbow, plate };
  arm.add(parts.a, parts.b, parts.from, parts.to, parts.elbow, plate);
  arm.userData.parts = parts;
  arm.position.y = y;
  arm.visible = false;
  arm.traverse((m) => (m.userData.noPick = true));
  return arm;
}

/** Lays a dock arm out along its +x to `length`, its far end `rise` higher; the elbow raised a little between. */
export function bendDock(arm: Object3D, length: number, rise: number): void {
  const p = arm.userData.parts as { a: Object3D; b: Object3D; from: Object3D; to: Object3D; elbow: Object3D };
  const a = new Vector3(0, 0, 0);
  const b = new Vector3(length, rise, 0);
  const m = a.clone().lerp(b, 0.5).add(new Vector3(0, 0.04 + 0.05 * length, 0));
  const up = new Vector3(0, 1, 0);
  for (const [seg, s, e] of [[p.a, a, m], [p.b, m, b]] as const) {
    const d = e.clone().sub(s);
    seg.position.copy(s);
    seg.quaternion.setFromUnitVectors(up, d.clone().normalize());
    seg.scale.set(1, Math.max(0.01, d.length()), 1);
  }
  p.elbow.position.copy(m);
  (arm.userData.parts as { plate: Object3D }).plate.position.copy(b);
  for (const [c, at, toward] of [[p.from, a, m], [p.to, b, m]] as const) {
    c.position.copy(at);
    c.quaternion.setFromUnitVectors(up, toward.clone().sub(at).normalize());
  }
}
