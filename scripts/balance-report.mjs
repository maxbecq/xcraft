// Markdown comparison of two big.test.ts results (BIG_OUT files): node scripts/balance-report.mjs before.json after.json
import { readFileSync } from 'node:fs';

const [before, after] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const diff = (a, b) => (b === a ? '' : ` (${b > a ? '+' : ''}${b - a})`);
const rows = (key) => [...new Set([...Object.keys(before[key]), ...Object.keys(after[key])])].map((k) => `| ${k} | ${before[key][k] ?? 0} | ${after[key][k] ?? 0}${diff(before[key][k] ?? 0, after[key][k] ?? 0)} |`);
console.log(`### Équilibrage : ${after.games ?? 98} parties IA contre IA (98 par paire de camps)

| Victoires | Avant | Après |
|---|---|---|
${rows('wins').join('\n')}
| durée moyenne (min) | ${before.minutes} | ${after.minutes}${diff(before.minutes, after.minutes)} |

<details><summary>Unités produites</summary>

| Unité | Avant | Après |
|---|---|---|
${rows('units').join('\n')}

</details>

« Avant » : le \`balance.json\` de \`main\` ; « Après » : celui de cette PR, avec le même code. Équilibre visé : 49 victoires chacun dans chaque paire ; un écart de moins de 10 victoires est dans le bruit.`);
