import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

const R = 100;
const N = 120;

function circleTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: N }, (_, i) => {
    const a = (2 * Math.PI * i) / N;
    return [R * Math.cos(a), R * Math.sin(a)] as [number, number];
  });
  return {
    version: 2,
    id: 'edge-kerb',
    name: 'Edge Kerb',
    widthMeters: 12,
    lengthMeters: 2 * Math.PI * R,
    officialLengthMeters: 2 * Math.PI * R,
    centerline,
    sectors: [0, 40, 80],
    elevation: centerline.map(() => 0),
    kerbs: [{ start: 10, end: 30, side: 'left' }],
    runoffs: [
      { start: 0, end: N - 1, side: 'left', surface: 'runoff', widthMeters: 195 },
      { start: 0, end: N - 1, side: 'right', surface: 'runoff', widthMeters: 195 },
    ],
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

describe('176 kerb exemption edge cases', () => {
  it('EDGE3: kerb strips survive the overlap filter on a full-loop track with huge runoffs', () => {
    const strips = buildTrackSurfaces(circleTrack());
    const kerbs = strips.filter((s) => s.surface === 'kerb');
    expect(kerbs).toHaveLength(1);
    expect(kerbs[0].indices.length).toBeGreaterThan(0);
  });
});
