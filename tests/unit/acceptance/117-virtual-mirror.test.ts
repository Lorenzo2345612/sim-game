import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mirrorCameraPose } from '../../../src/render/mirror';

const TOL = 1e-9;

function within(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
}

function outPose(): { position: THREE.Vector3; forward: THREE.Vector3 } {
  return { position: new THREE.Vector3(), forward: new THREE.Vector3() };
}

describe('117 virtual mirror acceptance', () => {
  it('AT1: car at (10, 0, 5) with identity quat gives position (10, 1.0, 5.5) and forward (0, 0, +1)', () => {
    const out = outPose();
    mirrorCameraPose({ x: 10, y: 0, z: 5 }, { x: 0, y: 0, z: 0, w: 1 }, out);
    within(out.position.x, 10);
    within(out.position.y, 1.0);
    within(out.position.z, 5.5);
    within(out.forward.x, 0);
    within(out.forward.y, 0);
    within(out.forward.z, 1);
  });

  it('AT2: car yawed 90° about +Y gives forward = rotate((0, 0, 1))', () => {
    const yaw = Math.PI / 2;
    const quat = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const expected = new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w),
    );
    const out = outPose();
    mirrorCameraPose({ x: 0, y: 0, z: 0 }, quat, out);
    within(out.forward.x, expected.x);
    within(out.forward.y, expected.y);
    within(out.forward.z, expected.z);
  });
});
