import { Box3, Vector3, Mesh, Object3D, Matrix4, Quaternion } from 'three';
import type { View } from './views';

/** A Z walker's leg (zleg_<pair>_<l|r>), pivoting at the hip, its shin (zshin_) at the knee; legs of one group step together. */
export interface InsectLeg {
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
  /** A leg cut at the knee (concepts-z/splitknee.py) walks by two-bone IK. */
  ik?: LegIK;
}

/** A Z leg's two-bone IK: its rest pose in the femur's parent frame, and where its foot is on the ground. */
interface LegIK {
  hip: Vector3;
  l1: number;
  l2: number;
  /** Rest hip-to-foot direction, and the way the knee stands out from that line. */
  dir: Vector3;
  pole: Vector3;
  /** Inverse rest bases of femur and shin (along the bone, across, the bend's normal). */
  femur: Matrix4;
  shin: Matrix4;
  qf: Quaternion;
  qs: Quaternion;
  /** The foot at rest, in the frame of the turning wrapper (heading, no bob nor lean), and the hip there. */
  home: Vector3;
  root: Vector3;
  /** Thigh plus shin, in world units. */
  reach: number;
  /** World position of the foot, where the last swing began, whether it is in the air, and whether `at` is valid. */
  at: Vector3;
  lift: Vector3;
  swing: boolean;
  ready: boolean;
  /** A soft dark disc on the ground under the foot (a child of the view's root), smaller as the foot lifts. */
  shadow?: Mesh;
}
export const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
/** How far a Z leg turns either way while walking, in radians. */
export const GAIT_SWING = 0.35;

/**
 * Ground covered by one full gait cycle: each leg group sweeps its feet back by one stride while planted,
 * and the groups take turns, so the body moves two strides a cycle. A stride is the arc the foot sweeps:
 * twice the leg's reach times the sine of the swing.
 */
export function gaitCycle(body: Object3D, legs: InsectLeg[]): number {
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
  // Reach on the ground, hip to foot: legs splayed forwards or back (generated models) reach further than their
  // sideways extent alone, and a short reach makes the feet patter.
  const reach =
    legs.reduce((sum, l) => {
      const box = new Box3().setFromObject(l.o);
      l.o.getWorldPosition(pivot);
      const dx = Math.max(Math.abs(box.min.x - pivot.x), Math.abs(box.max.x - pivot.x));
      const dz = Math.max(Math.abs(box.min.z - pivot.z), Math.abs(box.max.z - pivot.z));
      return sum + Math.hypot(dx, dz);
    }, 0) / legs.length;
  return 2 * (2 * reach * Math.sin(GAIT_SWING));
}

export function insectLegs(body: Object3D): InsectLeg[] | undefined {
  const legs: InsectLeg[] = [];
  body.traverse((o) => {
    const m = /^zleg_(\d+)_([lr])$/.exec(o.name);
    if (m) legs.push({ o, shin: o.getObjectByName(`zshin_${m[1]}_${m[2]}`), alpha: 0, beta: 0, pair: Number(m[1]), group: (Number(m[1]) + (m[2] === 'r' ? 1 : 0)) % 2, side: m[2] === 'r' ? 1 : -1 });
  });
  return legs.length ? legs : undefined;
}

const _ta = new Vector3();
const _tb = new Vector3();
const _tc = new Vector3();
const _td = new Vector3();
const _te = new Vector3();
const _tn = new Vector3();
const _tk = new Vector3();
const _th = new Vector3();
const _tm = new Matrix4();
const _tq = new Quaternion();
const _tr = new Quaternion();
const UP = new Vector3(0, 1, 0);

/** Basis along `x`, across, and the bend normal `n` (orthogonalised against `x`). */
function legBasis(m: Matrix4, x: Vector3, n: Vector3): Matrix4 {
  _te.copy(n).addScaledVector(x, -n.dot(x)).normalize();
  return m.makeBasis(x, _tn.crossVectors(_te, x), _te);
}

