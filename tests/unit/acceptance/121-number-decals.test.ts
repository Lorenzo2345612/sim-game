import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { decalAnchors, numberTexture } from '../../../src/render/numberDecal';

const BOUNDS = new THREE.Box3(new THREE.Vector3(-0.9, 0, -2.5), new THREE.Vector3(0.9, 1, 2.5));
const TOL = 1e-9;

function expectVec(
  actual: { x: number; y: number; z: number },
  ex: number,
  ey: number,
  ez: number,
): void {
  expect(Math.abs(actual.x - ex)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(actual.y - ey)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(actual.z - ez)).toBeLessThanOrEqual(TOL);
}

describe('121 number decals acceptance', () => {
  it('AT1: decalAnchors returns the exact left, right and nose anchors for the bounds (± 1e-9)', () => {
    const { left, right, nose } = decalAnchors(BOUNDS);
    expectVec(left.position, -0.9, 0.55, -0.25);
    expectVec(left.normal, -1, 0, 0);
    expectVec(right.position, 0.9, 0.55, -0.25);
    expectVec(right.normal, 1, 0, 0);
    expectVec(nose.position, 0, 1, -1.9);
    expectVec(nose.normal, 0, 1, 0);
  });

  it('AT2: numberTexture(7) called twice returns the same cached texture object', () => {
    const first = numberTexture(7);
    const second = numberTexture(7);
    expect(second).toBe(first);
  });
});
