import { Box3, BufferAttribute, DetachedBindMode, BufferGeometry, type Group, Matrix4, Mesh, Object3D, Skeleton, SkinnedMesh, Vector3 } from 'three';

/**
 * The Dieux are drawn as single blocks (one mesh per material, no limbs, no skeleton): they glided over the ground.
 * Each gets a small skeleton made up at load time (procRig), its bones placed from its silhouette (RIGS) and its
 * vertices bound to them with soft weights, so a robe bends instead of tearing. The view then walks, floats, flies or
 * slithers those bones (stepRig), by the ground actually covered so feet keep pace with the speed. Render only.
 *
 * Measures are in the model's own units (as loaded, facing +Z, feet at y = 0).
 */
export interface RigSpec {
  /** walk: two legs. quad: four. float: no legs, a hem that trails. fly: wings. serpent: a body that sways in rings. */
  kind: 'walk' | 'quad' | 'float' | 'fly' | 'serpent';
  /** Height of the hips (legs pivot there) or of the waist for a float. */
  hip: number;
  /** Half-width over which the left leg's weight hands over to the right's: narrow for bare legs, wide for a robe. */
  blend?: number;
  /** How far legs swing either way (radians). */
  swing?: number;
  /** Arms: hanging beyond |x| > [0], from the shoulder at height [1], up to [2] (a weapon held up; default just above). */
  arms?: [number, number, number?];
  /** How far arms swing, against the legs' swing (default 0.6): less for a long weapon held low. */
  armSwing?: number;
  /** Wings: beyond |x| > [0], their root at height [1]. */
  wings?: [number, number];
  /** quad: fore legs ahead of this z, hind legs behind. */
  front?: number;
  /** Ground covered in one full cycle (two steps), at most. */
  stride?: number;
  /** A ponderous walker (Golem, Titan): slower, heavier steps, a deeper sway. */
  heavy?: boolean;
  /** A god's circle and ornaments on the ground: flat parts low and wide stay put. */
  ring?: boolean;
  /** Legs reach no further than this from z = 0: a cape or a train behind follows the hips, not the stride. */
  depth?: number;
}

/**
 * The Dieux's silhouettes (tools/blender/dieux, and the image-to-3D Minotaure and Gaïa), read off their models:
 * legs below `hip`, robes on the gods, wings and arms beyond their x.
 */
export const RIGS: Record<string, RigSpec> = {
  // Gods: robed, legs under the robe; their circle on the ground.
  thor: { kind: 'walk', depth: 0.4, hip: 1.25, blend: 0.25, swing: 0.3, arms: [0.4, 2.3, 4.2], armSwing: 0.4, ring: true, heavy: true },
  odin: { kind: 'walk', depth: 0.4, hip: 1.3, blend: 0.4, swing: 0.2, arms: [0.48, 2.25], ring: true },
  apollon: { kind: 'walk', depth: 0.4, hip: 1.1, blend: 0.22, swing: 0.32, arms: [0.5, 2.25], ring: true },
  seth: { kind: 'walk', depth: 0.4, hip: 1.2, blend: 0.4, swing: 0.2, arms: [0.55, 2.2], ring: true },
  athena: { kind: 'walk', depth: 0.4, hip: 1.25, blend: 0.4, swing: 0.2, arms: [0.48, 2.2], ring: true },
  isis: { kind: 'walk', depth: 0.4, hip: 1.3, blend: 0.45, swing: 0.16, arms: [0.5, 2.25], ring: true },
  hades: { kind: 'walk', depth: 0.4, hip: 1.25, blend: 0.35, swing: 0.2, arms: [0.48, 2.25], ring: true },
  osiris: { kind: 'walk', depth: 0.4, hip: 1.25, blend: 0.35, swing: 0.2, arms: [0.48, 2.25], ring: true },
  frigg: { kind: 'float', hip: 1.2, arms: [0.48, 2.25] },
  gaia: { kind: 'float', hip: 1.0, arms: [0.55, 1.9] },
  // Their troops.
  nain: { kind: 'walk', hip: 0.22, blend: 0.06, swing: 0.55, arms: [0.22, 0.55] },
  minotaure: { kind: 'walk', hip: 0.5, blend: 0.1, swing: 0.5, arms: [0.36, 1.3], armSwing: 0.25 },
  titan: { kind: 'walk', hip: 0.32, blend: 0.08, swing: 0.4, arms: [0.2, 1.3], heavy: true },
  immortel: { kind: 'walk', hip: 0.25, blend: 0.08, swing: 0.45, arms: [0.27, 1.05] },
  golem: { kind: 'walk', hip: 0.42, blend: 0.12, swing: 0.35, heavy: true },
  pretresse: { kind: 'walk', hip: 0.38, blend: 0.12, swing: 0.14, arms: [0.12, 0.62] },
  sphinx: { kind: 'quad', hip: 0.5, blend: 0.12, swing: 0.45, front: -0.1, depth: 0.6 },
  esprit: { kind: 'float', hip: 0.35, arms: [0.12, 0.45] },
  elementaire: { kind: 'float', hip: 0.35, arms: [0.12, 0.65] },
  elemeau: { kind: 'float', hip: 0.25, arms: [0.17, 0.45] },
  elemterre: { kind: 'float', hip: 0.3, arms: [0.24, 0.35], heavy: true },
  elemair: { kind: 'fly', hip: 0.45, wings: [0.2, 0.6] },
  walkyrie: { kind: 'fly', hip: 0.3, wings: [0.17, 0.68], swing: 0.3 },
  drake: { kind: 'fly', hip: 0.55, wings: [0.32, 0.85] },
  corbeau: { kind: 'fly', hip: 0.7, wings: [0.04, 0.75] },
  jormungandr: { kind: 'serpent', hip: 0.2 },
};

