// Isdaris buildings modelled in Blender by Fable (recherches-visuelles/isdaris-batiments/3d/blender-fable) into the game's
// static-model slot, `public/models/<type>-meshy.glb`: façade turned to +Z, sized to the footprint, feet at the origin, and
// the blue bands' material renamed `team` (the team colour, as in the Blender models). Their parts keep their names:
// `float_*` levitate, `fx_*` glow (render/models.ts, render/life.ts). Then: bash tools/meshy/compress.sh (SIZE=1024).
// Usage: node tools/meshy/fable.mjs <blender-fable dir> <out dir>
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

// footprint: the widest side, in tiles; yaw: degrees about +Y to bring the façade to +Z.
const MODELS = {
  portail: { footprint: 2.76 }, // as the Meshy one it replaces (size 3)
  trone: { footprint: 3.9, yaw: -45 }, // modelled turned 45° for its board's three-quarter view; size 4
  obelisque: { footprint: 4.7 }, // its own terrace now, as wide as the plaza it stood on (size 4)
};
const TEAM = new Set(['bleu', 'obelisque_bleu']);

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [type, { footprint, yaw = 0 }] of Object.entries(MODELS)) {
  const doc = await io.read(`${src}/${type}.glb`);
  const scene = doc.getRoot().listScenes()[0];
  for (const m of doc.getRoot().listMaterials()) if (TEAM.has(m.getName())) m.setName('team');
  const root = doc.createNode(type);
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    root.addChild(n);
  }
  scene.addChild(root);
  const a = (yaw * Math.PI) / 360;
  root.setRotation([0, Math.sin(a), 0, Math.cos(a)]);
  let b = getBounds(scene);
  const s = footprint / Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  root.setScale([s, s, s]);
  b = getBounds(scene);
  root.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
  b = getBounds(scene);
  console.log(type, 'scale', s.toFixed(3), 'size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '));
  await io.write(`${out}/${type}-meshy.glb`, doc);
}
