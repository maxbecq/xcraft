// Takes the base colour texture out of a Meshy model, or puts an edited one back (meshopt kept).
// Usage: node tools/meshy/texture.mjs get public/models/<name>-meshy.glb out.webp
//        node tools/meshy/texture.mjs set public/models/<name>-meshy.glb in.webp
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';

const [mode, glb, file] = process.argv.slice(2);
if (!['get', 'set'].includes(mode) || !glb || !file) throw new Error('usage: texture.mjs get|set <model.glb> <image>');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(glb);
const textures = doc.getRoot().listMaterials().map((m) => m.getBaseColorTexture()).filter((t) => t);
if (textures.length !== 1) throw new Error(`${glb}: expected one base colour texture, found ${textures.length}`);
const [texture] = textures;
if (mode === 'get') {
  writeFileSync(file, texture.getImage());
  console.log(`${glb}: ${texture.getMimeType()} -> ${file}`);
} else {
  texture.setImage(readFileSync(file)).setMimeType(file.endsWith('.png') ? 'image/png' : 'image/webp');
  await io.write(glb, doc);
  console.log(`${file} -> ${glb}`);
}
