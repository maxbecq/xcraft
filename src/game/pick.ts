import type { Entity } from '../sim/world';

/** A thing that can be clicked: the screen box its model fills, caught `margin` px outside it, `min` px across at least. */
export interface Catch {
  e: Entity;
  r: { x0: number; y0: number; x1: number; y1: number };
  margin: number;
  min: number;
}

/**
 * The thing whose catch zone holds (x, y): the one whose outline is nearest the cursor (0 inside it), so a click on a
 * field's own box beats a unit that only reaches it by its margin; inside several outlines, the nearest middle.
 */
export function nearestCatch(x: number, y: number, catches: Catch[]): Entity | undefined {
  let best: Entity | undefined;
  let bestD = Infinity;
  let bestC = Infinity;
  for (const { e, r, margin, min } of catches) {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const hx = Math.max((r.x1 - r.x0) / 2 + margin, min / 2);
    const hy = Math.max((r.y1 - r.y0) / 2 + margin, min / 2);
    if (Math.abs(x - cx) > hx || Math.abs(y - cy) > hy) continue;
    const d = Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));
    const c = Math.hypot(x - cx, y - cy);
    if (d < bestD || (d === bestD && c < bestC)) [best, bestD, bestC] = [e, d, c];
  }
  return best;
}

/**
 * What a click picks. `hits`: what the ray under the cursor meets, nearest first (a unit with `seen`: not hidden by the
 * fog; `xray`: the mesh met is drawn as a silhouette where a building hides it). The nearest it meets wins, a building
 * as much as a unit or a resource: a click on the front of a building standing before a well, or on a Plate-forme's
 * deck over a Quadripode, takes the building. One exception: a unit the ray meets further on, through the building,
 * on its very model and shown there as a silhouette, wins (a click through to it). Only when the ray meets nothing do
 * the wider catch zones of units and resources decide (`caught`), then the nearest resource (`near`).
 */
export function pickAt(
  hits: { e: Entity; seen: boolean; xray?: boolean }[],
  caught: () => Entity | undefined,
  near: () => Entity | undefined,
  occupant: (well: Entity) => Entity | undefined = () => undefined,
): Entity | undefined {
  const i = hits.findIndex(({ e, seen }) => e.def.kind !== 'unit' || seen);
  if (i < 0) return caught() ?? near();
  // A well an extractor stands on is that extractor (its rocks and glow reach past the building's model).
  const first = occupant(hits[i].e) ?? hits[i].e;
  if (first.def.kind !== 'building') return first;
  return hits.slice(i + 1).find(({ e, seen, xray }) => e.def.kind === 'unit' && seen && xray)?.e ?? first;
}
