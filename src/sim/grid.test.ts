import { expect, it } from 'vitest';
import { MAPS, buildMap } from '../maps';
import { Grid } from './grid';

it('canStep from its per-tile sides answers as the tiles themselves do, buildings and all', () => {
  for (const def of Object.values(MAPS)) {
    const g = new Grid(buildMap(def));
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < g.blocked.length; i++) if (rand() < 0.15) g.blocked[i] = 1;
    const slow = (g as unknown as { terrainStep: (...a: (number | boolean)[]) => boolean }).terrainStep.bind(g);
    for (let y = -1; y <= g.height; y++)
      for (let x = -1; x <= g.width; x++)
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++)
            for (const t of [false, true]) if (g.canStep(x, y, x + dx, y + dy, t) !== slow(x, y, x + dx, y + dy, t)) expect([def.id, x, y, dx, dy, t]).toBe('the same');
  }
});

it('findPath gives the very paths of the plain A* it replaces (canStep per neighbour, a heap of arrays)', () => {
  const DX = [0, 1, 0, -1, 1, 1, -1, -1];
  const DY = [-1, 0, 1, 0, -1, 1, 1, -1];
  const reference = (g: Grid, sx: number, sy: number, gx: number, gy: number): number[] => {
    const w = g.width;
    const [start, goal] = [sy * w + sx, gy * w + gx];
    if (start === goal) return [];
    const cost = new Map<number, number>();
    const from = new Map<number, number>();
    const done = new Set<number>();
    const heap: [number, number, number][] = [];
    let seq = 0;
    const less = (a: [number, number, number], b: [number, number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const push = (p: number, v: number) => {
      heap.push([p, seq++, v]);
      for (let i = heap.length - 1; i > 0; ) {
        const q = (i - 1) >> 1;
        if (!less(heap[i], heap[q])) break;
        [heap[i], heap[q]] = [heap[q], heap[i]];
        i = q;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const [l, r] = [2 * i + 1, 2 * i + 2];
          let m = i;
          if (l < heap.length && less(heap[l], heap[m])) m = l;
          if (r < heap.length && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]];
          i = m;
        }
      }
      return top[2];
    };
    const h = (i: number) => {
      const dx = Math.abs((i % w) - gx);
      const dy = Math.abs(Math.floor(i / w) - gy);
      return 10 * (dx + dy) - 6 * Math.min(dx, dy);
    };
    cost.set(start, 0);
    push(h(start), start);
    let [best, bestH] = [start, h(start)];
    while (heap.length) {
      const cur = pop();
      if (done.has(cur)) continue;
      done.add(cur);
      if (h(cur) < bestH) [best, bestH] = [cur, h(cur)];
      if (cur === goal) break;
      const [cx, cy] = [cur % w, Math.floor(cur / w)];
      for (let d = 0; d < 8; d++) {
        const [nx, ny] = [cx + DX[d], cy + DY[d]];
        if (!g.canStep(cx, cy, nx, ny)) continue;
        const ni = ny * w + nx;
        const ng = cost.get(cur)! + (d < 4 ? 10 : 14);
        if (cost.has(ni) && ng >= cost.get(ni)!) continue;
        cost.set(ni, ng);
        from.set(ni, cur);
        push(ng + h(ni), ni);
      }
    }
    const path: number[] = [];
    for (let i = best; i !== start; i = from.get(i)!) path.push(i);
    return path.reverse();
  };
  for (const def of Object.values(MAPS)) {
    const g = new Grid(buildMap(def));
    let seed = 3;
    const rand = (n: number) => Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * n);
    for (let i = 0; i < g.blocked.length; i++) if (rand(100) < 8) g.blocked[i] = 1;
    for (let k = 0; k < 60; k++) {
      const [sx, sy, gx, gy] = [rand(g.width), rand(g.height), rand(g.width), rand(g.height)];
      expect(g.findPath(sx, sy, gx, gy)).toEqual(reference(g, sx, sy, gx, gy));
    }
  }
});

it('lineWalkable answers as when it asked canStep at each step', () => {
  for (const def of Object.values(MAPS)) {
    const g = new Grid(buildMap(def));
    let seed = 9;
    const rand = (n: number) => Math.floor(((seed = (seed * 16807) % 2147483647) / 2147483647) * n);
    for (let i = 0; i < g.blocked.length; i++) if (rand(100) < 10) g.blocked[i] = 1;
    const reference = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.floor(Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2));
      const n = Math.max(1, Math.ceil(len / 256));
      let [tx, ty] = [Math.floor(ax / 1024), Math.floor(ay / 1024)];
      for (let i = 1; i <= n; i++) {
        const nx = Math.floor((ax + Math.trunc(((bx - ax) * i) / n)) / 1024);
        const ny = Math.floor((ay + Math.trunc(((by - ay) * i) / n)) / 1024);
        if (nx === tx && ny === ty) continue;
        if (Math.abs(nx - tx) > 1 || Math.abs(ny - ty) > 1 || !g.canStep(tx, ty, nx, ny)) return false;
        [tx, ty] = [nx, ny];
      }
      return true;
    };
    for (let k = 0; k < 3000; k++) {
      const ax = rand((g.width + 4) * 1024) - 2048;
      const ay = rand((g.height + 4) * 1024) - 2048;
      const [bx, by] = [ax + rand(24 * 1024) - 12 * 1024, ay + rand(24 * 1024) - 12 * 1024];
      expect(g.lineWalkable(ax, ay, bx, by)).toBe(reference(ax, ay, bx, by));
    }
  }
});
