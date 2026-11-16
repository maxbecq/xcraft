// Text-to-3D through the Meshy API: preview mesh, then textured refine, then download.
// Usage: MESHY_API_KEY=... node tools/meshy/gen.mjs <name> "<prompt>" ["<texture prompt>"] [polycount]
import { mkdir, writeFile } from 'node:fs/promises';

const [name, prompt, texturePrompt, poly = '8000'] = process.argv.slice(2);
const key = process.env.MESHY_API_KEY;
if (!name || !prompt || !key) throw new Error('usage: gen.mjs <name> "<prompt>" ["<texture prompt>"] [polycount], with MESHY_API_KEY set');
const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const out = 'tools/meshy/out';

async function create(body) {
  const r = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()).result;
}
async function wait(id) {
  for (;;) {
    const t = await (await fetch(`${API}/${id}`, { headers })).json();
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${id}: ${t.status} ${JSON.stringify(t.task_error)}`);
    console.log(`${name} ${t.status} ${t.progress}%`);
    await new Promise((s) => setTimeout(s, 10_000));
  }
}
async function save(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${file}: ${r.status}`);
  await writeFile(`${out}/${file}`, Buffer.from(await r.arrayBuffer()));
}

await mkdir(out, { recursive: true });
const preview = await wait(await create({
  mode: 'preview', prompt, ai_model: 'meshy-6', should_remesh: true, topology: 'triangle',
  target_polycount: Number(poly), ...(process.env.PROP ? {} : { pose_mode: 'a-pose' }), origin_at: 'bottom', target_formats: ['glb'],
}));
console.log(`${name} preview done (${preview.consumed_credits} credits)`);
const refine = await wait(await create({
  mode: 'refine', preview_task_id: preview.id, texture_prompt: texturePrompt || prompt,
  texture_resolution: '2k', remove_lighting: true, target_formats: ['glb'],
}));
console.log(`${name} refine done (${refine.consumed_credits} credits)`);
await save(refine.model_urls.glb, `${name}.glb`);
await save(refine.thumbnail_url, `${name}.png`);
await writeFile(`${out}/${name}.json`, JSON.stringify({ preview: preview.id, refine: refine.id, prompt, texturePrompt }, null, 2));
console.log(`${name} saved to ${out}/${name}.glb`);
