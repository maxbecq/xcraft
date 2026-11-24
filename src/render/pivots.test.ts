import { Box3, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { boxInParent } from './pivots';
// Node's file system, reached at run time (the project carries no Node types): the files as served.
const fs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fs)) as { readFileSync(path: string): Uint8Array };

/** A compressed model's node tree (transforms only), each mesh node holding its mesh's box as the game would read it. */
function load(name: string): Object3D {
  // Its JSON chunk, after the 20-byte header. A name with its extension is a file of its own (a weapon module).
  const bytes = readFileSync(`public/models/${name.endsWith('.glb') ? name : `${name}-meshy.glb`}`);
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
  const j = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + size)));
  const nodes: Object3D[] = j.nodes.map((n: { name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; extras?: object }) => {
    const o = new Object3D();
    o.name = n.name ?? '';
    Object.assign(o.userData, n.extras);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    if (n.mesh !== undefined) {
      const box = new Box3();
      for (const prim of j.meshes[n.mesh].primitives) {
        const a = j.accessors[prim.attributes.POSITION];
        // A quantised position's bounds are stored raw: as the GPU reads them, normalised.
        const k = a.normalized ? (a.componentType === 5122 ? 32767 : a.componentType === 5120 ? 127 : 1) : 1;
        box.union(new Box3(new Vector3().fromArray(a.min).divideScalar(k), new Vector3().fromArray(a.max).divideScalar(k)));
      }
      Object.assign(o, { geometry: { boundingBox: box, computeBoundingBox() {} } });
    }
    return o;
  });
  j.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => nodes[i].add(nodes[c])));
  const root = new Object3D();
  for (const i of j.scenes[0].nodes) root.add(nodes[i]);
  return root;
}

const MOVING = /^(zrotor|zduct|zmast|zturret|ztread|zwheel|zstep|zvat|zpumper|zlever|zwing|armillaryb?|zshin_\d+_[lr]|zw_saw|cargo)(_\d+)*$/;

describe('moving parts keep their pivots through compression (tools/meshy/pivots.py)', () => {
  for (const name of ['bourdon', 'scarabee', 'casernevolante', 'grandconseil', 'pegase', 'cuve', 'barge', 'drone', 'dronecombat', 'quadripode', 'hexapode', 'octopode', 'zw_dechiqueteur.glb']) {
    it(`${name}: every moving part is a pivot node, its mesh in a child`, () => {
      const parts: Object3D[] = [];
      load(name).traverse((o) => MOVING.test(o.name) && parts.push(o));
      expect(parts.length).toBeGreaterThan(0);
      for (const o of parts) {
        expect((o as { geometry?: unknown }).geometry, o.name).toBeUndefined();
        expect(o.children.some((c) => c.name === `${o.name}_geo`), o.name).toBe(true);
      }
    });
  }

  it('a Scarabée track link written to its place on the loop lies on its track, not out past it', () => {
    const root = load('scarabee');
    const holder = root.getObjectByName('ztracks')!;
    const [, , az, r, ox] = holder.userData.zloop as number[];
    for (const side of [0, 1]) {
      const link = holder.getObjectByName(`ztread_${side}_0`)!;
      // As render/units.ts writes it on the bottom run, then on the top run (turned over).
      for (const [y, turn] of [[az - r, 0], [az + r, Math.PI]]) {
        link.position.set(side ? ox : -ox, y, 0);
        link.rotation.x = turn;
        const box = boxInParent(link);
        const [inner, outer] = side ? [box.min.x, box.max.x] : [-box.max.x, -box.min.x];
        expect(outer).toBeLessThan(ox + 0.03); // its side plate at most just outside the track's face
        expect(inner).toBeGreaterThan(ox - 0.34); // its cleat across the track, not beyond its inner edge
      }
    }
  });

  it("the Scarabée's turret turns on its own seat", () => {
    const turret = load('scarabee').getObjectByName('zturret')!;
    expect(turret.position.x).toBeCloseTo(0, 3);
    expect(turret.position.z).toBeCloseTo(0.15, 2); // where tools/meshy/scarabparts.py sank it, a little ahead
  });

  for (const name of ['dronecombat', 'quadripode', 'hexapode', 'octopode']) {
    it(`${name}: each shin turns at its knee, at its top, not its middle (tools/meshy/zknees.py)`, () => {
      const root = load(name);
      const legs: Object3D[] = [];
      root.traverse((o) => /^zleg_\d+_[lr]$/.test(o.name) && legs.push(o));
      expect(legs.length).toBeGreaterThanOrEqual(4);
      root.updateMatrixWorld(true);
      for (const leg of legs) {
        const shin = leg.getObjectByName(leg.name.replace('zleg_', 'zshin_'))!;
        // Its pivot high on the shin, where it meets the femur: compression had left it at the shin's middle.
        const box = boxInParent(shin).applyMatrix4(leg.matrixWorld);
        const knee = shin.getWorldPosition(new Vector3());
        expect((knee.y - box.min.y) / (box.max.y - box.min.y), shin.name).toBeGreaterThan(0.75);
      }
    });
  }
});
