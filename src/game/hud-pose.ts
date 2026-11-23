/**
 * A building ordered: shown at once where it will rise, before its worker gets there (remark 91, touch screens). The
 * outline of its footprint, white, spreads out and fades, three waves one after the other (the user's choice of
 * 2026-11-23, among four prototypes).
 */
import { AdditiveBlending, Mesh, MeshBasicMaterial, type Scene, Shape, ShapeGeometry } from 'three';
import { type BuildingDef, DEFS } from '../data';
import { type GameMap, heightAt } from '../map';

/** A square frame one unit wide, its border this share of the side. */
const FRAME = (() => {
  const s = new Shape().moveTo(-0.5, -0.5).lineTo(0.5, -0.5).lineTo(0.5, 0.5).lineTo(-0.5, 0.5).lineTo(-0.5, -0.5);
  const i = 0.5 - 0.06;
  s.holes.push(new Shape().moveTo(-i, -i).lineTo(-i, i).lineTo(i, i).lineTo(i, -i).lineTo(-i, -i));
  return new ShapeGeometry(s);
})();
const WAVES = 3;
const GAP_MS = 140;
const LIFE_MS = 700;

export class PoseConfirm {
  private readonly shown: { mesh: Mesh; t0: number; size: number }[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly map: GameMap,
  ) {}

  /** The order to raise `type` at (tx, ty) was just given. */
  placed(type: string, tx: number, ty: number): void {
    const size = (DEFS[type] as BuildingDef).size;
    const cx = tx + size / 2;
    const cz = ty + size / 2;
    const y = heightAt(this.map, cx, cz) + 0.2;
    for (let i = 0; i < WAVES; i++) {
      const mesh = new Mesh(FRAME, new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(cx, y, cz);
      mesh.scale.setScalar(size);
      this.scene.add(mesh);
      this.shown.push({ mesh, t0: performance.now() + i * GAP_MS, size });
    }
  }

  /** Each frame: spreads and fades each wave, and drops those that are over. */
  update(): void {
    const now = performance.now();
    for (let i = this.shown.length - 1; i >= 0; i--) {
      const s = this.shown[i];
      const k = (now - s.t0) / LIFE_MS;
      const mat = s.mesh.material as MeshBasicMaterial;
      if (k >= 1) {
        this.scene.remove(s.mesh);
        mat.dispose();
        this.shown.splice(i, 1);
        continue;
      }
      s.mesh.scale.setScalar(s.size * (1 + 0.6 * Math.max(0, k)));
      mat.opacity = k < 0 ? 0 : 0.95 * (1 - k);
    }
  }
}
