import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SurfaceStrip } from '../../../src/core/types';
import { createTrackSurfaceObject } from '../../../src/render/trackSurfaceRenderer';

function strip(surface: SurfaceStrip['surface']): SurfaceStrip {
  return {
    surface,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    indices: new Uint32Array([0, 1, 2, 2, 1, 3]),
  };
}

describe('trackSurfaceRenderer edge cases', () => {
  it('creates one mesh per surface present and none for absent surfaces', () => {
    const { group } = createTrackSurfaceObject([strip('asphalt'), strip('asphalt'), strip('kerb')]);
    expect(group.children).toHaveLength(2);
    expect(group.children.map((child) => child.name).sort()).toEqual(['asphalt', 'kerbs']);
  });

  it('empty strips give an empty group', () => {
    const { group } = createTrackSurfaceObject([]);
    expect(group).toBeInstanceOf(THREE.Group);
    expect(group.children).toHaveLength(0);
  });

  it('merges strips of one surface with offset indices', () => {
    const { group } = createTrackSurfaceObject([strip('asphalt'), strip('asphalt')]);
    const mesh = group.children[0] as THREE.Mesh;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex()!;
    expect(position.count).toBe(8);
    expect(index.count).toBe(12);
    expect([...index.array.slice(6, 12)]).toEqual([4, 5, 6, 6, 5, 7]);
  });

  it('second dispose() does not throw', () => {
    const result = createTrackSurfaceObject([strip('asphalt')], {
      loadTexture: () => new THREE.Texture(),
    });
    result.dispose();
    expect(() => result.dispose()).not.toThrow();
  });

  it('dispose() fires the dispose event on geometries, materials and textures', () => {
    const loaded: THREE.Texture[] = [];
    const result = createTrackSurfaceObject([strip('runoff')], {
      loadTexture: (url) => {
        const texture = new THREE.Texture();
        texture.name = url;
        loaded.push(texture);
        return texture;
      },
    });
    const events: string[] = [];
    result.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.addEventListener('dispose', () => events.push('geometry'));
      const material = object.material as THREE.MeshStandardMaterial;
      material.addEventListener('dispose', () => events.push('material'));
      for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
        texture?.addEventListener('dispose', () => events.push('texture'));
      }
    });
    result.dispose();
    expect(events.sort()).toEqual([
      'geometry',
      'material',
      'texture',
      'texture',
      'texture',
    ]);
    expect(loaded.map((texture) => texture.name)).toEqual([
      'textures/runoff/color.jpg',
      'textures/runoff/normal.jpg',
      'textures/runoff/roughness.jpg',
    ]);
  });
});