/** Measures a leg cut at the knee, matrices up to date: hip, knee and foot (the shin's lowest point) at rest. */
export function legRig(l: InsectLeg, pivot: Object3D): LegIK | undefined {
  const parent = l.o.parent;
  if (!l.shin || !parent) return undefined;
  const pts: Vector3[] = [];
  l.shin.traverse((m) => {
    const pos = (m as Mesh).isMesh ? (m as Mesh).geometry.getAttribute('position') : undefined;
    for (let i = 0; i < (pos?.count ?? 0); i++) pts.push(new Vector3().fromBufferAttribute(pos!, i).applyMatrix4(m.matrixWorld));
  });
  if (!pts.length) return undefined;
  const kneeW = l.shin.getWorldPosition(new Vector3());
  const hipW = l.o.getWorldPosition(new Vector3());
  // The foot: the middle of the sole, not its lowest corner (a flat foot pad, the Octopode's, has many).
  const bottom = Math.min(...pts.map((q) => q.y));
  const sole = pts.filter((q) => q.y < bottom + 0.04 * (hipW.y - bottom));
  const low = sole.reduce((sum, q) => sum.add(q), new Vector3()).divideScalar(sole.length);
  const hip = l.o.position.clone();
  const knee = parent.worldToLocal(kneeW.clone());
  const foot = parent.worldToLocal(low.clone());
  const x0 = knee.clone().sub(hip).normalize();
  const s0 = foot.clone().sub(knee).normalize();
  const n0 = new Vector3().crossVectors(x0, s0);
  if (n0.lengthSq() < 1e-8) n0.crossVectors(x0, UP); // a straight leg: it will bend upwards
  n0.normalize();
  const dir = foot.clone().sub(hip).normalize();
  const pole = knee.clone().sub(hip);
  pole.addScaledVector(dir, -pole.dot(dir));
  // Lifted: a leg standing almost straight (the Octopode's) has its knee barely off the hip-foot line, and bent
  // either way at random, its shin flipping up. Next to nothing for a leg hanging straight down.
  pole.addScaledVector(UP.clone().addScaledVector(dir, -UP.dot(dir)), 0.3 * knee.distanceTo(hip));
  if (pole.lengthSq() < 1e-10) pole.copy(UP).addScaledVector(dir, -UP.dot(dir));
  pole.normalize();
  return {
    hip,
    l1: knee.distanceTo(hip),
    l2: foot.distanceTo(knee),
    dir,
    pole,
    femur: legBasis(new Matrix4(), x0, n0).transpose(),
    shin: legBasis(new Matrix4(), s0, n0).transpose(),
    qf: l.o.quaternion.clone(),
    qs: l.shin.quaternion.clone(),
    home: pivot.worldToLocal(low.clone()),
    root: pivot.worldToLocal(hipW.clone()),
    reach: hipW.distanceTo(kneeW) + kneeW.distanceTo(low),
    at: new Vector3(),
    lift: new Vector3(),
    swing: false,
    ready: false,
  };
}

/** How far a walker sinks on its legs while walking, against its hip height: its knees bend, and its feet reach further. */
export const CROUCH = 0.3;
/** Walking, each foot steps round a spot pulled from its rest spot this far back towards its hip, front to back: generated
 * models stand with their legs splayed far forwards and back, which leaves them no reach to stride. */
const GATHER = 0.6;

/** How far (world units) this foot can go forwards or back of the spot it steps round, the body crouched by `crouch`. */
function legRoom(ik: LegIK, crouch: number): number {
  const x = ik.home.x - ik.root.x;
  const z = (ik.home.z - ik.root.z) * (1 - GATHER);
  const y = ik.root.y - crouch - ik.home.y;
  return Math.sqrt(Math.max(0, (0.95 * ik.reach) ** 2 - x * x - y * y)) - Math.abs(z);
}

/** Bends a leg so its foot reaches `target` (world), the knee standing out the way it does at rest. Matrices up to
 * date above the femur. */
function reachFoot(l: InsectLeg, ik: LegIK, target: Vector3): void {
  const t = l.o.parent!.worldToLocal(_ta.copy(target));
  const d = _tb.subVectors(t, ik.hip);
  const dist = Math.min((ik.l1 + ik.l2) * 0.999, Math.max(Math.abs(ik.l1 - ik.l2) * 1.02 + 1e-5, d.length()));
  d.normalize();
  _tq.setFromUnitVectors(ik.dir, d);
  const pole = _tc.copy(ik.pole).applyQuaternion(_tq);
  pole.addScaledVector(d, -pole.dot(d)).normalize();
  const a = (ik.l1 * ik.l1 - ik.l2 * ik.l2 + dist * dist) / (2 * dist);
  const knee = _td.copy(ik.hip).addScaledVector(d, a).addScaledVector(pole, Math.sqrt(Math.max(0, ik.l1 * ik.l1 - a * a)));
  t.copy(ik.hip).addScaledVector(d, dist); // the foot, at reach
  const x1 = d.subVectors(knee, ik.hip).normalize(); // d is free again
  const s1 = t.sub(knee).normalize();
  const n1 = _tn.crossVectors(x1, s1);
  if (n1.lengthSq() < 1e-10) n1.crossVectors(x1, pole);
  n1.normalize();
  const nx = _tk.copy(n1);
  // Femur: its rest basis turned onto the new one; the shin likewise, expressed under the turned femur.
  const qf = _tq.setFromRotationMatrix(legBasis(_tm, x1, nx).multiply(ik.femur)).multiply(ik.qf);
  l.o.quaternion.copy(qf);
  const qs = _tr.setFromRotationMatrix(legBasis(_tm, s1, nx).multiply(ik.shin));
  l.shin!.quaternion.copy(qf).invert().multiply(qs).multiply(ik.qf).multiply(ik.qs);
}

