import { describe, expect, it } from 'vitest';
import { FP, dist, ticks } from './fixed';
import { createMatch } from './setup';

/**
 * Point 115 (b), seen by the editor's session: with no AI, Légionnaires given an attack-move at the enemy's
 * headquarters often stopped short without all attacking. Three of twelve sent across ville-nuit stood for good at
 * one waypoint, pushing each other off it: only a plain move replanned when it got no nearer (follow).
 */
describe('a group attack-moving at a headquarters', () => {
  it('gets there whole and every one strikes it, on ville-nuit and l-anneau', () => {
    for (const id of ['ville-nuit', 'l-anneau']) {
      const w = createMatch(['humains', 'humains'], undefined, id);
      const hq = [...w.entities.values()].filter((e) => e.type === 'conseil');
      const [mine, theirs] = [hq.find((e) => e.owner === 0)!, hq.find((e) => e.owner === 1)!];
      const ids: number[] = [];
      for (let k = 0; k < 12; k++) ids.push(w.spawn('legionnaire', 0, mine.x + (6 + (k % 4)) * FP, mine.y + (6 + Math.floor(k / 4)) * FP).id);
      w.step([{ player: 0, kind: 'attack', ids, x: theirs.x, y: theirs.y }]);
      const struck = new Set<number>();
      while (w.tick < ticks(150)) {
        w.step([]);
        for (const s of w.shots) if (s.id && ids.includes(s.id)) struck.add(s.id);
      }
      const far = ids.filter((i) => dist(w.entities.get(i)!.x, w.entities.get(i)!.y, theirs.x, theirs.y) > 6 * FP);
      expect(far, id).toEqual([]);
      expect(struck.size, id).toBe(ids.length);
    }
  });
});
