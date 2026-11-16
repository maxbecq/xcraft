import { OrthographicCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

// SC1-like fixed view: 45° yaw, ~35° pitch, orthographic.
export const YAW = Math.PI / 4;
export const PITCH = (35 * Math.PI) / 180;

const MIN_VIEW = 12;
const MAX_VIEW = 40;
/** Pan speed, in screen heights per second. */
const PAN_SPEED = 0.9;

/** Camera offset from the point it looks at, for a given distance. */
export function isoOffset(distance: number): Vector3 {
  return new Vector3(
    Math.sin(YAW) * Math.cos(PITCH),
    Math.sin(PITCH),
    Math.cos(YAW) * Math.cos(PITCH),
  ).multiplyScalar(distance);
}

/** Ground movement that shifts the view by (dx right, dy up) in screen units. */
export function screenToGround(dx: number, dy: number): { x: number; z: number } {
  const k = 1 / Math.sin(PITCH); // the ground is foreshortened vertically
  return {
    x: Math.cos(YAW) * dx - Math.sin(YAW) * dy * k,
    z: -Math.sin(YAW) * dx - Math.cos(YAW) * dy * k,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Orthographic camera looking at a ground point kept inside the map. */
export class CameraRig {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  readonly target = new Vector3();
  viewHeight = 20;
  private readonly raycaster = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);

  constructor(private readonly width: number, private readonly height: number) {}

  lookAt(x: number, z: number): void {
    this.target.set(clamp(x, 0, this.width), 0, clamp(z, 0, this.height));
  }

  /** dx, dy in -1..1: screen directions held by the player. */
  pan(dx: number, dy: number, dt: number): void {
    const g = screenToGround(dx, dy);
    const s = this.viewHeight * PAN_SPEED * dt;
    this.lookAt(this.target.x + g.x * s, this.target.z + g.z * s);
  }

  /** Drags the view by a finger movement, in screen pixels (the ground follows the finger). */
  panPixels(dx: number, dy: number): void {
    const perUnit = window.innerHeight / this.viewHeight;
    const g = screenToGround(-dx / perUnit, dy / perUnit);
    this.lookAt(this.target.x + g.x, this.target.z + g.z);
  }

  zoomBy(factor: number): void {
    this.viewHeight = clamp(this.viewHeight * factor, MIN_VIEW, MAX_VIEW);
  }

  update(aspect: number): void {
    const h = this.viewHeight / 2;
    Object.assign(this.camera, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(this.target).add(isoOffset(100));
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  /** Ground points under the four screen corners, clockwise from top-left. */
  footprint(): Vector3[] {
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => {
      this.raycaster.setFromCamera(new Vector2(x, y), this.camera);
      return this.raycaster.ray.intersectPlane(this.ground, new Vector3()) ?? new Vector3();
    });
  }
}
