import {
  AdditiveBlending, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, EdgesGeometry, LineBasicMaterial, LineSegments, Mesh, Points, PointsMaterial,
  Vector3, type Material, type Object3D, type WebGLProgramParametersWithUniforms, type WebGLRenderer,
} from 'three';
import { owned, SHARED } from './models';

/**
 * An Isdaris building materialising (the user's pick B, 2026-11-26): its own creases grow up from the ground as a cyan
 * skeleton (first 30 % of the build), then the marble rises behind a cyan front with sparks on it (the rest), each
 * following the true build progress. The model's own lights (halos, veil, beams) wait for the end.
 * The cut is in world height, so it fits every model, Meshy or Blender; the materials are this view's own copies,
 * given back at the end. Shadows and ambient occlusion would draw the whole model, cut or not: off until then.
 */
export interface Materialising {
  /** World heights of the marble's front and of the skeleton's top. */
  front: { value: number };
  edge: { value: number };
  bottom: number;
  top: number;
  originals: [Mesh, Material | Material[], boolean][];
  lines: LineSegments[];
  hidden: Object3D[];
  sparks: Points;
  /** Model vertices in the view's frame, sorted by height (x, y, z triplets), for the sparks. */
  verts: Float32Array;
}

const SKELETON = 0.3; // share of the build the skeleton takes to grow
const SPARKS = 60;
const EDGES = new WeakMap<BufferGeometry, EdgesGeometry>();
let sparkMaterial: PointsMaterial | undefined;

/** The skeleton's lines: the model's creases at 40° (35° picked up every step of the Portail's statues). */
function edges(g: BufferGeometry): EdgesGeometry {
  let e = EDGES.get(g);
  if (!e) {
    EDGES.set(g, (e = new EdgesGeometry(g, 40)));
    SHARED.add(e); // kept when a view is freed (free() spares shared geometries)
  }
  return e;
}

/** A model effect (a halo, a beam, a glow card, the veil, the glass): hidden until built. */
const isEffect = (o: Object3D) => {
  const m = (o as Mesh).material as Material | undefined;
  return (m as { isShaderMaterial?: boolean } | undefined)?.isShaderMaterial || /^fx_(voile|verre)/.test(o.name);
};

