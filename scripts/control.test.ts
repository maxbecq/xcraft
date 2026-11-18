import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { AI } from '../src/ai/ai';
import type { Faction } from '../src/data';
import { ticks } from '../src/sim/fixed';
import { createMatch } from '../src/sim/setup';
// A light check that a faction's AI really plays, after a new mechanic: not balance. A score of games against each
// other faction (7 start delays each), and for each game: who won and when, what the faction made, the god levels it
// bought, the abilities it cast, and the enemy buildings it brought down (it attacks).
// Run: CONTROL=dieux npx vitest run scripts/control.test.ts   (CONTROL_MAP=le-col; CONTROL_OUT=file for the report)
it.skipIf(!process.env.CONTROL)('control', () => {
  const me = process.env.CONTROL as Faction;
  const foes = (['humains', 'isdaris', 'z', 'dieux'] as Faction[]).filter((f) => f !== me);
  const lines: string[] = [];
  for (const foe of foes) {
    let won = 0;
    let lost = 0;
    let draws = 0;
    let minutes = 0;
    const made: Record<string, Set<number>> = {};
    const levels: Record<string, number> = {};
    const casts: Record<string, number> = {};
    let razed = 0;
    let attacked = 0;
    let levelled = 0;
    for (let i = 0; i < 7; i++) {
      const w = createMatch([me, foe], undefined, process.env.CONTROL_MAP);
      const ais = [new AI(w, 0), new AI(w, 1)];
      const delay = [i * 10, (6 - i) * 10];
      const theirs = new Set<number>();
      const top: Record<string, number> = {};
      let lostHere = 0;
      while (w.winner === null && w.tick < ticks(35 * 60)) {
        w.step(ais.flatMap((ai, p) => (w.tick >= delay[p] ? ai.think() : [])));
        for (const c of w.casts) casts[c.kind] = (casts[c.kind] ?? 0) + 1; // both sides: the world does not say who cast
        if (w.tick % 50 === 0) {
          const now = new Set<number>();
          for (const e of w.entities.values()) {
            if (e.owner === 0 && e.def.kind === 'unit') (made[e.type] ??= new Set()).add(e.id);
            if (e.owner === 0 && e.def.kind === 'unit' && e.lvl > (top[e.type] ?? 1)) top[e.type] = e.lvl;
            if (e.owner === 1 && e.def.kind === 'building') now.add(e.id);
          }
          for (const id of theirs) if (!now.has(id) && !w.entities.has(id)) lostHere++;
          theirs.clear();
          for (const id of now) theirs.add(id);
        }
      }
      if (w.winner === 0) won++;
      else if (w.winner === 1) lost++;
      else draws++;
      minutes += w.tick / ticks(60);
      razed += lostHere;
      for (const [t, l] of Object.entries(top)) levels[t] = Math.max(levels[t] ?? 1, l);
      if (lostHere) attacked++;
      if (Object.values(top).some((l) => l > 1)) levelled++;
    }
    const units = Object.entries(made).map(([t, s]) => `${t} ${s.size}`).join(', ');
    lines.push(
      `${me} contre ${foe} : ${won} victoires, ${lost} défaites, ${draws} nuls, ${Math.round(minutes / 7)} min en moyenne`,
      `  unités : ${units}`,
      `  niveaux : un dieu monté dans ${levelled} parties sur 7 ; niveau maximal par dieu ${JSON.stringify(levels)}`,
      `  sorts (des deux camps) : ${JSON.stringify(casts)}`,
      `  bâtiments adverses détruits : ${razed}, dans ${attacked} parties sur 7`,
    );
  }
  const report = lines.join('\n');
  console.log(report);
  if (process.env.CONTROL_OUT) writeFileSync(process.env.CONTROL_OUT, report);
}, 3_600_000);
