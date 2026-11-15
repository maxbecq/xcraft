import { CanvasTexture, type Material, type MeshStandardMaterial, SRGBColorSpace, type Texture } from 'three';

/**
 * Weathering for models, computed in the shader from world position (no UVs needed):
 * rust blotches, damp streaks running down walls, and grime near the ground.
 * `amount` 0..1 scales it (buildings ~1, units lighter). Glowing materials are left clean.
 */
export function weather(m: Material, amount: number): void {
  const mat = m as MeshStandardMaterial;
  if (mat.userData.weathered || !('emissive' in mat) || mat.emissive.getHex() !== 0) return;
  mat.userData.weathered = true;
  mat.customProgramCacheKey = () => `weather${amount}`;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    shader.uniforms.weatherAmount = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vHeight;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vHeight = wp.y;
        wp = modelMatrix * wp;
        vWPos = wp.xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        varying float vHeight;
        uniform float weatherAmount;
        float wHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float wNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(wHash(i), wHash(i + vec3(1, 0, 0)), f.x), mix(wHash(i + vec3(0, 1, 0)), wHash(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(wHash(i + vec3(0, 0, 1)), wHash(i + vec3(1, 0, 1)), f.x), mix(wHash(i + vec3(0, 1, 1)), wHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float wFbm(vec3 p) { return wNoise(p) * 0.55 + wNoise(p * 2.1) * 0.3 + wNoise(p * 4.3) * 0.15; }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float side = 1.0 - abs(vWNormal.y);
          // Rust: irregular orange-brown blotches with a darker core.
          float rust = smoothstep(0.58, 0.78, wFbm(vWPos * 2.3));
          vec3 rustCol = mix(vec3(0.55, 0.26, 0.1), vec3(0.32, 0.13, 0.05), wNoise(vWPos * 9.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, rustCol, rust * 0.75 * weatherAmount);
          // Damp: dark streaks running down vertical faces.
          float streak = wNoise(vec3(vWPos.x * 7.0 + vWPos.z * 7.0, vWPos.y * 0.7, 0.0));
          float damp = smoothstep(0.62, 0.85, streak) * side * smoothstep(0.35, 0.6, wFbm(vWPos * 0.9 + 3.0));
          diffuseColor.rgb *= 1.0 - damp * 0.45 * weatherAmount;
          // Grime: dirt splashed up from the ground.
          float grime = (1.0 - smoothstep(0.0, 0.55, vHeight)) * (0.6 + 0.4 * wNoise(vWPos * 6.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.16, 0.12), grime * 0.5 * weatherAmount);
        }`,
      );
  };
}

const PALETTES: [fill: string, outline: string, shine: string][] = [
  ['#ff3fa4', '#1a0a14', '#ffc2e4'],
  ['#ffd23f', '#2a1606', '#fff3b8'],
  ['#3fe0ff', '#06162a', '#c8f6ff'],
  ['#7dff5a', '#0a2006', '#d8ffc8'],
  ['#ff5a2a', '#200806', '#ffd0b8'],
  ['#f2f2f2', '#141414', '#ffffff'],
  ['#b06aff', '#14062a', '#e6d0ff'],
];
const TAG_COUNT = 14;
let pool: Texture[] | null = null;

/** Small seeded random generator, so every tag is the same from one game to the next. */
function rng(seed: number): () => number {
  let s = seed * 2654435761 + 1013904223;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917);
    return ((s >>> 0) % 100000) / 100000;
  };
}

type Stroke = { pts: [number, number][]; arrow: boolean };

/** One alien ideogram: a few strokes (bars, arcs, hooks, chevrons) and dots, in a 100x150 box. */
function glyph(r: () => number): { strokes: Stroke[]; dots: [number, number][] } {
  const strokes: Stroke[] = [];
  const dots: [number, number][] = [];
  const parts = 2 + Math.floor(r() * 3);
  // A slanted spine holds most glyphs together.
  const lean = (r() - 0.5) * 40;
  strokes.push({ pts: [[50 - lean, 10], [50 + (r() - 0.5) * 30, 75], [50 + lean, 140]], arrow: r() < 0.35 });
  for (let i = 0; i < parts; i++) {
    const kind = Math.floor(r() * 5);
    const y = 25 + r() * 100;
    if (kind === 0) {
      // Bar crossing the spine.
      strokes.push({ pts: [[10 + r() * 20, y], [50, y + (r() - 0.5) * 20], [90 - r() * 15, y + (r() - 0.5) * 30]], arrow: r() < 0.5 });
    } else if (kind === 1) {
      // Arc around a point.
      const cx = 30 + r() * 40;
      const rad = 18 + r() * 22;
      const a0 = r() * Math.PI * 2;
      const pts: [number, number][] = [];
      for (let k = 0; k <= 8; k++) {
        const a = a0 + (k / 8) * Math.PI * (1.1 + r() * 0.6);
        pts.push([cx + Math.cos(a) * rad, y + Math.sin(a) * rad * 1.2]);
      }
      strokes.push({ pts, arrow: false });
    } else if (kind === 2) {
      // Hook curling off the spine.
      const s = r() < 0.5 ? -1 : 1;
      strokes.push({ pts: [[50, y], [50 + s * 35, y - 15], [50 + s * 40, y + 15], [50 + s * 20, y + 20]], arrow: r() < 0.3 });
    } else if (kind === 3) {
      // Chevron.
      const s = r() < 0.5 ? -1 : 1;
      strokes.push({ pts: [[15, y - 20 * s], [50, y + 15 * s], [85, y - 20 * s]], arrow: false });
    } else {
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) dots.push([15 + r() * 70, y + (r() - 0.5) * 30]);
    }
  }
  return { strokes, dots };
}

/** Draws a smooth stroke through points (quadratic curves through midpoints). */
function trace(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

function arrowHead(ctx: CanvasRenderingContext2D, pts: [number, number][], size: number): void {
  const [x, y] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  const a = Math.atan2(y - py, x - px);
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
  ctx.lineTo(x + Math.cos(a + 2.5) * size, y + Math.sin(a + 2.5) * size);
  ctx.lineTo(x + Math.cos(a - 2.5) * size, y + Math.sin(a - 2.5) * size);
  ctx.closePath();
  ctx.fill();
}

/** Spray-painted tags in an alien script: wild strokes, outlines, drop shadow, arrows, overspray and drips. */
export function graffiti(): Texture[] {
  if (pool) return pool;
  pool = Array.from({ length: TAG_COUNT }, (_, i) => {
    const r = rng(i + 7);
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const [fill, outline, shine] = PALETTES[i % PALETTES.length];
    const count = 2 + Math.floor(r() * 3);
    const glyphs = Array.from({ length: count }, () => glyph(r));
    const width = 14 + r() * 8;
    const tilt = glyphs.map(() => (r() - 0.5) * 0.25);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Lay the glyphs out on a baseline that sags or rises, overlapping a little.
    const place = (k: number) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const span = 440 / count;
      ctx.translate(36 + k * span * 0.98, 40 + Math.sin(k * 1.3 + i) * 14);
      ctx.rotate(tilt[k]);
      ctx.scale(span / 100, 1.15);
    };
    const passes: [string, number, number, number][] = [
      // colour, extra width, offset x, offset y: shadow, outline, fill, shine
      ['rgba(0,0,0,0.55)', 10, 7, 8],
      [outline, 10, 0, 0],
      [fill, 0, 0, 0],
    ];
    for (const [col, extra, ox, oy] of passes) {
      for (let k = 0; k < count; k++) {
        place(k);
        ctx.translate(ox, oy);
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = width + extra;
        if (col === fill) {
          ctx.shadowColor = fill;
          ctx.shadowBlur = 10; // overspray halo
        }
        for (const s of glyphs[k].strokes) {
          trace(ctx, s.pts);
          ctx.stroke();
          if (s.arrow) arrowHead(ctx, s.pts, width * 1.6 + extra * 0.6);
        }
        for (const [dx, dy] of glyphs[k].dots) {
          ctx.beginPath();
          ctx.arc(dx, dy, width * 0.75 + extra / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
    }
    // Shine: a thin light line along the upper side of each stroke.
    ctx.globalAlpha = 0.7;
    for (let k = 0; k < count; k++) {
      place(k);
      ctx.translate(-width * 0.18, -width * 0.22);
      ctx.strokeStyle = shine;
      ctx.lineWidth = Math.max(2, width * 0.22);
      for (const s of glyphs[k].strokes) {
        trace(ctx, s.pts);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Drips running down from the bottom of the piece, and loose spray mist.
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    for (let k = 0; k < 6 + r() * 6; k++) {
      const x = 40 + r() * 430;
      const y0 = 150 + r() * 50;
      const len = 15 + r() * 45;
      ctx.lineWidth = 2 + r() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + (r() - 0.5) * 3, y0 + len);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y0 + len, ctx.lineWidth * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let k = 0; k < 400; k++) {
      ctx.globalAlpha = 0.25 + r() * 0.4;
      ctx.fillRect(20 + r() * 470, 20 + r() * 210, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
  return pool;
}
