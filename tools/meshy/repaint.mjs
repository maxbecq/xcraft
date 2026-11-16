// Repaints a render of a simple model as hand-painted concept art that keeps its shapes, ready for
// image-to-3D (gpt-image-2 image edit); PROMPT in the environment replaces the whole prompt. Usage: OPENAI_API_KEY=... node tools/meshy/repaint.mjs <name> <render.png> "<notes>"
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const [name, image, notes = ''] = process.argv.slice(2);
const key = process.env.OPENAI_API_KEY;
if (!name || !image || !key) throw new Error('usage: repaint.mjs <name> <render.png> "<notes>", with OPENAI_API_KEY set');
const prompt = process.env.PROMPT || `Repaint this 3D render as a single concept art for a real-time strategy game, in the hand-painted style of StarCraft II and Warcraft III. Keep exactly the same shapes, layout, proportions, camera angle and big simple readable forms: do not add clutter, small details or extra buildings. Large clean surfaces with painted texture: corrugated sheet metal, rust, rivets, worn edges, bold highlights. Every blue part stays a strong saturated royal blue (the team colour). ${notes} Plain flat light grey background, no ground plane, no text, no frame, no shadow on the ground.`;
const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', prompt);
form.append('size', '1024x1024');
form.append('quality', 'high');
form.append('image[]', new Blob([await readFile(image)], { type: 'image/png' }), 'render.png');
const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
const { data } = await r.json();
await mkdir('tools/meshy/out', { recursive: true });
await writeFile(`tools/meshy/out/${name}-sketch.png`, Buffer.from(data[0].b64_json, 'base64'));
console.log(`saved tools/meshy/out/${name}-sketch.png`);
