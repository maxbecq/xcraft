import { AdditiveBlending, BufferAttribute, MeshLambertMaterial, type DataTexture, type Material, Vector2, CatmullRomCurve3, MeshStandardMaterial, TubeGeometry, CanvasTexture, RepeatWrapping, SRGBColorSpace, Color, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, type Object3D, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { BuildingDef } from '../data';
import { type GameMap, heightAt, LEVEL_HEIGHT } from '../map';
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
const BEAM_TOP: Record<string, number> = { obelisque: 6.6, emetteur: 3.1, pylonesanglant: 3.4 };

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

/** The creep's textures: ground tint and traces (map), their phosphor light (emissive), traces alone (mask), noise. */
let pcb: { map: CanvasTexture; glow: CanvasTexture; traces: CanvasTexture; noise: CanvasTexture } | null = null;

/** Sine of the camera's elevation: how much the view squashes the ground's depth on screen. */
const VIEW_SQUASH = 0.574;

/**
 * How far a direction on the creep texture (canvas x, y) lies on screen from the nearest horizontal or
 * vertical, in degrees. The texture is laid with u = x and v = -z and the camera looks down (-1, -1), so
 * canvas (1, 1) runs straight up the screen and (1, -1) straight across.
 */
export function offAxis(angle: number): number {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const deg = (Math.atan2(((c + s) / Math.SQRT2) * VIEW_SQUASH, (c - s) / Math.SQRT2) * 180) / Math.PI;
  const m = ((deg % 90) + 90) % 90;
  return Math.min(m, 90 - m);
}

/** Tileable value noise, `cells` lattice cells across, two octaves, in [0, 1]. */
function tileNoise(size: number, cells: number, seed: number): Float32Array {
  let k = seed;
  const rnd = () => ((k = (k * 16807) % 2147483647) / 2147483647);
  const out = new Float32Array(size * size);
  for (const [n, amp] of [[cells, 0.65], [cells * 2, 0.35]] as const) {
    const lat = Array.from({ length: n * n }, rnd);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const v = (i: number, j: number) => lat[((j + n) % n) * n + ((i + n) % n)];
        const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
        const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
        out[y * size + x] += (top + (bot - top) * sy) * amp;
      }
  }
  return out;
}

/**
 * Z creep: worn electronics grown into the ground. Traces at free angles, never running straight across or
 * up the screen (they would read as things standing up), branching off each other, ending in pads, with
 * light points here and there; a dark, uneven film under them, the ground showing through. The traces'
 * neon cyan (the Z screens' #6ff4ff) is in the emissive texture only, so the film takes the scene's light like the ground.
 */
