import { AdditiveBlending, CylinderGeometry, DoubleSide, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, type Scene, ShaderMaterial, Color } from 'three';
import BALANCE from '../balance.json';
import { FLY_HEIGHT } from '../data';
import { HELD_BY } from './effects';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import { type Entity, type World, soars } from '../sim/world';

/** A lasting effect on a unit, as shown: its key (an ability's, for its pictogram), colour, and whether it helps. */
export interface Mark {
  key: string;
  color: number;
  good: boolean;
}

const M = (key: string, color: number, good: boolean): Mark => ({ key, color, good });
const BOOST = M('stimulant', 0xff5a3a, true);
const WAR = M('cridegueurre', 0xffb830, true);
const REFLECT = M('renvoi', 0xffe08a, true);
const INVULN = M('invuln', 0xfff6c0, true);
const PHASED = M('dephasage', 0x6ae8ff, true);
const CHARGED = M('courroux', 0x8ab8ff, true);
const CAMO = M('camouflage', 0xe8f0ff, true);
const STATUE = M('statue', 0xb0a898, true);
const CHILL = M('gel', 0x9ad8ff, false);
const BLIND = M('amonra', 0xffd040, false);
const CHARM = M('soumission', 0xff4ad0, false);
const SWARM = M('nuee', 0x9a9a40, false);
const SLOW = M('jetdesable', 0xd8b070, false);
const STUNNED = M('chocmental', 0xc08aff, false);
const BURROWED = M('enfouissement', 0xb08a60, true);
const ILLUSION = M('double', 0x9af0ff, true);

/**
 * What lasts on this entity now and has no look of its own yet, the strongest first (at most a few are drawn): a badge
 * stands in for it until it does. The Humans' spells drawn their own way (render/effects.ts, Effects.lasting) have none:
 * Peau de roc, Régénérant, Gaz euphorisants, the Belluaire's Camouflage, poison, Napalm, mines, the Réservoir's fuse,
 * the Cadavre réanimé; nor the Z's (Effects.zSpells): Gravité alourdie, Nuage de nanites, Gel électronique, Balise de
 * vacarme, Impulsion magnétique, Canon IEM, the invisibility and repair kits.
 */
export function marksOf(e: Entity): Mark[] {
  const out: Mark[] = [];
  if (HELD_BY.get(e.id) === 'chocmental' && e.held > 0) out.push(STUNNED);
  if (e.burrowed) out.push(BURROWED);
  if (e.illusion) out.push(ILLUSION);
  if (e.charm > 0) out.push(CHARM);
  if (e.invuln > 0 && e.def.kind === 'unit') out.push(INVULN);
  if (e.phased > 0 && e.def.kind === 'unit') out.push(PHASED);
  if (e.reflect > 0) out.push(REFLECT);
  if (e.war > 0) out.push(WAR);
  if (e.boost > 0) out.push(BOOST);
  if (e.charged > 0) out.push(CHARGED);
  if (e.statue > 0) out.push(STATUE);
  if (e.pace > 0 && e.paceMove <= 100 && e.paceAtk >= 100) out.push(SLOW);
  if (e.chill > 0) out.push(CHILL);
  if (e.blind > 0) out.push(BLIND);
  if (e.swarm > 0) out.push(SWARM);
  if (e.camo > 0 && e.type !== 'belluaire') out.push(CAMO);
  return out;
}

/** Zones that last on the ground: their centre, reach (tiles) and colour. */
function zones(world: World, seen: (x: number, y: number) => boolean, put: (x: number, z: number, r: number, color: number) => void): void {
  const now = world.tick;
  for (const z of world.silences) if (z.until > now && seen(z.x, z.y)) put(z.x / FP, z.y / FP, z.r / FP, 0x6ab8ff);
  for (const z of world.storms) if (z.until > now && seen(z.x, z.y)) put(z.x / FP, z.y / FP, z.r / FP, 0xe0b870);
  for (const z of world.clouds) if (z.hits > 0 && seen(z.x, z.y)) put(z.x / FP, z.y / FP, z.r / FP, 0x8aff4a);
  // Zones revealed for a while (Observation céleste, balises, Observatoire…): their reach in tiles, the Forge's by default.
  for (const z of world.scans) if (z.left > 0 && seen(z.x, z.y)) put(z.x / FP, z.y / FP, z.radius ?? BALANCE.rules.observation.radius, 0xfff0c0);
  for (const e of world.entities.values()) {
    if (e.hp <= 0 || !seen(e.x, e.y)) continue;
    if (e.gravity > 0) put(e.x / FP, e.y / FP, BALANCE.abilities.gravite.radius, 0xa07aff);
    // The Gods' standing auras: Athéna's protection, Odin's war.
    const lvl = Math.max(0, Math.min(2, e.lvl - 1));
    if (e.type === 'athena') put(e.x / FP, e.y / FP, BALANCE.rules.upgrades.auraprotection.radius[lvl], 0x9ad8ff);
    if (e.type === 'odin') put(e.x / FP, e.y / FP, BALANCE.rules.upgrades.auraguerre.radius[lvl], 0xffb830);
  }
}

