import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, type CameraMode } from '../../../src/render/cameraRig';
import { shakeOffset } from '../../../src/render/cameraShake';
import type { Quat, VehicleState, WheelState } from '../../../src/core/types';

const MODES: CameraMode[] = ['chase', 'tcam', 'cockpit'];
const out = (): { y: number; roll: number } => ({ y: NaN, roll: NaN });

function maxAbsShake(amount: number, mode: CameraMode): { y: number; roll: number } {
  let maxY = 0;
  let maxRoll = 0;
  for (let k = 0; k < 120; k++) {
    const o = shakeOffset(amount, k / 120, mode, out());
    maxY = Math.max(maxY, Math.abs(o.y));
    maxRoll = Math.max(maxRoll, Math.abs(o.roll));
  }
  return { y: maxY, roll: maxRoll };
}

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function makeState(): VehicleState {
  const wheels: WheelState[] = [0, 1, 2, 3].map(() => ({
    position: { x: 0, y: 0, z: 0 },
    steering: 0,
    rotation: 0,
    inContact: false,
  }));
  return { position: { x: 1, y: 0, z: -5 }, rotation: yawQuat(0.4), forwardSpeed: 30, wheels };
}

function makeCockpitRig(): { rig: CameraRig; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const rig = new CameraRig(camera);
  rig.mode = 'cockpit';
  return { rig, camera };
}

describe('164 camera shake acceptance', () => {
  it('AT1: amount 0 gives y 0 and roll 0 in any mode', () => {
    for (const mode of MODES) {
      const o = shakeOffset(0, 0.37, mode, out());
      expect(o.y).toBe(0);
      expect(o.roll).toBe(0);
    }
  });

  it('AT2: amount 1 cockpit over k/120 keeps |y| in [0.009, 0.015] and |roll| in [0.003, 0.004]', () => {
    const { y, roll } = maxAbsShake(1, 'cockpit');
    expect(y).toBeLessThanOrEqual(0.015 + 1e-12);
    expect(y).toBeGreaterThanOrEqual(0.009);
    expect(roll).toBeLessThanOrEqual(0.004 + 1e-12);
    expect(roll).toBeGreaterThanOrEqual(0.003);
  });

  it('AT3: amount 1 chase over k/120 keeps |y| ≤ 0.0075', () => {
    expect(maxAbsShake(1, 'chase').y).toBeLessThanOrEqual(0.0075 + 1e-12);
  });

  it('AT4: amount 2 matches amount 1 and NaN gives y 0, roll 0', () => {
    const a1 = shakeOffset(1, 0.21, 'cockpit', out());
    const a2 = shakeOffset(2, 0.21, 'cockpit', out());
    expect(a2.y).toBeCloseTo(a1.y, 12);
    expect(a2.roll).toBeCloseTo(a1.roll, 12);
    const nan = shakeOffset(NaN, 0.21, 'cockpit', out());
    expect(nan.y).toBe(0);
    expect(nan.roll).toBe(0);
  });

  it('AT5: applyShake then update restores the plain-update pose (no accumulation)', () => {
    const state = makeState();
    const { rig, camera } = makeCockpitRig();
    rig.update(state, 1 / 120);
    const px = camera.position.x;
    const py = camera.position.y;
    const pz = camera.position.z;
    const qx = camera.quaternion.x;
    const qy = camera.quaternion.y;
    const qz = camera.quaternion.z;
    const qw = camera.quaternion.w;
    rig.applyShake(1, 0.21);
    rig.update(state, 1 / 120);
    expect(camera.position.x).toBeCloseTo(px, 9);
    expect(camera.position.y).toBeCloseTo(py, 9);
    expect(camera.position.z).toBeCloseTo(pz, 9);
    expect(camera.quaternion.x).toBeCloseTo(qx, 9);
    expect(camera.quaternion.y).toBeCloseTo(qy, 9);
    expect(camera.quaternion.z).toBeCloseTo(qz, 9);
    expect(camera.quaternion.w).toBeCloseTo(qw, 9);
  });

  it('AT6: setShakeScale(0) makes applyShake leave the camera position unchanged', () => {
    const state = makeState();
    const { rig, camera } = makeCockpitRig();
    rig.setShakeScale(0);
    rig.update(state, 1 / 120);
    const px = camera.position.x;
    const py = camera.position.y;
    const pz = camera.position.z;
    rig.applyShake(1, 0.21);
    expect(camera.position.x).toBeCloseTo(px, 9);
    expect(camera.position.y).toBeCloseTo(py, 9);
    expect(camera.position.z).toBeCloseTo(pz, 9);
  });
});
