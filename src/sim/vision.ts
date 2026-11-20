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

  /**
   * Reveals a disc of `radius` tiles around tile (cx, cy), seen from that tile's level; `high`: seen from the air,
   * over every cliff. A whole radius from a whole tile (nearly always) walks each row of the disc only, from a table
   * of its half-widths, reading the tiles' levels worked out once (Grid.lowest); the same tiles as revealAny.
   */
  reveal(cx: number, cy: number, radius: number, high = false): void {
    if (!Number.isInteger(radius) || radius < 0 || radius > 255 || !Number.isInteger(cx) || !Number.isInteger(cy)) return this.revealAny(cx, cy, radius, high);
    const g = this.grid;
    const w = g.width;
    const low = g.lowest;
    const t = this.tiles;
    const eye = high ? Infinity : g.inside(cx, cy) ? g.level(cx, cy) : 0;
    const half = rows(radius);
    const y1 = Math.min(g.height - 1, cy + radius);
    for (let y = Math.max(0, cy - radius); y <= y1; y++) {
      const h = half[y - cy + radius];
      const x1 = Math.min(w - 1, cx + h);
      for (let x = Math.max(0, cx - h), i = y * w + x; x <= x1; x++, i++) if (low[i] <= eye) t[i] = VISIBLE;
    }
  }

  /** reveal() tile by tile, for any radius and centre. */
  private revealAny(cx: number, cy: number, radius: number, high: boolean): void {
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

/** For a whole radius, each row's half-width: the largest dx with dx² + dy² <= radius², dy from -radius to radius. */
const DISCS = new Map<number, Int32Array>();
function rows(radius: number): Int32Array {
  let half = DISCS.get(radius);
  if (!half) {
    half = new Int32Array(2 * radius + 1);
    for (let dy = -radius; dy <= radius; dy++) {
      let dx = 0;
      while ((dx + 1) ** 2 + dy ** 2 <= radius * radius) dx++;
      half[dy + radius] = dx;
    }
    DISCS.set(radius, half);
  }
  return half;
}
