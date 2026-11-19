import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, type Scene, ShaderMaterial, Vector3 } from 'three';
import type { UnitDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { flies, type Entity, type World } from '../sim/world';

/** Grounds that keep a print, and its colour (darker than the ground, drawn see-through). */
const GROUNDS: Record<string, number> = { glace: 0x2e3f52, desert: 0x4a2e16, lune: 0x161618 };
/** Prints at most on the ground at once: the oldest is reused when a new one is needed. */
const MAX = 512;
/** Seconds a print takes to fade out. */
const LIFE = 14;
/** Only heavy walkers leave them (a Serf's would be a flicker). */
const HEAVY = 0.6;

/**
 * Footprints behind heavy units on snow, sand and the Moon: one instanced quad per print, the print itself drawn in
 * the shader (no texture), fading with its age; a single draw call, capped at MAX. Render only: the simulation knows
 * nothing of them. Off on the basse level.
 */
export class Footprints {
  private readonly mesh: InstancedMesh<PlaneGeometry, ShaderMaterial> | null = null;
  private readonly born: InstancedBufferAttribute | null = null;
  private next = 0;
  /** Each walker's last print: where, and which foot. */
  private readonly last = new Map<number, { x: number; z: number; left: boolean }>();
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(scene: Scene, private readonly map: GameMap, biome: string, enabled: boolean) {
    const color = GROUNDS[biome];
    if (!enabled || color === undefined) return;
    const born = (this.born = new InstancedBufferAttribute(new Float32Array(MAX).fill(-1e9), 1));
    born.setUsage(DynamicDrawUsage);
    const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('aBorn', born);
    const mesh = (this.mesh = new InstancedMesh(
      geo,
      new ShaderMaterial({
        uniforms: { color: { value: new Color(color) }, now: { value: 0 } },
        vertexShader: `
          attribute float aBorn;
          uniform float now;
          varying vec2 vUv;
          varying float vFade;
          void main() {
            vUv = uv;
            vFade = clamp(1.0 - (now - aBorn) / ${LIFE.toFixed(1)}, 0.0, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 color;
          varying vec2 vUv;
          varying float vFade;
          void main() {
            // A sole (an oval, wider at the front) and a heel, soft-edged.
            vec2 p = vUv - 0.5;
            float sole = length(vec2(p.x / (0.36 - 0.08 * p.y), (p.y - 0.12) / 0.3));
            float heel = length(vec2(p.x / 0.24, (p.y + 0.3) / 0.16));
            float d = min(sole, heel);
            float a = (1.0 - smoothstep(0.7, 1.0, d)) * 0.85 * vFade;
            if (a < 0.01) discard;
            gl_FragColor = vec4(color, a);
          }`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
      MAX,
    ));
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    scene.add(mesh);
  }

  /** Each frame: a print wherever a heavy walker in sight has gone a stride since its last. */
  update(world: World, sees: (e: Entity) => boolean, now: number): void {
    if (!this.mesh || !this.born) return;
    const t = now / 1000;
    this.mesh.material.uniforms.now.value = t;
    let changed = false;
    for (const e of world.entities.values()) {
      const r = e.def.kind === 'unit' ? (e.def as UnitDef).radius : 0;
      if (r < HEAVY || flies(e) || e.inside || !sees(e)) continue;
      const x = e.x / FP;
      const z = e.y / FP;
      const was = this.last.get(e.id);
      if (!was) {
        this.last.set(e.id, { x, z, left: false });
        continue;
      }
      const dx = x - was.x;
      const dz = z - was.z;
      const d = Math.hypot(dx, dz);
      const stride = 0.55 * r;
      if (d < stride) continue;
      // A teleport (Gaïa, a drop) or a long jump between frames: start afresh there.
      if (d > 4) {
        this.last.set(e.id, { x, z, left: false });
        continue;
      }
      // One foot then the other, either side of the way it walks.
      const [ux, uz] = [dx / d, dz / d];
      const side = (was.left ? -1 : 1) * 0.28 * r;
      const px = x - uz * side;
      const pz = z + ux * side;
      const size = 0.42 * r;
      this.q.setFromAxisAngle(this.up, Math.atan2(ux, uz));
      this.m.compose(new Vector3(px, heightAt(this.map, px, pz) + 0.1, pz), this.q, new Vector3(size * 0.8, 1, size * 1.2));
      this.mesh.setMatrixAt(this.next, this.m);
      this.born.setX(this.next, t);
      this.next = (this.next + 1) % MAX;
      this.last.set(e.id, { x, z, left: !was.left });
      changed = true;
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.born.needsUpdate = true;
    }
    // Forget those gone (now and then: the map is small).
    if (this.last.size > world.entities.size) for (const id of this.last.keys()) if (!world.entities.has(id)) this.last.delete(id);
  }
}
