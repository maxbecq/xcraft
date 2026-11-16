import { AdditiveBlending, CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt } from '../map';
import { FP } from '../sim/fixed';
import type { Entity, World } from '../sim/world';

/**
 * Additive light with soft edges: fades where the surface turns away from the eye (the silhouette of the
 * cone) and towards both ends.
 */
function softLight(color: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { color: { value: new Color(color) }, opacity: { value: 1 } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-p.xyz);
        vAlong = uv.y;
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying vec3 vNormal;
      varying vec3 vView;
      varying float vAlong;
      void main() {
        float facing = pow(abs(dot(normalize(vNormal), normalize(vView))), 1.6);
        float ends = smoothstep(0.0, 0.08, vAlong) * smoothstep(1.0, 0.96, vAlong);
        gl_FragColor = vec4(color, opacity * facing * ends);
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** Where the beam leaves each power building, above its ground (model heights). */
const BEAM_TOP: Record<string, number> = { obelisque: 6.9, emetteur: 3.1, pylonesanglant: 3.4 };

let fieldTexture: CanvasTexture | null = null;
/** A soft disc with a bright rim and faint Art Deco rays: the emission zone seen from above. */
function fieldMap(): CanvasTexture {
  if (fieldTexture) return fieldTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const fill = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  fill.addColorStop(0, 'rgba(255,240,200,0.10)');
  fill.addColorStop(0.86, 'rgba(255,230,170,0.18)');
  fill.addColorStop(0.95, 'rgba(255,250,225,0.9)');
  fill.addColorStop(1, 'rgba(255,250,225,0)');
  g.fillStyle = fill;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,236,180,0.12)';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 30, 128 + Math.sin(a) * 30);
    g.lineTo(128 + Math.cos(a) * 118, 128 + Math.sin(a) * 118);
    g.stroke();
  }
  fieldTexture = new CanvasTexture(c);
  return fieldTexture;
}

/**
 * Isdaris power network: the emission zone of each Obelisk and Emitter on the ground (where buildings
 * can be materialised), brighter while placing one, and beams of light linking emitters to each other
 * and back to the main building.
 */
