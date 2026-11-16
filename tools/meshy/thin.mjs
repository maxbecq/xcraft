// Thins Meshy meshes for big armies, in place. Every character is skinned three times a frame
// (picture, ambient occlusion, shadows), so vertex count is what limits large battles.
// Meshy textures come in thousands of small islands; gltf-transform's simplifier stops at their seams,
// so this uses meshoptimizer's permissive mode, which collapses across them while weighing UV error.
// Usage: node tools/meshy/thin.mjs <ratio> public/models/<name>-meshy.glb ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [ratio, ...files] = process.argv.slice(2);
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/** An accessor's elements as floats (normalised integers decoded), packed. */
function floats(accessor) {
  const n = accessor.getCount();
  const size = accessor.getElementSize();
  const out = new Float32Array(n * size);
  const el = [];
  for (let i = 0; i < n; i++) out.set(accessor.getElement(i, el), i * size);
  return out;
}

for (const file of files) {
  const doc = await io.read(file);
  let before = 0;
  let after = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      if (!indices || prim.getMode() !== 4) continue;
      const uv = prim.getAttribute('TEXCOORD_0');
      const target = Math.floor((indices.getCount() * Number(ratio)) / 3) * 3;
      const [kept] = MeshoptSimplifier.simplifyWithAttributes(
        new Uint32Array(indices.getArray()),
        floats(position), 3,
        uv ? floats(uv) : new Float32Array(position.getCount() * 2), 2, [uv ? 5 : 0, uv ? 5 : 0],
        null, target, 0.05, ['Permissive'],
      );
      // Keep only the vertices still used, in first-use order (also good for the GPU vertex cache).
      const remap = new Map();
      const order = [];
      const newIndices = new Uint32Array(kept.length);
      kept.forEach((v, i) => {
        if (!remap.has(v)) {
          remap.set(v, order.length);
          order.push(v);
        }
        newIndices[i] = remap.get(v);
      });
      before += position.getCount();
      after += order.length;
      for (const attr of prim.listAttributes()) {
        const src = attr.getArray();
        const size = attr.getElementSize();
        const dst = new src.constructor(order.length * size);
        order.forEach((v, i) => dst.set(src.subarray(v * size, v * size + size), i * size));
        attr.setArray(dst);
      }
      indices.setArray(order.length > 65535 ? newIndices : Uint16Array.from(newIndices));
    }
  }
  await io.write(file, doc);
  console.log(`${file}: ${before} -> ${after} vertices`);
}
