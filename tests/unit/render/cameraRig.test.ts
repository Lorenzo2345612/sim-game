import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraRig, COCKPIT_FOV, COCKPIT_OFFSET, TCAM_OFFSET } from '../../../src/render/cameraRig';
import { CHASE_DISTANCE, CHASE_HEIGHT } from '../../../src/render/chaseCamera';
import type { Quat, Vec3, VehicleState, WheelState } from '../../../src/core/types';

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

function makeState(position: Vec3, yaw: number, forwardSpeed = 0): VehicleState {
  const wheels: WheelState[] = [0, 1, 2, 3].map(() => ({
    position: { x: 0, y: 0, z: 0 },
    steering: 0,
    rotation: 0,
    inContact: false,
  }));
  return { position, rotation: yawQuat(yaw), forwardSpeed, wheels };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
}

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

describe('CameraRig', () => {
  it('starts in chase mode with the camera fov unchanged', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    expect(rig.mode).toBe('chase');
    expect(camera.fov).toBe(60);
  });

  it('chase delegates to ChaseCamera: first update snaps behind the car', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.update(makeState({ x: 10, y: 0, z: -20 }, 0), 1 / 120);
    expect(camera.position.x).toBeCloseTo(10, 5);
    expect(camera.position.y).toBeCloseTo(CHASE_HEIGHT, 5);
    expect(camera.position.z).toBeCloseTo(-20 + CHASE_DISTANCE, 5);
  });

  it('chase keeps its speed-based fov range (60 at rest)', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    rig.next();
    rig.next();
    expect(rig.mode).toBe('chase');
    expect(camera.fov).toBe(60);
    const state = makeState(ORIGIN, 0, 0);
    for (let i = 0; i < 60; i++) rig.update(state, 1 / 60);
    expect(camera.fov).toBeCloseTo(60, 9);
  });

  it('tcam follows the car position with the offset', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    rig.update(makeState({ x: 10, y: 2, z: -5 }, 0), 1 / 120);
    expect(camera.position.x).toBeCloseTo(10 + TCAM_OFFSET.x, 5);
    expect(camera.position.y).toBeCloseTo(2 + TCAM_OFFSET.y, 5);
    expect(camera.position.z).toBeCloseTo(-5 + TCAM_OFFSET.z, 5);
  });

  it('cockpit offset rotates with the car yaw', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    rig.next();
    rig.update(makeState(ORIGIN, Math.PI / 2), 1 / 120);
    expect(camera.position.x).toBeCloseTo(COCKPIT_OFFSET.z, 5);
    expect(camera.position.y).toBeCloseTo(COCKPIT_OFFSET.y, 5);
    expect(camera.position.z).toBeCloseTo(-COCKPIT_OFFSET.x, 5);
  });

  it('tcam orientation matches the car rotation (looks along -Z forward)', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    const yaw = Math.PI / 2;
    rig.update(makeState(ORIGIN, yaw), 1 / 120);
    // yaw pi/2 faces the car toward -X (yaw = atan2(-dx, -dz))
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    expect(fwd.x).toBeCloseTo(-1, 5);
    expect(fwd.y).toBeCloseTo(0, 5);
    expect(fwd.z).toBeCloseTo(0, 5);
  });

  it('fov restores to the initial value when leaving cockpit', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.next();
    expect(camera.fov).toBe(60);
    rig.next();
    expect(camera.fov).toBe(COCKPIT_FOV);
    rig.next();
    expect(camera.fov).toBe(60);
  });

  it('assigning mode directly applies the fov', () => {
    const camera = makeCamera();
    const rig = new CameraRig(camera);
    rig.mode = 'cockpit';
    expect(camera.fov).toBe(COCKPIT_FOV);
    rig.mode = 'tcam';
    expect(camera.fov).toBe(60);
  });

  it('next() returns the new mode and matches the mode property', () => {
    const rig = new CameraRig(makeCamera());
    expect(rig.next()).toBe(rig.mode);
    expect(rig.next()).toBe(rig.mode);
    expect(rig.next()).toBe(rig.mode);
    expect(rig.mode).toBe('chase');
  });

  it('dispose does not throw', () => {
    const rig = new CameraRig(makeCamera());
    expect(() => rig.dispose()).not.toThrow();
  });
});