const smooth = (a: number, b: number, x: number) => {
  const c = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return c * c * (3 - 2 * c);
};

/** A made-up skeleton's bones, by role, found again on each copy by name. */
export interface Rig {
  spec: RigSpec;
  /** The bones' root, out of the scene: their matrices are worked out here (stepRig). */
  root: Object3D;
  hips: Object3D;
  torso: Object3D;
  legs: Object3D[];
  arms: Object3D[];
  wings: Object3D[];
  segs: Object3D[];
  /** Rest heights of hips and torso; gait phase; how much it walks (0..1); last place; ground speed; world size of a model unit. */
  rest: [number, number];
  phase: number;
  walk: number;
  at: [number, number] | undefined;
  speed: number;
  scale: number;
  seed: number;
}

/**
 * Turns a Dieux model into skinned meshes bound to a skeleton made from `spec` (one mesh per material still: no
 * draw call added). The bones stand apart from the scene, in the model's own frame, bound detached: every mesh of
 * every copy then draws with the same bind matrices, where bones in the scene made three send each mesh its own
 * (1 700 matrix uploads a frame in a battle of 160 Dieux, a third more render time). A copy (models.ts model) clones
 * the bones and binds its own skeleton; the view moves them and works out their matrices (stepRig).
 */
export function procRig(scene: Group, spec: RigSpec): void {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const top = box.max.y;
  const half = Math.max(-box.min.x, box.max.x);
  const node = (name: string, parent: Object3D | null, x: number, y: number, z = 0) => {
    const o = new Object3D();
    o.name = `grig_${name}`;
    // Bones hold positions relative to their parent: given here in the model's frame.
    o.position.copy(parent ? parent.worldToLocal(new Vector3(x, y, z)) : new Vector3(x, y, z));
    parent?.add(o);
    o.updateMatrixWorld(true);
    return o;
  };
  const root = node('root', null, 0, 0);
  const hips = node('hips', root, 0, spec.hip);
  const torso = node('torso', hips, 0, spec.hip);
  const bones: Object3D[] = [root, hips, torso];
  const legs: Object3D[] = [];
  const blend = spec.blend ?? half * 0.2;
  if (spec.kind === 'walk') for (const s of [1, -1]) legs.push(node(`leg_${legs.length}`, hips, s * blend, spec.hip));
  if (spec.kind === 'float') legs.push(node('leg_0', hips, 0, spec.hip));
  if (spec.kind === 'quad') for (const f of [1, -1]) for (const s of [1, -1]) legs.push(node(`leg_${legs.length}`, hips, s * blend, spec.hip, (spec.front ?? 0) + f * blend));
  const arms = spec.arms ? [1, -1].map((s, i) => node(`arm_${i}`, torso, s * spec.arms![0], spec.arms![1])) : [];
  const wings = spec.wings ? [1, -1].map((s, i) => node(`wing_${i}`, torso, s * spec.wings![0], spec.wings![1])) : [];
  const segs: Object3D[] = [];
  if (spec.kind === 'serpent') {
    let parent: Object3D = root;
    for (let i = 0; i < 5; i++) segs.push((parent = node(`seg_${i}`, parent, 0, box.min.y + ((top - box.min.y) * i) / 5)));
  }
  bones.push(...legs, ...arms, ...wings, ...segs);
  const index = (o: Object3D) => bones.indexOf(o);
  const meshes: Mesh[] = [];
  scene.traverse((o) => void (o instanceof Mesh && !(o instanceof SkinnedMesh) && meshes.push(o)));
  const w = new Array<number>(bones.length);
  const p = new Vector3();
  for (const mesh of meshes) {
    // The packed attributes as they are (quantised normals): a skinned vertex is drawn in up to four passes a frame.
    const g = (mesh.geometry as BufferGeometry).clone();
    if (!mesh.matrixWorld.equals(new Matrix4())) g.applyMatrix4(mesh.matrixWorld);
    const pos = g.getAttribute('position');
    const n = pos.count;
    // Bytes: a few bones, weights to 1/255.
    const skinIndex = new Uint8Array(n * 4);
    const skinWeight = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      w.fill(0);
      weigh(spec, p, w, { root, hips, torso, legs, arms, wings, segs, index, top, half, blend, low: box.min.y });
      // The four strongest, normalised.
      const best = w.map((v, k) => [v, k] as const).filter(([v]) => v > 1e-3).sort((a, b) => b[0] - a[0]).slice(0, 4);
      const sum = best.reduce((s, [v]) => s + v, 0) || 1;
      let left = 255;
      best.forEach(([v, k], j) => {
        skinIndex[i * 4 + j] = k;
        const q = j === best.length - 1 ? left : Math.round((v / sum) * 255);
        skinWeight[i * 4 + j] = q;
        left -= q;
      });
      if (!best.length) skinWeight[i * 4] = 255; // the root
    }
    mesh.parent!.remove(mesh);
    g.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4, true));
    const skin = new SkinnedMesh(g, mesh.material);
    skin.name = mesh.name;
    Object.assign(skin.userData, mesh.userData);
    scene.add(skin);
  }
  scene.updateMatrixWorld(true);
  const skeleton = new Skeleton(bones as never[]);
  scene.traverse((o) => {
    if (!(o instanceof SkinnedMesh)) return;
    o.bindMode = DetachedBindMode;
    o.bind(skeleton, new Matrix4());
    o.computeBoundingBox();
    o.computeBoundingSphere();
    o.boundingSphere!.radius *= 1.3; // limbs swing out of the rest pose
    o.userData.godRig = true;
  });
  scene.userData.rig = spec;
}

