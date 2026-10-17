import * as THREE from 'three';
import type { Surface, SurfaceStrip, TrackDataV2 } from '../core/types';
import type { ResolvedTrackStyle } from '../track/trackStyle';
import { createSurfaceMaterial, type SurfaceMaterialUserData } from './surfaceMaterials';

export interface TrackSurfaceOptions {
  loadTexture?: (url: string) => THREE.Texture;
  style?: ResolvedTrackStyle;
  track?: TrackDataV2;
}
export interface TrackSurfaceObject { group: THREE.Group; dispose(): void }

const MESH_NAME: Partial<Record<Surface, string>> = {
  asphalt: 'asphalt',
  kerb: 'kerbs',
  grass: 'grass',
  gravel: 'gravel',
  runoff: 'runoff',
};

function defaultLoadTexture(url: string): THREE.Texture {
  const texture =
    typeof document !== 'undefined' ? new THREE.TextureLoader().load(url) : new THREE.Texture();
  texture.name = url;
  return texture;
}

export function createTrackSurfaceObject(
  strips: SurfaceStrip[],
  options?: TrackSurfaceOptions,
): TrackSurfaceObject {
  const loadTexture = options?.loadTexture ?? defaultLoadTexture;
  const bySurface = new Map<Surface, SurfaceStrip[]>();
  for (const strip of strips) {
    if (!MESH_NAME[strip.surface]) continue;
    const same = bySurface.get(strip.surface) ?? [];
    same.push(strip);
    bySurface.set(strip.surface, same);
  }

  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  const textures = new Set<THREE.Texture>();
  const macro = bySurface.size > 0 ? loadTexture('textures/macro-noise.png') : undefined;

  for (const [surface, same] of bySurface) {
    const vertexCount = same.reduce((n, s) => n + s.positions.length / 3, 0);
    const positions = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(same.reduce((n, s) => n + s.indices.length, 0));
    let base = 0;
    let offset = 0;
    for (const strip of same) {
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
    geometries.push(geometry);

    const material = createSurfaceMaterial(surface, loadTexture, macro);
    materials.push(material);
    for (const texture of (material.userData as SurfaceMaterialUserData).textures) {
      textures.add(texture);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = MESH_NAME[surface]!;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  let disposed = false;
  return {
    group,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}
