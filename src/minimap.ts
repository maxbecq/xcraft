import type { CameraRig } from './camera';
import { TEAM_COLORS } from './render/units';
import { FP } from './sim/fixed';
import type { Entity, World } from './sim/world';
import type { GameMap } from './map';
import { tileColor } from './terrain';

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
  /** Left-click hook (e.g. attack-move); return true to keep the camera still. */
  intercept: (x: number, y: number) => boolean = () => false;

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

    const point = (e: PointerEvent) => this.toMap.transformPoint(new DOMPoint(e.offsetX, e.offsetY));
    const move = (e: PointerEvent) => {
      const p = point(e);
      this.rig.lookAt(p.x, p.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      const p = point(e);
      if (e.button === 2) return this.onOrder(p.x, p.y);
      if (this.intercept(p.x, p.y)) return;
      this.canvas.setPointerCapture(e.pointerId);
      move(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) move(e);
    });
  }

  /** Redraws the ground darkened by the player's fog of war. */
  fog(tiles: Uint8Array): void {
    const d = this.image.data;
    for (let i = 0; i < tiles.length; i++) {
      const f = tiles[i] === 2 ? 1 : tiles[i] === 1 ? 0.55 : 0.15;
      d[i * 4] = this.base[i * 4] * f;
      d[i * 4 + 1] = this.base[i * 4 + 1] * f;
      d[i * 4 + 2] = this.base[i * 4 + 2] * f;
    }
    this.tiles.getContext('2d')!.putImageData(this.image, 0, 0);
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
        ctx.fillStyle = e.type === 'minerai' ? '#7fd8ff' : '#c08bff';
        ctx.fillRect(e.tx, e.ty, e.type === 'puits' ? 3 : 1, e.type === 'puits' ? 3 : 1);
        continue;
      }
      if (e.owner < 0 || !sees(e)) continue;
      ctx.fillStyle = `#${TEAM_COLORS[e.owner].toString(16).padStart(6, '0')}`;
      const s = Math.max(1.5, (e.radius * 2) / FP);
      ctx.fillRect(e.x / FP - s / 2, e.y / FP - s / 2, s, s);
    }

    ctx.beginPath();
    for (const p of this.rig.footprint()) ctx.lineTo(p.x, p.z);
    ctx.closePath();
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}
