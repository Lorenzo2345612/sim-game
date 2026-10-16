import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

// Task 160 lands src/render/landmarks.ts; the variable specifier keeps typecheck
// green until the module exists (the 158 pattern).
const LANDMARKS_MODULE = '../../../src/render/landmarks';

type LandmarkKind = 'cylinder-tower' | 'flame-towers' | 'twin-deck' | 'wheel' | 'lattice-tower';
type BuildLandmark = (kind: LandmarkKind, height: number) => THREE.Group;

const KINDS: LandmarkKind[] = [
  'cylinder-tower',
  'flame-towers',
  'twin-deck',
  'wheel',
  'lattice-tower',
];
const H = 100;

async function loadBuildLandmark(): Promise<BuildLandmark> {
  return ((await import(LANDMARKS_MODULE)) as { buildLandmark: BuildLandmark }).buildLandmark;
}

function countTriangles(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const perGeometry = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    const instanced = mesh as THREE.InstancedMesh;
    total += perGeometry * (instanced.isInstancedMesh ? instanced.count : 1);
  });
  return total;
}

describe('160 landmarks acceptance', () => {
  it('AT1: each proxy kind with height H has <= 3000 triangles and bounding box height = H +/- 2 %', async () => {
    const buildLandmark = await loadBuildLandmark();
    for (const kind of KINDS) {
      const group = buildLandmark(kind, H);
      expect(group).toBeInstanceOf(THREE.Group);
      const height = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).y;
      expect(Math.abs(height - H)).toBeLessThanOrEqual(0.02 * H);
      expect(countTriangles(group)).toBeLessThanOrEqual(3000);
    }
  });
});
