import { describe, expect, it, vi } from 'vitest';
import type { Mesh } from 'three';
import { cutCorner, LEVEL_HEIGHT } from './map';
import { buildTerrain } from './terrain';
import './render/biome';

// Codex, 2026-11-26: the limit that eases a cliff's foot under the band also moved the wall's top row, which hangs
// from the plateau's edge: where the edge is pushed well out (an inner corner), the two meshes parted along that line
// (0.075 tile on Origine).
describe('a cliff\'s wall', () => {
  it('hangs from the plateau\'s edge: its top row lies on each side of the edge, corners included', () => {
    // A plateau with bays and spurs, for inner and outer corners.
    const N = 40;
    const level = new Uint8Array(N * N);
    for (let y = 6; y < 34; y++) for (let x = 6; x < 34; x++) if (!(x < 12 && y % 12 < 6) && !(y < 12 && x % 12 < 6) && !(x > 27 && y % 10 < 5) && !(y > 27 && x % 10 < 5)) level[y * N + x] = 1;
    const map = { width: N, height: N, level, ramp: new Array(N * N).fill(null), rampStep: new Uint8Array(N * N) };
    // The ground's textures are painted on canvases: none here, and none looked at.
    const ctx: object = new Proxy({}, { get: (_, k) => (k === 'createImageData' ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) : () => ctx) });
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
    // The terrain's first two meshes: the ground, then the cliffs' walls.
    const [groundMesh, cliffMesh] = buildTerrain(map).children as Mesh[];
    const points = (m: Mesh) => {
      const p = m.geometry.getAttribute('position');
      return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    };
    const ground = points(groundMesh);
    const walls = points(cliffMesh);
    const lv = (x: number, y: number) => level[y * N + x];
    // The sides of the edge: the sides of the plateau's triangles along a tile side with low ground beyond.
    const sides: number[][][] = [];
    for (let i = 0; i < ground.length; i += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const [p, q] = [ground[i + a], ground[i + b]];
        if (p[1] < LEVEL_HEIGHT - 0.4 || q[1] < LEVEL_HEIGHT - 0.4) continue;
        const [px, pz, qx, qz] = [Math.round(p[0]), Math.round(p[2]), Math.round(q[0]), Math.round(q[2])];
        if (Math.abs(qx - px) + Math.abs(qz - pz) !== 1) continue;
        // The two tiles either side of the grid line from (px, pz) to (qx, qz).
        const [t1, t2] = px === qx ? [lv(px - 1, Math.min(pz, qz)), lv(px, Math.min(pz, qz))] : [lv(Math.min(px, qx), pz - 1), lv(Math.min(px, qx), pz)];
        // Not by a diagonal cliff (a cut corner), whose wall runs across its tile.
        const cut = (cx: number, cz: number) => [0, 1].some((i) => [0, 1].some((j) => cutCorner(map, cx - i, cz - j) >= 0));
        if (t1 !== t2 && !cut(px, pz) && !cut(qx, qz)) sides.push([p, q]);
      }
    }
    expect(sides.length).toBeGreaterThan(60);
    let least = 99;
    for (const [p, q] of sides) {
      const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const along = new Set<number>();
      for (const [x, y, z] of walls) {
        const t = ((x - p[0]) * d[0] + (y - p[1]) * d[1] + (z - p[2]) * d[2]) / (d[0] ** 2 + d[1] ** 2 + d[2] ** 2);
        if (t > -1e-3 && t < 1 + 1e-3 && Math.hypot(x - p[0] - d[0] * t, y - p[1] - d[1] * t, z - p[2] - d[2] * t) < 1e-3) along.add(Math.round(t * 1000));
      }
      least = Math.min(least, along.size);
    }
    // WALL_SEGMENTS + 1 points a side.
    expect(least).toBe(8);
  });
});
