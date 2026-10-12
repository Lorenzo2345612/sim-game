import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig, type CameraMode } from '../../../src/render/cameraRig';
import type { Quat, Vec3, VehicleState, WheelState } from '../../../src/core/types';

function within(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function makeState(position: Vec3, yaw: number): VehicleState {
  const wheels: WheelState[] = [0, 1, 2, 3].map(() => ({
    position: { x: 0, y: 0, z: 0 },
    steering: 0,
    rotation: 0,
    inContact: false,
  }));
  return { position, rotation: yawQuat(yaw), forwardSpeed: 0, wheels };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

describe('047 camera rig acceptance', () => {
  it('AT1: tcam with car at origin facing -Z gives position (0, 1.15, 0.6) relative and looks forward', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    expect(rig.next()).toBe('tcam');
    rig.update(makeState({ ...ORIGIN }, 0), 1 / 120);
    within(camera.position.x, 0, 0.01);
    within(camera.position.y, 1.15, 0.01);
    within(camera.position.z, 0.6, 0.01);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    within(fwd.x, 0, 1e-3);
    within(fwd.y, 0, 1e-3);
    within(fwd.z, -1, 1e-3);
  });

  it('AT2: cockpit gives position (0, 0.75, -0.2) relative and FOV 75', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    expect(rig.next()).toBe('cockpit');
    rig.update(makeState({ ...ORIGIN }, 0), 1 / 120);
    within(camera.position.x, 0, 0.01);
    within(camera.position.y, 0.75, 0.01);
    within(camera.position.z, -0.2, 0.01);
    expect(camera.fov).toBeCloseTo(75, 6);
  });

  it('AT3: next() cycles chase -> tcam -> cockpit -> chase', () => {
    const rig = new CameraRig(makeCamera());
    expect(rig.mode).toBe('chase');
    const sequence: CameraMode[] = [rig.next(), rig.next(), rig.next()];
    expect(sequence).toEqual(['tcam', 'cockpit', 'chase']);
    expect(rig.mode).toBe('chase');
  });

  it('AT4: tcam with car yawed pi/2 rotates the offset with the car to (0.6, 1.15, 0)', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    rig.update(makeState({ ...ORIGIN }, Math.PI / 2), 1 / 120);
    within(camera.position.x, 0.6, 0.01);
    within(camera.position.y, 1.15, 0.01);
    within(camera.position.z, 0, 0.01);
  });
});
