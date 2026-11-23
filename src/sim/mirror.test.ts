import { describe, expect, it } from 'vitest';
import { FP } from './fixed';
import { createMatch } from './setup';

/**
 * The same scene from each corner of a map built for four (each corner the last turned a quarter round): a mixed
 * group, big units and small, walks to the far corner. Moves are the same up to the turn, tick by tick: positions,
 * arrivals, nobody left behind. Before, floor on tile edges, a fixed scan order, pushes taken bucket by bucket and
 * path ties in the order of the eight directions made one corner slower than another, and could leave big units
 * standing at a ramp's edge for good.
 */
describe('moves turned with the map', () => {
  for (const id of ['origine', 'carrefour']) {
    it(`are the same from the four corners of ${id}`, () => {
      const turn = (W: number, x: number, y: number, q: number): [number, number] => {
        for (let k = 0; k < q; k++) [x, y] = [W - y, x];
        return [x, y];
      };
      const runs = [0, 1, 2, 3].map((q) => {
        const w = createMatch(['humains', 'humains', 'humains', 'humains'], undefined, id);
        const S = w.map.width * FP;
        const g = w.grid;
        // The map itself must turn into itself.
        for (let y = 0; y < g.height; y++) for (let x = 0; x < g.width; x++) expect(g.open(x, y)).toBe(g.open(g.width - 1 - y, x));
        const hq = [...w.entities.values()].find((e) => e.type === 'conseil' && e.owner === 0)!;
        const far = [...w.entities.values()].find((e) => e.type === 'conseil' && turn(S, hq.x, hq.y, 2)[0] === e.x && turn(S, hq.x, hq.y, 2)[1] === e.y)!;
        // The group belongs to the player whose base is at the corner it starts from.
    const [hx, hy] = turn(S, hq.x, hq.y, q);
    const owner = [...w.entities.values()].find((e) => e.type === 'conseil' && e.x === hx && e.y === hy)!.owner;
    for (const e of [...w.entities.values()]) if (e.def.kind === 'unit') w.entities.delete(e.id);
        const ids: number[] = [];
        for (let k = 0; k < 8; k++) {
          // Half a tile off the 4x4 Conseil's middle (on a tile's edge), as they were off the 5x5 one's: not spawned on edges.
          const [x, y] = turn(S, hq.x + 4 * FP + FP / 2 + (k % 4) * 700, hq.y + 4 * FP + FP / 2 + Math.floor(k / 4) * 700, q);
          ids.push(w.spawn(k % 2 ? 'minotaure' : 'auxiliaire', owner, x, y).id);
        }
        const [tx, ty] = turn(S, far.x, far.y, q);
        w.step([{ player: owner, kind: 'move', ids, x: tx, y: ty }]);
        const track: string[] = [];
        for (let t = 0; t < 2400; t++) {
          w.step([]);
          if (t % 50 === 0)
            track.push(ids.map((i) => {
              const e = w.entities.get(i)!;
              const [x, y] = turn(S, e.x, e.y, (4 - q) % 4); // back to the first corner's frame
              return `${x},${y}`;
            }).join(' '));
        }
        const left = ids.filter((i) => w.entities.get(i)!.order).length;
        return { track, left };
      });
      expect(runs[0].left).toBe(0);
      for (const r of runs.slice(1)) {
        expect(r.left).toBe(0);
        expect(r.track).toEqual(runs[0].track);
      }
    });
  }
});
