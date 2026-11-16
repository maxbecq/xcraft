import type { Grid } from './grid';

export const UNSEEN = 0;
export const EXPLORED = 1;
export const VISIBLE = 2;

/** Per-player fog of war. Units on low ground cannot see onto higher cliffs. */
export class Vision {
  readonly tiles: Uint8Array;

  constructor(private readonly grid: Grid) {
    this.tiles = new Uint8Array(grid.width * grid.height);
  }

  /** Clears current visibility, keeping what was explored. */
  begin(): void {
    const t = this.tiles;
    for (let i = 0; i < t.length; i++) if (t[i] === VISIBLE) t[i] = EXPLORED;
  }

  /** Reveals a disc of `radius` tiles around tile (cx, cy), seen from that tile's level. */
  /** `high`: seen from the air, over every cliff. */
  reveal(cx: number, cy: number, radius: number, high = false): void {
    const g = this.grid;
    const eye = high ? Infinity : g.inside(cx, cy) ? g.level(cx, cy) : 0;
    const r2 = radius * radius;
    for (let y = Math.max(0, cy - radius); y <= Math.min(g.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(g.width - 1, cx + radius); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        if (g.level(x, y) > eye) continue;
        this.tiles[y * g.width + x] = VISIBLE;
      }
    }
  }

  visible(x: number, y: number): boolean {
    return this.grid.inside(x, y) && this.tiles[y * this.grid.width + x] === VISIBLE;
  }
}