function pcbTextures(): NonNullable<typeof pcb> {
  if (pcb) return pcb;
  const S = 512;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.lineCap = g.lineJoin = 'round';
    return [c, g] as const;
  };
  const [mc, g] = canvas(); // map: film and dim traces
  const [ec, eg] = canvas(); // emissive: the phosphor light
  const [tc, tg] = canvas(); // traces alone, for the waves
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, S, S);
  tg.strokeStyle = tg.fillStyle = '#fff';
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Routed like a real board: buses of parallel traces leave the chips' pins and turn together, never crossing,
  // ending in vias. Three directions only: the texture's two axes (the iso grid's diagonals on screen) and a
  // 1:2 jog (about 60° on screen); never the screen's horizontal or vertical.
  const U = 6; // trace pitch, and the chips' pin pitch
  const C = 2; // occupancy cell, px; the tile wraps
  const NC = S / C;
  const taken = new Uint8Array(NC * NC);
  type P = [number, number];
  const cellsOf = (pts: P[], r: number) => {
    const out = new Set<number>();
    const rc = Math.ceil(r / C);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / C) + 1;
      for (let k = 0; k <= n; k++) {
        const cx = Math.floor((x0 + ((x1 - x0) * k) / n) / C);
        const cy = Math.floor((y0 + ((y1 - y0) * k) / n) / C);
        for (let dy = -rc; dy <= rc; dy++)
          for (let dx = -rc; dx <= rc; dx++) if (dx * dx + dy * dy <= rc * rc) out.add((((cy + dy) % NC) + NC) % NC * NC + ((((cx + dx) % NC) + NC) % NC));
      }
    }
    return [...out];
  };
  const free = (cells: number[]) => cells.every((c) => !taken[c]);
  const take = (cells: number[]) => cells.forEach((c) => (taken[c] = 1));
  const rect = (x: number, y: number, w: number, h: number): P[] => {
    const pts: P[] = [];
    for (let yy = y; yy <= y + h; yy += C) pts.push([x, yy], [x + w, yy]);
    return pts;
  };
  type Trace = { pts: P[]; w: number; glow: number; vias: boolean; start: boolean };
  const traces: Trace[] = [];
  type Chip = { x: number; y: number; w: number; h: number };
  const chips: Chip[] = [];
  for (let i = 0; i < 120 && chips.length < 16; i++) {
    const ch = { x: Math.floor(rnd() * (S / U)) * U, y: Math.floor(rnd() * (S / U)) * U, w: U * (4 + Math.floor(rnd() * 6)), h: 14 + Math.floor(rnd() * 3) * 6 };
    const cells = cellsOf(rect(ch.x - 9, ch.y - 16, ch.w + 18, ch.h + 32), 2);
    if (!free(cells)) continue;
    take(cellsOf(rect(ch.x - 2, ch.y - 2, ch.w + 4, ch.h + 4), 2));
    chips.push(ch);
  }
  const unit = (a: P) => {
    const l = Math.hypot(a[0], a[1]);
    return [a[0] / l, a[1] / l] as P;
  };
  // A route from p heading d: straight runs, right-angle turns, and jogs that shift the run sideways.
  const route = (p: P, d: P, legs: number): P[] => {
    const pts: P[] = [p];
    let [x, y] = p;
    for (let k = 0; k < legs; k++) {
      const len = U * (2 + Math.floor(rnd() * 7));
      x += d[0] * len;
      y += d[1] * len;
      pts.push([x, y]);
      if (k === legs - 1) break;
      if (rnd() < 0.35) {
        // Jog along (2, 1) or (-2, -1), whichever goes on, then back to the same heading.
        const j = unit(d[0] * 2 + d[1] > 0 ? [2, 1] : [-2, -1]);
        const jl = U * (2 + Math.floor(rnd() * 3));
        x += j[0] * jl;
        y += j[1] * jl;
        pts.push([x, y]);
      } else d = rnd() < 0.5 ? [-d[1], d[0]] : [d[1], -d[0]];
    }
    return pts;
  };
  // The same route shifted sideways by o, mitred at each corner so parallel traces keep their pitch.
  const offset = (pts: P[], o: number): P[] =>
    pts.map(([x, y], i) => {
      const nrm = (a: P, b: P) => unit([-(b[1] - a[1]), b[0] - a[0]]);
      const n1 = i > 0 ? nrm(pts[i - 1], pts[i]) : nrm(pts[0], pts[1]);
      const n2 = i < pts.length - 1 ? nrm(pts[i], pts[i + 1]) : n1;
      const k = o / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      return [x + (n1[0] + n2[0]) * k, y + (n1[1] + n2[1]) * k];
    });
  const lay = (base: P[], k: number, w: number, skip = 0, vias = true) => {
    base = base.filter((q, i) => !i || Math.hypot(q[0] - base[i - 1][0], q[1] - base[i - 1][1]) > 0.5); // no zero-length legs
    if (base.length < 2) return false;
    const lines = Array.from({ length: k }, (_, i) => offset(base, (i - (k - 1) / 2) * U));
    // A branch starts on the trace it leaves: its first few px are not checked against it.
    const from = (l: P[]): P[] => {
      if (!skip) return l;
      const d = unit([l[1][0] - l[0][0], l[1][1] - l[0][1]]);
      return [[l[0][0] + d[0] * skip, l[0][1] + d[1] * skip], ...l.slice(1)];
    };
    const cells = lines.map((l) => cellsOf(from(l), w / 2 + 1.2));
    if (!cells.every(free)) return false;
    cells.forEach(take);
    const glow = 0.35 + rnd() * 0.65;
    for (const pts of lines) traces.push({ pts, w, glow, vias, start: vias && !skip });
    if (vias) take(lines.flatMap((l) => cellsOf([l[l.length - 1], l[l.length - 1]], 4))); // room for the vias
    return true;
  };
  const bus = (start: P, d: P, k: number, w: number, skip = 0) => lay(route(start, d, 2 + Math.floor(rnd() * 4)), k, w, skip);
  // A connected board: buses run from chip to chip (out of one's pins, across, into the other's), and the rest
  // of the traces branch off them, so everything belongs to one network.
  const pinRow = (ch: Chip, side: number) => (side < 0 ? ch.y - 11 : ch.y + ch.h + 11);
  for (const a of chips) {
    const near = chips
      .filter((b) => b !== a)
      .map((b) => {
        // The nearest copy of b on the wrapping tile.
        const dx = ((b.x - a.x + S * 1.5) % S) - S / 2;
        const dy = ((b.y - a.y + S * 1.5) % S) - S / 2;
        return { ...b, x: a.x + dx, y: a.y + dy };
      })
      .sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))
      .slice(0, 4);
    for (const b of near) {
      const side = b.y < a.y ? -1 : 1;
      const k = Math.min(Math.floor(a.w / U), Math.floor(b.w / U), 2 + Math.floor(rnd() * 3));
      for (let tries = 0; tries < 6; tries++) {
        const ax = a.x + U * (Math.floor(rnd() * (Math.floor(a.w / U) - k + 1)) + (k - 1) / 2 + 0.5);
        const bx = b.x + U * (Math.floor(rnd() * (Math.floor(b.w / U) - k + 1)) + (k - 1) / 2 + 0.5);
        const y0 = pinRow(a, side);
        const y1 = pinRow(b, -side);
        if ((y1 - y0) * side < U * 4) break; // overlapping in depth: no clean route
        const my = Math.round((y0 + (y1 - y0) * (0.3 + rnd() * 0.4)) / U) * U;
        // Out of a's pins, across, into b's: the bus keeps its order, as the pins face each other.
        if (lay([[ax, y0], [ax, my], [bx, my], [bx, y1]], k, 2, 0, false)) break;
      }
    }
  }
  // Buses out of the chips' long sides, from groups of neighbouring pins.
  for (const ch of chips)
    for (const side of [-1, 1]) {
      const pins = Math.floor(ch.w / U);
      for (let tries = 0, done = 0; tries < 10 && done < 3; tries++) {
        const k = Math.min(pins, 2 + Math.floor(rnd() * 4));
        const first = Math.floor(rnd() * (pins - k + 1));
        const cx = ch.x + U * (first + (k - 1) / 2 + 0.5);
        const y = pinRow(ch, side);
        if (bus([cx, y], [0, side], k, 2)) done++;
      }
    }
  // Branches off the network: from a point on a trace, out sideways, ending in vias; a few thick power lines.
  for (let i = 0; i < 20000 && traces.length < 320; i++) {
    if (!traces.length) break;
    const t = traces[Math.floor(rnd() * traces.length)];
    const j = Math.floor(rnd() * (t.pts.length - 1));
    const [a, b] = [t.pts[j], t.pts[j + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Only off a straight run along one of the texture's axes: a branch off a jog would leave at a fourth angle.
    if (len < U * 3 || (Math.abs(b[0] - a[0]) > 0.5 && Math.abs(b[1] - a[1]) > 0.5)) continue;
    const f = (U * (1 + Math.floor(rnd() * (len / U - 1)))) / len;
    const p: P = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    const along = unit([b[0] - a[0], b[1] - a[1]]);
    const d: P = rnd() < 0.5 ? [-along[1], along[0]] : [along[1], -along[0]];
    lay(route(p, d, 1 + Math.floor(rnd() * 3)), rnd() < 0.25 ? 2 : 1, rnd() < 0.1 ? 4 : 2, t.w / 2 + 10);
  }
  const ends = traces.filter((t) => t.vias).map((t) => t.pts[t.pts.length - 1]);
  const lights = ends.filter(() => rnd() < 0.05).map(([x, y]) => ({ x, y, r: 1.4 + rnd() * 1.4 }));
  // Drawn nine times, shifted by the tile size, so the pattern wraps seamlessly.
  for (const ox of [-S, 0, S])
    for (const oy of [-S, 0, S]) {
      for (const ctx of [g, eg, tg]) {
        ctx.save();
        ctx.translate(ox, oy);
      }
      // The film: dark, thin, so the ground's colour and grain stay under it.
      g.fillStyle = 'rgba(8,19,20,0.55)';
      g.fillRect(0, 0, S, S);
      for (const t of traces) {
        const path = (ctx: CanvasRenderingContext2D) => {
          ctx.beginPath();
          t.pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        };
        path(g);
        g.strokeStyle = 'rgba(2,7,8,0.55)'; // a groove either side
        g.lineWidth = t.w + 2.5;
        g.stroke();
        g.strokeStyle = '#164c52';
        g.lineWidth = t.w;
        g.stroke();
        path(eg);
        eg.strokeStyle = `rgba(40,${Math.round(139 + 54 * t.glow)},${Math.round(150 + 60 * t.glow)},${0.45 + 0.4 * t.glow})`;
        eg.lineWidth = Math.max(1.2, t.w * 0.7);
        eg.stroke();
        path(tg);
        tg.lineWidth = t.w;
        tg.stroke();
        for (const [x, y] of t.vias ? (t.start ? [t.pts[0], t.pts[t.pts.length - 1]] : [t.pts[t.pts.length - 1]]) : []) {
          const r = t.w * 0.6 + 1.6;
          g.fillStyle = '#1d626a';
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = '#03090a';
          g.beginPath();
          g.arc(x, y, r * 0.42, 0, Math.PI * 2);
          g.fill();
          eg.strokeStyle = `rgba(60,${Math.round(159 + 54 * t.glow)},${Math.round(170 + 60 * t.glow)},0.8)`;
          eg.lineWidth = 1.2;
          eg.beginPath();
          eg.arc(x, y, r * 0.75, 0, Math.PI * 2);
          eg.stroke();
        }
      }
      for (const ch of chips) {
        g.fillStyle = '#2f646a';
        for (let px = ch.x + U / 2; px < ch.x + ch.w; px += U) g.fillRect(px - 1.2, ch.y - 11, 2.4, ch.h + 22); // pins
        g.fillStyle = 'rgba(2,7,8,0.7)';
        g.fillRect(ch.x - 1, ch.y - 1, ch.w + 2, ch.h + 2);
        g.fillStyle = '#0c1314';
        g.fillRect(ch.x, ch.y, ch.w, ch.h);
        eg.fillStyle = 'rgba(150,244,255,0.9)';
        eg.fillRect(ch.x + ch.w - 7, ch.y + ch.h - 7, 3, 3); // status LED
      }
      for (const l of lights) {
        const f = eg.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 3);
        f.addColorStop(0, 'rgba(190,248,255,1)');
        f.addColorStop(0.3, 'rgba(70,214,230,0.8)');
        f.addColorStop(1, 'rgba(20,110,120,0)');
        eg.fillStyle = f;
        eg.fillRect(l.x - l.r * 3, l.y - l.r * 3, l.r * 6, l.r * 6);
      }
      for (const ctx of [g, eg, tg]) ctx.restore();
    }
  // Noise for the frayed rim (red), grime and wear (green).
  const N = 128;
  const nc = document.createElement('canvas');
  nc.width = nc.height = N;
  const ng = nc.getContext('2d')!;
  const img = ng.createImageData(N, N);
  const fray = tileNoise(N, 8, 5);
  const grime = tileNoise(N, 4, 9);
  for (let i = 0; i < N * N; i++) {
    img.data[i * 4] = fray[i] * 255;
    img.data[i * 4 + 1] = grime[i] * 255;
    img.data[i * 4 + 3] = 255;
  }
  ng.putImageData(img, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new CanvasTexture(c);
    t.wrapS = t.wrapT = RepeatWrapping;
    if (srgb) t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  pcb = { map: tex(mc, true), glow: tex(ec, true), traces: tex(tc, false), noise: tex(nc, false) };
  return pcb;
}

/** The creep's material, before its shader patch. */
const creepLook = () => new MeshLambertMaterial({ map: pcbTextures().map, emissiveMap: pcbTextures().glow, emissive: 0xffffff, emissiveIntensity: 1.6, transparent: true, depthWrite: false, side: DoubleSide });

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
  private readonly creepMaterial = creepLook();
  /** An enemy's creep, wires and plugs: cut away wherever the player has no vision now (fog of war). */
  private readonly creepFoe = creepLook();
  private readonly creepTime = { value: 0 };
  /** Wires between Z buildings: dark rubber. */
  private readonly wireMaterial = new MeshStandardMaterial({ color: 0x17181c, metalness: 0.1, roughness: 0.55 });
  private readonly plugGeometry = new CylinderGeometry(1, 1, 1, 8);
  private readonly plugSteel = new MeshStandardMaterial({ color: 0x7d786e, metalness: 0.6, roughness: 0.5 });
  private readonly plugCopper = new MeshStandardMaterial({ color: 0xb06a34, metalness: 0.8, roughness: 0.35 });
  private readonly wireFoe = this.wireMaterial.clone();
  private readonly fieldFoe = this.fieldMaterial.clone();
  private readonly plugSteelFoe = this.plugSteel.clone();
  private readonly plugCopperFoe = this.plugCopper.clone();
  /** Whether an owner is the viewer's enemy (set at each update). */
  private foe: (owner: number) => boolean = () => false;
  private readonly beamMaterial = new MeshBasicMaterial({ color: 0xfff0c0, transparent: true, depthWrite: false, blending: AdditiveBlending });
  private readonly glowMaterial = new MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.18, depthWrite: false, blending: AdditiveBlending });
  private readonly beamFoe = this.beamMaterial.clone();
  private readonly glowFoe = this.glowMaterial.clone();
  private key = '';
  /** Materialising buildings: a big pulsing beam from the nearest Obelisk to each, by building id. */
  private readonly warps = new Map<number, Group>();
  private readonly warpCore = softLight(0xfff6d8);
  private readonly warpGlow = softLight(0xffcf6a);
  /** A cone along Y; aimed with lookAt, its top (wide) lands on the building site, its narrow bottom at the Obelisk. */
  private readonly unitBeam = new CylinderGeometry(1, 0.05, 1, 24, 8, true);
  private readonly unitColumn = new CylinderGeometry(1, 1, 1, 24, 4, true);

  constructor(scene: Object3D, private readonly map: GameMap, private readonly fog: DataTexture) {
    scene.add(this.root);
    // Faint waves of current rolling out from each building over the traces (aDist: tiles from its centre).
    const creepPatch = (sh: Parameters<Material['onBeforeCompile']>[0]) => {
      sh.uniforms.time = this.creepTime;
      sh.uniforms.traces = { value: pcbTextures().traces };
      sh.uniforms.noise = { value: pcbTextures().noise };
      sh.vertexShader = `attribute float aDist;\nattribute float aRim;\nvarying float vDist;\nvarying float vRim;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvDist = aDist;\nvRim = aRim;')}`;
      sh.fragmentShader = `uniform float time;\nuniform sampler2D traces;\nuniform sampler2D noise;\nvarying float vDist;\nvarying float vRim;\n${sh.fragmentShader
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float trace = texture2D(traces, vMapUv).a;
          vec2 nz = vec2(texture2D(noise, vMapUv * 1.9).r, texture2D(noise, vMapUv * 0.55 + 0.37).g);
          // The rim frays into the ground through noise instead of fading evenly.
          float fray = smoothstep(nz.x - 0.14, nz.x + 0.14, vRim);
          // Grime: the film thins and thickens in patches; the traces keep their ink.
          diffuseColor.a *= fray * mix(mix(0.45, 1.15, nz.y), 1.0, trace);
          diffuseColor.rgb *= mix(0.7, 1.0, nz.y);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // Worn traces glow less; waves of current roll out from each building, sharp front outside.
          totalEmissiveRadiance *= fray * mix(0.55, 1.0, smoothstep(0.3, 0.7, nz.y));
          float w = fract(vDist / 6.0 - time * 0.2);
          float band = smoothstep(0.75, 0.97, w) * (1.0 - smoothstep(0.97, 1.0, w));
          totalEmissiveRadiance += vec3(0.4, 0.94, 1.0) * trace * band * 0.3 * fray;`,
        )}`;
    };
    this.creepMaterial.onBeforeCompile = creepPatch;
    this.creepFoe.onBeforeCompile = creepPatch;
    for (const [m, key] of [[this.creepFoe, 'creep'], [this.wireFoe, 'wire'], [this.plugSteelFoe, 'plug-steel'], [this.plugCopperFoe, 'plug-copper'], [this.fieldFoe, 'field'], [this.beamFoe, 'beam'], [this.glowFoe, 'glow']] as const) {
      // Cut away where the fog texture (1 visible, 0.5 explored, 0 never seen) says the player sees nothing now.
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh, r) => {
        prev.call(m, sh, r);
        sh.uniforms.fogMap = { value: this.fog };
        sh.uniforms.mapSize = { value: new Vector2(this.map.width, this.map.height) };
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform vec2 mapSize;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogUv = (modelMatrix * vec4(transformed, 1.0)).xz / mapSize;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (texture2D(fogMap, vFogUv).r < 0.9) discard;');
      };
      m.customProgramCacheKey = () => `foe-${key}`;
    }
  }

  /** One hidden mesh per material of the network, the enemy's variants too, for the warm-up to compile their programs
   * and send their textures (render/prewarm.ts): an enemy's creep or beams first seen in play compiled them then. */
  samples(): Object3D[] {
    const g = new PlaneGeometry(0.01, 0.01);
    const list: Object3D[] = [];
    for (const m of Object.values(this)) {
      if (!(m as Material)?.isMaterial) continue;
      const mesh = new Mesh(g, m as Material);
      mesh.userData.keep = true;
      mesh.visible = false;
      list.push(mesh);
    }
    return list;
  }

  /** `highlight`: an Isdaris building is being placed, or a power building is selected. `foe`: whether an owner is the
   * viewer's enemy, whose creep and wires show only where the viewer sees now. */
  update(world: World, sees: (e: Entity) => boolean, highlight: boolean, foe: (owner: number) => boolean = () => false): void {
    this.foe = foe;
    // Only the linked network powers anything; a cut-off emitter shows no zone and no beam.
    const nodes = world.players.flatMap((p) => world.powerNetwork(p.id)).filter(sees);
    // Z buildings outside the network's nodes get a powered link too, so they join the key.
    const fed = [...world.entities.values()].filter((e) => e.def.kind === 'building' && e.buildLeft <= 0 && !(e.def as BuildingDef).power && world.players[e.owner]?.faction === 'z' && sees(e));
    const key = [...nodes, ...fed].map((e) => e.id).join(',');
    if (key !== this.key) this.rebuild(nodes, world, fed, key);
    const t = performance.now() / 1000;
    this.fieldMaterial.opacity = this.fieldFoe.opacity = highlight ? 0.95 : 0.2;
    this.creepMaterial.opacity = this.creepFoe.opacity = highlight ? 1 : 0.75;
    this.beamMaterial.opacity = this.beamFoe.opacity = 0.55 + 0.25 * Math.sin(t * 3.1);
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
      // An enemy's shaft would point at an Obelisk hidden in the fog: drawn only while that Obelisk is seen too.
      if (!source || (this.foe(b.owner) && !sees(source))) continue;
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
    // Discs, wires and beams are built anew each time; only the plugs share one geometry. Materials are shared.
    for (const m of this.root.children as Mesh[]) if (m.geometry !== this.plugGeometry) m.geometry.dispose();
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
        const rim = new Float32Array(pos.count);
        const dist = new Float32Array(pos.count);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const z = pos.getZ(i);
          uv.setXY(i, x / PCB_TILE, -z / PCB_TILE);
          const d = Math.hypot(x - cx, z - cz) / r;
          const ragged = 0.12 * Math.sin(x * 1.7 + z * 0.6) * Math.sin(z * 1.3 - x * 0.4);
          // Not on cliff walls: there the world-space pattern smears into streaks running up the screen.
          // Sampled as far as the next vertex, so a face spanning a cliff edge counts as steep at both ends.
          const slope = Math.max(...[[0.55, 0], [-0.55, 0], [0, 0.55], [0, -0.55]].map(([dx, dz]) => Math.abs(heightAt(this.map, x + dx, z + dz) - heightAt(this.map, x, z)) / 0.55));
          const flat = 1 - Math.min(1, Math.max(0, (slope - 0.5) / 0.4));
          rim[i] = Math.min(1, Math.max(0, (1 - d + ragged) / 0.35)) * flat;
          dist[i] = d * r;
        }
        geo.setAttribute('aRim', new BufferAttribute(rim, 1));
        geo.setAttribute('aDist', new BufferAttribute(dist, 1));
      }
      const disc = new Mesh(geo, creep(e) ? (this.foe(e.owner) ? this.creepFoe : this.creepMaterial) : this.foe(e.owner) ? this.fieldFoe : this.fieldMaterial);
      disc.renderOrder = 1;
      disc.receiveShadow = creep(e); // lit and shaded like the ground it lies on
      this.root.add(disc);
    }
    // Z: a wire from each node to the nearest node already linked whose creep touches its own, and from every
    // other building to the nearest node whose creep it stands on. A far expansion gets no wire home: nothing
    // across open ground gives it away.
    const radius = (e: Entity) => (e.def as BuildingDef).power! * FP;
    const far = (a: Entity, b: Entity) => Math.hypot(b.x - a.x, b.y - a.y);
    for (const owner of new Set(nodes.filter(creep).map((e) => e.owner))) {
      const own = nodes.filter((e) => e.owner === owner);
      const linked = [own.find((e) => (e.def as BuildingDef).dropoff) ?? own[0]];
      for (const e of own) if (e !== linked[0]) linked.push(e);
      const nearest = (e: Entity, among: Entity[]) => among.reduce((a, b) => (far(e, b) < far(e, a) ? b : a));
      for (let i = 1; i < linked.length; i++) {
        const touching = linked.slice(0, i).filter((b) => far(linked[i], b) <= radius(linked[i]) + radius(b));
        if (touching.length) this.link(linked[i], nearest(linked[i], touching));
      }
      for (const e of fed) {
        if (e.host) continue; // a Pod's add-on hangs on its Pod's gantry, not on a wire of its own
        const under = own.filter((b) => far(e, b) <= radius(b));
        if (e.owner === owner && under.length) this.link(e, nearest(e, under));
      }
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
        this.beam(at(best[0]).add(new Vector3(0, BEAM_TOP[best[0].type] ?? 3, 0)), at(best[1]).add(new Vector3(0, BEAM_TOP[best[1].type] ?? 3, 0)), this.foe(owner));
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
    // No wire down a cliff: seen from above it reads as a stray line running off to a base below.
    const h = pts.map(([x, z]) => heightAt(this.map, x, z));
    if (h.some((y, i) => i > 0 && Math.abs(y - h[i - 1]) > LEVEL_HEIGHT * 0.5)) return;
    this.wire(a, b, pts);
  }

  /**
   * A real wire lying on the ground between two buildings: a rubber tube that leaves each building through a
   * plug at its edge.
   */
  private wire(a: Entity, b: Entity, pts: [number, number][]): void {
    const foe = this.foe(a.owner);
    const edge = (e: Entity) => ((e.def as BuildingDef).size / 2) * 0.8;
    const out = (x: number, z: number, e: Entity) => Math.hypot(x - e.x / FP, z - e.y / FP) > edge(e);
    const kept = pts.filter(([x, z]) => out(x, z, a) && out(x, z, b));
    if (kept.length < 3) return;
    // Every other sample, so the tube stays smooth; it rests on the ground, a little higher than its radius.
    const radius = 0.07;
    const curve = new CatmullRomCurve3(kept.filter((_, i) => i % 2 === 0 || i === kept.length - 1).map(([x, z]) => new Vector3(x, heightAt(this.map, x, z) + radius + 0.03, z)));
    const length = curve.getLength();
    const geo = new TubeGeometry(curve, Math.ceil(length * 4), radius, 6);
    this.root.add(new Mesh(geo, foe ? this.wireFoe : this.wireMaterial));
    for (const [t, dir] of [[0, 1], [1, -1]] as const) {
      const at = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).multiplyScalar(dir);
      for (const [r, len, shift, material] of [[radius * 1.7, 0.32, 0.12, foe ? this.plugSteelFoe : this.plugSteel], [radius * 1.95, 0.07, 0.22, foe ? this.plugCopperFoe : this.plugCopper]] as const) {
        const m = new Mesh(this.plugGeometry, material);
        m.scale.set(r, len, r);
        m.position.copy(at).addScaledVector(tangent, shift - 0.12);
        m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
        this.root.add(m);
      }
    }
  }

  private beam(from: Vector3, to: Vector3, foe: boolean): void {
    const length = from.distanceTo(to);
    // A thin bright core in a wider soft glow.
    for (const [radius, material] of [[0.05, foe ? this.beamFoe : this.beamMaterial], [0.16, foe ? this.glowFoe : this.glowMaterial]] as const) {
      const m = new Mesh(new CylinderGeometry(radius, radius, length, 6, 1, true), material);
      m.position.copy(from).add(to).multiplyScalar(0.5);
      m.lookAt(to);
      m.rotateX(Math.PI / 2);
      this.root.add(m);
    }
  }
}
