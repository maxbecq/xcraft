// Image-to-3D through the Meshy API: textured, remeshed low-poly model from a concept image.
// Usage: MESHY_API_KEY=... node tools/meshy/img3d.mjs <name> <image.png> [polycount]
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [name, image, poly = '8000'] = process.argv.slice(2);
const key = process.env.MESHY_API_KEY;
if (!name || !image || !key) throw new Error('usage: img3d.mjs <name> <image.png> [polycount], with MESHY_API_KEY set');
const API = 'https://api.meshy.ai/openapi/v1/image-to-3d';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const out = 'tools/meshy/out';

const r = await fetch(API, {
  method: 'POST', headers,
  body: JSON.stringify({
    image_url: `data:image/png;base64,${(await readFile(image)).toString('base64')}`,
    ai_model: 'latest', should_texture: true, texture_resolution: '2k',
    should_remesh: true, topology: 'triangle', target_polycount: Number(poly),
    pose_mode: 'a-pose', target_formats: ['glb'], multi_view_thumbnails: true,
  }),
});
if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
const id = (await r.json()).result;
let t;
for (;;) {
  t = await (await fetch(`${API}/${id}`, { headers })).json();
  if (t.status === 'SUCCEEDED') break;
  if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${id}: ${t.status} ${JSON.stringify(t.task_error)}`);
  console.log(`${name} ${t.status} ${t.progress}%`);
  await new Promise((s) => setTimeout(s, 10_000));
}
const save = async (url, file) => writeFile(`${out}/${file}`, Buffer.from(await (await fetch(url)).arrayBuffer()));
await mkdir(out, { recursive: true });
await save(t.model_urls.glb, `${name}-img.glb`);
for (const [view, url] of Object.entries(t.thumbnail_urls ?? { front: t.thumbnail_url })) await save(url, `${name}-img-${view}.png`);
await writeFile(`${out}/${name}-img.json`, JSON.stringify({ task: id, credits: t.consumed_credits }, null, 2));
console.log(`${name} saved (${t.consumed_credits} credits)`);