interface Parts {
  root: Object3D;
  hips: Object3D;
  torso: Object3D;
  legs: Object3D[];
  arms: Object3D[];
  wings: Object3D[];
  segs: Object3D[];
  index: (o: Object3D) => number;
  top: number;
  half: number;
  blend: number;
  low: number;
}

/** A vertex's weights on each bone. */
function weigh(spec: RigSpec, p: Vector3, w: number[], b: Parts): void {
  const { hip } = spec;
  if (spec.ring && p.y < 0.08 && Math.hypot(p.x, p.z) > b.half * 0.72) {
    w[b.index(b.root)] = 1;
    return;
  }
  if (spec.kind === 'serpent') {
    const f = Math.min(b.segs.length - 1, Math.max(0, ((p.y - b.low) / (b.top - b.low)) * b.segs.length - 0.5));
    const k = Math.floor(f);
    w[b.index(b.segs[k])] = 1 - (f - k);
    if (k + 1 < b.segs.length) w[b.index(b.segs[k + 1])] = f - k;
    return;
  }
  // Below the hips: the legs (or the trailing hem); above: the hips, then the chest.
  const leg = spec.kind === 'fly' ? 0 : (1 - smooth(hip * 0.75, hip * 1.05, p.y)) * (spec.depth ? 1 - smooth(spec.depth, spec.depth * 1.5, Math.abs(p.z)) : 1);
  if (leg > 0) {
    const s = smooth(-b.blend, b.blend, p.x);
    if (spec.kind === 'walk') {
      w[b.index(b.legs[0])] = leg * s;
      w[b.index(b.legs[1])] = leg * (1 - s);
    } else if (spec.kind === 'quad') {
      const f = smooth((spec.front ?? 0) - b.blend, (spec.front ?? 0) + b.blend, p.z);
      w[b.index(b.legs[0])] = leg * s * f;
      w[b.index(b.legs[1])] = leg * (1 - s) * f;
      w[b.index(b.legs[2])] = leg * s * (1 - f);
      w[b.index(b.legs[3])] = leg * (1 - s) * (1 - f);
    } else w[b.index(b.legs[0])] = leg;
  }
  let rest = 1 - leg;
  const limb = (pair: Object3D[], at: [number, number, number?] | undefined, fade: number) => {
    if (!at || !pair.length) return;
    const top = at[2] ?? at[1];
    const out = smooth(at[0], at[0] + b.half * 0.12, Math.abs(p.x)) * (1 - smooth(top, top + fade, p.y)) * smooth(hip * 0.9, hip * 1.1, p.y);
    if (out <= 0) return;
    w[b.index(pair[p.x > 0 ? 0 : 1])] = rest * out;
    rest *= 1 - out;
  };
  limb(b.arms, spec.arms, b.top * 0.08);
  limb(b.wings, spec.wings, b.top * 0.3);
  const chest = smooth(hip, hip + (b.top - hip) * 0.4, p.y);
  w[b.index(b.torso)] += rest * chest;
  w[b.index(b.hips)] += rest * (1 - chest);
}

