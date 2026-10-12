import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { CarRenderer, computeWheelQuaternion, WHEEL_NODE_NAMES } from '../../../src/render/carRenderer';
import type { Quat, VehicleState, WheelState } from '../../../src/core/types';

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const qY = (a: number) => new THREE.Quaternion().setFromAxisAngle(Y_AXIS, a);
const qX = (a: number) => new THREE.Quaternion().setFromAxisAngle(X_AXIS, a);
const quatOf = (q: THREE.Quaternion): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w });

function makeScene(opts: { omitBody?: boolean; omitWheels?: string[] } = {}): THREE.Object3D {
  const scene = new THREE.Object3D();
  if (!opts.omitBody) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    body.name = 'body';
    body.position.set(0.1, 0.2, 0.3);
    scene.add(body);
  }
  for (const name of WHEEL_NODE_NAMES) {
    if (opts.omitWheels?.includes(name)) continue;
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
    wheel.name = name;
    wheel.position.set(0.9, 0.35, -1.4);
    scene.add(wheel);
  }
  return scene;
}

function makeWheel(over: Partial<WheelState> = {}): WheelState {
  return { position: { x: 0, y: 0, z: 0 }, steering: 0, rotation: 0, inContact: true, ...over };
}

function makeState(rotation: Quat, wheels: WheelState[]): VehicleState {
  return { position: { x: 1, y: 2, z: 3 }, rotation, forwardSpeed: 0, wheels };
}

describe('computeWheelQuaternion formula', () => {
  it('applies spin as Rx(-rotation) after the steering yaw', () => {
    const q = computeWheelQuaternion(IDENTITY, 0, 0.7, new THREE.Quaternion());
    const expected = qX(-0.7).multiply(qY(Math.PI));
    expect(q.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('matches the full chassis x Ry(steer) x Rx(-rot) x Ry(pi) order with tilted inputs', () => {
    const chassisQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 1, -0.2).normalize(), 0.5);
    const q = computeWheelQuaternion(quatOf(chassisQ), -0.3, -1.2, new THREE.Quaternion());
    const expected = chassisQ.clone().multiply(qY(-0.3)).multiply(qX(1.2)).multiply(qY(Math.PI));
    expect(q.angleTo(expected)).toBeLessThan(1e-6);
  });

  it('keeps a unit quaternion for a very large accumulated rotation', () => {
    const q = computeWheelQuaternion(IDENTITY, 0, 1000, new THREE.Quaternion());
    expect(q.length()).toBeCloseTo(1, 6);
    expect(Number.isNaN(q.x + q.y + q.z + q.w)).toBe(false);
  });

  it('overwrites out regardless of its previous value or reuse', () => {
    const out = new THREE.Quaternion().setFromAxisAngle(X_AXIS, 2.5);
    computeWheelQuaternion(IDENTITY, 0.1, 0.2, out);
    const q = computeWheelQuaternion(IDENTITY, 0.5, 0.9, out);
    const expected = qY(0.5).multiply(qX(-0.9)).multiply(qY(Math.PI));
    expect(q).toBe(out);
    expect(out.angleTo(expected)).toBeLessThan(1e-6);
  });
});

describe('CarRenderer.update quaternions', () => {
  it('rotates the body with state.rotation and orients each wheel group from chassis, steering and spin', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const chassisQ = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2);
    const wheels = [0, 1, 2, 3].map((i) =>
      makeWheel({ position: { x: i, y: 0.3, z: -i }, steering: 0.2 * i, rotation: 1.1 * i }),
    );
    renderer.update(makeState(quatOf(chassisQ), wheels));

    const carBody = renderer.root.children[0];
    expect(carBody.quaternion.angleTo(chassisQ)).toBeLessThan(1e-6);
    for (let i = 0; i < 4; i++) {
      const group = renderer.root.children[i + 1];
      const expected = computeWheelQuaternion(quatOf(chassisQ), wheels[i].steering, wheels[i].rotation, new THREE.Quaternion());
      expect(group.quaternion.angleTo(expected)).toBeLessThan(1e-6);
    }
  });

  it('leaves earlier wheels correct after later ones reuse the shared temporary', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const wheelsA = [0, 1, 2, 3].map((i) => makeWheel({ steering: 0.9, rotation: 4 - i }));
    renderer.update(makeState(IDENTITY, wheelsA));
    const firstA = renderer.root.children[1].quaternion.clone();

    const wheelsB = [0, 1, 2, 3].map(() => makeWheel());
    renderer.update(makeState(IDENTITY, wheelsB));
    const ryPi = qY(Math.PI);
    for (let i = 0; i < 4; i++) {
      expect(renderer.root.children[i + 1].quaternion.angleTo(ryPi)).toBeLessThan(1e-6);
    }

    renderer.update(makeState(IDENTITY, wheelsA));
    expect(renderer.root.children[1].quaternion.angleTo(firstA)).toBeLessThan(1e-6);
  });

  it('places the wheel mesh (not just its group) at the state position in world space', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const wheels = [0, 1, 2, 3].map((i) => makeWheel({ position: { x: -2 + i, y: 0.4, z: 5 - i } }));
    renderer.update(makeState(IDENTITY, wheels));
    for (let i = 0; i < 4; i++) {
      const mesh = renderer.root.children[i + 1].children[0];
      const world = mesh.getWorldPosition(new THREE.Vector3());
      expect(world.x).toBeCloseTo(wheels[i].position.x, 6);
      expect(world.y).toBeCloseTo(wheels[i].position.y, 6);
      expect(world.z).toBeCloseTo(wheels[i].position.z, 6);
    }
  });
});

