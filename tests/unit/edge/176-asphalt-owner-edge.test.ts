import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner } from '../../../src/track/surfaces';

const R = 200;
const N = 200;
const HW = 6;

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    version: 2,
    id: 'edge-circle',
    name: 'Edge Circle',
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

describe('176 asphaltOwner edge cases', () => {
  it('EDGE1: asphaltOwner uses halfWidthAt - margin, inclusive, per-segment containment', () => {
    const track = circleTrack();
    const owner = asphaltOwner(track);
    const p7 = track.centerline[7];
    const p8 = track.centerline[8];
    const dx = p8[0] - p7[0];
    const dz = p8[1] - p7[1];
    const len = Math.hypot(dx, dz);
    const nx = -dz / len;
    const nz = dx / len;
    // Quarter of the way along segment 7 -> 8, offset laterally off the segment line.
    const qx = p7[0] + 0.25 * dx;
    const qz = p7[1] + 0.25 * dz;
    const at = (t: number): [number, number] => [qx + nx * t, qz + nz * t];
    expect(owner(qx, qz)).toBe(7);
    expect(owner(...at(HW - 0.5))).toBe(7);
    expect(owner(...at(-(HW - 0.5)))).toBe(7);
    expect(owner(...at(HW - 0.4))).toBe(-1);
    expect(owner(...at(-(HW - 0.4)))).toBe(-1);
    expect(owner(1e4, 1e4)).toBe(-1);
    const owner0 = asphaltOwner(track, 0);
    expect(owner0(...at(HW - 0.1))).toBe(7);
    expect(owner0(...at(-(HW - 0.1)))).toBe(7);
    expect(owner0(...at(HW + 0.1))).toBe(-1);
  });
});
