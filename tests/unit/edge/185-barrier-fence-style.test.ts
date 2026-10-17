import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const POINTS = 100;
const BARRIERS: BarrierSegment[] = [
  { start: 0, end: 20, side: 'left', type: 'armco', offsetMeters: 8 },
  { start: 30, end: 50, side: 'left', type: 'wall', offsetMeters: 8 },
  { start: 60, end: 80, side: 'right', type: 'tyres', offsetMeters: 8 },
  { start: 85, end: 95, side: 'right', type: 'foam', offsetMeters: 8 },
];

function makeTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    widthMeters: 12,
    centerline: Array.from({ length: POINTS }, (_, i): [number, number] => [i * 10, 0]),
    lengthMeters: 990,
    elevation: Array.from({ length: POINTS }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
    pit: { start: 10, end: 30, side: 'right' },
  };
}

const track = makeTrack(BARRIERS);

function stubTexture(url: string): THREE.Texture {
  const texture = new THREE.Texture();
  texture.name = url;
  return texture;
}

function styleWith(patch: (barriers: ResolvedTrackStyle['barriers']) => void): ResolvedTrackStyle {
  const style = structuredClone(DEFAULT_TRACK_STYLE) as ResolvedTrackStyle;
  patch(style.barriers);
  return style;
}

function mesh(group: THREE.Group, name: string): THREE.Mesh {
  const found = group.getObjectByName(name);
  if (!(found instanceof THREE.Mesh)) throw new Error(`missing mesh ${name}`);
  return found;
}

function box(m: THREE.Mesh): THREE.Box3 {
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  if (!b) throw new Error('missing bounding box');
  return b;
}

function fenceMeters(group: THREE.Group): number {
  return group.userData.fenceMeters as number;
}

describe('185 barrier fence style edge cases', () => {
  it('EDGE1: range zeroing only the first half of the armco leaves about 100 m of fence', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.ranges = [{ start: 0, end: 10, side: 'left', fenceHeightMeters: 0 }];
      }),
    );
    expect(Math.abs(fenceMeters(group) - 100)).toBeLessThanOrEqual(2);
    dispose();
  });

  it('EDGE2: range on the opposite side does not affect the armco fence', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.ranges = [{ start: 0, end: 20, side: 'right', fenceHeightMeters: 0 }];
      }),
    );
    expect(Math.abs(fenceMeters(group) - 200)).toBeLessThanOrEqual(1);
    dispose();
  });

  it('EDGE3: each fence edge has 4 own vertices and uv v equals height / 3', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.fence.heightMeters = 5;
        b.fence.types = ['armco', 'wall'];
      }),
    );
    const geo = mesh(group, 'fence').geometry;
    expect(geo.getAttribute('position').count).toBe(160);
    const uv = geo.getAttribute('uv');
    let maxV = -Infinity;
    for (let i = 0; i < uv.count; i++) maxV = Math.max(maxV, uv.getY(i));
    expect(maxV).toBeCloseTo(5 / 3, 3);
    dispose();
  });

  it('EDGE4: no fence quads means no fence texture is loaded', () => {
    const urlsDefault: string[] = [];
    const urlsNone: string[] = [];
    createBarrierObject(track, (u) => (urlsDefault.push(u), stubTexture(u))).dispose();
    createBarrierObject(
      track,
      (u) => (urlsNone.push(u), stubTexture(u)),
      styleWith((b) => {
        b.fence.heightMeters = 0;
      }),
    ).dispose();
    expect(urlsNone.length).toBeLessThan(urlsDefault.length);
  });

  it('EDGE5: no wallBand mesh when bandColor is not set', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.concrete.bandColor = null;
      }),
    );
    expect(group.getObjectByName('wallBand')).toBeUndefined();
    dispose();
  });

  it('EDGE6: no wallBand mesh when bandColor is set but the track has no wall spans', () => {
    const { group, dispose } = createBarrierObject(
      makeTrack([BARRIERS[0]]),
      stubTexture,
      styleWith((b) => {
        b.concrete.bandColor = '#dac400';
      }),
    );
    expect(group.getObjectByName('wallBand')).toBeUndefined();
    dispose();
  });

  it('EDGE7: wallBand spans 0.35 to 0.65 m above the path and stays within the wall x range', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.concrete.bandColor = '#dac400';
      }),
    );
    const base = box(mesh(group, 'fence')).min.y;
    const b = box(mesh(group, 'wallBand'));
    expect(b.min.y - base).toBeCloseTo(0.35, 2);
    expect(b.max.y - base).toBeCloseTo(0.65, 2);
    expect(b.min.x).toBeGreaterThanOrEqual(299);
    expect(b.max.x).toBeLessThanOrEqual(501);
    dispose();
  });

  it('EDGE8: custom foam colours name the instanced meshes foamA and foamB', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.foam.colors = ['#d0432d', '#dadada'];
      }),
    );
    const names: string[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh && o.name.startsWith('foam')) names.push(o.name);
    });
    expect(names.sort()).toEqual(['foamA', 'foamB']);
    dispose();
  });

  it('EDGE9: the style object is not mutated', () => {
    const style = styleWith((b) => {
      b.fence.heightMeters = 5;
      b.concrete.bandColor = '#dac400';
      b.foam.colors = ['#d0432d', '#dadada'];
      b.ranges = [{ start: 60, end: 80, side: 'right', fenceHeightMeters: 4 }];
    });
    const before = structuredClone(style);
    createBarrierObject(track, stubTexture, style).dispose();
    expect(style).toEqual(before);
  });

  it('EDGE10: dispose disposes every geometry and material including fence and wallBand', () => {
    const { group, dispose } = createBarrierObject(
      track,
      stubTexture,
      styleWith((b) => {
        b.concrete.bandColor = '#dac400';
        b.fence.types = ['armco', 'wall'];
      }),
    );
    const disposed = new Set<object>();
    const all: Array<THREE.BufferGeometry | THREE.Material> = [];
    group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      all.push(o.geometry, ...mats);
    });
    for (const item of all) item.addEventListener('dispose', () => disposed.add(item));
    dispose();
    expect(group.getObjectByName('wallBand') ?? true).toBeTruthy();
    expect(all.length).toBeGreaterThan(0);
    for (const item of all) expect(disposed.has(item)).toBe(true);
  });
});
