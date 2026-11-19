import type { CameraRig } from './camera';
import { TEAM_COLORS } from './render/units';
import { FP } from './sim/fixed';
import type { Entity, World } from './sim/world';
import type { GameMap } from './map';
import { tileColor } from './terrain';

const PING_MS = 3000;

/** Top-down map, turned 45° to match the camera, showing the view and moving it on click. */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tiles: HTMLCanvasElement;
  private readonly toCanvas: DOMMatrix;
  private readonly toMap: DOMMatrix;
  private readonly scale: number;
  private readonly image: ImageData;
  private readonly base: Uint8ClampedArray;

  /** Called with a right-clicked map point, in tiles. */
  onOrder: (x: number, y: number) => void = () => {};
  /** Attack alerts: red rings spreading from the spot for a few seconds. */
  private pings: { x: number; y: number; t: number }[] = [];
  /** Left-click hook (e.g. attack-move); return true to keep the camera still. */
  intercept: (x: number, y: number) => boolean = () => false;

  /** The player's fog of war as last drawn (0 never explored, 1 explored, 2 in sight). */
  private known?: Uint8Array;

  constructor(map: GameMap, private readonly rig: CameraRig, size = 200) {
    this.canvas.width = this.canvas.height = size;
    this.canvas.className = 'minimap';
    this.ctx = this.canvas.getContext('2d')!;

    // One pixel per tile, drawn once.
    this.tiles = document.createElement('canvas');
    this.tiles.width = map.width;
    this.tiles.height = map.height;
    const tctx = this.tiles.getContext('2d')!;
    const img = tctx.createImageData(map.width, map.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const c = tileColor(map, x, y);
        // Cliff edges drawn dark, like a relief map.
        const l = map.level[y * map.width + x];
        const edge = [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx;
          const ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.level[ny * map.width + nx] < l && !map.ramp[ny * map.width + nx];
        });
        if (edge) c.multiplyScalar(0.45);
        img.data.set([c.r * 255, c.g * 255, c.b * 255, 255], (y * map.width + x) * 4);
      }
    }
    tctx.putImageData(img, 0, 0);
    this.image = img;
    this.base = img.data.slice();

    // Fit the map's diagonal into the canvas; +45° puts the camera's far side at the top.
    this.scale = size / (Math.max(map.width, map.height) * Math.SQRT2);
    this.toCanvas = new DOMMatrix().translate(size / 2, size / 2).rotate(45).scale(this.scale).translate(-map.width / 2, -map.height / 2);
    this.toMap = this.toCanvas.inverse();

    // The canvas may be drawn smaller than its pixel size (phones): scale the click back.
    const point = (e: PointerEvent) => this.toMap.transformPoint(new DOMPoint((e.offsetX * this.canvas.width) / this.canvas.clientWidth, (e.offsetY * this.canvas.height) / this.canvas.clientHeight));
    const move = (e: PointerEvent) => {
      const p = point(e);
      this.rig.lookAt(p.x, p.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = point(e);
      if (e.button === 2) return this.onOrder(p.x, p.y);
      if (this.intercept(p.x, p.y)) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // a held pointer (Pointer Lock) refuses capture: game/pointerlock.ts keeps the press on this canvas
      }
      move(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) move(e);
    });
  }

  /** Redraws the ground darkened by the player's fog of war. */
  fog(tiles: Uint8Array): void {
    this.known = tiles;
    const d = this.image.data;
    // Grey where explored but out of sight (as on the terrain, FOG_GLSL); where never explored, the map's layout
    // stays readable, very dark (the terrain itself is black there).
    for (let i = 0; i < tiles.length; i++) {
      const [r, g, b] = [this.base[i * 4], this.base[i * 4 + 1], this.base[i * 4 + 2]];
      const grey = (0.3 * r + 0.59 * g + 0.11 * b) * 0.55;
      const [cr, cg, cb] = tiles[i] === 2 ? [r, g, b] : tiles[i] === 1 ? [grey, grey, grey] : [r * 0.35, g * 0.35, b * 0.35];
      d[i * 4] = cr;
      d[i * 4 + 1] = cg;
      d[i * 4 + 2] = cb;
    }
    this.tiles.getContext('2d')!.putImageData(this.image, 0, 0);
  }

  ping(x: number, y: number): void {
    this.pings.push({ x, y, t: performance.now() });
  }

  draw(world: World, sees: (e: Entity) => boolean): void {
    const ctx = this.ctx;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.toCanvas);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tiles, 0, 0);

    for (const e of world.entities.values()) {
      if (e.type === 'minerai' || e.type === 'puits') {
        // Only once found: dimmed while out of sight, hidden where never explored.
        const state = this.known?.[e.ty * this.tiles.width + e.tx] ?? 2;
        if (!state) continue;
        ctx.globalAlpha = state === 2 ? 1 : 0.45;
        ctx.fillStyle = e.type === 'minerai' ? '#ffb060' : '#c08bff';
        ctx.fillRect(e.tx, e.ty, e.type === 'puits' ? 3 : 1, e.type === 'puits' ? 3 : 1);
        ctx.globalAlpha = 1;
        continue;
      }
      if (e.owner < 0 || !sees(e)) continue;
      ctx.fillStyle = `#${TEAM_COLORS[e.owner].toString(16).padStart(6, '0')}`;
      const s = Math.max(1.5, (e.radius * 2) / FP);
      ctx.fillRect(e.x / FP - s / 2, e.y / FP - s / 2, s, s);
    }

    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < PING_MS);
    ctx.lineWidth = 2 / this.scale;
    for (const p of this.pings) {
      for (const lag of [0, 0.5]) {
        const k = ((now - p.t) / 1000 + lag) % 1; // two rings a second, each growing and fading
        ctx.strokeStyle = `rgba(255, 60, 40, ${1 - k})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2 + k * 10, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.beginPath();
    for (const p of this.rig.footprint()) ctx.lineTo(p.x, p.z);
    ctx.closePath();
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}
