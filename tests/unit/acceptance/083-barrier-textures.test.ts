import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject, type BarrierObject } from '../../../src/render/barrierRenderer';
import { fixture } from './022-fixture-trackdatav2';

// Typed against the spec's Step 0 signature (loadTexture not yet in the module); extra arg is ignored until implemented.
const createBarrier: (
  track: TrackDataV2,
  loadTexture?: (url: string) => THREE.Texture,
) => BarrierObject = createBarrierObject;

const POINTS = 60;

function barrierTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [0, -2 * i]),
    lengthMeters: 236,
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function stubLoader(): { urls: string[]; loadTexture: (url: string) => THREE.Texture } {
  const urls: string[] = [];
  const loadTexture = (url: string): THREE.Texture => {
    urls.push(url);
    const texture = new THREE.Texture();
    texture.name = url;
    return texture;
  };
  return { urls, loadTexture };
}

function railMaterial(group: THREE.Group): THREE.MeshStandardMaterial {
  const rail = group.getObjectByName('armco');
  if (!(rail instanceof THREE.Mesh)) throw new Error('missing armco mesh');
  return rail.material as THREE.MeshStandardMaterial;
}

describe('083 barrier textures acceptance', () => {
  it('AT1: armco material map URL ends with textures/metal/color.jpg; normalMap and roughnessMap loaded', () => {
    const { urls, loadTexture } = stubLoader();
    const { group } = createBarrier(
      barrierTrack([{ start: 5, end: 15, side: 'right', type: 'armco', offsetMeters: 10 }]),
      loadTexture,
    );
    const material = railMaterial(group);
    expect(material.map?.name?.endsWith('textures/metal/color.jpg')).toBe(true);
    expect(material.normalMap).not.toBeNull();
    expect(material.roughnessMap).not.toBeNull();
    expect(urls.some((url) => url.endsWith('textures/metal/normal.jpg'))).toBe(true);
    expect(urls.some((url) => url.endsWith('textures/metal/roughness.jpg'))).toBe(true);
  });

  it('AT2: wall material is concrete from createSurfaceMaterial, userData.tileMeters = 4', () => {
    const { loadTexture } = stubLoader();
    const { group } = createBarrier(
      barrierTrack([{ start: 5, end: 25, side: 'right', type: 'wall', offsetMeters: 12 }]),
      loadTexture,
    );
    const wall = group.getObjectByName('wall');
    if (!(wall instanceof THREE.Mesh)) throw new Error('missing wall mesh');
    const material = wall.material as THREE.MeshStandardMaterial;
    expect(material.userData.tileMeters).toBeCloseTo(4, 10);
  });

  it('AT3: tyres InstancedMesh has instanceColor; instance 0 (0.9, 0.9, 0.9), instance 1 (0.75, 0.1, 0.1) ± 1e-6', () => {
    const { loadTexture } = stubLoader();
    const { group } = createBarrier(
      barrierTrack([{ start: 5, end: 25, side: 'right', type: 'tyres', offsetMeters: 8 }]),
      loadTexture,
    );
    const tyres = group.getObjectByName('tyres');
    if (!(tyres instanceof THREE.InstancedMesh)) throw new Error('tyres is not an InstancedMesh');
    expect(tyres.instanceColor).not.toBeNull();
    const color = new THREE.Color();
    tyres.getColorAt(0, color);
    expect(Math.abs(color.r - 0.9)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(color.g - 0.9)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(color.b - 0.9)).toBeLessThanOrEqual(1e-6);
    tyres.getColorAt(1, color);
    expect(Math.abs(color.r - 0.75)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(color.g - 0.1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(color.b - 0.1)).toBeLessThanOrEqual(1e-6);
  });

  it('AT4: dispose() called twice disposes every texture, material and geometry exactly once', () => {
    const disposals = new Map<THREE.Texture, number>();
    const loadTexture = (url: string): THREE.Texture => {
      const texture = new THREE.Texture();
      texture.name = url;
      const original = texture.dispose.bind(texture);
      texture.dispose = (): void => {
        disposals.set(texture, (disposals.get(texture) ?? 0) + 1);
        original();
      };
      disposals.set(texture, 0);
      return texture;
    };
    const { group, dispose } = createBarrier(
      barrierTrack([
        { start: 5, end: 15, side: 'right', type: 'armco', offsetMeters: 10 },
        { start: 20, end: 25, side: 'left', type: 'tyres', offsetMeters: 8 },
        { start: 30, end: 40, side: 'right', type: 'wall', offsetMeters: 12 },
      ]),
      loadTexture,
    );
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    group.traverse((object: THREE.Object3D) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const material = object.material as THREE.Material | THREE.Material[];
      for (const single of Array.isArray(material) ? material : [material]) {
        materials.add(single);
      }
    });
    expect(geometries.size).toBeGreaterThan(0);
    expect(materials.size).toBeGreaterThan(0);
    expect(disposals.size).toBeGreaterThan(0);
    const spies = [
      ...[...geometries].map((geometry) => vi.spyOn(geometry, 'dispose')),
      ...[...materials].map((material) => vi.spyOn(material, 'dispose')),
    ];
    dispose();
    dispose();
    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    for (const [texture, count] of disposals) {
      expect(count, `${texture.name} dispose calls`).toBe(1);
    }
  });
});
