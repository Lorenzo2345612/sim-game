import { describe, it, expect, vi } from 'vitest';
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

function pitchQuat(pitch: number): Quat {
  return { x: Math.sin(pitch / 2), y: 0, z: 0, w: Math.cos(pitch / 2) };
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

function freshPrev(): Vec3 {
  return { x: 0, y: 0, z: -1 };
}

function makeCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
}

describe('computeChaseTarget edge cases', () => {
  it('writes into the provided out object and returns the same reference', () => {
    const out = freshOut();
    const posRef = out.position;
    const lookRef = out.lookAt;
    const ret = computeChaseTarget({ x: 1, y: 2, z: 3 }, yawQuat(0.4), freshPrev(), out);
    expect(ret).toBe(out);
    expect(ret.position).toBe(posRef);
    expect(ret.lookAt).toBe(lookRef);
  });

  it('overwrites previousForward with the normalised XZ forward', () => {
    const prev = { x: 0, y: 0.5, z: 0.5 };
    computeChaseTarget({ x: 0, y: 0, z: 0 }, yawQuat(Math.PI / 2), prev, freshOut());
    expect(prev.x).toBeCloseTo(-1, 9);
    expect(prev.y).toBe(0);
    expect(prev.z).toBeCloseTo(0, 9);
  });

  it('normalises the forward of a non-unit quaternion', () => {
    const r = Math.SQRT2;
    const prev = freshPrev();
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, { x: 0, y: r, z: 0, w: r }, prev, freshOut());
    // fx = -4, fz = 3, len = 5 -> fwd = (-0.8, 0, 0.6)
    expect(out.position.x).toBeCloseTo(4.8, 9);
    expect(out.position.y).toBeCloseTo(CHASE_HEIGHT, 9);
    expect(out.position.z).toBeCloseTo(-3.6, 9);
    expect(prev.x).toBeCloseTo(-0.8, 9);
    expect(prev.z).toBeCloseTo(0.6, 9);
    expect(Math.hypot(prev.x, prev.y, prev.z)).toBeCloseTo(1, 9);
  });

  it('falls back when projected length is just below 1e-3', () => {
    const q = pitchQuat(Math.PI / 2 - 1e-4);
    const prev = { x: 1, y: 0, z: 0 };
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, q, prev, freshOut());
    expect(out.position.x).toBeCloseTo(-CHASE_DISTANCE, 9);
    expect(prev.x).toBe(1);
    expect(prev.y).toBe(0);
    expect(prev.z).toBe(0);
  });

  it('normalises when projected length is just above 1e-3', () => {
    const q = pitchQuat(Math.PI / 2 - 5e-3);
    const prev = { x: 1, y: 0, z: 0 };
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, q, prev, freshOut());
    expect(out.position.x).toBeCloseTo(0, 9);
    expect(out.position.z).toBeCloseTo(CHASE_DISTANCE, 9);
    expect(prev.x).toBeCloseTo(0, 9);
    expect(prev.z).toBeCloseTo(-1, 9);
  });

  it('fallback keeps the y component of previousForward', () => {
    const prev = { x: 0, y: 1, z: 0 };
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, pitchQuat(Math.PI / 2), prev, freshOut());
    expect(out.position.x).toBeCloseTo(0, 9);
    expect(out.position.y).toBeCloseTo(-CHASE_DISTANCE + CHASE_HEIGHT, 9);
    expect(out.position.z).toBeCloseTo(0, 9);
    expect(out.lookAt.y).toBeCloseTo(LOOK_AHEAD + LOOK_HEIGHT, 9);
  });

  it('a later degenerate rotation reuses the forward stored by an earlier update', () => {
    const prev = freshPrev();
    computeChaseTarget({ x: 0, y: 0, z: 0 }, yawQuat(Math.PI / 2), prev, freshOut());
    const out = computeChaseTarget({ x: 0, y: 0, z: 0 }, pitchQuat(Math.PI / 2), prev, freshOut());
    expect(out.position.x).toBeCloseTo(CHASE_DISTANCE, 9);
  });
});

