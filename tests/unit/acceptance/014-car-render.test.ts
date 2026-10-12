import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CarRenderer, computeWheelQuaternion, WHEEL_NODE_NAMES } from '../../../src/render/carRenderer';
import type { Quat, VehicleState } from '../../../src/core/types';

function within(actual: number, expected: number, tol = 1e-6): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function makeFakeScene(opts?: { omitWheelBackRight?: boolean }): THREE.Object3D {
  const scene = new THREE.Object3D();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  body.name = 'body';
  body.position.set(0, 0.1, 0);
  scene.add(body);
  for (const name of WHEEL_NODE_NAMES) {
    if (name === 'wheel-back-right' && opts?.omitWheelBackRight) continue;
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
    wheel.name = name;
    wheel.position.set(0.9, 0.35, -1.4);
    scene.add(wheel);
  }
  return scene;
}

describe('014 car render acceptance', () => {
  it('AT1: fromGltfScene builds an instance whose root has the body group plus 4 wheel groups', () => {
    const renderer = CarRenderer.fromGltfScene(makeFakeScene());
    expect(renderer).toBeInstanceOf(CarRenderer);
    const children = renderer.root.children;
    expect(children.length).toBe(5);
    expect(children.every((c) => c instanceof THREE.Group)).toBe(true);
    expect(children[0].getObjectByName('body')).not.toBeNull();
    WHEEL_NODE_NAMES.forEach((name, i) => {
      expect(children[i + 1].getObjectByName(name)).not.toBeNull();
    });
  });

  it('AT2: fromGltfScene throws Missing node on a scene without wheel-back-right', () => {
    expect(() => CarRenderer.fromGltfScene(makeFakeScene({ omitWheelBackRight: true }))).toThrow(
      'Missing node: wheel-back-right',
    );
  });

  it('AT3: update places each wheel group at the state wheel position and the body at state position', () => {
    const renderer = CarRenderer.fromGltfScene(makeFakeScene());
    const positions: [number, number, number][] = [
      [1.5, 0.2, -3.1],
      [-0.7, 0.35, 2.4],
      [0.25, -1.1, -0.9],
      [3.3, 0.05, 1.8],
    ];
    const state: VehicleState = {
      position: { x: 0.7, y: 0.3, z: -1.2 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      forwardSpeed: 0,
      wheels: positions.map((p) => ({
        position: { x: p[0], y: p[1], z: p[2] },
        steering: 0,
        rotation: 0,
        inContact: true,
      })),
    };
    renderer.update(state);
    for (let i = 0; i < 4; i++) {
      const world = renderer.root.children[i + 1].getWorldPosition(new THREE.Vector3());
      within(world.x, positions[i][0]);
      within(world.y, positions[i][1]);
      within(world.z, positions[i][2]);
    }
    const bodyWorld = renderer.root.children[0].getWorldPosition(new THREE.Vector3());
    within(bodyWorld.x, state.position.x);
    within(bodyWorld.y, state.position.y);
    within(bodyWorld.z, state.position.z);
  });

  it('AT4: computeWheelQuaternion with identity chassis, no steering and no rotation is Ry(pi)', () => {
    const out = computeWheelQuaternion(IDENTITY, 0, 0, new THREE.Quaternion());
    const expected = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);
    expect(out.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('AT5: steering 0.3 vs 0 gives a yaw difference of 0.3', () => {
    const q0 = computeWheelQuaternion(IDENTITY, 0, 0, new THREE.Quaternion());
    const q1 = computeWheelQuaternion(IDENTITY, 0.3, 0, new THREE.Quaternion());
    const delta = q1.multiply(q0.invert());
    const expected = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 0.3);
    expect(delta.angleTo(expected)).toBeLessThanOrEqual(1e-6);
  });

  it('AT6: the Kenney model and texture are copied into public/models', () => {
    expect(existsSync(fileURLToPath(new URL('../../../public/models/race.glb', import.meta.url)))).toBe(true);
    expect(
      existsSync(fileURLToPath(new URL('../../../public/models/Textures/colormap.png', import.meta.url))),
    ).toBe(true);
  });
});
