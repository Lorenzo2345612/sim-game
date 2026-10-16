import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner } from '../../../src/track/surfaces';

const R = 200;
const N = 200;
const HW = 6;

function circleTrack(centerline: [number, number][]): TrackDataV2 {
  return {
    version: 2,
    id: 'post-owner',
    name: 'Post Owner',
    widthMeters: 2 * HW,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, 66, 133],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1000, sizeZ: 1000, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

const ring = Array.from({ length: N }, (_, i) => {
  const a = (2 * Math.PI * i) / N;
  return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
});
const track = circleTrack(ring);

describe('176 asphaltOwner limits post-coder gaps', () => {
  it('POST1: a margin above the half-width contains nothing; at the half-width only the centerline survives', () => {
    const p = track.centerline[3];
    expect(asphaltOwner(track, HW)(p[0], p[1])).not.toBe(-1);
    expect(asphaltOwner(track, HW + 1)(p[0], p[1])).toBe(-1);
    expect(asphaltOwner(track, HW - 0.1)(p[0], p[1])).not.toBe(-1);
  });

  it('POST2: a negative margin expands the asphalt beyond the half-width', () => {
    const p7 = track.centerline[7];
    const p8 = track.centerline[8];
    const dx = p8[0] - p7[0];
    const dz = p8[1] - p7[1];
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    const qx = p7[0] + 0.25 * dx;
    const qz = p7[1] + 0.25 * dz;
    const outside = [qx + nx * (HW + 0.2), qz + nz * (HW + 0.2)] as const;
    expect(asphaltOwner(track)(outside[0], outside[1])).toBe(-1);
    expect(asphaltOwner(track, -0.5)(outside[0], outside[1])).not.toBe(-1);
  });

  it('POST3: fewer than two centerline points answers -1 without throwing', () => {
    const one = circleTrack([[0, 0]]);
    const owner = asphaltOwner(one);
    expect(owner(0, 0)).toBe(-1);
    expect(owner(1e3, 1e3)).toBe(-1);
  });
});
