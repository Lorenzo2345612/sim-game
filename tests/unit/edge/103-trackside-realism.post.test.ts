import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { wBeamProfile } from '../../../src/render/barrierProfiles';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const N = 60;

function makeTrack(spacing: number, elevation: number, barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: Array.from({ length: N }, (_, i): [number, number] => [0, -spacing * i]),
    lengthMeters: spacing * (N - 1),
    elevation: Array.from({ length: N }, () => elevation),
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

function instanced(group: THREE.Group, name: string): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) found = object;
  });
  return found;
}

function instanceYs(mesh: THREE.InstancedMesh): number[] {
  const matrix = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix).y);
  }
  return out;
}

function box(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error('missing geometry bounding box');
  return box;
}

describe('103 trackside realism post-code gaps', () => {
  it('POST1: rail uv is u = arc length / 2 per path point and v = profile arc fraction 0..1', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, 0, [{ start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    const rail = group.getObjectByName('armco');
    if (!(rail instanceof THREE.Mesh)) throw new Error('armco is not a Mesh');
    const profile = wBeamProfile();
    const cum: number[] = [0];
    let total = 0;
    for (let m = 1; m < profile.length; m++) {
      total += Math.hypot(profile[m][0] - profile[m - 1][0], profile[m][1] - profile[m - 1][1]);
      cum.push(total);
    }
    const expectedV = cum.map((c) => c / total);
    const uv = rail.geometry.getAttribute('uv');
    expect(uv.count).toBe(6 * 9);
    for (let k = 0; k < 6; k++) {
      for (let m = 0; m < 9; m++) {
        expect(uv.getX(k * 9 + m)).toBeCloseTo(k, 4);
        expect(uv.getY(k * 9 + m)).toBeCloseTo(expectedV[m], 4);
      }
    }
    expect(uv.getX(0)).toBeCloseTo(0, 6);
    expect(uv.getX(5 * 9)).toBeCloseTo(10 / 2, 4);
    dispose();
  });

  it('POST2: posts are 0.08 x 0.75 x 0.12 boxes sharing the exact rail material object', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, 0, [{ start: 5, end: 10, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    const rail = group.getObjectByName('armco');
    const posts = instanced(group, 'armcoPosts');
    if (!(rail instanceof THREE.Mesh) || !posts) throw new Error('missing armco or posts');
    const size = new THREE.Vector3();
    box(posts.geometry).getSize(size);
    expect(size.x).toBeCloseTo(0.08, 6);
    expect(size.y).toBeCloseTo(0.75, 6);
    expect(size.z).toBeCloseTo(0.12, 6);
    expect(posts.material).toBe(rail.material);
    dispose();
  });

  it('POST3: post count is floor(length / 2) + 1: 12 m span gets 7, 0.9 m span gets 1', () => {
    const long = createBarrierObject(
      makeTrack(2, 0, [{ start: 5, end: 11, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    expect(instanced(long.group, 'armcoPosts')?.count).toBe(7);
    long.dispose();
    const short = createBarrierObject(
      makeTrack(0.9, 0, [{ start: 5, end: 6, side: 'right', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    expect(instanced(short.group, 'armcoPosts')?.count).toBe(1);
    short.dispose();
  });

  it('POST4: on the left side the two W-beam lobes bulge toward the track at y = 0.5 and 0.7', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, 0, [{ start: 5, end: 10, side: 'left', type: 'armco', offsetMeters: 10 }]),
      stubTexture,
    );
    const rail = group.getObjectByName('armco');
    if (!(rail instanceof THREE.Mesh)) throw new Error('armco is not a Mesh');
    const pos = rail.geometry.getAttribute('position');
    const b = box(rail.geometry);
    expect(b.min.x).toBeCloseTo(-10.05, 3);
    expect(b.max.x).toBeCloseTo(-9.95, 3);
    let lobes = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) + 9.95) < 1e-3) {
        lobes++;
        const y = pos.getY(i);
        const nearLobe = Math.abs(y - 0.5) < 1e-4 || Math.abs(y - 0.7) < 1e-4;
        expect(nearLobe).toBe(true);
      }
    }
    expect(lobes).toBe(12);
    dispose();
  });

  it('POST5: on an elevated path the rail occupies y 5.445-5.755 and the fence runs 5 to 8', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, 5, [
        { start: 5, end: 10, side: 'right', type: 'tyres', offsetMeters: 8 },
        { start: 20, end: 25, side: 'right', type: 'armco', offsetMeters: 10 },
      ]),
      stubTexture,
    );
    const rail = group.getObjectByName('armco');
    const fence = group.getObjectByName('fence');
    if (!(rail instanceof THREE.Mesh) || !(fence instanceof THREE.Mesh)) throw new Error('missing armco or fence');
    const rb = box(rail.geometry);
    expect(rb.min.y).toBeCloseTo(5.445, 3);
    expect(rb.max.y).toBeCloseTo(5.755, 3);
    const fb = box(fence.geometry);
    expect(fb.min.y).toBeCloseTo(5, 3);
    expect(fb.max.y).toBeCloseTo(8, 3);
    dispose();
  });

  it('POST6: on an elevated path tyre rows stack from the path height and post centres sit 0.375 above it', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack(2, 5, [
        { start: 5, end: 10, side: 'right', type: 'tyres', offsetMeters: 8 },
        { start: 20, end: 25, side: 'right', type: 'armco', offsetMeters: 10 },
      ]),
      stubTexture,
    );
    const tyres = instanced(group, 'tyres');
    const posts = instanced(group, 'armcoPosts');
    if (!tyres || !posts) throw new Error('missing tyres or posts');
    const tyreYs = instanceYs(tyres);
    expect(tyreYs[0]).toBeCloseTo(5.125, 4);
    expect(tyreYs[50]).toBeCloseTo(5.875, 4);
    expect(instanceYs(posts)[0]).toBeCloseTo(5.375, 4);
    dispose();
  });
});
