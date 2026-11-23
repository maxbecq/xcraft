import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, type Scene, ShaderMaterial } from 'three';
import { type GameMap, heightAt } from '../map';

/** Tiles round the cursor the grid can reach (it covers about the screen at the usual zoom; more costs for little). */
export const GRID_REACH = 40;
const N = 2 * GRID_REACH + 1;
const LIFT = 0.07;

const OK = new Color(0x4dff6a);
const NO = new Color(0xff3b30);

/**
 * The placement grid while a building is being placed: the tiles round the cursor, each edged green where the building
 * could stand and red where not, fading out towards the screen's edges; and the building's footprint under the
 * cursor, bright with a halo (green: it can go there, red: not), with its add-on's room beside it for a Z Pod.
 */
export class PlaceGrid {
  private readonly group = new Group();
  private readonly cells: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly foot = halo(1);
  /** The add-on's room: outlined and filled, without a halo, so it does not melt into the footprint's. */
  private readonly addon = halo(0);
  /** A Z Pod's 8 places for the add-on being put (équilibreur 22/11), faint, green where free, red where taken. */
  private readonly slotMarks = Array.from({ length: 8 }, () => halo(0));
  /** Free wells while an extractor is placed: drawn over the models, so a well behind a building still shows. */
  private readonly wellMarks: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  private readonly pos = new Float32Array(N * N * 4 * 3);
  private readonly col = new Float32Array(N * N * 4 * 3);
  private readonly fade = new Float32Array(N * N * 4);
  private readonly heights = new Float32Array((N + 1) * (N + 1));

  /** An aimed spell's zone under the cursor: a ring its radius (the balancer, 2026-11-22: zones are radii). */
  private readonly zoneRing = new Mesh(new RingGeometry(0.94, 1, 72).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));

  constructor(scene: Scene, private readonly map: GameMap) {
    this.zoneRing.visible = false;
    this.zoneRing.renderOrder = 4;
    scene.add(this.zoneRing);
    const g = new BufferGeometry();
    const uv = new Float32Array(N * N * 4 * 2);
    const index = new Uint32Array(N * N * 6);
    for (let i = 0; i < N * N; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      index.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2], i * 6);
    }
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('fade', new BufferAttribute(this.fade, 1));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(new BufferAttribute(index, 1));
    this.cells = new Mesh(g, cellMaterial());
    this.cells.frustumCulled = false;
    this.cells.renderOrder = 2;
    this.group.add(this.cells, this.foot, this.addon, ...this.slotMarks);
    for (const m of this.slotMarks) m.visible = false;
    this.group.visible = false;
    scene.add(this.group);
  }

  /** The ring of a spell's zone of radius `r` round (x, z), or none. */
  zone(x: number, z: number, r: number): void {
    this.zoneRing.visible = true;
    this.zoneRing.position.set(x, heightAt(this.map, x, z) + 0.1, z);
    this.zoneRing.scale.set(r, 1, r);
  }

  noZone(): void {
    this.zoneRing.visible = false;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** The tiles without a footprint (an extractor with no well near the cursor yet). */
  noFootprint(): void {
    this.foot.visible = this.addon.visible = false;
  }

  /**
   * Redraws the tiles within `reach` of (cx, cy), each lit by `fits`. Meant to be called only when the cursor moves to
   * another tile (or the ground changes): the footprint alone moves every frame.
   */
  cellsAt(cx: number, cy: number, reach: number, fits: (x: number, y: number) => boolean): void {
    const r = Math.min(GRID_REACH, Math.max(4, Math.ceil(reach)));
    // Each corner's height once (four tiles share it).
    const side = 2 * r + 2;
    const h = this.heights;
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) h[j * side + i] = heightAt(this.map, cx - r + i, cy - r + j) + LIFT;
    let n = 0;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) continue;
        const c = fits(x, y) ? OK : NO;
        // Full near the cursor, gone at the reach's edge (a circle, so no square corner shows).
        const f = Math.max(0, 1 - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r);
        const corners = [x, y, x + 1, y, x + 1, y + 1, x, y + 1];
        for (let k = 0; k < 4; k++) {
          const px = corners[k * 2];
          const pz = corners[k * 2 + 1];
          this.pos.set([px, h[(pz - cy + r) * side + px - cx + r], pz], (n * 4 + k) * 3);
          this.col.set([c.r, c.g, c.b], (n * 4 + k) * 3);
          this.fade[n * 4 + k] = f * f * (3 - 2 * f);
        }
        n++;
      }
    }
    const g = this.cells.geometry;
    for (const a of ['position', 'color', 'fade']) g.getAttribute(a).needsUpdate = true;
    g.setDrawRange(0, n * 6);
    this.group.visible = true;
  }

  /** Marks these wells (top-left tiles, `size` wide) green over everything; none for another building. */
  wells(spots: [number, number][], size: number): void {
    while (this.wellMarks.length < spots.length) {
      const m = halo(1);
      this.wellMarks.push(m);
      this.group.add(m);
    }
    this.wellMarks.forEach((m, i) => {
      m.visible = i < spots.length;
      if (m.visible) place(m, this.map, spots[i][0], spots[i][1], size, true, 0.8);
    });
  }

  /** A Pod's 8 places for an add-on, all at once (none: hidden). */
  slots(list: { tx: number; ty: number; size: number; ok: boolean }[] | null): void {
    this.slotMarks.forEach((m, i) => {
      const s = list?.[i];
      m.visible = !!s;
      if (s) place(m, this.map, s.tx, s.ty, s.size, s.ok, 0.45);
    });
  }

  /** The footprint (tx, ty, size) under the cursor, and, for a Pod, its add-on's room (null: not shown). */
  footprint(tx: number, ty: number, size: number, ok: boolean, addon: { tx: number; ty: number; size: number; ok: boolean } | null): void {
    place(this.foot, this.map, tx, ty, size, ok, 1);
    this.foot.visible = true;
    this.addon.visible = !!addon;
    if (addon) place(this.addon, this.map, addon.tx, addon.ty, addon.size, addon.ok, 0.7);
    this.group.visible = true;
  }
}

