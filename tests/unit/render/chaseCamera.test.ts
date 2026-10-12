import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ChaseCamera,
  computeChaseTarget,
  CHASE_DISTANCE,
  CHASE_HEIGHT,
  LOOK_AHEAD,
  LOOK_HEIGHT,
  type ChaseTarget,
} from '../../../src/render/chaseCamera';
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

function freshOut(): ChaseTarget {
  return { position: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

describe('computeChaseTarget', () => {
  it('target behind car at yaw 0', () => {
    const prev = { x: 0, y: 0, z: -1 };
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, yawQuat(0), prev, freshOut());
    expect(out.position.x).toBeCloseTo(0, 5);
    expect(out.position.y).toBeCloseTo(CHASE_HEIGHT, 5);
    expect(out.position.z).toBeCloseTo(CHASE_DISTANCE, 5);
    expect(out.lookAt.x).toBeCloseTo(0, 5);
    expect(out.lookAt.y).toBeCloseTo(LOOK_HEIGHT, 5);
    expect(out.lookAt.z).toBeCloseTo(-LOOK_AHEAD, 5);
  });

  it('target is on +X at yaw pi/2', () => {
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, yawQuat(Math.PI / 2), { x: 0, y: 0, z: -1 }, freshOut());
    expect(out.position.x).toBeCloseTo(CHASE_DISTANCE, 5);
    expect(out.position.y).toBeCloseTo(CHASE_HEIGHT, 5);
    expect(out.position.z).toBeCloseTo(0, 5);
  });

  it('target falls back to previous forward', () => {
    const s = Math.sin(Math.PI / 4);
    const qDown: Quat = { x: -s, y: 0, z: 0, w: Math.cos(Math.PI / 4) };
    const prev = { x: 1, y: 0, z: 0 };
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, qDown, prev, freshOut());
    expect(out.position.x).toBeCloseTo(-CHASE_DISTANCE, 5);
    expect(prev.x).toBe(1);
    expect(prev.y).toBe(0);
    expect(prev.z).toBe(0);

    const qUp: Quat = { x: s, y: 0, z: 0, w: Math.cos(Math.PI / 4) };
    const out2 = computeChaseTarget({ x: 0, y: 0, z: 0 }, qUp, { x: 0, y: 0, z: -1 }, freshOut());
    expect(out2.position.x).toBeCloseTo(0, 5);
    expect(out2.position.y).toBeCloseTo(CHASE_HEIGHT, 5);
    expect(out2.position.z).toBeCloseTo(CHASE_DISTANCE, 5);
  });
});

describe('ChaseCamera', () => {
  it('snap places camera exactly on target', () => {
    const state = makeState({ x: 3, y: 0, z: -5 }, 0.7);
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(state);
    const expected = computeChaseTarget(
      { ...state.position },
      { ...state.rotation },
      { x: 0, y: 0, z: -1 },
      freshOut(),
    );
    expect(camera.position.x).toBeCloseTo(expected.position.x, 9);
    expect(camera.position.y).toBeCloseTo(expected.position.y, 9);
    expect(camera.position.z).toBeCloseTo(expected.position.z, 9);
  });

  it('smoothing is framerate independent', () => {
    const cameraA = makeCamera();
    const cameraB = makeCamera();
    const chaseA = new ChaseCamera(cameraA);
    const chaseB = new ChaseCamera(cameraB);
    chaseA.snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    chaseB.snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    const stateB = makeState({ x: 10, y: 0, z: -20 }, 0);
    chaseA.update(stateB, 1 / 60);
    chaseA.update(stateB, 1 / 60);
    chaseB.update(stateB, 1 / 30);
    const targetTravel = distance({ x: 0, y: CHASE_HEIGHT, z: CHASE_DISTANCE }, { x: 10, y: CHASE_HEIGHT, z: -20 + CHASE_DISTANCE });
    const d = distance(cameraA.position, cameraB.position);
    expect(d).toBeLessThanOrEqual(0.02 * targetTravel);
  });

  it('update moves camera toward target', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    const startDist = camera.position.distanceTo({ x: 10, y: CHASE_HEIGHT, z: CHASE_DISTANCE - 20 });
    chase.update(makeState({ x: 10, y: 0, z: -20 }, 0), 1 / 60);
    const endDist = camera.position.distanceTo({ x: 10, y: CHASE_HEIGHT, z: CHASE_DISTANCE - 20 });
    expect(endDist).toBeLessThan(startDist);
    expect(endDist).toBeGreaterThan(0);
  });

  it('fov tends to 70 at 80 m/s', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0, 0));
    const state = makeState({ x: 0, y: 0, z: 0 }, 0, 80);
    for (let i = 0; i < 600; i++) {
      chase.update(state, 1 / 60);
    }
    expect(camera.fov).toBeGreaterThanOrEqual(69.9);
    expect(camera.fov).toBeLessThanOrEqual(70.1);
  });

  it('fov stays 60 at rest', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0, 0));
    const state = makeState({ x: 0, y: 0, z: 0 }, 0, 0);
    for (let i = 0; i < 60; i++) {
      chase.update(state, 1 / 60);
    }
    expect(camera.fov).toBeCloseTo(60, 9);
  });
});