/** The made-up skeleton of a copy, if its model has one. */
export function findRig(body: Object3D, scale: number, seed: number): Rig | undefined {
  const spec = body.userData.rig as RigSpec | undefined;
  let root: Object3D | undefined;
  body.traverse((o) => {
    if (!root && (o as SkinnedMesh).isSkinnedMesh && o.userData.godRig) root = (o as SkinnedMesh).skeleton.bones[0];
  });
  if (!spec || !root) return undefined;
  const all = (prefix: string) => {
    const out: Object3D[] = [];
    for (let i = 0; ; i++) {
      const o = root!.getObjectByName(`grig_${prefix}_${i}`);
      if (!o) return out;
      out.push(o);
    }
  };
  const hips = root.getObjectByName('grig_hips')!;
  const torso = root.getObjectByName('grig_torso')!;
  return { spec, root, hips, torso, legs: all('leg'), arms: all('arm'), wings: all('wing'), segs: all('seg'), rest: [hips.position.y, torso.position.y], phase: seed, walk: 0, at: undefined, speed: 0, scale, seed };
}

/**
 * Poses a made-up skeleton for this frame. `x`, `z`: where the unit stands (tiles); `turn`: how far it still has to
 * turn (radians, for a lean into the bend); `fighting`: it strikes or casts, standing.
 */
export function stepRig(r: Rig, x: number, z: number, dt: number, t: number, moving: boolean, turn: number, fighting: boolean): void {
  pose(r, x, z, dt, t, moving, turn, fighting);
  r.root.updateMatrixWorld(true); // out of the scene: three does not
}

