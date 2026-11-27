import { CylinderGeometry, DoubleSide, Mesh, type Scene, ShaderMaterial } from 'three';

/** How tall the prism stands, tiles: low, so the fight behind it stays in sight. */
const HEIGHT = 1.3;
/** Seconds to rise when cast, and to fade before it goes. */
const RISE = 0.35;
const FADE = 0.45;

const material = new ShaderMaterial({
  uniforms: { time: { value: 0 }, show: { value: 1 }, flash: { value: 0 } },
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vP;
    varying vec3 vN;
    void main() {
      vUv = uv;
      vP = position;
      vN = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float time;
    uniform float show;
    uniform float flash;
    varying vec2 vUv;
    varying vec3 vP;
    varying vec3 vN;
    float line(float d, float w) { return smoothstep(w, 0.0, abs(d)); }
    void main() {
      float glow;
      float face;
      if (abs(vN.y) > 0.5) {
        // The top: an octagon, its rim and an inner one, by the distance to its sides (1 on them).
        float a = atan(vP.z, vP.x);
        float d = length(vP.xz) * cos(mod(a + 0.3927, 0.7854) - 0.3927) / 3.0;
        face = floor((a + 3.1416) / 0.7854);
        glow = line(d - 1.0, 0.05) + 0.6 * line(d - 0.72, 0.025);
      } else {
        // A side: its edges, the top rim, and chevrons of light like cut facets.
        float u = fract(vUv.x * 8.0);
        face = floor(vUv.x * 8.0);
        float c = abs(u - 0.5) * 2.0;
        float edges = line(min(u, 1.0 - u), 0.035) + line(1.0 - vUv.y, 0.06) + 0.4 * line(vUv.y, 0.05);
        float chevrons = line(fract(vUv.y * 1.6 + c * 0.55) - 0.5, 0.045) * (1.0 - c);
        // A sheen sweeping up now and then.
        float sweep = exp(-pow((vUv.y - fract(time * 0.22)) * 7.0, 2.0)) * 0.35;
        glow = edges + chevrons + sweep;
      }
      // Each facet glints on its own beat.
      float glint = pow(0.5 + 0.5 * sin(time * 1.9 + face * 2.4), 6.0);
      float body = 0.3 + 0.2 * glint;
      float g = clamp(glow, 0.0, 1.0);
      vec3 col = mix(vec3(0.0, 0.62, 0.9) * (1.0 + glint), vec3(0.45, 1.6, 1.8), g) + flash;
      gl_FragColor = vec4(col, clamp(body + g * 0.7 + flash, 0.0, 1.0) * show);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
// Its apothem the disc's radius (3 tiles): the sides stand at its edge.
const geometry = new CylinderGeometry(3 / Math.cos(Math.PI / 8), 3 / Math.cos(Math.PI / 8), HEIGHT, 8, 1, false).translate(0, HEIGHT / 2 - 0.15, 0);

/**
 * Concentration énergétique (Druide, Isdaris): a low octagonal prism of condensed energy, translucent cyan, over the
 * disc no one walks through (the user's pick, variant C, 2026-11-27). It rises when cast, its facets glint while it
 * lasts and it fades out at the end. One mesh per block, one shader program for all. Render only.
 */
export class Prisms {
  private readonly live = new Map<object, { mesh: Mesh<CylinderGeometry, ShaderMaterial>; age: number; used: boolean }>();
  private time = 0;

  constructor(private readonly scene: Scene) {}

  /** A sample for the warm-up (render/prewarm.ts): its program compiled before play. */
  static sample(): Mesh {
    const m = new Mesh(geometry, material);
    m.userData.keep = true;
    return m;
  }

  begin(dt: number): void {
    this.time += dt;
    for (const p of this.live.values()) p.used = false;
  }

  /** This frame's block `key` at x, y, z (its foot), `left` seconds still to stand. */
  put(key: object, x: number, y: number, z: number, left: number, dt: number): void {
    let p = this.live.get(key);
    if (!p) {
      const mesh = new Mesh(geometry, material.clone());
      mesh.renderOrder = 3;
      this.scene.add(mesh);
      this.live.set(key, (p = { mesh, age: 0, used: true }));
    }
    p.used = true;
    p.age += dt;
    const rise = Math.min(1, p.age / RISE);
    const out = Math.min(1, left / FADE);
    p.mesh.position.set(x, y, z);
    // Rising out of the ground, eased, and sinking a little as it fades.
    p.mesh.scale.set(1, Math.max(0.01, (1 - (1 - rise) ** 3) * (0.85 + 0.15 * out)), 1);
    const u = p.mesh.material.uniforms;
    u.time.value = this.time;
    u.show.value = Math.min(rise * 1.5, 1) * out;
    u.flash.value = (1 - rise) * 0.6;
  }

  /** Takes away the blocks not put this frame. */
  end(): void {
    for (const [key, p] of this.live) {
      if (p.used) continue;
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
      this.live.delete(key);
    }
  }
}
