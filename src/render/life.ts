import { Group, type Object3D } from 'three';

/**
 * Human buildings coming alive: their brass armillary spheres turn slowly, the meridians one way and the
 * tilted ecliptic ring the other, at a pace of their own. Null when the model has no sphere.
 */
export function armillaries(body: Object3D, seed: number): { group: Group; update(dt: number, t: number): void } | null {
  const rings: [Object3D, number][] = [];
  body.traverse((o) => {
    const m = /^armillary(b?)_\d+$/.exec(o.name);
    if (m) rings.push([o, (m[1] ? -0.55 : 0.3) * (0.8 + 0.4 * ((seed * 0.618) % 1))]);
  });
  if (!rings.length) return null;
  return {
    group: new Group(),
    update(dt) {
      for (const [o, speed] of rings) o.rotation.y += speed * dt;
    },
  };
}

/**
 * GLSL for the Human Meshy skins, after the team paint: needs `paint` (the texture colour), `vLife` (offset
 * from the building's origin, world units), `vSeed` and `veinTime`. Lit windows (warm orange in the texture)
 * switch on and off one by one, each on its own slow cycle; green vats breathe and send up bubbles.
 * Returns the light to add (rgb) and how much of the paint stays (a: dark windows are dimmed).
 */
export const LIFE_GLSL = `
  float lifeHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  vec4 lifeGlow(vec3 paint, vec3 local, float seed, float t) {
    vec3 glow = vec3(0.0);
    float dim = 1.0;
    // Windows: one cell per half tile, on for most of a 9-25 s cycle.
    float warm = smoothstep(0.12, 0.25, paint.r - paint.b) * smoothstep(0.45, 0.6, paint.r) * step(paint.g, paint.r * 0.85);
    if (warm > 0.0) {
      vec3 cell = floor(local * 2.0);
      float h = lifeHash(cell + seed);
      float cycle = fract(t / (9.0 + 16.0 * h) + lifeHash(cell + seed + 7.0));
      float on = smoothstep(0.0, 0.03, cycle) * (1.0 - smoothstep(0.66 + 0.2 * h, 0.69 + 0.2 * h, cycle));
      glow += vec3(1.0, 0.55, 0.18) * warm * on * 0.9;
      dim = 1.0 - warm * (1.0 - on) * 0.6;
    }
    // Green vats: a slow breath, and bubbles rising in columns.
    float green = smoothstep(0.08, 0.2, paint.g - max(paint.r, paint.b)) * smoothstep(0.3, 0.45, paint.g);
    if (green > 0.0) {
      // Round bubbles on a grid scrolling up, a third of the cells holding one.
      vec2 q = vec2((local.x + local.z) * 6.0, local.y * 6.0 - t * 1.6);
      float h = lifeHash(vec3(floor(q), seed));
      float bubble = (1.0 - smoothstep(0.18, 0.3, length(fract(q) - 0.5))) * step(0.66, h);
      float breath = 0.55 + 0.45 * sin(t * 1.3 + seed * 6.28);
      glow += green * (vec3(0.35, 1.0, 0.4) * 0.35 * breath + vec3(0.7, 1.0, 0.7) * 1.3 * bubble);
    }
    return vec4(glow, dim);
  }`;
