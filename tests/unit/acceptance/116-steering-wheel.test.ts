import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

// Task 116 lands src/render/steeringWheel.ts; the variable specifier keeps
// typecheck green until the module exists (the 158/160 pattern).
const STEERING_WHEEL_MODULE = '../../../src/render/steeringWheel';

type CreateSteeringWheel = (radius: number) => THREE.Group;
type SetSteeringWheelAngle = (group: THREE.Group, steer: number, lockDeg: number) => void;

async function loadSteeringWheel(): Promise<{
  createSteeringWheel: CreateSteeringWheel;
  setSteeringWheelAngle: SetSteeringWheelAngle;
}> {
  return (await import(STEERING_WHEEL_MODULE)) as {
    createSteeringWheel: CreateSteeringWheel;
    setSteeringWheelAngle: SetSteeringWheelAngle;
  };
}

function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    total += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
  });
  return total;
}

function boundingRadius(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let max = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      max = Math.max(max, v.length());
    }
  });
  return max;
}

describe('116 steering wheel acceptance', () => {
  it('AT1: createSteeringWheel(0.13) has <= 2000 triangles and bounding radius in [0.12, 0.16]', async () => {
    const { createSteeringWheel } = await loadSteeringWheel();
    const group = createSteeringWheel(0.13);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(countTriangles(group)).toBeLessThanOrEqual(2000);
    const radius = boundingRadius(group);
    expect(radius).toBeGreaterThanOrEqual(0.12);
    expect(radius).toBeLessThanOrEqual(0.16);
  });

  it('AT2: steer 1 at lock 270 gives -135 deg and steer -0.5 at lock 480 gives +120 deg in radians', async () => {
    const { createSteeringWheel, setSteeringWheelAngle } = await loadSteeringWheel();
    const group = createSteeringWheel(0.13);
    setSteeringWheelAngle(group, 1, 270);
    expect(Math.abs(group.rotation.z - (-135 * Math.PI) / 180)).toBeLessThanOrEqual(1e-9);
    setSteeringWheelAngle(group, -0.5, 480);
    expect(Math.abs(group.rotation.z - (120 * Math.PI) / 180)).toBeLessThanOrEqual(1e-9);
  });
});
