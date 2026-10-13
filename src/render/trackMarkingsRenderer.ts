import * as THREE from 'three';
import type { SurfaceStrip } from '../core/types';

export interface TrackMarkingsObject { group: THREE.Group; dispose(): void }

export function createTrackMarkingsObject(strips: SurfaceStrip[]): TrackMarkingsObject {
  const group = new THREE.Group();
  const vertexCount = strips.reduce((n, s) => n + s.positions.length / 3, 0);
  if (vertexCount === 0) return { group, dispose: () => {} };

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(strips.reduce((n, s) => n + s.indices.length, 0));
  let base = 0;
  let offset = 0;
  for (const strip of strips) {
    positions.set(strip.positions, base * 3);
    uvs.set(strip.uvs, base * 2);
    for (let i = 0; i < strip.indices.length; i++) indices[offset + i] = strip.indices[i] + base;
    base += strip.positions.length / 3;
    offset += strip.indices.length;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.95, 0.95, 0.95),
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'markings';
  mesh.receiveShadow = true;
  group.add(mesh);

  let disposed = false;
  return {
    group,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    },
  };
}