const PAD = 1.2;

function halo(glowing: number): Mesh<PlaneGeometry, ShaderMaterial> {
  const m = new Mesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new ShaderMaterial({
      uniforms: { color: { value: new Color() }, size: { value: 1 }, strength: { value: 1 }, glowing: { value: glowing } },
      vertexShader: `
        uniform float size;
        varying vec2 vP;
        void main() {
          // In tiles from the footprint's corner, the pad round it included.
          vP = (uv - 0.5) * (size + 2.0 * ${PAD.toFixed(2)}) + 0.5 * size;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform float size;
        uniform float strength;
        uniform float glowing;
        varying vec2 vP;
        void main() {
          vec2 q = abs(vP - 0.5 * size) - 0.5 * size;
          float out_ = length(max(q, 0.0));
          float in_ = -max(q.x, q.y);
          float edge = out_ > 0.0 ? 0.0 : 1.0 - smoothstep(0.0, 0.12, in_);
          float fill = out_ > 0.0 ? 0.0 : 0.28;
          float glow = out_ > 0.0 ? glowing * 0.75 * exp(-3.2 * out_) : 0.0;
          gl_FragColor = vec4(color, strength * max(max(edge, fill), glow));
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    }),
  );
  m.renderOrder = 3;
  m.frustumCulled = false;
  return m;
}

function place(m: Mesh<PlaneGeometry, ShaderMaterial>, map: GameMap, tx: number, ty: number, size: number, ok: boolean, strength: number): void {
  const cx = tx + size / 2;
  const cz = ty + size / 2;
  m.position.set(cx, heightAt(map, cx, cz) + 0.12, cz);
  m.scale.set(size + 2 * PAD, 1, size + 2 * PAD);
  m.material.uniforms.color.value.copy(ok ? OK : NO);
  m.material.uniforms.size.value = size;
  m.material.uniforms.strength.value = strength;
}

function cellMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: `
      attribute vec3 color;
      attribute float fade;
      varying vec3 vColor;
      varying float vFade;
      varying vec2 vUv;
      void main() {
        vColor = color;
        vFade = fade;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying float vFade;
      varying vec2 vUv;
      void main() {
        // A line about 1.5 px wide whatever the zoom, along each tile's edges, over a faint wash of its colour.
        vec2 d = min(vUv, 1.0 - vUv) / max(fwidth(vUv), vec2(1e-4));
        float line = 1.0 - smoothstep(0.75, 1.75, min(d.x, d.y));
        gl_FragColor = vec4(vColor, vFade * max(0.85 * line, 0.07));
      }`,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}
