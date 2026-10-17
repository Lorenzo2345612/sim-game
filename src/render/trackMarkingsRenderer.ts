import * as THREE from 'three';
import type { SurfaceStrip } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';
import { registerWhitePaint } from './sceneSetup';

export interface TrackMarkingsObject { group: THREE.Group; dispose(): void }

// HSL lightness of an sRGB hex, 0..1.
function hexLightness(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const max = Math.max((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const min = Math.min((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return (max + min) / 510;
}

export function createTrackMarkingsObject(strips: SurfaceStrip[], style?: ResolvedTrackStyle): TrackMarkingsObject {
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

  const edge = style?.edgeLines.color ?? null;
  const material = new THREE.MeshStandardMaterial({
    color: edge ? new THREE.Color(edge) : new THREE.Color(0.7, 0.7, 0.7),
    roughness: 0.6,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  // White paint registration only for the default grey or near-white edge lines (capped at 0.7 linear).
  if (edge === null || hexLightness(edge) >= 0.85) {
    if (edge !== null) {
      const c = material.color;
      const max = Math.max(c.r, c.g, c.b);
      if (max > 0) c.multiplyScalar(0.7 / max);
    }
    registerWhitePaint(material);
  }

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
