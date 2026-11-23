import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

/**
 * Shots' streaks, all in one draw call: glowing ribbons from a tail to a head, turned to face the camera, a hot white
 * core in the shooter's colour, brightest at the head. A streak either flies (a tracer of a set length running from the
 * muzzle to the target) or stands on the whole line and fades (a beam). Additive, no depth test, like the particles.
 */
export class Streaks {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  live = 0;
  private used = 0;
  private readonly free: number[] = [];
  private readonly active: Uint8Array;
  /** Per streak: from xyz, to xyz. */
  private readonly line: Float32Array;
  /** Per streak: age, life, flight (seconds to reach the target, 0: a beam), length, width, alpha. */
  private readonly course: Float32Array;
  private readonly rgb: Float32Array;
  /** Per streak: how high its path bows above the straight line, mid-way (0: straight; a spark's ballistic arc). */
  private readonly arc: Float32Array;
  private readonly a: InstancedBufferAttribute;
  private readonly b: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly tint = new Color();
  private readonly head = new Vector3();
  private readonly tail = new Vector3();
  private readonly mid = new Vector3();

  constructor(private readonly capacity: number) {
    this.active = new Uint8Array(capacity);
    this.line = new Float32Array(capacity * 6);
    this.course = new Float32Array(capacity * 6);
    this.rgb = new Float32Array(capacity * 3);
    this.arc = new Float32Array(capacity);
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    this.a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage); // tail xyz, width
    this.b = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage); // head xyz
    this.color = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
    geometry.setAttribute('aTail', this.a);
    geometry.setAttribute('aHead', this.b);
    geometry.setAttribute('aColor', this.color);
    geometry.instanceCount = 0;
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: true,
        vertexShader: /* glsl */ `
          attribute vec4 aTail;
          attribute vec3 aHead;
          attribute vec4 aColor;
          varying vec2 vUv;
          varying vec4 vColor;
          void main() {
            // position.x in [-0.5, 0.5]: tail to head; position.y: across.
            vec4 t = modelViewMatrix * vec4(aTail.xyz, 1.0);
            vec4 h = modelViewMatrix * vec4(aHead, 1.0);
            vec2 d = h.xy - t.xy;
            float len = max(length(d), 1e-4);
            vec2 across = vec2(-d.y, d.x) / len;
            float u = position.x + 0.5;
            vec4 mv = mix(t, h, u);
            // Round caps: the ribbon reaches half a width past either end.
            mv.xy += (d / len) * aTail.w * 0.5 * sign(position.x) + across * position.y * aTail.w;
            gl_Position = projectionMatrix * mv;
            vUv = vec2(u, position.y * 2.0);
            vColor = aColor;
          }`,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          varying vec4 vColor;
          void main() {
            float across = 1.0 - abs(vUv.y);
            float body = smoothstep(0.0, 1.0, across);
            float core = pow(across, 6.0);
            float along = mix(0.25, 1.0, vUv.x);
            vec3 c = (vColor.rgb * body + vec3(core)) * along;
            gl_FragColor = vec4(c * vColor.a, 0.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** A streak from `from` to `to`: `flight` seconds to get there (0: a beam over the whole line), then `linger` to fade;
   * `arc` bows its path up by that much mid-way, so a spark flies up and falls back onto `to`. */
  spawn(color: number, from: Vector3, to: Vector3, flight: number, linger: number, length: number, width: number, alpha: number, arc = 0): void {
    let i = this.free.pop();
    if (i === undefined) {
      if (this.used >= this.capacity) return;
      i = this.used++;
    }
    this.active[i] = 1;
    this.live++;
    this.line.set([from.x, from.y, from.z, to.x, to.y, to.z], i * 6);
    this.course.set([0, flight + linger, flight, length, width, alpha], i * 6);
    this.arc[i] = arc;
    this.tint.set(color);
    this.rgb.set([this.tint.r, this.tint.g, this.tint.b], i * 3);
  }

  update(dt: number): void {
    const { line: l, course: c } = this;
    let n = 0;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.color.array as Float32Array;
    for (let i = 0; i < this.used; i++) {
      if (!this.active[i]) continue;
      const age = (c[i * 6] += dt);
      const [life, flight, length, width, alpha] = [c[i * 6 + 1], c[i * 6 + 2], c[i * 6 + 3], c[i * 6 + 4], c[i * 6 + 5]];
      if (age >= life) {
        this.active[i] = 0;
        this.free.push(i);
        this.live--;
        continue;
      }
      const p0 = this.tail.set(l[i * 6], l[i * 6 + 1], l[i * 6 + 2]);
      const p1 = this.head.set(l[i * 6 + 3], l[i * 6 + 4], l[i * 6 + 5]);
      let [k0, k1, fade] = [0, 1, 1 - age / life];
      if (flight > 0) {
        // A tracer: its head runs to the target, its tail `length` behind (never before the muzzle), then it shrinks into the hit.
        k1 = Math.min(1, age / flight);
        k0 = Math.max(0, k1 - length / (p0.distanceTo(p1) || 1e-3));
        if (age > flight) k0 += (1 - k0) * ((age - flight) / (life - flight));
        fade = 1;
      }
      const bow = this.arc[i] * 4;
      const t = this.mid.lerpVectors(p0, p1, k0);
      A.set([t.x, t.y + bow * k0 * (1 - k0), t.z, width], n * 4);
      const h = p0.lerp(p1, k1);
      B.set([h.x, h.y + bow * k1 * (1 - k1), h.z], n * 3);
      C.set([this.rgb[i * 3], this.rgb[i * 3 + 1], this.rgb[i * 3 + 2], alpha * fade * fade], n * 4);
      n++;
    }
    this.mesh.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n) {
      this.a.needsUpdate = this.b.needsUpdate = this.color.needsUpdate = true;
      this.a.addUpdateRange(0, n * 4);
      this.b.addUpdateRange(0, n * 3);
      this.color.addUpdateRange(0, n * 4);
    }
  }
}