/** Ground covered by one second of the walk clip at its natural pace, in tiles. */
export const WALK_STRIDE = 1.1;

/** Cross-fades a character to clip `name`, if it has it. */
export function play(v: View, name: string, timeScale = 1): void {
  const next = v.clips?.get(name);
  if (!next) return;
  next.timeScale = timeScale;
  if (v.playing === next) return;
  next.reset().play();
  if (v.playing) next.crossFadeFrom(v.playing, 0.2, false);
  v.playing = next;
}

/** Advances a Z walker's gait by the distance its view moved since the last frame; returns the phase. */
export function stepGait(v: View, dt = 0): number {
  const { x, z } = v.root.position;
  const g = v.gait!;
  const moved = Math.hypot(x - g.x, z - g.z);
  if (moved < 1) g.phase += (moved / g.cycle) * Math.PI * 2; // a longer jump is a teleport, not a step
  if (dt > 0 && moved < 1) g.speed += (moved / dt - g.speed) * Math.min(1, dt * 4);
  g.x = x;
  g.z = z;
  return g.phase;
}

/**
 * Z walkers with knees: each foot stays planted on the ground while its group bears the body, then swings in an arc
 * to a spot half a stride ahead of where it stands at rest, the leg bent by two-bone IK. Groups take turns (tripods
 * on six legs, diagonals on four), the stride lengthens and the step rises with the ground speed, and the gait's
 * cycle is two strides so the planted feet do not slide. Standing still, the feet step back under the body.
 */
export function walk(v: View, dt: number, moving: boolean, visible: boolean): void {
  const legs = v.limbs.insect!;
  const g = v.gait!;
  const reach = legs.reduce((sum, l) => sum + l.ik!.reach, 0) / legs.length;
  // As long as the speed asks for, within what every leg can reach with the body crouched.
  const room = Math.max(0.15 * reach, 1.6 * Math.min(...legs.map((l) => legRoom(l.ik!, CROUCH * g.hip))));
  g.stride = Math.min(room, Math.max(0.4 * room, g.speed * 0.32));
  g.cycle = 2 * g.stride;
  if (!visible) {
    for (const l of legs) l.ik!.ready = false; // planted afresh when seen again
    return;
  }
  v.root.updateMatrixWorld(true);
  const fwd = _th.set(Math.sin(v.model.rotation.y), 0, Math.cos(v.model.rotation.y));
  const step = g.stride * 0.35 + reach * 0.06;
  const phase = g.phase / (Math.PI * 2);
  for (const l of legs) {
    const ik = l.ik!;
    // Home: the rest foot under the turning wrapper, without the body's bob.
    _ta.copy(ik.home);
    if (moving) _ta.z += (ik.root.z - ik.home.z) * GATHER;
    const home = v.model.localToWorld(_ta);
    home.y -= v.model.position.y;
    if (!ik.ready || ik.at.distanceTo(home) > 1.5 * reach) {
      ik.at.copy(home);
      ik.lift.copy(home);
      ik.swing = false;
      ik.ready = true;
    }
    const target = _tb.copy(ik.at);
    if (!moving) {
      // Back under the body, lifted while it is away.
      const away = Math.hypot(ik.at.x - home.x, ik.at.z - home.z);
      ik.at.lerp(home, Math.min(1, dt * 7));
      target.copy(ik.at).y += Math.min(step, away * 0.6);
      ik.swing = false;
      ik.lift.copy(ik.at);
    } else {
      const f = (((phase + l.group * 0.5) % 1) + 1) % 1;
      const swing = f >= 0.5;
      // While a foot is planted the body goes one stride over it, from half a stride ahead to half behind; while it
      // swings the body goes another stride, so it aims where its spot will be when it lands.
      const p = swing ? (f - 0.5) * 2 : f * 2;
      const ahead = swing ? g.stride * (1.5 - p) : g.stride * (0.5 - p);
      const spot = _tc.copy(home).addScaledVector(fwd, ahead);
      if (swing && !ik.swing) ik.lift.copy(ik.at);
      if (!swing && ik.swing) ik.at.copy(spot); // plants it, as far behind as the stance has already gone
      ik.swing = swing;
      if (swing) {
        ik.at.lerpVectors(ik.lift, spot, smoothstep(p));
        target.copy(ik.at).y += step * Math.sin(Math.PI * p);
      }
    }
    if (ik.shadow) {
      ik.shadow.position.set(target.x - v.root.position.x, 0.03, target.z - v.root.position.z);
      ik.shadow.scale.setScalar(Math.max(0.4, 1 - (target.y - home.y) / Math.max(step, 0.01)));
    }
    reachFoot(l, ik, target); // last: it reuses the scratch vectors home and target live in
  }
}
