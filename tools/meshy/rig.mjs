// Rig a Meshy character, then bake preset animations into one .glb.
// Usage: MESHY_API_KEY=... node tools/meshy/rig.mjs <name> <image-to-3d task id> <height m> <action ids, comma separated>
import { writeFile } from 'node:fs/promises';

const [name, task, height, actions] = process.argv.slice(2);
const key = process.env.MESHY_API_KEY;
if (!name || !task || !height || !actions || !key) throw new Error('usage: rig.mjs <name> <task id> <height m> <ids>, with MESHY_API_KEY set');
const API = 'https://api.meshy.ai/openapi/v1';
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const out = 'tools/meshy/out';

async function run(path, body) {
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  const id = (await r.json()).result;
  for (;;) {
    const t = await (await fetch(`${API}/${path}/${id}`, { headers })).json();
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${path} ${id}: ${t.status} ${JSON.stringify(t.task_error)}`);
    console.log(`${name} ${path} ${t.status} ${t.progress}%`);
    await new Promise((s) => setTimeout(s, 8_000));
  }
}
const save = async (url, file) => writeFile(`${out}/${file}`, Buffer.from(await (await fetch(url)).arrayBuffer()));

const rig = await run('rigging', { input_task_id: task, height_meters: Number(height) });
await save(rig.result.rigged_character_glb_url, `${name}-rig.glb`);
await save(rig.result.basic_animations.walking_glb_url, `${name}-walk.glb`);
await save(rig.result.basic_animations.running_glb_url, `${name}-run.glb`);
console.log(`${name} rigged (${rig.consumed_credits} credits)`);
const anim = await run('animations', { rig_task_id: rig.id, action_ids: actions.split(',').map(Number) });
await save(anim.result.animation_glb_url, `${name}-anims.glb`);
console.log(`${name} animated (${anim.consumed_credits} credits)`);
await writeFile(`${out}/${name}-rig.json`, JSON.stringify({ rig: rig.id, animation: anim.id, actions }, null, 2));
