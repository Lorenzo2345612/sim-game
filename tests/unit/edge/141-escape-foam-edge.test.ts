import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject, type BarrierObject } from '../../../src/render/barrierRenderer';
import * as surfaces from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

// Task 141 adds escapeRoadStrips and BarrierObject.foamBlocks; the casts keep this
// test-first file compiling until they exist.
const escapeRoadStrips = (
  surfaces as unknown as { escapeRoadStrips: (track: TrackDataV2) => SurfaceStrip[] }
).escapeRoadStrips;

type FoamObject = BarrierObject & { foamBlocks: number };

const zs = (n: number): number[] => Array.from({ length: n }, (_, i) => -2 * i);
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);

function makeTrack(zsArr: number[], elevation: number[], barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: zsArr.map((z): [number, number] => [0, z]),
    lengthMeters: Math.abs(zsArr[zsArr.length - 1] - zsArr[0]),
    elevation,
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

function foamObject(track: TrackDataV2): FoamObject {
  return createBarrierObject(track, stubTexture) as FoamObject;
}

function instanced(group: THREE.Group, name: string): THREE.InstancedMesh | undefined {
  let found: THREE.InstancedMesh | undefined;
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name === name) found = object;
  });
  return found;
}

function foamMeshNames(group: THREE.Group): string[] {
  const names: string[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name.startsWith('foam')) names.push(object.name);
  });
  return names.sort();
}

function instanceZ(mesh: THREE.InstancedMesh): number[] {
  const matrix = new THREE.Matrix4();
  const out: number[] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    out.push(new THREE.Vector3().setFromMatrixPosition(matrix).z);
  }
  return out.sort((a, b) => a - b);
}

function requireMesh(object: FoamObject, name: string): THREE.InstancedMesh {
  const mesh = instanced(object.group, name);
  if (!mesh) throw new Error(`${name} is missing`);
  return mesh;
}

function facesUp(strip: SurfaceStrip): void {
  const p = strip.positions;
  for (let t = 0; t + 2 < strip.indices.length; t += 3) {
    const a = strip.indices[t];
    const b = strip.indices[t + 1];
    const c = strip.indices[t + 2];
    const ux = p[3 * b] - p[3 * a];
    const uz = p[3 * b + 2] - p[3 * a + 2];
    const vx = p[3 * c] - p[3 * a];
    const vz = p[3 * c + 2] - p[3 * a + 2];
    expect(uz * vx - ux * vz).toBeGreaterThan(0);
  }
}

// Cornered polyline: first-segment normal +Z at point 0, last-segment normal +X at
// point 2, their average (±1,±1)/√2 at the inner corner; elevation = index.
const CORNER_PTS: [number, number][] = [[0, -2], [4, -2], [4, -10]];

function lShapedTrack(): TrackDataV2 {
  return {
    ...makeTrack(zs(12), Array.from({ length: 12 }, (_, i) => i), []),
    escapeRoads: [{ points: CORNER_PTS, width: 6 }],
  };
}

