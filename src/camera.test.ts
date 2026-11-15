import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraRig, PITCH, isoOffset, screenToGround } from './camera';

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

  it('bounds the zoom', () => {
    const rig = new CameraRig(96, 96);
    rig.zoomBy(100);
    expect(rig.viewHeight).toBe(40);
    rig.zoomBy(0.0001);
    expect(rig.viewHeight).toBe(12);
  });
});
