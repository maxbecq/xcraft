import type { CameraRig } from './camera';
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
        img.data.set([c.r * 255, c.g * 255, c.b * 255, 255], (y * map.width + x) * 4);
      }
    }
    tctx.putImageData(img, 0, 0);

    // Fit the map's diagonal into the canvas; +45° puts the camera's far side at the top.
    this.scale = size / (Math.max(map.width, map.height) * Math.SQRT2);
    this.toCanvas = new DOMMatrix().translate(size / 2, size / 2).rotate(45).scale(this.scale).translate(-map.width / 2, -map.height / 2);
    this.toMap = this.toCanvas.inverse();

    const move = (e: PointerEvent) => {
      const p = this.toMap.transformPoint(new DOMPoint(e.offsetX, e.offsetY));
      this.rig.lookAt(p.x, p.y);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      move(e);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons & 1) move(e);
    });
  }

  draw(): void {
    const ctx = this.ctx;
    ctx.resetTransform();
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.toCanvas);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tiles, 0, 0);

    ctx.beginPath();
    for (const p of this.rig.footprint()) ctx.lineTo(p.x, p.z);
    ctx.closePath();
    ctx.lineWidth = 1.5 / this.scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
}
