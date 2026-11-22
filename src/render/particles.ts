import { type Camera, CanvasTexture, Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, type Texture, Vector3 } from 'three';

/** The particles' pictures, side by side in one texture: which third a particle reads. */
export type Picture = 0 | 1 | 2;

/**
 * Every effect particle in one draw call: camera-facing squares, each with its own place, size, colour, opacity and
 * picture, sent to the graphics chip as one instanced mesh. They used to be a sprite and a material each, a draw call
 * apiece: up to 1 200 in a big fight, most of the frame's draw calls. Glows add their light, smoke covers what is
 * behind it: both go through one blend (colour already multiplied by opacity, and no opacity left for a glow), drawn
 * far to near as the sprites were.
 */
export class Particles {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  /** Particles flying now. */
  live = 0;
  /** Slots ever used: never more than `limit`. */
  private used = 0;
  private readonly free: number[] = [];
  private readonly active: Uint8Array;
  /** Per particle: x y z, vx vy vz. */
  private readonly motion: Float32Array;
  /** Per particle: age, life, size0, size1, alpha, gravity. */
  private readonly course: Float32Array;
  /** Per particle: r g b (linear), picture, additive. */
  private readonly look: Float32Array;
  private readonly depth: Float32Array;
  private readonly order: number[] = [];
  private readonly center: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly info: InstancedBufferAttribute;
  private readonly tint = new Color();
  private readonly dir = new Vector3();

  /** `pictures`: three square canvases of the same size (glow, smoke, flame). */
  constructor(pictures: [HTMLCanvasElement, HTMLCanvasElement, HTMLCanvasElement], private readonly capacity: number) {
    this.active = new Uint8Array(capacity);
    this.motion = new Float32Array(capacity * 6);
    this.course = new Float32Array(capacity * 6);
    this.look = new Float32Array(capacity * 5);
    this.depth = new Float32Array(capacity);
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.center = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    this.info = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aCenter', this.center);
    geometry.setAttribute('aColor', this.color);
    geometry.setAttribute('aInfo', this.info);
    geometry.instanceCount = 0;
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: { atlas: { value: atlas(pictures) } },
        transparent: true,
        // No depth test: the post pass does not keep scene depth. Effects are short-lived and drawn over the scene.
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: true,
        vertexShader: /* glsl */ `
          attribute vec3 aCenter;
          attribute vec4 aColor;
          attribute vec3 aInfo; // size, picture, additive
          varying vec2 vUv;
          varying vec4 vColor;
          varying float vAdd;
          void main() {
            vUv = vec2((uv.x + aInfo.y) / 3.0, uv.y);
            vColor = aColor;
            vAdd = aInfo.z;
            vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
            mv.xy += position.xy * aInfo.x;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D atlas;
          varying vec2 vUv;
          varying vec4 vColor;
          varying float vAdd;
          void main() {
            gl_FragColor = vColor * texture2D(atlas, vUv);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            // One blend for both kinds: a glow leaves no opacity, so it only adds its light.
            gl_FragColor.rgb *= gl_FragColor.a;
            gl_FragColor.a *= 1.0 - vAdd;
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** One more particle, unless `limit` are already flying (a share of the capacity, by the graphics level). */
  spawn(limit: number, picture: Picture, color: number, pos: Vector3, vel: Vector3, life: number, size0: number, size1: number, alpha: number, gravity: number, additive: boolean): void {
    let i = this.free.pop();
    if (i === undefined) {
      if (this.used >= Math.min(this.capacity, limit)) return;
      i = this.used++;
    }
    this.active[i] = 1;
    this.live++;
    this.motion.set([pos.x, pos.y, pos.z, vel.x, vel.y, vel.z], i * 6);
    this.course.set([0, life, size0, size1, alpha, gravity], i * 6);
    this.tint.set(color);
    this.look.set([this.tint.r, this.tint.g, this.tint.b, picture, additive ? 1 : 0], i * 5);
  }

  /** Moves and fades them, then lays them out far to near for `camera`. */
  update(dt: number, camera: Camera): void {
    const { motion: m, course: c, look, order, depth } = this;
    camera.getWorldDirection(this.dir);
    const { x: dx, y: dy, z: dz } = this.dir;
    order.length = 0;
    for (let i = 0; i < this.used; i++) {
      if (!this.active[i]) continue;
      const age = (c[i * 6] += dt);
      if (age >= c[i * 6 + 1]) {
        this.active[i] = 0;
        this.live--;
        this.free.push(i);
        continue;
      }
      m[i * 6 + 4] -= c[i * 6 + 5] * dt;
      m[i * 6] += m[i * 6 + 3] * dt;
      m[i * 6 + 1] += m[i * 6 + 4] * dt;
      m[i * 6 + 2] += m[i * 6 + 5] * dt;
      depth[i] = m[i * 6] * dx + m[i * 6 + 1] * dy + m[i * 6 + 2] * dz;
      order.push(i);
    }
    // Far first, as three sorted the sprites; the older one first where two stand as far.
    order.sort((a, b) => depth[b] - depth[a] || a - b);
    const [center, color, info] = [this.center.array as Float32Array, this.color.array as Float32Array, this.info.array as Float32Array];
    for (let n = 0; n < order.length; n++) {
      const i = order[n];
      const f = c[i * 6] / c[i * 6 + 1];
      center[n * 3] = m[i * 6];
      center[n * 3 + 1] = m[i * 6 + 1];
      center[n * 3 + 2] = m[i * 6 + 2];
      color[n * 4] = look[i * 5];
      color[n * 4 + 1] = look[i * 5 + 1];
      color[n * 4 + 2] = look[i * 5 + 2];
      color[n * 4 + 3] = c[i * 6 + 4] * (1 - f) * Math.min(1, f * 8 + 0.3);
      info[n * 3] = c[i * 6 + 2] + (c[i * 6 + 3] - c[i * 6 + 2]) * f;
      info[n * 3 + 1] = look[i * 5 + 3];
      info[n * 3 + 2] = look[i * 5 + 4];
    }
    const n = order.length;
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    for (const a of [this.center, this.color, this.info]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

/** The three pictures side by side (each fades out towards its edges, so none bleeds into its neighbour). */
function atlas(pictures: HTMLCanvasElement[]): Texture {
  const size = pictures[0].width;
  const c = document.createElement('canvas');
  c.width = size * pictures.length;
  c.height = size;
  const ctx = c.getContext('2d')!;
  pictures.forEach((p, i) => ctx.drawImage(p, i * size, 0, size, size));
  return new CanvasTexture(c);
}
