// Shrinks Blender models (and Meshy dress overlays) for the web, in place, with lossless-position meshopt:
// vertex positions keep their floats and node transforms stay as they are (the procedural limbs and the
// team-paint lookups rely on them); normals go to 8-bit octahedral, then everything is meshopt-packed.
// The game loads them with MeshoptDecoder. Files already compressed are skipped.
// Usage: node tools/compress-models.mjs public/models/<name>.glb ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// decor.ts loads doodads.glb without a MeshoptDecoder.
for (const file of process.argv.slice(2).filter((f) => !f.endsWith('doodads.glb'))) {
  const doc = await io.read(file);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME)) continue;
  const before = statSync(file).size;
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  console.log(`${file}: ${before} -> ${statSync(file).size}`);
}
