// HUD icons for the Forge upgrades: one painted emblem per line (gpt-image-2, on black), then
// tools/meshy/upgrade-icons.py keys the black out and stamps the level on each.
// Usage: OPENAI_API_KEY=... node tools/meshy/upgrade-icons.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY is not set');
const STYLE = 'Single game UI icon emblem, stylised hand-painted like Warcraft III and World of Warcraft icons, scrap-metal wasteland style, bold readable silhouette centred, worn steel with a royal blue accent, no text, no frame, on a plain flat pure black background';
const LINES = {
  melee: 'a crossed circular saw blade and a heavy cleaver',
  ranged: 'a scrap rifle with a single glowing bullet in front of it',
  armor: 'a riveted scrap-metal chest plate with a blue painted stripe',
};
await mkdir('tools/meshy/out', { recursive: true });
await Promise.all(Object.entries(LINES).map(async ([line, what]) => {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-image-2', prompt: `${STYLE}: ${what}.`, size: '1024x1024', quality: 'high', n: 1 }),
  });
  if (!r.ok) throw new Error(`${line}: ${r.status} ${await r.text()}`);
  const { data } = await r.json();
  await writeFile(`tools/meshy/out/${line}-icon.png`, Buffer.from(data[0].b64_json, 'base64'));
  console.log(`saved ${line}`);
}));
