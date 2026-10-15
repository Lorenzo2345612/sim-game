import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

const R = 50;
const N = 180;
const HW = 6;

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    version: 2,
    id: 'edge-clamp',
    name: 'Edge Clamp',
    widthMeters: 2 * HW,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, 60, 120],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [{ start: 0, end: N - 1, side: 'right', surface: 'runoff', widthMeters: 50 }],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 500, sizeZ: 500, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 inner clamp edge cases', () => {
  it('EDGE4: inner-side runoff lateral offset is clamped to 0.9 x radius of curvature', () => {
    const track = circleTrack();
    const strips = buildTrackSurfaces(track);
    const runoff = strips.find((s) => s.surface === 'runoff');
    expect(runoff).toBeDefined();
    const cx = track.centerline;
    const cap = 0.9 * R;
    for (let j = 0; j < N; j++) {
      const prev = cx[(j - 1 + N) % N];
      const next = cx[(j + 1) % N];
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz);
      const rx = -dz / len;
      const rz = dx / len;
      for (const [col, expected] of [[0, HW], [1, cap]] as const) {
        const v = 3 * (2 * j + col);
        const lat = (runoff!.positions[v] - cx[j][0]) * rx + (runoff!.positions[v + 2] - cx[j][1]) * rz;
        expect(lat, `row ${j} col ${col}`).toBeCloseTo(expected, 2);
      }
    }
  });
});
