import { AdditiveBlending, CanvasTexture, SRGBColorSpace, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
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

let creepTexture: CanvasTexture | null = null;
/**
 * Z creep (notice): a chaotic but working mesh of electric cables. Bundles of insulated wires run out from the
 * centre, each shaded as a tube (dark edge, coloured sheath, a highlight), held by ties, with junction boxes
 * and their LEDs along the way; the rim frays out.
 */
function creepMap(): CanvasTexture {
  if (creepTexture) return creepTexture;
  const S = 1024;
  const C = S / 2;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // Insulation colours: mostly black and grey rubber, some dark red, rusty orange and faded yellow.
  const sheaths = ['#15161a', '#1d1f24', '#2b2d33', '#15161a', '#5a1e1a', '#7a4a22', '#6e6230', '#202a2e'];
  const point = (a: number, r: number) => [C + Math.cos(a) * r, C + Math.sin(a) * r] as const;
  type Path = [number, number, number, number, number, number, number, number];
  const along = (p: Path, t: number) => {
    const u = 1 - t;
    return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6], u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]] as const;
  };
  const tube = (p: Path, dx: number, dy: number, w: number, color: string) => {
    const trace = () => {
      g.beginPath();
      g.moveTo(p[0] + dx, p[1] + dy);
      g.bezierCurveTo(p[2] + dx, p[3] + dy, p[4] + dx, p[5] + dy, p[6] + dx, p[7] + dy);
    };
    trace();
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = w + 3;
    g.stroke();
    g.strokeStyle = color;
    g.lineWidth = w;
    g.stroke();
    g.save();
    g.translate(-w * 0.18, -w * 0.18);
    trace();
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = Math.max(1, w * 0.25);
    g.stroke();
    g.restore();
  };
  const bundles: Path[] = [];
  for (let i = 0; i < 46; i++) {
    // A bundle wanders out from near the centre to the rim.
    const a = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * 1.4;
    const [x0, y0] = point(a, rnd() * 90);
    const [x1, y1] = point(a + bend * 0.3 + (rnd() - 0.5) * 0.6, 160 + rnd() * 180);
    const [x2, y2] = point(a + bend * 0.7 + (rnd() - 0.5) * 0.6, 300 + rnd() * 160);
    const [x3, y3] = point(a + bend, 380 + rnd() * 130);
    const path: Path = [x0, y0, x1, y1, x2, y2, x3, y3];
    bundles.push(path);
    const n = 1 + Math.floor(rnd() * 4);
    const w = 5 + rnd() * 9;
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * w * 0.95;
      const nx = -Math.sin(a) * off;
      const ny = Math.cos(a) * off;
      tube(path, nx, ny, w * (0.75 + rnd() * 0.4), sheaths[Math.floor(rnd() * sheaths.length)]);
    }
    // Cable ties across the bundle.
    if (n > 1)
      for (let t = 0.2 + rnd() * 0.2; t < 0.95; t += 0.18 + rnd() * 0.2) {
        const [x, y] = along(path, t);
        const [xb, yb] = along(path, t + 0.01);
        const ang = Math.atan2(yb - y, xb - x);
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        g.fillStyle = 'rgba(120,118,110,0.95)';
        g.fillRect(-2, (-n * w) / 2 - 2, 4, n * w + 4);
        g.restore();
      }
  }
  // Junction boxes on the bundles, with a status LED.
  for (let i = 0; i < 26; i++) {
    const [x, y] = along(bundles[i % bundles.length], 0.25 + rnd() * 0.6);
    const s = 14 + rnd() * 12;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI);
    g.fillStyle = 'rgba(0,0,0,0.8)';
    g.fillRect(-s / 2 - 2, -s / 2 - 2, s + 4, s * 0.7 + 4);
    g.fillStyle = rnd() < 0.5 ? '#4a4640' : '#6a3a22';
    g.fillRect(-s / 2, -s / 2, s, s * 0.7);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(-s / 2, -s / 2, s, 2);
    g.fillStyle = i % 4 ? 'rgba(90,250,255,1)' : 'rgba(255,70,50,1)';
    g.beginPath();
    g.arc(s * 0.25, -s * 0.15, 2.5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // Ragged rim: fade the outer ring out.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(C, C, S * 0.3, C, C, C);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.8, 'rgba(0,0,0,0.85)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  creepTexture = new CanvasTexture(c);
  creepTexture.colorSpace = SRGBColorSpace;
  creepTexture.anisotropy = 4;
  return creepTexture;
}

/**
 * Isdaris power network: the emission zone of each Obelisk and Emitter on the ground (where buildings
 * can be materialised), brighter while placing one, and beams of light linking emitters to each other
 * and back to the main building.
 */
export class PowerNet {
  private readonly root = new Group();
  private readonly fieldMaterial = new MeshBasicMaterial({ map: fieldMap(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe2a0, side: DoubleSide });
  /** Z: the same field, drawn as creep on the ground. */
  private readonly creepMaterial = new MeshBasicMaterial({ map: creepMap(), transparent: true, depthWrite: false, side: DoubleSide });
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
    if (key !== this.key) this.rebuild(nodes, world);
    const t = performance.now() / 1000;
    this.fieldMaterial.opacity = highlight ? 0.95 : 0.2;
    this.creepMaterial.opacity = highlight ? 1 : 0.95;
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
    // Light enough to see the units around and behind it.
    this.warpCore.uniforms.opacity.value = 0.38 + 0.12 * Math.sin(t * 9);
    this.warpGlow.uniforms.opacity.value = 0.2 + 0.07 * Math.sin(t * 5.3);
  }

  private rebuild(nodes: Entity[], world: World): void {
    const creep = (e: Entity) => world.players[e.owner].faction === 'z';
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
      const disc = new Mesh(geo, creep(e) ? this.creepMaterial : this.fieldMaterial);
      disc.renderOrder = 1;
      this.root.add(disc);
    }
    // Per player, a tree grown from the main buildings: each emitter links to the nearest node already
    // in the network whose zone touches its own.
    for (const owner of new Set(nodes.filter((e) => !creep(e)).map((e) => e.owner))) {
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
