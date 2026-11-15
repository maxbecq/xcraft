// Deterministic integer math for the simulation: no floats may influence game state.

/** Fixed-point units per tile. */
export const FP = 1024;
/** Simulation ticks per second. */
export const TICK_RATE = 20;
/** SC-style "Faster" game speed: data is written in "Normal" seconds. */
export const GAME_SPEED = 1.4;

/** Integer square root (floor), exact for any safe integer. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n)); // float guess, corrected below to be exact
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return isqrt(dx * dx + dy * dy);
}

/** Integer division rounded toward zero. */
export const idiv = (a: number, b: number) => Math.trunc(a / b);

/** Tiles per "Normal" second to fixed-point units per tick. */
export const speedPerTick = (tilesPerSecond: number) => Math.round((tilesPerSecond * GAME_SPEED * FP) / TICK_RATE);

/** "Normal" seconds to ticks. */
export const ticks = (seconds: number) => Math.max(1, Math.round((seconds * TICK_RATE) / GAME_SPEED));

export const toFp = (tiles: number) => Math.round(tiles * FP);
export const tileOf = (v: number) => Math.floor(v / FP);
