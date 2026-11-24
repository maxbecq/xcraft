import { Box3, Matrix4, type Object3D } from 'three';

/**
 * Moving parts and compression. tools/meshy/compress.sh quantises a model's positions with meshopt, which moves each
 * mesh node's origin to the middle of its mesh; a part the game turns or moves by its node then turned about the wrong
 * point. tools/meshy/pivots.py (run before compressing) keeps each moving part as a node of its own holding its pivot,
 * its mesh in a child `<name>_geo` that compression alone shifts. So the game writes a part's node freely; to know
 * where its mesh lies, it reads through to its children (boxInParent).
 */

/** The box an object's meshes fill, in its parent's frame (its own transform and its children's applied). */
export function boxInParent(o: Object3D): Box3 {
  const box = new Box3();
  const m = new Matrix4();
  const walk = (n: Object3D, parent: Matrix4) => {
    n.updateMatrix();
    const at = m.clone().multiplyMatrices(parent, n.matrix);
    const g = (n as { geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } }).geometry;
    if (g) {
      if (!g.boundingBox) g.computeBoundingBox();
      box.union(g.boundingBox!.clone().applyMatrix4(at));
    }
    for (const c of n.children) walk(c, at);
  };
  walk(o, new Matrix4());
  return box;
}
