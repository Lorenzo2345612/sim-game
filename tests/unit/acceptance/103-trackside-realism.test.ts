import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { fixture } from './022-fixture-trackdatav2';

// Straight fixture like 083: 60 centerline points 2 m apart along -Z; indices 5..10 span 10 m.
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

function stubTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
}

function instancePositions(mesh: THREE.InstancedMesh): THREE.Vector3[] {
  const matrix = new THREE.Matrix4();
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix));
  }
  return out;
}

function meshBox(mesh: THREE.Mesh): THREE.Box3 {
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) throw new Error('missing geometry bounding box');
  return box;
}

describe('103 trackside realism acceptance', () => {
  it('AT1: 10 m tyre wall is one InstancedMesh with 16 or 17 tyres per row every 0.62 m, 4 rows, top at 1.0 ± 0.05 m', () => {
    const { group, dispose } = createBarrierObject(
      barrierTrack([{ start: 5, end: 10, side: 'right', type: 'tyres', offsetMeters: 8 }]),
      stubTexture,
    );
    let tyreMeshes = 0;
    group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.name === 'tyres') tyreMeshes++;
    });
    expect(tyreMeshes).toBe(1);
    const tyres = group.getObjectByName('tyres');
    if (!(tyres instanceof THREE.InstancedMesh)) throw new Error('tyres is not an InstancedMesh');
    const rows: THREE.Vector3[][] = [[], [], [], []];
    let assigned = 0;
    for (const p of instancePositions(tyres)) {
      const r = Math.round((p.y - 0.125) / 0.25);
      if (r >= 0 && r <= 3 && Math.abs(p.y - (r * 0.25 + 0.125)) < 0.01) {
        rows[r].push(p);
        assigned++;
      }
    }
    expect(assigned).toBe(tyres.count);
    for (const row of rows) {
      expect(row.length).toBeGreaterThanOrEqual(16);
      expect(row.length).toBeLessThanOrEqual(17);
      row.sort((a, b) => a.z - b.z);
      for (let k = 1; k < row.length; k++) {
        expect(Math.abs(row[k].z - row[k - 1].z)).toBeCloseTo(0.62, 4);
      }
    }
    tyres.computeBoundingBox();
    const box = tyres.boundingBox;
    if (!box) throw new Error('missing tyres bounding box');
    expect(box.max.y).toBeGreaterThanOrEqual(0.95);
    expect(box.max.y).toBeLessThanOrEqual(1.05);
    dispose();
  });

  it('AT2: 10 m armco rail cross-section is 0.31 m tall centred at 0.6 m with 6 posts every 2.0 m', () => {
    const { group, dispose } = createBarrierObject(
      barrierTrack([{ start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    const rail = group.getObjectByName('armco');
    if (!(rail instanceof THREE.Mesh)) throw new Error('armco is not a Mesh');
    const box = meshBox(rail);
    expect(box.max.y - box.min.y).toBeCloseTo(0.31, 4);
    expect((box.max.y + box.min.y) / 2).toBeCloseTo(0.6, 4);
    const posts = group.getObjectByName('armcoPosts');
    if (!(posts instanceof THREE.InstancedMesh)) throw new Error('armcoPosts is not an InstancedMesh');
    expect(posts.count).toBe(6);
    const centers = instancePositions(posts).sort((a, b) => a.z - b.z);
    for (let k = 1; k < centers.length; k++) {
      expect(Math.abs(centers[k].z - centers[k - 1].z)).toBeCloseTo(2.0, 3);
    }
    dispose();
  });

  it('AT3: catch fence is 3.0 m tall quads behind the armco, with an opacity map and alphaTest 0.5', () => {
    const { group, dispose } = createBarrierObject(
      barrierTrack([{ start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    const fence = group.getObjectByName('fence');
    if (!(fence instanceof THREE.Mesh)) throw new Error('fence is not a Mesh');
    const fenceBox = meshBox(fence);
    expect(fenceBox.max.y - fenceBox.min.y).toBeCloseTo(3.0, 4);
    const rail = group.getObjectByName('armco');
    if (!(rail instanceof THREE.Mesh)) throw new Error('armco is not a Mesh');
    expect(fenceBox.min.x).toBeGreaterThan(meshBox(rail).max.x);
    const material = fence.material as THREE.MeshStandardMaterial;
    expect(material.alphaMap?.name?.endsWith('textures/fence/opacity.jpg')).toBe(true);
    expect(material.alphaTest).toBeCloseTo(0.5, 10);
    dispose();
  });
});