/** The marble cut at the front, a cyan band just under it, weaker on flat faces (a terrace lit all at once flared). */
function cut(m: Material, front: { value: number }): Material {
  const c = owned(m.clone());
  const prev = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  c.side = DoubleSide; // the cut reads as solid, not hollow
  c.onBeforeCompile = (sh: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => {
    prev(sh, r);
    sh.uniforms.uFront = front;
    sh.vertexShader = `varying vec3 vMatW;\nvarying vec3 vMatN;\n${sh.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>
      vMatW = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vMatN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform float uFront;\nvarying vec3 vMatW;\nvarying vec3 vMatN;\n${sh.fragmentShader}`
      .replace('void main() {', 'void main() {\n  if (vMatW.y > uFront) discard;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(0.08, 0.6, 0.95) * exp(-max(0.0, uFront - vMatW.y) * 45.0) * (1.0 - 0.85 * abs(vMatN.y));`);
  };
  c.customProgramCacheKey = () => `${key()}-materialise`;
  return c;
}

/** Starts a view's materialisation; `root` is the view's root, the frame the sparks live in. */
export function materialise(body: Object3D, root: Object3D): Materialising {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(body);
  const front = { value: -1e3 };
  const edge = { value: -1e3 };
  const originals: Materialising['originals'] = [];
  const lines: LineSegments[] = [];
  const hidden: Object3D[] = [];
  const meshes: Mesh[] = [];
  body.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    if (isEffect(o)) {
      if (o.visible) hidden.push(o);
      return;
    }
    meshes.push(o as Mesh);
  });
  for (const o of hidden) o.visible = false;
  const toRoot = root.matrixWorld.clone().invert();
  const v = new Vector3();
  const pts: number[] = [];
  for (const mesh of meshes) {
    originals.push([mesh, mesh.material, mesh.castShadow]);
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => cut(m, front)) : cut(mesh.material, front);
    mesh.castShadow = false;
    mesh.userData.noAo = true;
    const e = edges(mesh.geometry);
    const count = e.getAttribute('position').count / 2;
    const lm = owned(new LineBasicMaterial({ color: new Color(0.05, 0.5, 0.85), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
    // A dense mesh (the Portail's statues) would pile its lines up into a blot of light.
    lm.opacity = Math.min(1, 900 / Math.max(1, count));
    lm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uFront: front, uEdge: edge });
      sh.vertexShader = `varying float vMatY;\n${sh.vertexShader}`.replace('#include <project_vertex>', `#include <project_vertex>\n vMatY = (modelMatrix * vec4(transformed, 1.0)).y;`);
      sh.fragmentShader = `uniform float uFront;\nuniform float uEdge;\nvarying float vMatY;\n${sh.fragmentShader}`.replace('#include <opaque_fragment>', `if (vMatY > uEdge) discard;
        diffuseColor.a *= smoothstep(uFront - 0.35, uFront + 0.05, vMatY) * (0.3 + 0.5 * exp(-max(0.0, uEdge - vMatY) * 6.0));
        #include <opaque_fragment>`);
    };
    lm.customProgramCacheKey = () => 'materialise-edges';
    const l = new LineSegments(e, lm);
    l.userData.noPick = true;
    l.renderOrder = 3;
    mesh.add(l);
    lines.push(l);
    // Sparks' perches: every few vertices, in the root's frame.
    const pos = mesh.geometry.getAttribute('position');
    const step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(toRoot);
      pts.push(v.x, v.y, v.z);
    }
  }
  const order = [...Array(pts.length / 3).keys()].sort((a, b) => pts[a * 3 + 1] - pts[b * 3 + 1]);
  const verts = new Float32Array(pts.length);
  order.forEach((k, i) => verts.set(pts.slice(k * 3, k * 3 + 3), i * 3));
  sparkMaterial ??= new PointsMaterial({ color: new Color(0.6, 1.8, 2.4), size: 0.07, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false });
  const sparks = new Points(new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3), 3)), sparkMaterial);
  sparks.userData.noPick = true;
  sparks.frustumCulled = false;
  root.add(sparks);
  return { front, edge, bottom: box.min.y - root.position.y, top: box.max.y - root.position.y, originals, lines, hidden, sparks, verts };
}

/** One frame at build progress p (0..1), the root standing at height `ground`. */
export function materialiseStep(m: Materialising, p: number, ground: number): void {
  const span = m.top - m.bottom + 0.05;
  m.edge.value = ground + m.bottom + span * Math.min(1, p / SKELETON);
  const marble = Math.max(0, (p - SKELETON) / (1 - SKELETON));
  const h = m.bottom + span * marble; // in the root's frame
  m.front.value = marble > 0 ? ground + h : -1e3;
  // Sparks: perches near the front, picked at random each frame, a little jitter.
  const pos = m.sparks.geometry.getAttribute('position') as BufferAttribute;
  const n = m.verts.length / 3;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m.verts[mid * 3 + 1] < h - 0.08) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < n && m.verts[end * 3 + 1] < h + 0.08) end++;
  for (let i = 0; i < SPARKS; i++) {
    if (end > lo && marble > 0) {
      const k = (lo + Math.floor(Math.random() * (end - lo))) * 3;
      pos.setXYZ(i, m.verts[k] + (Math.random() - 0.5) * 0.06, m.verts[k + 1] + Math.random() * 0.12, m.verts[k + 2] + (Math.random() - 0.5) * 0.06);
    } else pos.setXYZ(i, 0, -50, 0);
  }
  pos.needsUpdate = true;
}

/** Built: the shared materials back, shadows and effects back, the copies, lines and sparks freed. */
export function materialiseEnd(m: Materialising): void {
  for (const [mesh, material, shadow] of m.originals) {
    const copies = mesh.material;
    mesh.material = material;
    mesh.castShadow = shadow;
    mesh.userData.noAo = false;
    for (const c of ([] as Material[]).concat(copies)) c.dispose();
  }
  for (const l of m.lines) {
    l.removeFromParent();
    (l.material as Material).dispose(); // its edges stay: cached by geometry
  }
  for (const o of m.hidden) o.visible = true;
  m.sparks.removeFromParent();
  m.sparks.geometry.dispose();
}
