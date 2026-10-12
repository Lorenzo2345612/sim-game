import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ChaseCamera,
  computeChaseTarget,
  type ChaseTarget,
} from '../../../src/render/chaseCamera';
import type { Quat, Vec3, VehicleState, WheelState } from '../../../src/core/types';

function within(actual: number, expected: number, tol = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

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

function freshOut(): ChaseTarget {
  return { position: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } };
}

function freshPrevForward(): Vec3 {
  return { x: 0, y: 0, z: -1 };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
}

describe('015 chase camera acceptance', () => {
  it('AT1: car at origin facing -Z gives position (0, 2.2, 6) and lookAt (0, 0.8, -4)', () => {
    const out = computeChaseTarget({ ...ORIGIN }, { ...IDENTITY }, freshPrevForward(), freshOut());
    within(out.position.x, 0);
    within(out.position.y, 2.2);
    within(out.position.z, 6);
    within(out.lookAt.x, 0);
    within(out.lookAt.y, 0.8);
    within(out.lookAt.z, -4);
  });

  it('AT2: yaw pi/2 (faces -X) puts the chase position at (6, 2.2, 0)', () => {
    const out = computeChaseTarget({ ...ORIGIN }, yawQuat(Math.PI / 2), freshPrevForward(), freshOut());
    within(out.position.x, 6);
    within(out.position.y, 2.2);
    within(out.position.z, 0);
  });

  it('AT3: pitch-90-deg quaternion (forward +Y) falls back to previousForward (0,0,-1)', () => {
    const s = Math.sin(Math.PI / 4);
    const q: Quat = { x: s, y: 0, z: 0, w: Math.cos(Math.PI / 4) };
    const out = computeChaseTarget({ ...ORIGIN }, q, freshPrevForward(), freshOut());
    within(out.position.x, 0);
    within(out.position.y, 2.2);
    within(out.position.z, 6);
  });

  it('AT4: two 1/60 updates and one 1/30 update agree within 2 % of the target travel', () => {
    const cameraA = makeCamera();
    const cameraB = makeCamera();
    const chaseA = new ChaseCamera(cameraA);
    const chaseB = new ChaseCamera(cameraB);
    chaseA.snap(makeState({ ...ORIGIN }, 0));
    chaseB.snap(makeState({ ...ORIGIN }, 0));
    const stateB = makeState({ x: 10, y: 0, z: -20 }, 0);
    chaseA.update(stateB, 1 / 60);
    chaseA.update(stateB, 1 / 60);
    chaseB.update(stateB, 1 / 30);
    // both yaw 0, so the target travels exactly as far as the car
    const travel = Math.hypot(10, 0, -20);
    const d = Math.hypot(
      cameraA.position.x - cameraB.position.x,
      cameraA.position.y - cameraB.position.y,
      cameraA.position.z - cameraB.position.z,
    );
    expect(d).toBeLessThanOrEqual(0.02 * travel);
  });

  it('AT5: snap places camera.position exactly on the computed target', () => {
    const state = makeState({ x: 3, y: 0, z: -5 }, 0.7);
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(state);
    const expected = computeChaseTarget(
      { ...state.position },
      { ...state.rotation },
      freshPrevForward(),
      freshOut(),
    );
    within(camera.position.x, expected.position.x, 1e-9);
    within(camera.position.y, expected.position.y, 1e-9);
    within(camera.position.z, expected.position.z, 1e-9);
  });

  it('AT6: 600 updates at forwardSpeed 80 bring fov to 70 (+/-0.1)', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ ...ORIGIN }, 0, 0));
    const state = makeState({ ...ORIGIN }, 0, 80);
    for (let i = 0; i < 600; i++) {
      chase.update(state, 1 / 60);
    }
    within(camera.fov, 70, 0.1);
  });
});