function pose(r: Rig, x: number, z: number, dt: number, t: number, moving: boolean, turn: number, fighting: boolean): void {
  const s = r.spec;
  const moved = r.at ? Math.hypot(x - r.at[0], z - r.at[1]) : 0;
  r.at = [x, z];
  if (moved < 1 && dt > 0) r.speed += (moved / dt - r.speed) * Math.min(1, dt * 4);
  r.walk += ((moving ? 1 : 0) - r.walk) * Math.min(1, dt * 6);
  const k = r.walk;
  // A full cycle covers at most the model's stride, and turns at least once in 1.25 s (a slow god still steps).
  const stride = (s.stride ?? s.hip * (s.heavy ? 2.2 : 2.6)) * r.scale;
  const cycle = Math.min(stride, Math.max(0.05, r.speed) * (s.heavy ? 1.6 : 1.25));
  if (moved < 1) r.phase += (moved / cycle) * Math.PI * 2;
  const ph = r.phase;
  const swing = s.swing ?? 0.4;
  const breathe = Math.sin(t * 1.7 + r.seed);
  const bank = Math.max(-0.35, Math.min(0.35, -turn * 0.6));
  const { hips, torso } = r;
  const ease = (o: Object3D | undefined, axis: 'x' | 'y' | 'z', to: number, rate = 12) => {
    if (o) o.rotation[axis] += (to - o.rotation[axis]) * Math.min(1, dt * rate);
  };
  const lift = (o: Object3D, rest: number, by: number) => (o.position.y = rest + by);
  if (s.kind === 'walk' || s.kind === 'quad') {
    const heavy = s.heavy ? 1 : 0;
    // Highest as the legs pass under the body, lowest as a foot lands; a heavy one drops hard on each step.
    const pass = Math.abs(Math.cos(ph));
    const bob = (heavy ? Math.pow(pass, 0.5) - 0.7 : pass - 0.6) * s.hip * (heavy ? 0.09 : 0.07) * k;
    lift(hips, r.rest[0], bob + breathe * s.hip * 0.008 * (1 - k));
    ease(hips, 'z', Math.sin(ph) * (heavy ? 0.07 : 0.04) * k + bank * 0.3 * k);
    ease(hips, 'y', Math.sin(ph) * 0.08 * k);
    ease(hips, 'x', (heavy ? 0.05 : 0.03) * k);
    ease(torso, 'y', -Math.sin(ph) * 0.14 * k);
    ease(torso, 'x', (heavy ? 0.06 : 0.04) * k + (fighting ? 0.05 : 0) + breathe * 0.012 * (1 - k));
    ease(torso, 'z', -Math.sin(ph) * (heavy ? 0.04 : 0.02) * k);
    if (s.kind === 'walk') {
      ease(r.legs[0], 'x', Math.sin(ph) * swing * k, 18);
      ease(r.legs[1], 'x', -Math.sin(ph) * swing * k, 18);
    } else
      r.legs.forEach((l, i) => {
        // Diagonal pairs: fore left with hind right.
        const diag = i === 0 || i === 3 ? 0 : Math.PI;
        ease(l, 'x', Math.sin(ph + diag) * swing * k, 18);
      });
    r.arms.forEach((a, i) => ease(a, 'x', (i ? 1 : -1) * Math.sin(ph) * swing * (s.armSwing ?? 0.6) * k + (fighting ? -0.25 : 0), 10));
    return;
  }
  if (s.kind === 'float') {
    // Drifts up and down, leans into its way, its hem trailing behind; a heavy one (a rock) lurches.
    const drift = Math.sin(t * (s.heavy ? 3 : 1.6) + r.seed) * s.hip * (s.heavy ? 0.05 : 0.08);
    const lurch = s.heavy ? Math.abs(Math.sin(ph)) * s.hip * 0.12 * k : 0;
    lift(hips, r.rest[0], drift + lurch);
    ease(hips, 'x', 0.16 * k, 6);
    ease(hips, 'z', bank * k + Math.sin(t * 1.1 + r.seed) * 0.03, 6);
    ease(torso, 'x', -0.05 * k + breathe * 0.02, 6);
    ease(r.legs[0], 'x', -0.3 * k + Math.sin(t * 2.6 + r.seed) * 0.06, 4);
    ease(r.legs[0], 'z', Math.sin(t * 1.9 + r.seed) * 0.05, 4);
    r.arms.forEach((a, i) => {
      ease(a, 'x', 0.35 * k + Math.sin(t * 2 + r.seed + i * 1.4) * 0.1 + (fighting ? -0.4 : 0), 5);
      ease(a, 'z', (i ? -1 : 1) * (0.08 + Math.sin(t * 1.3 + i) * 0.04), 5);
    });
    return;
  }
  if (s.kind === 'fly') {
    // Wingbeats, faster on the way; the body rises on each downstroke, dangling legs kick back.
    const rate = moving ? 9 : 5;
    const beat = Math.sin(t * rate + r.seed);
    const flap = beat * (moving ? 0.55 : 0.35);
    r.wings.forEach((wg, i) => (wg.rotation.z = (i ? -1 : 1) * (flap + 0.1)));
    lift(hips, r.rest[0], -Math.cos(t * rate + r.seed) * s.hip * 0.06);
    ease(torso, 'x', 0.1 * k, 6);
    return;
  }
  // A serpent sways in waves running up its rings, faster as it goes.
  const wave = t * (2 + 2 * k) + ph * 0.5;
  r.segs.forEach((g, i) => {
    if (i === 0) return;
    ease(g, 'z', Math.sin(wave - i * 0.9) * (0.06 + 0.06 * k), 8);
    ease(g, 'y', Math.cos(wave - i * 0.9) * 0.08, 8);
  });
}
