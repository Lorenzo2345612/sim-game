import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createScene } from '../../../src/render/sceneSetup';
import { FOG_TABLE, ShadowRig } from '../../../src/render/environment';

const FOG: Record<string, { color: string; density: number }> = {
  monza: { color: '#b8c9d9', density: 0.00055 },
  spa: { color: '#9aa7b0', density: 0.0011 },
  silverstone: { color: '#a9b3bb', density: 0.0008 },
};

describe('042 lighting acceptance', () => {
  it('AT1: FOG_TABLE keeps the per-track densities only (colours come from the HDRI horizon, task 099)', () => {
    for (const [trackId, expected] of Object.entries(FOG)) {
      expect(FOG_TABLE[trackId].density).toBeCloseTo(expected.density, 12);
      expect('color' in FOG_TABLE[trackId]).toBe(false);
    }
  });

  it('AT2: ShadowRig update centres the shadow camera within 1 m of the car, mapSize 2048, frustum +/-60 m', () => {
    const { scene } = createScene();
    const rig = new ShadowRig(scene);
    expect(rig.light).toBeInstanceOf(THREE.DirectionalLight);
    expect(rig.light.shadow.camera).toBeInstanceOf(THREE.OrthographicCamera);

    const car = { x: 137.42, y: 0.35, z: -88.71 };
    rig.update(car);

    const center = rig.light.target.position;
    expect(Math.hypot(center.x - car.x, center.y - car.y, center.z - car.z)).toBeLessThanOrEqual(1);
    expect(rig.light.shadow.mapSize.width).toBe(2048);
    expect(rig.light.shadow.mapSize.height).toBe(2048);
    const cam = rig.light.shadow.camera as THREE.OrthographicCamera;
    expect(cam.left).toBeCloseTo(-60, 6);
    expect(cam.right).toBeCloseTo(60, 6);
    expect(cam.top).toBeCloseTo(60, 6);
    expect(cam.bottom).toBeCloseTo(-60, 6);
  });

  it('AT3: setEnabled with preset low disables renderer shadowMap', () => {
    const { scene } = createScene();
    const rig = new ShadowRig(scene);
    const renderer = { shadowMap: { enabled: true } };
    rig.setEnabled(renderer, false);
    expect(renderer.shadowMap.enabled).toBe(false);
  });
});
