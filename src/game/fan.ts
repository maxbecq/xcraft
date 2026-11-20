/** The marking menu's layout (game/radial.ts), apart from the page so it can be tested. */

/** Distance from the finger to the first arc of buttons, between arcs, between buttons along an arc (px). */
const RING_MIN = 78;
const RING_STEP = 62;
const SPACING = 58;

/** Where `n` buttons go round (0, 0): on arcs one inside the other, the inner ones filled first, each arc spanning
 * `span` radians centred on the direction `dir` (-π/2: up). Gives the offsets and the outer arc's radius. */
export function fan(n: number, dir: number, span: number): { at: [number, number][]; r: number } {
  const at: [number, number][] = [];
  let r = RING_MIN;
  for (;;) {
    const fit = Math.min(n - at.length, Math.floor((span * r) / SPACING) + 1);
    for (let i = 0; i < fit; i++) {
      const a = dir + (fit === 1 ? 0 : (i / (fit - 1) - 0.5) * span);
      at.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    if (at.length >= n) return { at, r };
    r += RING_STEP;
  }
}
