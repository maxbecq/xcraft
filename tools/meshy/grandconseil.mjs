// Fable's Grand Conseil (recherches-visuelles/isdaris-batiments/3d/blender-fable/grandconseil.glb, built on the Conseil:
// same footprint and anchoring) slimmed for the game: the flat dark fill under the old dice (663 cells, one quad each) merged
// into one quad per radial run, the window atlas kept once, the dome glass renamed out of the Portail's `verre`.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
// Usage: node tools/meshy/grandconseil.mjs <blender-fable>/grandconseil.glb public/models/grandconseil-meshy.glb
// then SIZE=1024 bash tools/meshy/compress.sh public/models/grandconseil-meshy.glb.
const [src, dst] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const prim = root.listMeshes().find((m) => m.getName() === 'Mesh_0').listPrimitives().find((p) => p.getMaterial().getName() === 'meshy');
const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0'), nor = prim.getAttribute('NORMAL');
const idx = prim.getIndices();
const P = (i) => pos.getElement(i, []);
const ids = Array.from(idx.getArray());
// A fill cell: a triangle flat at y 2.40 facing up, its three corners on one texel.
const keep = [], cells = new Map();
for (let t = 0; t < ids.length; t += 3) {
  const v = ids.slice(t, t + 3);
  const u = v.map((i) => uv.getElement(i, []));
  const fill = v.every((i) => Math.abs(P(i)[1] - 2.4) < 0.002 && nor.getElement(i, [])[1] > 0.99) && u.every((q) => Math.abs(q[0] - u[0][0]) < 1e-5 && Math.abs(q[1] - u[0][1]) < 1e-5);
  if (!fill) { keep.push(...v); continue; }
  cells.set(t, v);
}
// Triangles to quads: pair by shared corner positions.
const key = (i) => P(i).map((x) => x.toFixed(4)).join();
const quads = [], used = new Set();
const tris = [...cells.entries()];
for (const [t, v] of tris) {
  if (used.has(t)) continue;
  const ks = new Set(v.map(key));
  const mate = tris.find(([t2, w]) => t2 !== t && !used.has(t2) && w.filter((i) => ks.has(key(i))).length === 2);
  if (!mate) throw new Error('unpaired fill triangle');
  used.add(t); used.add(mate[0]);
  const corners = new Map();
  for (const i of [...v, ...mate[1]]) corners.set(key(i), i);
  quads.push([...corners.values()]);
}
// Runs along a radius: same angle (centre), radii 0.04 apart.
const rad = (i) => Math.hypot(P(i)[0], P(i)[2]);
const ang = (q) => { const c = q.reduce((s, i) => [s[0] + P(i)[0], s[1] + P(i)[2]], [0, 0]); return Math.round(Math.atan2(c[1], c[0]) * 1800 / Math.PI); };
const byAng = new Map();
for (const q of quads) (byAng.get(ang(q)) ?? byAng.set(ang(q), []).get(ang(q))).push(q);
const add = []; // [inner a, inner b, outer a, outer b] vertex ids, by position
let runs = 0;
for (const list of byAng.values()) {
  list.sort((a, b) => Math.min(...a.map(rad)) - Math.min(...b.map(rad)));
  let run = [list[0]];
  const flush = () => {
    const inner = [...run[0]].sort((a, b) => rad(a) - rad(b)).slice(0, 2);
    const outer = [...run.at(-1)].sort((a, b) => rad(b) - rad(a)).slice(0, 2);
    add.push([inner, outer]); runs++;
  };
  for (let k = 1; k < list.length; k++) {
    if (Math.abs(Math.min(...list[k].map(rad)) - Math.min(...list[k - 1].map(rad)) - 0.04) < 0.005) run.push(list[k]);
    else { flush(); run = [list[k]]; }
  }
  flush();
}
// New corners appended (copies of the cells' own corners, so every attribute carries over), two triangles facing up.
const names = prim.listSemantics();
const count = pos.getCount();
const extra = [];
for (const [inner, outer] of add) {
  // Pair each inner corner with the outer one on its side (the nearer).
  const d = (a, b) => Math.hypot(P(a)[0] - P(b)[0], P(a)[2] - P(b)[2]);
  const [i0, i1] = inner, [o0, o1] = d(i0, outer[0]) < d(i0, outer[1]) ? outer : [outer[1], outer[0]];
  const base = count + extra.length;
  extra.push(i0, i1, o1, o0);
  let tri = [base, base + 1, base + 2, base, base + 2, base + 3];
  const a = P(i0), b = P(i1), c = P(o1);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); // y of (b-a) x (c-a)
  if (ny < 0) tri = [base, base + 2, base + 1, base, base + 3, base + 2];
  keep.push(...tri);
}
for (const s of names) {
  const acc = prim.getAttribute(s);
  const n = acc.getElementSize();
  const arr = new (acc.getArray().constructor)((count + extra.length) * n);
  arr.set(acc.getArray());
  extra.forEach((i, k) => arr.set(acc.getElement(i, []), (count + k) * n));
  acc.setArray(arr);
}
// Only the corners still used, renumbered.
const map = new Map();
for (const i of keep) if (!map.has(i)) map.set(i, map.size);
for (const s of names) {
  const acc = prim.getAttribute(s);
  const n = acc.getElementSize();
  const arr = new (acc.getArray().constructor)(map.size * n);
  for (const [i, j] of map) arr.set(acc.getElement(i, []), j * n);
  acc.setArray(arr);
}
idx.setArray(new Uint32Array(keep.map((i) => map.get(i))));
console.log(`fill: ${tris.length} triangles in ${quads.length} cells -> ${runs} quads`);
// The window atlas once: the cut-out stone's PNG (its alpha) serves the opaque windows too.
const fen = root.listMaterials().find((m) => m.getName() === 'fenetrage');
const fenp = root.listMaterials().find((m) => m.getName() === 'fenetrage_pierre');
const twice = fen.getBaseColorTexture();
fen.setBaseColorTexture(fenp.getBaseColorTexture());
twice.dispose();
root.listMaterials().find((m) => m.getName() === 'verre').setName('dome_verre');
await io.write(dst, doc);