describe('ChaseCamera edge cases', () => {
  it('first update() snaps without smoothing', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    const state = makeState({ x: 2, y: 0, z: -3 }, 0.5, 40);
    chase.update(state, 1 / 60);
    const expected = computeChaseTarget(
      { ...state.position },
      { ...state.rotation },
      freshPrev(),
      freshOut(),
    );
    expect(camera.position.x).toBeCloseTo(expected.position.x, 9);
    expect(camera.position.y).toBeCloseTo(expected.position.y, 9);
    expect(camera.position.z).toBeCloseTo(expected.position.z, 9);
    expect(camera.fov).toBeCloseTo(65, 9);
  });

  it('update with dt 0 leaves camera unchanged', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    chase.update(makeState({ x: 10, y: 0, z: -20 }, 0, 80), 0);
    expect(camera.position.x).toBeCloseTo(0, 9);
    expect(camera.position.y).toBeCloseTo(CHASE_HEIGHT, 9);
    expect(camera.position.z).toBeCloseTo(CHASE_DISTANCE, 9);
    expect(camera.fov).toBeCloseTo(60, 9);
  });

  it('a very large dt reaches the target exactly', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    chase.update(makeState({ x: 10, y: 0, z: -20 }, 0, 80), 1000);
    expect(camera.position.x).toBeCloseTo(10, 9);
    expect(camera.position.y).toBeCloseTo(CHASE_HEIGHT, 9);
    expect(camera.position.z).toBeCloseTo(-20 + CHASE_DISTANCE, 9);
    expect(camera.fov).toBeCloseTo(70, 9);
  });

  it('snap aims the camera at the look point', () => {
    const camera = makeCamera();
    new ChaseCamera(camera).snap(makeState({ x: 0, y: 0, z: 0 }, 0));
    const dx = 0;
    const dy = LOOK_HEIGHT - CHASE_HEIGHT;
    const dz = -LOOK_AHEAD - CHASE_DISTANCE;
    const len = Math.hypot(dx, dy, dz);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.y).toBeCloseTo(dy / len, 6);
    expect(dir.z).toBeCloseTo(dz / len, 6);
  });

  it('fov clamps to 70 for high speeds of either sign', () => {
    const camA = makeCamera();
    new ChaseCamera(camA).snap(makeState({ x: 0, y: 0, z: 0 }, 0, 160));
    expect(camA.fov).toBeCloseTo(70, 9);
    const camB = makeCamera();
    new ChaseCamera(camB).snap(makeState({ x: 0, y: 0, z: 0 }, 0, -160));
    expect(camB.fov).toBeCloseTo(70, 9);
  });

  it('fov scales linearly with mid-range speeds', () => {
    const camA = makeCamera();
    new ChaseCamera(camA).snap(makeState({ x: 0, y: 0, z: 0 }, 0, 40));
    expect(camA.fov).toBeCloseTo(65, 9);
    const camB = makeCamera();
    new ChaseCamera(camB).snap(makeState({ x: 0, y: 0, z: 0 }, 0, -20));
    expect(camB.fov).toBeCloseTo(62.5, 9);
  });

  it('update calls updateProjectionMatrix once when the fov change exceeds 0.01', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0, 0));
    const spy = vi.spyOn(camera, 'updateProjectionMatrix');
    chase.update(makeState({ x: 0, y: 0, z: 0 }, 0, 80), 1 / 60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(camera.fov).toBeCloseTo(60 + 10 * (1 - Math.exp(-3 / 60)), 9);
  });

  it('update stops calling updateProjectionMatrix once the fov change is under 0.01', () => {
    const camera = makeCamera();
    const chase = new ChaseCamera(camera);
    chase.snap(makeState({ x: 0, y: 0, z: 0 }, 0, 0));
    const state = makeState({ x: 0, y: 0, z: 0 }, 0, 80);
    for (let i = 0; i < 120; i++) chase.update(state, 1 / 60);
    const spy = vi.spyOn(camera, 'updateProjectionMatrix');
    const before = camera.fov;
    chase.update(state, 1 / 60);
    expect(camera.fov).toBeGreaterThan(before);
    expect(camera.fov).toBeLessThan(70);
    expect(spy).toHaveBeenCalledTimes(0);
  });
});
