import { OrthographicCamera, Vector3 } from 'three';

// SC1-like fixed view: 45° yaw, ~35° pitch, orthographic.
export const YAW = Math.PI / 4;
export const PITCH = (35 * Math.PI) / 180;

/** Camera offset from the point it looks at, for a given distance. */
export function isoOffset(distance: number): Vector3 {
  return new Vector3(
    Math.sin(YAW) * Math.cos(PITCH),
    Math.sin(PITCH),
    Math.cos(YAW) * Math.cos(PITCH),
  ).multiplyScalar(distance);
}

/** Orthographic camera showing `viewHeight` world units vertically. */
export function createIsoCamera(aspect: number, viewHeight: number, target = new Vector3()): OrthographicCamera {
  const h = viewHeight / 2;
  const camera = new OrthographicCamera(-h * aspect, h * aspect, h, -h, 0.1, 1000);
  camera.position.copy(target).add(isoOffset(100));
  camera.lookAt(target);
  return camera;
}
