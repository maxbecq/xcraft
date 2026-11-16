// Concept art for one model through the OpenAI Images API, framed for image-to-3D:
// one subject, full body, front three-quarter view, plain light background.
// Usage: OPENAI_API_KEY=... node tools/meshy/sketch.mjs <name> "<description>"
import { mkdir, writeFile } from 'node:fs/promises';

const [name, description] = process.argv.slice(2);
const key = process.env.OPENAI_API_KEY;
if (!name || !description || !key) throw new Error('usage: sketch.mjs <name> "<description>", with OPENAI_API_KEY set');
const prompt = `${description}. Single concept art for a real-time strategy game, in the hand-painted style of StarCraft II and Warcraft III: chunky readable silhouette, slightly exaggerated proportions, bold painted highlights and worn edges. ${process.env.FRAMING || "Full body, entire figure visible head to feet, standing, front three-quarter view"}, centered, plain flat light grey background, no text, no frame, no shadow on the ground, no other objects.`;
const r = await fetch('https://api.openai.com/v1/images/generations', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-image-2', prompt, size: '1024x1024', quality: 'high', n: 1 }),
});
if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
const { data } = await r.json();
await mkdir('tools/meshy/out', { recursive: true });
await writeFile(`tools/meshy/out/${name}-sketch.png`, Buffer.from(data[0].b64_json, 'base64'));
console.log(`saved tools/meshy/out/${name}-sketch.png`);