describe('CarRenderer.fromGltfScene transforms', () => {
  it('reorients the body pivot (ry=pi, y=-0.45) and scales the body mesh by 1.6', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    const bodyPivot = renderer.root.children[0].children[0];
    expect(bodyPivot.rotation.y).toBeCloseTo(Math.PI, 6);
    expect(bodyPivot.position.y).toBeCloseTo(-0.45, 6);
    const body = bodyPivot.children[0];
    expect(body.name).toBe('body');
    expect(body.scale.x).toBeCloseTo(1.6, 6);
    expect(body.scale.y).toBeCloseTo(1.6, 6);
    expect(body.scale.z).toBeCloseTo(1.6, 6);
  });

  it('zeroes each wheel node position, scales it by 1.1 and parents it to its own wheel group', () => {
    const renderer = CarRenderer.fromGltfScene(makeScene());
    for (let i = 0; i < 4; i++) {
      const group = renderer.root.children[i + 1];
      expect(group.children).toHaveLength(1);
      const wheel = group.children[0];
      expect(wheel.name).toBe(WHEEL_NODE_NAMES[i]);
      expect(wheel.position.x).toBe(0);
      expect(wheel.position.y).toBe(0);
      expect(wheel.position.z).toBe(0);
      expect(wheel.scale.x).toBeCloseTo(1.1, 6);
      expect(wheel.scale.y).toBeCloseTo(1.1, 6);
      expect(wheel.scale.z).toBeCloseTo(1.1, 6);
    }
  });

  it('reports the missing body before any missing wheel', () => {
    expect(() => CarRenderer.fromGltfScene(makeScene({ omitBody: true, omitWheels: ['wheel-front-left'] }))).toThrow(
      'Missing node: body',
    );
  });

  it('reports the first missing wheel in WHEEL_NODE_NAMES order', () => {
    expect(() =>
      CarRenderer.fromGltfScene(makeScene({ omitWheels: ['wheel-back-right', 'wheel-front-left'] })),
    ).toThrow('Missing node: wheel-front-left');
  });
});

describe('CarRenderer.dispose resources', () => {
  it('disposes each material and the textures it references, including material arrays', () => {
    const scene = makeScene();
    const body = scene.getObjectByName('body') as THREE.Mesh;
    const texture = new THREE.Texture();
    const matA = new THREE.MeshStandardMaterial({ map: texture });
    const matB = new THREE.MeshStandardMaterial();
    body.material = [matA, matB];
    const renderer = CarRenderer.fromGltfScene(scene);

    const textureSpy = vi.spyOn(texture, 'dispose');
    const aSpy = vi.spyOn(matA, 'dispose');
    const bSpy = vi.spyOn(matB, 'dispose');
    renderer.dispose();

    expect(textureSpy).toHaveBeenCalledTimes(1);
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).toHaveBeenCalledTimes(1);
  });
});

describe('no allocation in hot paths', () => {
  it('update and computeWheelQuaternion contain no new operator', () => {
    expect(CarRenderer.prototype.update.toString()).not.toMatch(/\bnew\b/);
    expect(computeWheelQuaternion.toString()).not.toMatch(/\bnew\b/);
  });
});