export class PowerNet {
  private readonly root = new Group();
  private readonly fieldMaterial = new MeshBasicMaterial({ map: fieldMap(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe2a0, side: DoubleSide });
  private readonly beamMaterial = new MeshBasicMaterial({ color: 0xfff0c0, transparent: true, depthWrite: false, blending: AdditiveBlending });
  private readonly glowMaterial = new MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending });
  private key = '';
  /** Materialising buildings: a big pulsing beam from the nearest Obelisk to each, by building id. */
  private readonly warps = new Map<number, Group>();
  private readonly warpCore = softLight(0xfff6d8);
  private readonly warpGlow = softLight(0xffcf6a);
  /** A cone along Y; aimed with lookAt, its top (wide) lands on the building site, its narrow bottom at the Obelisk. */
  private readonly unitBeam = new CylinderGeometry(1, 0.05, 1, 24, 8, true);
  private readonly unitColumn = new CylinderGeometry(1, 1, 1, 24, 4, true);

  constructor(scene: Object3D, private readonly map: GameMap) {
    scene.add(this.root);
  }

  /** `highlight`: an Isdaris building is being placed, or a power building is selected. */
  update(world: World, sees: (e: Entity) => boolean, highlight: boolean): void {
    // Only the linked network powers anything; a cut-off emitter shows no zone and no beam.
    const nodes = world.players.flatMap((p) => world.powerNetwork(p.id)).filter(sees);
    const key = nodes.map((e) => e.id).join(',');
    if (key !== this.key) this.rebuild(nodes);
    const t = performance.now() / 1000;
    this.fieldMaterial.opacity = highlight ? 0.95 : 0.2;
    this.beamMaterial.opacity = 0.55 + 0.25 * Math.sin(t * 3.1);
    this.updateWarps(world, sees, t);
  }

  private updateWarps(world: World, sees: (e: Entity) => boolean, t: number): void {
    const at = (e: Entity, up: number) => new Vector3(e.x / FP, heightAt(this.map, e.x / FP, e.y / FP) + up, e.y / FP);
    const live = new Set<number>();
    for (const b of world.entities.values()) {
      if (b.def.kind !== 'building' || !(b.def as BuildingDef).warp || b.buildLeft <= 0 || !sees(b)) continue;
      let source: Entity | undefined;
      let best = Infinity;
      for (const o of world.entities.values()) {
        if (o === b || o.owner !== b.owner || o.type !== 'obelisque' || o.buildLeft > 0) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < best) [source, best] = [o, d];
      }
      if (!source) continue;
      live.add(b.id);
      let g = this.warps.get(b.id);
      if (!g) {
        g = new Group();
        const from = at(source, BEAM_TOP.obelisque);
        const to = at(b, 0.3);
        const length = from.distanceTo(to);
        // A wide soft shaft around a bright core, from the Obelisk's tip down onto the site.
        for (const [radius, material] of [[0.5, this.warpCore], [1.6, this.warpGlow]] as const) {
          const m = new Mesh(this.unitBeam, material);
          m.scale.set(radius, length, radius);
          m.position.copy(from).add(to).multiplyScalar(0.5);
          m.lookAt(to);
          m.rotateX(Math.PI / 2);
          g.add(m);
        }
        // Where it lands: a column of light the size of the building.
        const size = (b.def as BuildingDef).size;
        const column = new Mesh(this.unitColumn, this.warpGlow);
        column.scale.set(size * 0.45, 3, size * 0.45);
        column.position.copy(at(b, 1.5));
        g.add(column);
        this.root.parent?.add(g);
        this.warps.set(b.id, g);
      }
    }
    for (const [id, g] of this.warps) {
      if (live.has(id)) continue;
      g.removeFromParent();
      this.warps.delete(id);
    }
    this.warpCore.uniforms.opacity.value = 0.55 + 0.2 * Math.sin(t * 9);
    this.warpGlow.uniforms.opacity.value = 0.3 + 0.12 * Math.sin(t * 5.3);
  }

  private rebuild(nodes: Entity[]): void {
    this.key = nodes.map((e) => e.id).join(',');
    this.root.clear();
    const at = (e: Entity) => new Vector3(e.x / FP, heightAt(this.map, e.x / FP, e.y / FP), e.y / FP);
    for (const e of nodes) {
      const r = (e.def as BuildingDef).power!;
      // Draped over the ground, so it runs down cliffs and ramps instead of hanging in the air.
      const segments = Math.ceil(r * 4);
      const geo = new PlaneGeometry(r * 2, r * 2, segments, segments);
      const pos = geo.getAttribute('position');
      const cx = e.x / FP;
      const cz = e.y / FP;
      for (let i = 0; i < pos.count; i++) {
        const x = cx + pos.getX(i);
        const z = cz - pos.getY(i);
        pos.setXYZ(i, x, heightAt(this.map, x, z) + 0.08, z);
      }
      geo.computeBoundingSphere();
      const disc = new Mesh(geo, this.fieldMaterial);
      disc.renderOrder = 1;
      this.root.add(disc);
    }
    // Per player, a tree grown from the main buildings: each emitter links to the nearest node already
    // in the network whose zone touches its own.
    for (const owner of new Set(nodes.map((e) => e.owner))) {
      const own = nodes.filter((e) => e.owner === owner);
      const linked = own.filter((e) => e.type === 'obelisque');
      const rest = own.filter((e) => e.type !== 'obelisque');
      if (!linked.length && rest.length) linked.push(rest.shift()!);
      for (;;) {
        let best: [Entity, Entity, number] | null = null;
        for (const a of rest)
          for (const b of linked) {
            const d = Math.hypot(a.x - b.x, a.y - b.y) / FP;
            const reach = (a.def as BuildingDef).power! + (b.def as BuildingDef).power!;
            if (d <= reach && (!best || d < best[2])) best = [a, b, d];
          }
        if (!best) break;
        this.beam(at(best[0]).add(new Vector3(0, BEAM_TOP[best[0].type] ?? 3, 0)), at(best[1]).add(new Vector3(0, BEAM_TOP[best[1].type] ?? 3, 0)));
        linked.push(best[0]);
        rest.splice(rest.indexOf(best[0]), 1);
      }
    }
  }

  private beam(from: Vector3, to: Vector3): void {
    const length = from.distanceTo(to);
    // A thin bright core in a wider soft glow.
    for (const [radius, material] of [[0.05, this.beamMaterial], [0.16, this.glowMaterial]] as const) {
      const m = new Mesh(new CylinderGeometry(radius, radius, length, 6, 1, true), material);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.lookAt(to);
      m.rotateX(Math.PI / 2);
      this.root.add(m);
    }
  }
}
