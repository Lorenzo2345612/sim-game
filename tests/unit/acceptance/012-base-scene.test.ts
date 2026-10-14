import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../../../src/render/sceneSetup';

function within(actual: number, expected: number, tol = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

const HALF_PI = Math.PI / 2;

describe('012 base scene acceptance', () => {
  it('AT1: createScene runs in Node without WebGL and has Fog plus sky-blue Color background', () => {
    const { scene } = createScene();
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHexString()).toBe('9ec9f0');
  });

  it('AT2: scene contains the returned sun DirectionalLight at (300, 500, 200)', () => {
    const { scene, sun } = createScene();
    expect(sun).toBeInstanceOf(THREE.DirectionalLight);
    expect(scene.children).toContain(sun);
    within(sun.position.x, 300);
    within(sun.position.y, 500);
    within(sun.position.z, 200);
  });

  it('AT3: ground is named, rotated -PI/2 and at y 0', () => {
    const { scene, ground } = createScene();
    expect(ground.name).toBe('ground');
    within(ground.rotation.x, -HALF_PI);
    within(ground.position.y, 0);
    expect(scene.children).toContain(ground);
  });

  it('AT4: camera has fov 60, near 0.1 and far 5000', () => {
    const { camera } = createScene();
    within(camera.fov, 60);
    within(camera.near, 0.1);
    within(camera.far, 5000);
  });
});
