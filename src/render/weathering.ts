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

const TAGS = ['XC', 'RUST', 'MAD', 'NO GODS', 'BOOM', 'Z!', '27', 'KRAK', 'FREE', 'SCRAP', 'H8', 'VIVA'];
const SPRAY = ['#ff3fa4', '#ffd23f', '#f2f2f2', '#3fe0ff', '#ff4a2a', '#7dff5a'];
let pool: Texture[] | null = null;

/** Spray-painted tags with drips, drawn once into canvases. */
export function graffiti(): Texture[] {
  if (pool) return pool;
  pool = TAGS.map((text, i) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const color = SPRAY[i % SPRAY.length];
    ctx.translate(128, 64);
    ctx.rotate(((i * 37) % 13 - 6) * 0.02);
    ctx.font = `${text.length > 4 ? 52 : 74}px Impact, 'Arial Black', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Overspray halo, dark outline, then the fill.
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(15,10,10,0.9)';
    ctx.strokeText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    // Drips.
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (let k = 0; k < 5; k++) {
      const x = -70 + ((i * 53 + k * 37) % 140);
      const len = 10 + ((i * 17 + k * 23) % 30);
      ctx.beginPath();
      ctx.moveTo(x, 18);
      ctx.lineTo(x, 18 + len);
      ctx.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  });
  return pool;
}