describe('141 escape road and foam edge cases', () => {
  it('EDGE1: escapeRoadStrips returns [] when escapeRoads is missing and when it is empty', () => {
    const base = makeTrack(zs(60), zeros(60), []);
    expect(escapeRoadStrips(base)).toEqual([]);
    expect(escapeRoadStrips({ ...base, escapeRoads: [] })).toEqual([]);
  });

  it('EDGE2: escape strip of a cornered polyline is width/2 from the path at every point, along end-segment normals with the corner normal averaged, at the elevation interpolated on the nearest centerline segment (grade 0.5 m per metre) plus 0.01', () => {
    const strips = escapeRoadStrips(lShapedTrack());
    expect(strips).toHaveLength(1);
    expect(strips[0].surface).toBe('runoff');
    const pos = strips[0].positions;
    expect(pos.length).toBe(18);
    const bisect = 3 / Math.SQRT2;
    for (let i = 0; i < 3; i++) {
      const a = i * 6;
      for (const v of [0, 1]) {
        const yExp = Math.min(Math.max(-pos[a + v * 3 + 2] / 2, 0), 11) + 0.01;
        expect(Math.abs(pos[a + v * 3 + 1] - yExp)).toBeLessThanOrEqual(1e-6);
      }
      const dx0 = pos[a] - CORNER_PTS[i][0];
      const dz0 = pos[a + 2] - CORNER_PTS[i][1];
      const dx1 = pos[a + 3] - CORNER_PTS[i][0];
      const dz1 = pos[a + 5] - CORNER_PTS[i][1];
      expect(Math.abs(Math.hypot(dx0, dz0) - 3)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(Math.hypot(dx1, dz1) - 3)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(dx0 + dx1)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(dz0 + dz1)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(Math.hypot(dx1 - dx0, dz1 - dz0) - 6)).toBeLessThanOrEqual(1e-6);
      if (i === 0) {
        expect(Math.abs(dx0)).toBeLessThanOrEqual(1e-6);
      } else if (i === 2) {
        expect(Math.abs(dz0)).toBeLessThanOrEqual(1e-6);
      } else {
        expect(Math.abs(dx0 - dz0)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(dx1 - dz1)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(Math.abs(dx0) - bisect)).toBeLessThanOrEqual(1e-6);
        expect(dx0 * dx1).toBeLessThan(0);
      }
    }
  });

  it('EDGE3: escape strip has one quad per polyline gap, wound so normals face +Y, with uv = signed lateral / 10 and v = along-path metres / 10', () => {
    const s = escapeRoadStrips(lShapedTrack())[0];
    expect(s.indices.length).toBe(12);
    facesUp(s);
    const vExp = [0, 0.4, 1.2];
    for (let i = 0; i < 3; i++) {
      for (const v of [0, 1]) {
        const q = (i * 2 + v) * 2;
        expect(Math.abs(Math.abs(s.uvs[q]) - 0.3)).toBeLessThanOrEqual(1e-6);
        expect(Math.abs(s.uvs[q + 1] - vExp[i])).toBeLessThanOrEqual(1e-6);
      }
      expect(s.uvs[i * 4] * s.uvs[i * 4 + 2]).toBeLessThan(0);
    }
  });

  it('EDGE4: a 2.5 m foam span yields floor(2.5 / 1) = 2 blocks centred at (k + 0.5) m; the 0.5 m remainder gets no block', () => {
    const track = makeTrack(
      Array.from({ length: 40 }, (_, i) => (i <= 5 ? -2 * i : i === 6 ? -12.5 : -12.5 - 2 * (i - 6))),
      zeros(40),
      [{ start: 5, end: 6, side: 'right', type: 'foam', offsetMeters: 10 }],
    );
    const object = foamObject(track);
    expect(object.foamBlocks).toBe(2);
    const blue = requireMesh(object, 'foamBlue');
    const red = requireMesh(object, 'foamRed');
    expect(blue.count).toBe(1);
    expect(red.count).toBe(1);
    expect(instanceZ(blue)[0]).toBeCloseTo(-10.5, 4);
    expect(instanceZ(red)[0]).toBeCloseTo(-11.5, 4);
    object.dispose();
  });

  it('EDGE5: only colours with at least one block get a mesh and each colour has its own MeshStandardMaterial with roughness 0.6 and metalness 0', () => {
    const track = makeTrack(
      Array.from({ length: 40 }, (_, i) => (i <= 5 ? -2 * i : i === 6 ? -12.5 : -12.5 - 2 * (i - 6))),
      zeros(40),
      [{ start: 5, end: 6, side: 'right', type: 'foam', offsetMeters: 10 }],
    );
    const object = foamObject(track);
    expect(instanced(object.group, 'foamWhite')).toBeUndefined();
    expect(foamMeshNames(object.group)).toEqual(['foamBlue', 'foamRed']);
    const blue = requireMesh(object, 'foamBlue');
    const red = requireMesh(object, 'foamRed');
    const mb = blue.material as THREE.MeshStandardMaterial;
    const mr = red.material as THREE.MeshStandardMaterial;
    expect(mb).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mr).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mr).not.toBe(mb);
    expect(mb.roughness).toBeCloseTo(0.6, 6);
    expect(mr.roughness).toBeCloseTo(0.6, 6);
    expect(mb.metalness).toBeCloseTo(0, 6);
    expect(mr.metalness).toBeCloseTo(0, 6);
    object.dispose();
  });

  it('EDGE6: foam spans build no wall mesh and wall spans build no foam mesh; foamBlocks totals the instances of a foam object', () => {
    const foam = foamObject(
      makeTrack(zs(60), zeros(60), [{ start: 5, end: 10, side: 'right', type: 'foam', offsetMeters: 10 }]),
    );
    expect(foam.group.getObjectByName('wall')).toBeUndefined();
    expect(foam.foamBlocks).toBe(10);
    let counted = 0;
    for (const name of ['foamBlue', 'foamRed', 'foamWhite']) counted += instanced(foam.group, name)?.count ?? 0;
    expect(counted).toBe(foam.foamBlocks);
    foam.dispose();

    const wall = foamObject(
      makeTrack(zs(60), zeros(60), [{ start: 5, end: 10, side: 'right', type: 'wall', offsetMeters: 10 }]),
    );
    expect(wall.foamBlocks).toBe(0);
    expect(foamMeshNames(wall.group)).toEqual([]);
    wall.dispose();
  });

  it('EDGE7: a zero-length foam span (two coincident path points) creates no blocks, no foam mesh and no wall mesh', () => {
    const track = makeTrack(
      Array.from({ length: 60 }, (_, i) => (i <= 5 ? -2 * i : i === 6 ? -10 : -2 * (i - 1))),
      zeros(60),
      [{ start: 5, end: 6, side: 'right', type: 'foam', offsetMeters: 10 }],
    );
    const object = foamObject(track);
    expect(object.foamBlocks).toBe(0);
    expect(foamMeshNames(object.group)).toEqual([]);
    expect(object.group.getObjectByName('wall')).toBeUndefined();
    object.dispose();
  });

  it('EDGE8: the colour counter runs over the whole barrier object: two right foam runs of 4 m and 2 m give 2 blue, 2 red, 2 white (a per-span reset would give 3/2/1)', () => {
    const object = foamObject(
      makeTrack(zs(60), zeros(60), [
        { start: 5, end: 7, side: 'right', type: 'foam', offsetMeters: 10 },
        { start: 10, end: 11, side: 'right', type: 'foam', offsetMeters: 10 },
      ]),
    );
    expect(object.foamBlocks).toBe(6);
    expect(requireMesh(object, 'foamBlue').count).toBe(2);
    expect(requireMesh(object, 'foamRed').count).toBe(2);
    expect(requireMesh(object, 'foamWhite').count).toBe(2);
    object.dispose();
  });

  it('EDGE9: a foam block sits with its inner face flush on the barrier line, FOAM_DEPTH/2 = 0.3 m outward on both sides, base on the path elevation and FOAM_WIDTH = 0.96 m along the tangent', () => {
    const track = makeTrack(
      Array.from({ length: 40 }, (_, i) => (i <= 5 ? -2 * i : i === 6 ? -11 : -11 - 2 * (i - 6))),
      Array.from({ length: 40 }, () => 2),
      [
        { start: 5, end: 6, side: 'right', type: 'foam', offsetMeters: 10 },
        { start: 5, end: 6, side: 'left', type: 'foam', offsetMeters: 10 },
      ],
    );
    const object = foamObject(track);
    expect(object.foamBlocks).toBe(2);
    const boxes: THREE.Box3[] = [];
    for (const name of ['foamBlue', 'foamRed']) {
      const mesh = requireMesh(object, name);
      expect(mesh.count).toBe(1);
      mesh.computeBoundingBox();
      if (!mesh.boundingBox) throw new Error(`${name} has no bounding box`);
      boxes.push(mesh.boundingBox);
    }
    const right = boxes.find((b) => b.min.x > 0);
    const left = boxes.find((b) => b.max.x < 0);
    if (!right || !left) throw new Error('expected one foam block on each side');
    expect(right.min.x).toBeCloseTo(10, 3);
    expect(right.max.x).toBeCloseTo(10.6, 3);
    expect(left.max.x).toBeCloseTo(-10, 3);
    expect(left.min.x).toBeCloseTo(-10.6, 3);
    for (const b of [right, left]) {
      expect(b.min.y).toBeCloseTo(2, 3);
      expect(b.max.y).toBeCloseTo(3, 3);
      expect(b.max.x - b.min.x).toBeCloseTo(0.6, 3);
      expect(b.max.z - b.min.z).toBeCloseTo(0.96, 3);
      expect((b.min.z + b.max.z) / 2).toBeCloseTo(-10.5, 3);
    }
    object.dispose();
  });

  it('EDGE10: the colour meshes share one box geometry and dispose() disposes it and the three materials exactly once; a second call is a no-op', () => {
    const object = foamObject(
      makeTrack(zs(60), zeros(60), [{ start: 5, end: 10, side: 'right', type: 'foam', offsetMeters: 10 }]),
    );
    const blue = requireMesh(object, 'foamBlue');
    const red = requireMesh(object, 'foamRed');
    const white = requireMesh(object, 'foamWhite');
    expect(red.geometry).toBe(blue.geometry);
    expect(white.geometry).toBe(blue.geometry);
    const items: Array<{ dispose(): void }> = [
      blue.geometry,
      blue.material as THREE.Material,
      red.material as THREE.Material,
      white.material as THREE.Material,
    ];
    const counts = new Map<{ dispose(): void }, number>();
    for (const item of items) {
      const original = item.dispose.bind(item);
      Object.defineProperty(item, 'dispose', {
        value: (): void => {
          counts.set(item, (counts.get(item) ?? 0) + 1);
          original();
        },
        configurable: true,
      });
      counts.set(item, 0);
    }
    object.dispose();
    object.dispose();
    for (const item of items) expect(counts.get(item)).toBe(1);
  });
});
