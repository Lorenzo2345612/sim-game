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

function makeTrack(
  barriers: BarrierSegment[],
  centerline: [number, number][] = Array.from({ length: POINTS }, (_, i): [number, number] => [i * 10, 0]),
): TrackDataV2 {
  return {
    ...fixture,
    widthMeters: 12,
    centerline,
    lengthMeters: 990,
    elevation: centerline.map(() => 0),
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

function build(t: TrackDataV2, style?: ResolvedTrackStyle): ReturnType<typeof createBarrierObject> {
  return createBarrierObject(t, stubTexture, style);
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

describe('185 barrier fence style post-code gaps', () => {
  it('POST1: a wall-only track gets a fence when types include wall, and none with the default types', () => {
    const wallOnly = makeTrack([BARRIERS[1]]);
    const def = build(wallOnly);
    expect(def.group.getObjectByName('fence')).toBeUndefined();
    expect(fenceMeters(def.group)).toBe(0);
    def.dispose();
    const styled = build(
      wallOnly,
      styleWith((b) => {
        b.fence.types = ['wall'];
      }),
    );
    expect(styled.group.getObjectByName('armco')).toBeUndefined();
    expect(mesh(styled.group, 'fence')).toBeDefined();
    expect(Math.abs(fenceMeters(styled.group) - 200)).toBeLessThanOrEqual(2);
    styled.dispose();
  });

  it('POST2: the edge into a different-type vertex takes that vertex height: 190 m armco-only, 300 m with wall too', () => {
    const contiguous = makeTrack([
      { start: 10, end: 30, side: 'left', type: 'armco', offsetMeters: 8 },
      { start: 30, end: 40, side: 'left', type: 'wall', offsetMeters: 8 },
    ]);
    const armcoOnly = build(contiguous);
    expect(Math.abs(fenceMeters(armcoOnly.group) - 190)).toBeLessThanOrEqual(2);
    armcoOnly.dispose();
    const both = build(
      contiguous,
      styleWith((b) => {
        b.fence.types = ['armco', 'wall'];
      }),
    );
    expect(Math.abs(fenceMeters(both.group) - 300)).toBeLessThanOrEqual(2);
    both.dispose();
  });

  describe('closed whole-lap run', () => {
    const N = 64;
    const R = 100;
    const chord = 2 * (R + 8) * Math.sin(Math.PI / N);
    const circle = Array.from(
      { length: N },
      (_, i): [number, number] => [R * Math.cos((i * 2 * Math.PI) / N), R * Math.sin((i * 2 * Math.PI) / N)],
    );
    const lap = makeTrack(
      [{ start: 0, end: N - 1, side: 'left', type: 'armco', offsetMeters: 8 }],
      circle,
    );

    it('POST3: fenceMeters counts the closing edge of the closed run', () => {
      const { group, dispose } = build(lap);
      expect(fenceMeters(group)).toBeCloseTo(N * chord, 2);
      dispose();
    });

    it('POST4: a first vertex of height 0 drops only the closing edge', () => {
      const { group, dispose } = build(
        lap,
        styleWith((b) => {
          b.ranges = [{ start: 0, end: 0, side: 'left', fenceHeightMeters: 0 }];
        }),
      );
      expect(fenceMeters(group)).toBeCloseTo((N - 1) * chord, 2);
      dispose();
    });
  });

  it('POST5: a negative fence height below the 0-8 parser limits fences nothing', () => {
    const { group, dispose } = build(
      track,
      styleWith((b) => {
        b.fence.heightMeters = -2;
      }),
    );
    expect(group.getObjectByName('fence')).toBeUndefined();
    expect(fenceMeters(group)).toBe(0);
    dispose();
  });

  it('POST6: empty fence.types fences nothing at any height', () => {
    const { group, dispose } = build(
      track,
      styleWith((b) => {
        b.fence.types = [];
      }),
    );
    expect(group.getObjectByName('fence')).toBeUndefined();
    expect(fenceMeters(group)).toBe(0);
    dispose();
  });

  it('POST7: a range wins over a global height of 0 and fences only its own span at 4 m', () => {
    const { group, dispose } = build(
      track,
      styleWith((b) => {
        b.fence.heightMeters = 0;
        b.ranges = [{ start: 60, end: 80, side: 'right', fenceHeightMeters: 4 }];
      }),
    );
    expect(Math.abs(fenceMeters(group) - 200)).toBeLessThanOrEqual(2);
    const bbox = box(mesh(group, 'fence'));
    expect(bbox.max.y - bbox.min.y).toBeCloseTo(4, 2);
    dispose();
  });

  it('POST8: one mesh holds per-edge heights: armco quads top at 3 m and range quads at 4 m', () => {
    const { group, dispose } = build(
      track,
      styleWith((b) => {
        b.ranges = [{ start: 60, end: 80, side: 'right', fenceHeightMeters: 4 }];
      }),
    );
    const pos = mesh(group, 'fence').geometry.getAttribute('position');
    const tops = new Set<number>();
    for (let i = 0; i < pos.count; i++) tops.add(Math.round(pos.getY(i) * 1000) / 1000);
    expect([...tops].sort((a, b) => a - b)).toEqual([0, 3, 4]);
    dispose();
  });

  it('POST9: the band sits 0.01 m toward the track on both sides and is DoubleSide', () => {
    const twoWalls = makeTrack([
      BARRIERS[1],
      { start: 60, end: 80, side: 'right', type: 'wall', offsetMeters: 8 },
    ]);
    const { group, dispose } = build(
      twoWalls,
      styleWith((b) => {
        b.concrete.bandColor = '#dac400';
      }),
    );
    const band = mesh(group, 'wallBand');
    expect((band.material as THREE.MeshStandardMaterial).side).toBe(THREE.DoubleSide);
    const b = box(band);
    expect(b.min.z).toBeCloseTo(-7.99, 2);
    expect(b.max.z).toBeCloseTo(7.99, 2);
    dispose();
  });

  it('POST10: a side-less range applies to barriers of both sides', () => {
    const bothSides = makeTrack([
      { start: 60, end: 80, side: 'left', type: 'armco', offsetMeters: 8 },
      BARRIERS[2],
    ]);
    const types = (b: ResolvedTrackStyle['barriers']): void => {
      b.fence.types = ['armco', 'tyres'];
    };
    const full = build(bothSides, styleWith(types));
    expect(Math.abs(fenceMeters(full.group) - 400)).toBeLessThanOrEqual(2);
    full.dispose();
    const leftOnly = build(
      bothSides,
      styleWith((b) => {
        types(b);
        b.ranges = [{ start: 60, end: 80, side: 'left', fenceHeightMeters: 0 }];
      }),
    );
    expect(Math.abs(fenceMeters(leftOnly.group) - 200)).toBeLessThanOrEqual(2);
    leftOnly.dispose();
    const noSide = build(
      bothSides,
      styleWith((b) => {
        types(b);
        b.ranges = [{ start: 60, end: 80, fenceHeightMeters: 0 }];
      }),
    );
    expect(fenceMeters(noSide.group)).toBe(0);
    noSide.dispose();
  });

  it('POST11: the band adds no textures and its material carries no maps', () => {
    const plain: string[] = [];
    const withBand: string[] = [];
    const plainBar = createBarrierObject(track, (u) => (plain.push(u), stubTexture(u)));
    plainBar.dispose();
    const bandBar = createBarrierObject(
      track,
      (u) => (withBand.push(u), stubTexture(u)),
      styleWith((b) => {
        b.concrete.bandColor = '#dac400';
      }),
    );
    const material = mesh(bandBar.group, 'wallBand').material as THREE.MeshStandardMaterial;
    expect(material.map ?? null).toBeNull();
    expect(material.alphaMap ?? null).toBeNull();
    expect(material.normalMap ?? null).toBeNull();
    expect(material.roughnessMap ?? null).toBeNull();
    bandBar.dispose();
    expect(withBand).toEqual(plain);
  });
});
