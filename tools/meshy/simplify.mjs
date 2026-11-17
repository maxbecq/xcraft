// Simplifies Meshy models' shapes, in place: unpacks the meshopt file, has Blender weld and decimate it
// (tools/meshy/lowpoly.py, skin and clips kept), then packs it again with tools/compress-models.mjs.
// Usage: node tools/meshy/simplify.mjs <ratio 0-1> public/models/<name>-meshy.glb ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [ratio, ...files] = process.argv.slice(2);
if (!(Number(ratio) > 0 && Number(ratio) < 1) || !files.length) throw new Error('usage: simplify.mjs <ratio 0-1> <model.glb> ...');
const BLENDER = process.env.BLENDER ?? '/Applications/Blender.app/Contents/MacOS/Blender';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const dir = mkdtempSync(join(tmpdir(), 'lowpoly-'));

for (const file of files) {
  // Blender's importer cannot read meshopt: write a plain copy first.
  const doc = await io.read(file);
  doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === EXTMeshoptCompression.EXTENSION_NAME)?.dispose();
  const plain = join(dir, 'plain.glb');
  await io.write(plain, doc);
  const log = execFileSync(BLENDER, ['-b', '--factory-startup', '-P', 'tools/meshy/lowpoly.py', '--', plain, file, ratio], { encoding: 'utf8' });
  console.log(log.split('\n').filter((l) => l.startsWith('LOWPOLY')).map((l) => `${file}: ${l}`).join('\n'));
}
execFileSync('node', ['tools/compress-models.mjs', ...files], { stdio: 'inherit' });
