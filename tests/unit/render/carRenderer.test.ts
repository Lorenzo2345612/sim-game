import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CarRenderer, computeWheelQuaternion, WHEEL_NODE_NAMES } from '../../../src/render/carRenderer';
import type { Quat, VehicleState } from '../../../src/core/types';

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);

interface SceneOpts {
  omitBody?: boolean;
  omitWheel?: string;
}

function makeScene(opts: SceneOpts = {}): THREE.Object3D {
  const scene = new THREE.Object3D();
  if (!opts.omitBody) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    body.name = 'body';
    body.position.set(0.1, 0.2, 0.3);
    scene.add(body);
  }
  for (const name of WHEEL_NODE_NAMES) {
    if (name === opts.omitWheel) continue;
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
    wheel.name = name;
    wheel.position.set(0.9, 0.35, -1.4);
    scene.add(wheel);
  }
  return scene;
}

function makeState(positions: [number, number, number][]): VehicleState {
  return {
    position: { x: 0.7, y: 0.3, z: -1.2 },
    rotation: IDENTITY,
    forwardSpeed: 0,
    wheels: positions.map((p) => ({
      position: { x: p[0], y: p[1], z: p[2] },
      steering: 0,
      rotation: 0,
      inContact: true,
    })),
  };
}

describe('CarRenderer.fromGltfScene', () => {
  it('builds root with body and wheels', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    expect(renderer.root.children).toHaveLength(5);
    expect(renderer.root.children[0].getObjectByName('body')).not.toBeNull();
    WHEEL_NODE_NAMES.forEach((name, i) => {
      expect(renderer.root.children[i + 1].getObjectByName(name)).not.toBeNull();
    });
  });

  it('throws on missing wheel', () => {
    expect(() => CarRenderer.fromGltfScene(makeScene({ omitWheel: 'wheel-back-right' }))).toThrow(
      'Missing node: wheel-back-right',
    );
  });

  it('throws on missing body', () => {
    expect(() => CarRenderer.fromGltfScene(makeScene({ omitBody: true }))).toThrow('Missing node: body');
  });
});

describe('CarRenderer.update', () => {
  it('places wheels at state positions and the body at state position', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const positions: [number, number, number][] = [
      [1.5, 0.2, -3.1],
      [-0.7, 0.35, 2.4],
      [0.25, -1.1, -0.9],
      [3.3, 0.05, 1.8],
    ];
    const state = makeState(positions);
    renderer.update(state);

    WHEEL_NODE_NAMES.forEach((_, i) => {
      const world = renderer.root.children[i + 1].getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(positions[i][0], 4);
      expect(world.y).toBeCloseTo(positions[i][1], 4);
      expect(world.z).toBeCloseTo(positions[i][2], 4);
    });
    const body = renderer.root.children[0].getWorldPosition(new THREE.Vector3());
    expect(body.x).toBeCloseTo(state.position.x, 4);
    expect(body.y).toBeCloseTo(state.position.y, 4);
    expect(body.z).toBeCloseTo(state.position.z, 4);
  });
});

describe('computeWheelQuaternion', () => {
  it('identity is Ry(pi)', () => {
    const q = computeWheelQuaternion(IDENTITY, 0, 0, new THREE.Quaternion());
    const expected = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);
    expect(Math.abs(q.x)).toBeCloseTo(Math.abs(expected.x), 5);
    expect(Math.abs(q.y)).toBeCloseTo(Math.abs(expected.y), 5);
    expect(Math.abs(q.z)).toBeCloseTo(Math.abs(expected.z), 5);
    expect(Math.abs(q.w)).toBeCloseTo(Math.abs(expected.w), 5);
  });

  it('steering adds yaw', () => {
    const q0 = computeWheelQuaternion(IDENTITY, 0, 0, new THREE.Quaternion());
    const q1 = computeWheelQuaternion(IDENTITY, 0.3, 0, new THREE.Quaternion());
    const delta = q1.clone().multiply(q0.clone().invert());
    const expected = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, 0.3);
    expect(delta.angleTo(expected)).toBeLessThan(1e-5);
  });

  it('returns out', () => {
    const out = new THREE.Quaternion();
    expect(computeWheelQuaternion(IDENTITY, 0.2, 1.5, out)).toBe(out);
  });
});

describe('CarRenderer.dispose', () => {
  it('does not throw and disposes geometry', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const body = renderer.root.getObjectByName('body') as THREE.Mesh;
    const spy = vi.spyOn(body.geometry, 'dispose');
    expect(() => renderer.dispose()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
