import { describe, expect, it } from 'vitest';
import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { CameraRig, FLING_TAU, PITCH, isoOffset, screenToGround } from './camera';

describe('isoOffset', () => {
  it('keeps the requested distance', () => {
    expect(isoOffset(100).length()).toBeCloseTo(100);
  });

  it('looks down at the configured pitch', () => {
    expect(Math.asin(isoOffset(1).y)).toBeCloseTo(PITCH);
  });

  it('sits on the 45° diagonal', () => {
    const o = isoOffset(1);
    expect(o.x).toBeCloseTo(o.z);
  });
});

describe('screenToGround', () => {
  const rig = new CameraRig(96, 96);
  rig.update(1);
  // Where a ground displacement lands in camera space (x right, y up).
  const onScreen = (g: { x: number; z: number }) =>
    new Vector3(g.x, 0, g.z).transformDirection(rig.camera.matrixWorldInverse).multiplyScalar(Math.hypot(g.x, g.z));

  it('moves the view straight right', () => {
    const v = onScreen(screenToGround(1, 0));
    expect(v.x).toBeCloseTo(1);
    expect(v.y).toBeCloseTo(0);
  });

  it('moves the view straight up by one screen unit', () => {
    const v = onScreen(screenToGround(0, 1));
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(1);
  });
});

describe('CameraRig', () => {
  it('keeps the target inside the map', () => {
    const rig = new CameraRig(96, 96);
    rig.lookAt(-10, 200);
    expect(rig.target.x).toBe(0);
    expect(rig.target.z).toBe(96);
  });

  it('slides a flung view on by about speed × FLING_TAU, then stops', () => {
    Object.assign(globalThis, { window: { innerHeight: 1000 } });
    const rig = new CameraRig(96, 96);
    rig.lookAt(48, 48);
    const still = new CameraRig(96, 96);
    still.lookAt(48, 48);
    still.panPixels(1000 * FLING_TAU, 0); // where the slide should end
    rig.fling(1000, 0);
    for (let i = 0; i < 120; i++) rig.coast(1 / 60);
    expect(rig.target.distanceTo(still.target)).toBeLessThan(0.2); // within 10 %: frame steps and the stop threshold
    const end = rig.target.clone();
    rig.coast(1 / 60);
    expect(rig.target.equals(end)).toBe(true);
  });

  it('zooms towards the pointer: the ground under it stays put', () => {
    Object.assign(globalThis, { window: { innerWidth: 1600, innerHeight: 900 } });
    const rig = new CameraRig(96, 96);
    rig.lookAt(48, 48);
    rig.update(1600 / 900);
    const under = (px: number, py: number) => {
      const r = new Raycaster();
      r.setFromCamera(new Vector2((px / 1600) * 2 - 1, 1 - (py / 900) * 2), rig.camera);
      return r.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3())!;
    };
    const before = under(1200, 250);
    rig.zoomBy(0.8, 1200, 250);
    rig.update(1600 / 900);
    expect(rig.viewHeight).toBeCloseTo(17 * 0.8);
    expect(under(1200, 250).distanceTo(before)).toBeLessThan(1e-6);
  });

  it('zooms out to the whole map, at most', () => {
    const rig = new CameraRig(96, 96);
    rig.maxView = rig.overview(16 / 9);
    rig.zoomBy(100);
    expect(rig.viewHeight).toBeGreaterThan(((96 * Math.SQRT2) / (16 / 9)) * 1.1); // the map's width fits, with a margin
    expect(rig.viewHeight).toBeLessThan(100);
  });

  it('bounds the zoom', () => {
    const rig = new CameraRig(96, 96);
    rig.zoomBy(100);
    expect(rig.viewHeight).toBe(40);
    rig.zoomBy(0.0001);
    expect(rig.viewHeight).toBe(12);
  });
});
