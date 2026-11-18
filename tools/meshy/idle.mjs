// Replaces a rigged model's idle clip by a slice of one of its clips, played forth and back so it loops.
// Meshy's idle clips crouch (the Légionnaire kneels down and rises, the Auxiliaire stands in a wide squat):
// a bulky Meshy body hid it, a new mesh bound to the same skeleton reads as crawling. A standing slice fixes it.
// Usage: node tools/meshy/idle.mjs model.glb <source clip> <from s> <to s>   (in place; from = to holds one pose)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const [file, from, t0s, t1s] = process.argv.slice(2);
const [t0, t1] = [Number(t0s), Number(t1s)];
if (!file || !from || !(t1 >= t0)) throw new Error('usage: idle.mjs model.glb <clip> <from s> <to s>');
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(file);
const root = doc.getRoot();
const source = root.listAnimations().find((a) => a.getName() === from);
if (!source) throw new Error(`no clip ${from}`);
const old = root.listAnimations().find((a) => a.getName() === 'idle');
const idle = doc.createAnimation('idle');
const HOLD = 1.5; // a held pose still needs a clip length
for (const channel of source.listChannels()) {
  const sampler = channel.getSampler();
  const times = Array.from(sampler.getInput().getArray());
  const out = sampler.getOutput();
  const size = out.getElementSize();
  const values = Array.from(out.getArray());
  const at = (t) => {
    // Linear sample (rotations are normalised quaternions close together: lerp is fine at clip rates).
    let k = times.findIndex((x) => x >= t);
    if (k <= 0) k = k === 0 ? 0 : times.length - 1;
    const k0 = Math.max(0, k - 1), span = times[k] - times[k0];
    const f = span > 0 ? Math.min(1, Math.max(0, (t - times[k0]) / span)) : 0;
    const v = [];
    for (let i = 0; i < size; i++) v.push(values[k0 * size + i] * (1 - f) + values[k * size + i] * f);
    if (size === 4) { const n = Math.hypot(...v); for (let i = 0; i < 4; i++) v[i] /= n; }
    return v;
  };
  const step = 1 / 30;
  const keys = [];
  for (let t = t0; t < t1; t += step) keys.push(t);
  keys.push(t1);
  const forth = keys.map(at);
  const pose = t1 > t0 ? [...forth, ...forth.slice(0, -1).reverse()] : [forth[0], forth[0]];
  const back = keys.slice(0, -1).reverse().map((t) => 2 * t1 - t - t0);
  const when = t1 > t0 ? [...keys.map((t) => t - t0), ...back] : [0, HOLD];
  const buf = root.listBuffers()[0];
  const input = doc.createAccessor().setBuffer(buf).setType('SCALAR').setArray(new Float32Array(when));
  const output = doc.createAccessor().setBuffer(buf).setType(out.getType()).setArray(new Float32Array(pose.flat()));
  const s = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  idle.addSampler(s).addChannel(doc.createAnimationChannel().setTargetNode(channel.getTargetNode()).setTargetPath(channel.getTargetPath()).setSampler(s));
}
old?.dispose(); // after the slice is read: the source may be the old idle itself
await io.write(file, doc);
console.log(`${file}: idle <- ${from} ${t0}-${t1} s, ${idle.listChannels().length} channels`);
