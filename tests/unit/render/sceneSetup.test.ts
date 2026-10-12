import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createScene } from '../../../src/render/sceneSetup';

describe('createScene', () => {
  it('scene has fog and sky-blue background', () => {
    const { scene } = createScene();
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const fog = scene.fog as THREE.Fog;
    expect(fog.near).toBe(300);
    expect(fog.far).toBe(2500);
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHexString()).toBe('9ec9f0');
  });

  it('scene has at least two lights', () => {
    const { scene, sun } = createScene();
    const lights = scene.children.filter(
      (c) => (c as THREE.Object3D & { isLight?: boolean }).isLight === true,
    );
    expect(lights.length).toBeGreaterThanOrEqual(2);
    expect(lights.some((l) => l instanceof THREE.HemisphereLight)).toBe(true);
    expect(sun.position.x).toBe(300);
    expect(sun.position.y).toBe(500);
    expect(sun.position.z).toBe(200);
    expect(sun.castShadow).toBe(false);
  });

  it('ground is rotated and named', () => {
    const { scene, ground } = createScene();
    expect(ground.name).toBe('ground');
    expect(ground.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    expect(ground.position.y).toBe(0);
    expect(scene.children).toContain(ground);
  });

  it('camera has expected projection', () => {
    const { camera } = createScene();
    expect(camera.fov).toBe(60);
    expect(camera.near).toBe(0.1);
    expect(camera.far).toBe(5000);
    expect(camera.aspect).toBeCloseTo(16 / 9, 5);
    expect(camera.position.x).toBe(0);
    expect(camera.position.y).toBe(5);
    expect(camera.position.z).toBe(10);
  });

  it('camera is not added to the scene', () => {
    const { scene, camera } = createScene();
    expect(scene.children).not.toContain(camera);
  });

  it('sun is a directional light that is a scene child', () => {
    const { scene, sun } = createScene();
    expect(sun).toBeInstanceOf(THREE.DirectionalLight);
    expect(scene.children).toContain(sun);
    expect(sun.castShadow).toBe(false);
  });

  it('ground uses a 6000x6000 plane with the standard green material', () => {
    const { ground } = createScene();
    const geometry = ground.geometry as THREE.PlaneGeometry;
    expect(geometry).toBeInstanceOf(THREE.PlaneGeometry);
    expect(geometry.parameters.width).toBe(6000);
    expect(geometry.parameters.height).toBe(6000);
    const material = ground.material as THREE.MeshStandardMaterial;
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.color.getHexString()).toBe('4f7a3a');
    expect(material.roughness).toBe(1);
  });

  it('hemisphere light has expected sky, ground and intensity', () => {
    const { scene } = createScene();
    const hemi = scene.children.find((c) => c instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
    expect(hemi.color.getHexString()).toBe('cfe8ff');
    expect(hemi.groundColor.getHexString()).toBe('5a7a3a');
    expect(hemi.intensity).toBe(0.8);
  });

  it('each createScene call returns independent objects', () => {
    const a = createScene();
    a.ground.position.y = 123;
    const b = createScene();
    expect(b.ground).not.toBe(a.ground);
    expect(b.scene).not.toBe(a.scene);
    expect(b.ground.position.y).toBe(0);
  });

  it('sceneSetup imports nothing except three', () => {
    const source = readFileSync(
      new URL('../../../src/render/sceneSetup.ts', import.meta.url),
      'utf8',
    );
    const specifiers = [...source.matchAll(/(?:^|\n)\s*(?:import|export)[^;\n]*?\bfrom\s*['"]([^'"]+)['"]/g)]
      .map((m) => m[1]);
    const bareImports = [...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers.length + bareImports.length).toBeGreaterThan(0);
    for (const s of [...specifiers, ...bareImports]) expect(s).toBe('three');
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