const MAX_RINGS = 600;
const MAX_SHELLS = 300;
/** Rings drawn under a unit, its marks one inside the other. */
const PER_UNIT = 3;

/**
 * Lasting effects, shown while they last: a coloured ring on the ground under the unit (style a and c), a sheath of
 * light round it (style b), and a circle at the reach of a zone (every style). Two instanced meshes, two draw calls
 * whatever the number. Render only: it reads the world, never changes it.
 */
export class Marks {
  private readonly rings: InstancedMesh;
  private readonly shells: InstancedMesh;
  private readonly ringLook: InstancedBufferAttribute;
  private readonly ringShape: InstancedBufferAttribute;
  private readonly shellLook: InstancedBufferAttribute;
  private readonly m = new Matrix4();
  private readonly c = new Color();
  private readonly time = { value: 0 };

  constructor(scene: Scene, private readonly map: GameMap, private readonly style: string) {
    const flat = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.ringLook = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4).setUsage(DynamicDrawUsage);
    this.ringShape = new InstancedBufferAttribute(new Float32Array(MAX_RINGS * 4), 4).setUsage(DynamicDrawUsage);
    flat.setAttribute('aLook', this.ringLook);
    flat.setAttribute('aShape', this.ringShape);
    this.rings = new InstancedMesh(
      flat,
      new ShaderMaterial({
        uniforms: { time: this.time },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aLook;
          attribute vec4 aShape; // edge width (share of the radius), fill, dashes, phase
          varying vec2 vUv;
          varying vec4 vLook;
          varying vec4 vShape;
          void main() {
            vUv = position.xz;
            vLook = aLook;
            vShape = aShape;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float time;
          varying vec2 vUv;
          varying vec4 vLook;
          varying vec4 vShape;
          void main() {
            float r = length(vUv);
            if (r > 1.0) discard;
            float w = vShape.x;
            float edge = smoothstep(1.0 - w, 1.0 - w * 0.4, r) * (1.0 - smoothstep(1.0 - w * 0.25, 1.0, r));
            if (vShape.z > 0.0) {
              // Dashes turning slowly round the ring.
              float a = atan(vUv.y, vUv.x) / 6.2832 + time * 0.08 + vShape.w;
              edge *= step(0.4, fract(a * vShape.z));
            }
            float pulse = 0.8 + 0.2 * sin(time * 3.0 + vShape.w * 6.2832);
            float fill = vShape.y * smoothstep(0.0, 1.0, r);
            float k = (edge + fill) * pulse * vLook.a;
            gl_FragColor = vec4(vLook.rgb * k, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
      MAX_RINGS,
    );
    const tube = new CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.shellLook = new InstancedBufferAttribute(new Float32Array(MAX_SHELLS * 4), 4).setUsage(DynamicDrawUsage);
    tube.setAttribute('aLook', this.shellLook);
    this.shells = new InstancedMesh(
      tube,
      new ShaderMaterial({
        uniforms: { time: this.time },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        vertexShader: /* glsl */ `
          attribute vec4 aLook;
          varying vec2 vUv;
          varying vec4 vLook;
          void main() {
            vUv = uv;
            vLook = aLook;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float time;
          varying vec2 vUv;
          varying vec4 vLook;
          void main() {
            // Brightest at the foot, fading up; bands of light rising.
            float h = vUv.y;
            float bands = 0.55 + 0.45 * sin(h * 16.0 - time * 5.0 + vUv.x * 6.2832 * 2.0);
            float k = pow(1.0 - h, 1.6) * bands * vLook.a + smoothstep(0.12, 0.0, h) * 0.6 * vLook.a;
            gl_FragColor = vec4(vLook.rgb * k, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
      MAX_SHELLS,
    );
    for (const mesh of [this.rings, this.shells]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = 2;
      scene.add(mesh);
    }
  }

  /** Lays out this frame's marks: units' (those seen) and zones'. */
  update(world: World, sees: (e: Entity) => boolean, seen: (x: number, y: number) => boolean, alpha: number, dt: number): void {
    this.time.value += dt;
    if (this.style === 'avant' || this.style === 'aucun') return;
    let rings = 0;
    let shells = 0;
    const ring = (x: number, y: number, z: number, r: number, color: number, a: number, edge: number, fill: number, dashes: number, phase: number) => {
      if (rings >= MAX_RINGS) return;
      this.m.makeScale(r, 1, r).setPosition(x, y, z);
      this.rings.setMatrixAt(rings, this.m);
      this.c.set(color);
      this.ringLook.setXYZW(rings, this.c.r, this.c.g, this.c.b, a);
      this.ringShape.setXYZW(rings, edge, fill, dashes, phase);
      rings++;
    };
    zones(world, seen, (x, z, r, color) => ring(x, heightAt(this.map, x, z) + 0.06, z, r, color, 0.9, Math.min(0.5, 0.18 / r), 0.12, Math.round(r * 3), 0));
    for (const e of world.entities.values()) {
      if (e.def.kind === 'resource' || e.inside || e.hp <= 0) continue;
      // Canon IEM: a translucent green shell round what it took, while it holds it (the user's pick, 2026-11-23).
      if (e.seizedLeft > 0 && shells < MAX_SHELLS && sees(e)) {
        const x = (e.px + (e.x - e.px) * alpha) / FP;
        const z = (e.py + (e.y - e.py) * alpha) / FP;
        const r = (e.radius / FP) * 1.5 + 0.3;
        this.m.makeScale(r, 0.9 + r * 0.8, r).setPosition(x, heightAt(this.map, x, z) + (soars(e) ? FLY_HEIGHT : 0), z);
        this.shells.setMatrixAt(shells, this.m);
        this.c.set(0x8cff5a);
        this.shellLook.setXYZW(shells++, this.c.r, this.c.g, this.c.b, 0.75);
      }
      const marks = marksOf(e);
      if (!marks.length || !sees(e)) continue;
      const x = (e.px + (e.x - e.px) * alpha) / FP;
      const z = (e.py + (e.y - e.py) * alpha) / FP;
      const ground = heightAt(this.map, x, z);
      const y = ground + (soars(e) ? FLY_HEIGHT : 0);
      const size = e.def.kind === 'building' ? (e.def as { size: number }).size * 0.6 : e.radius / FP;
      const phase = (e.id % 17) / 17;
      for (const [i, mk] of marks.slice(0, PER_UNIT).entries()) {
        if (this.style === 'b') {
          if (shells >= MAX_SHELLS) continue;
          const r = size + 0.12 + i * 0.1;
          this.m.makeScale(r, 0.9 + size * 0.8, r).setPosition(x, y, z);
          this.shells.setMatrixAt(shells, this.m);
          this.c.set(mk.color);
          this.shellLook.setXYZW(shells, this.c.r, this.c.g, this.c.b, 0.55);
          shells++;
          // And a thin ring at its foot, so it reads from straight above too.
          ring(x, ground + 0.05, z, r, mk.color, 0.9, 0.12, 0, 0, phase);
        } else {
          // Rings under the unit, one inside the other; a harmful one dashed, a helpful one whole.
          const r = size + 0.3 + i * 0.16;
          ring(x, ground + 0.05 + i * 0.002, z, r, mk.color, this.style === 'c' ? 0.75 : 1.1, 0.22, 0.18, mk.good ? 0 : 6, phase + i * 0.3);
        }
      }
    }
    this.rings.count = rings;
    this.shells.count = shells;
    if (rings) this.ringLook.needsUpdate = this.ringShape.needsUpdate = this.rings.instanceMatrix.needsUpdate = true;
    if (shells) this.shellLook.needsUpdate = this.shells.instanceMatrix.needsUpdate = true;
  }
}
