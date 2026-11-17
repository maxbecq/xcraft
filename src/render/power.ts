import { AdditiveBlending, BufferAttribute, CatmullRomCurve3, MeshStandardMaterial, TubeGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
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

let pcbTexture: CanvasTexture | null = null;
/** The traces alone, white on transparent: where the waves of current light up. */
let pcbTraces: CanvasTexture | null = null;
/**
 * Z creep, circuit variant: a tileable printed circuit with no board under it, so the ground shows through.
 * Copper traces routed at right angles and 45°, pads and vias, chips with their pins and status LEDs, and a
 * faint solder-mask tint in patches. Laid in world space, so neighbouring zones join up.
 */
function pcbMap(): CanvasTexture {
  if (pcbTexture) return pcbTexture;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const mc = document.createElement('canvas');
  mc.width = mc.height = S;
  const mg = mc.getContext('2d')!;
  mg.lineCap = mg.lineJoin = 'round';
  mg.strokeStyle = mg.fillStyle = '#fff';
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const G = 16; // routing grid
  type Trace = { pts: [number, number][]; w: number };
  const traces: Trace[] = [];
  const DIRS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  for (let i = 0; i < 70; i++) {
    let x = Math.floor(rnd() * (S / G)) * G;
    let y = Math.floor(rnd() * (S / G)) * G;
    let d = Math.floor(rnd() * 4) * 2; // start straight
    const pts: [number, number][] = [[x, y]];
    const steps = 3 + Math.floor(rnd() * 5);
    for (let k = 0; k < steps; k++) {
      const n = 1 + Math.floor(rnd() * 5);
      x += DIRS[d][0] * G * n;
      y += DIRS[d][1] * G * n;
      pts.push([x, y]);
      d = (d + (rnd() < 0.5 ? 1 : 7)) % 8; // turn by 45°
    }
    traces.push({ pts, w: rnd() < 0.2 ? 5 : 2 + rnd() * 1.5 });
  }
  const chips = Array.from({ length: 7 }, () => ({ x: Math.floor(rnd() * (S / G)) * G, y: Math.floor(rnd() * (S / G)) * G, w: G * (2 + Math.floor(rnd() * 3)), h: G * (1 + Math.floor(rnd() * 2)), led: rnd() < 0.6 }));
  const masks = Array.from({ length: 16 }, () => ({ x: rnd() * S, y: rnd() * S, r: 50 + rnd() * 110 }));
  // Everything is drawn nine times, shifted by the tile size, so the pattern wraps seamlessly.
  for (const ox of [-S, 0, S])
    for (const oy of [-S, 0, S]) {
      g.save();
      g.translate(ox, oy);
      mg.save();
      mg.translate(ox, oy);
      // One colour only, an old phosphor terminal's green: a dark screen wash over everything, darker in
      // patches, the ground still showing through, and traces glowing brighter on it.
      g.fillStyle = 'rgba(6,24,9,0.42)';
      g.fillRect(0, 0, S, S);
      for (const m of masks) {
        const f = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, m.r);
        f.addColorStop(0, 'rgba(3,16,5,0.35)');
        f.addColorStop(1, 'rgba(3,16,5,0)');
        g.fillStyle = f;
        g.fillRect(m.x - m.r, m.y - m.r, m.r * 2, m.r * 2);
      }
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (const t of traces) {
        g.beginPath();
        t.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.strokeStyle = 'rgba(0,8,2,0.5)';
        g.lineWidth = t.w + 2;
        g.stroke();
        g.strokeStyle = '#1f9a2e'; // phosphor green
        g.lineWidth = t.w;
        g.stroke();
        g.strokeStyle = 'rgba(150,255,150,0.3)'; // brighter core
        g.lineWidth = Math.max(1, t.w * 0.3);
        g.stroke();
        mg.beginPath();
        t.pts.forEach(([x, y], k) => (k ? mg.lineTo(x, y) : mg.moveTo(x, y)));
        mg.lineWidth = t.w;
        mg.stroke();
        for (const [x, y] of [t.pts[0], t.pts[t.pts.length - 1]]) {
          // Pad with a drilled hole (via).
          g.fillStyle = '#3ccf48';
          g.beginPath();
          g.arc(x, y, t.w + 3, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#031006';
          g.beginPath();
          g.arc(x, y, (t.w + 3) * 0.4, 0, Math.PI * 2);
          g.fill();
        }
      }
      for (const ch of chips) {
        g.fillStyle = '#2a8f35';
        for (let px = ch.x + 4; px < ch.x + ch.w - 2; px += 6) {
          g.fillRect(px, ch.y - 4, 3, ch.h + 8); // pins on both long sides
        }
        g.fillStyle = 'rgba(0,8,2,0.6)';
        g.fillRect(ch.x - 1, ch.y - 1, ch.w + 2, ch.h + 2);
        g.fillStyle = '#07160a';
        g.fillRect(ch.x, ch.y, ch.w, ch.h);
        g.fillStyle = 'rgba(120,255,130,0.14)';
        g.fillRect(ch.x, ch.y, ch.w, 2);
        g.fillStyle = '#15501d';
        g.beginPath();
        g.arc(ch.x + 5, ch.y + 5, 2, 0, Math.PI * 2);
        g.fill();
        if (ch.led) {
          g.fillStyle = 'rgba(170,255,170,1)';
          g.beginPath();
          g.arc(ch.x + ch.w - 6, ch.y + ch.h - 6, 2.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.restore();
      mg.restore();
    }
  pcbTraces = new CanvasTexture(mc);
  pcbTraces.wrapS = pcbTraces.wrapT = RepeatWrapping;
  pcbTexture = new CanvasTexture(c);
  pcbTexture.colorSpace = SRGBColorSpace;
  pcbTexture.wrapS = pcbTexture.wrapT = RepeatWrapping;
  pcbTexture.anisotropy = 4;
  return pcbTexture;
}

/** Tiles covered by one repeat of the circuit texture. */
const PCB_TILE = 8;

/**
 * Isdaris power network: the emission zone of each Obelisk and Emitter on the ground (where buildings
 * can be materialised), brighter while placing one, and beams of light linking emitters to each other
 * and back to the main building.
 */
export class PowerNet {
  private readonly root = new Group();
  private readonly fieldMaterial = new MeshBasicMaterial({ map: fieldMap(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe2a0, side: DoubleSide });
  /** Z: the same field, drawn as creep on the ground. */
  private readonly creepMaterial = new MeshBasicMaterial({ map: pcbMap(), transparent: true, depthWrite: false, side: DoubleSide, vertexColors: true });
  private readonly creepTime = { value: 0 };
  /** Wires between Z buildings: dark rubber. */
  private readonly wireMaterial = new MeshStandardMaterial({ color: 0x17181c, metalness: 0.1, roughness: 0.55 });
  private readonly plugGeometry = new CylinderGeometry(1, 1, 1, 8);
  private readonly plugSteel = new MeshStandardMaterial({ color: 0x7d786e, metalness: 0.6, roughness: 0.5 });
  private readonly plugCopper = new MeshStandardMaterial({ color: 0xb06a34, metalness: 0.8, roughness: 0.35 });
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
    // Faint waves of current rolling out from each building over the traces (aDist: tiles from its centre).
    this.creepMaterial.onBeforeCompile = (sh) => {
      sh.uniforms.time = this.creepTime;
      sh.uniforms.traces = { value: pcbTraces };
      sh.vertexShader = `attribute float aDist;\nvarying float vDist;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;')}`;
      sh.fragmentShader = `uniform float time;\nuniform sampler2D traces;\nvarying float vDist;\n${sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float w = fract(vDist / 6.0 - time * 0.2);
        // Sharp front on the outside, a glow trailing inwards.
        float band = smoothstep(0.75, 0.97, w) * (1.0 - smoothstep(0.97, 1.0, w));
        float glow = texture2D(traces, vMapUv).a * band * 0.22;
        diffuseColor.rgb += vec3(0.4, 1.0, 0.45) * glow;
        diffuseColor.a = max(diffuseColor.a, glow);`,
      )}`;
    };
  }

  /** `highlight`: an Isdaris building is being placed, or a power building is selected. */
  update(world: World, sees: (e: Entity) => boolean, highlight: boolean): void {
    // Only the linked network powers anything; a cut-off emitter shows no zone and no beam.
    const nodes = world.players.flatMap((p) => world.powerNetwork(p.id)).filter(sees);
    // Z buildings outside the network's nodes get a powered link too, so they join the key.
    const fed = [...world.entities.values()].filter((e) => e.def.kind === 'building' && e.buildLeft <= 0 && !(e.def as BuildingDef).power && world.players[e.owner]?.faction === 'z' && sees(e));
    const key = [...nodes, ...fed].map((e) => e.id).join(',');
    if (key !== this.key) this.rebuild(nodes, world, fed, key);
    const t = performance.now() / 1000;
    this.fieldMaterial.opacity = highlight ? 0.95 : 0.2;
    this.creepMaterial.opacity = highlight ? 1 : 0.75;
    this.beamMaterial.opacity = 0.55 + 0.25 * Math.sin(t * 3.1);
    this.creepTime.value = t;
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

  private rebuild(nodes: Entity[], world: World, fed: Entity[], key: string): void {
    const creep = (e: Entity) => world.players[e.owner].faction === 'z';
    this.key = key;
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
      if (creep(e)) {
        // World-space UVs, so overlapping zones line up; the rim frays out unevenly into the ground.
        const uv = geo.getAttribute('uv');
        const color = new Float32Array(pos.count * 4);
        const dist = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          uv.setXY(i, x / PCB_TILE, -z / PCB_TILE);
          const d = Math.hypot(x - cx, z - cz) / r;
          const ragged = 0.12 * Math.sin(x * 1.7 + z * 0.6) * Math.sin(z * 1.3 - x * 0.4);
          const a = Math.min(1, Math.max(0, (1 - d + ragged) / 0.3));
          color.set([1, 1, 1, a], i * 4);
          dist[i] = d * r;
        }
        geo.setAttribute('color', new BufferAttribute(color, 4));
        geo.setAttribute('aDist', new BufferAttribute(dist, 1));
      }
      const disc = new Mesh(geo, creep(e) ? this.creepMaterial : this.fieldMaterial);
      disc.renderOrder = 1;
      this.root.add(disc);
    }
    // Z: a wire from each node to the nearest node already linked, and from every other building
    // to its nearest node.
    for (const owner of new Set(nodes.filter(creep).map((e) => e.owner))) {
      const own = nodes.filter((e) => e.owner === owner);
      const linked = [own.find((e) => (e.def as BuildingDef).dropoff) ?? own[0]];
      for (const e of own) if (e !== linked[0]) linked.push(e);
      const nearest = (e: Entity, among: Entity[]) => among.reduce((a, b) => (Math.hypot(b.x - e.x, b.y - e.y) < Math.hypot(a.x - e.x, a.y - e.y) ? b : a));
      for (let i = 1; i < linked.length; i++) this.link(linked[i], nearest(linked[i], linked.slice(0, i)));
      for (const e of fed) if (e.owner === owner) this.link(e, nearest(e, own));
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

  /**
   * A route on the ground between two buildings, at right angles and 45° like a circuit trace (a looser
   * curve for the cables), draped over the terrain; its UV runs along it in tiles, for the pulses.
   */
  private link(a: Entity, b: Entity): void {
    const [ax, az, bx, bz] = [a.x / FP, a.y / FP, b.x / FP, b.y / FP];
    const dx = bx - ax;
    const dz = bz - az;
    const diag = Math.min(Math.abs(dx), Math.abs(dz));
    const diagFirst = (a.id + b.id) % 2 === 0;
    const corner = (t: number): [number, number] => [ax + Math.sign(dx) * t, az + Math.sign(dz) * t];
    const knee: [number, number] = diagFirst ? corner(diag) : [bx - Math.sign(dx) * diag, bz - Math.sign(dz) * diag];
    const route: [number, number][] = [[ax, az], knee, [bx, bz]];
    const pts: [number, number][] = [];
    for (let k = 0; k < route.length - 1; k++) {
      const [x0, z0] = route[k];
      const [x1, z1] = route[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // The wire snakes a little instead of keeping a straight line.
        const wave = Math.sin((k + t) * Math.PI * 2 + a.id) * 0.25;
        const len = Math.hypot(x1 - x0, z1 - z0) || 1;
        pts.push([x0 + (x1 - x0) * t + (-(z1 - z0) / len) * wave, z0 + (z1 - z0) * t + ((x1 - x0) / len) * wave]);
      }
    }
    pts.push([bx, bz]);
    this.wire(a, b, pts);
  }

  /**
   * A real wire lying on the ground between two buildings: a rubber tube that leaves each building through a
   * plug at its edge.
   */
  private wire(a: Entity, b: Entity, pts: [number, number][]): void {
    const edge = (e: Entity) => ((e.def as BuildingDef).size / 2) * 0.8;
    const out = (x: number, z: number, e: Entity) => Math.hypot(x - e.x / FP, z - e.y / FP) > edge(e);
    const kept = pts.filter(([x, z]) => out(x, z, a) && out(x, z, b));
    if (kept.length < 3) return;
    // Every other sample, so the tube stays smooth; it rests on the ground, a little higher than its radius.
    const radius = 0.07;
    const curve = new CatmullRomCurve3(kept.filter((_, i) => i % 2 === 0 || i === kept.length - 1).map(([x, z]) => new Vector3(x, heightAt(this.map, x, z) + radius + 0.03, z)));
    const length = curve.getLength();
    const geo = new TubeGeometry(curve, Math.ceil(length * 4), radius, 6);
    this.root.add(new Mesh(geo, this.wireMaterial));
    for (const [t, dir] of [[0, 1], [1, -1]] as const) {
      const at = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).multiplyScalar(dir);
      for (const [r, len, shift, material] of [[radius * 1.7, 0.32, 0.12, this.plugSteel], [radius * 1.95, 0.07, 0.22, this.plugCopper]] as const) {
        const m = new Mesh(this.plugGeometry, material);
        m.scale.set(r, len, r);
        m.position.copy(at).addScaledVector(tangent, shift - 0.12);
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
        this.root.add(m);
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
