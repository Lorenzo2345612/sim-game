import { describe, it, expect } from 'vitest';
import { spawnFromTrack } from '../../../src/game/game';
import type { TrackData, TrackDataV2 } from '../../../src/core/types';

const CENTERLINE: [number, number][] = [
  [0, 0],
  [0, -2],
  [0, -4],
  [0, -6],
  [0, -8],
  [0, -10],
];

function v2Track(elevation: number[]): TrackDataV2 {
  return {
    version: 2,
    id: 'spawn-test',
    name: 'Spawn Test',
    widthMeters: 12,
    lengthMeters: 12,
    officialLengthMeters: 12,
    centerline: CENTERLINE,
    sectors: [0, 1, 2],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 1, side: 'right' },
    source: { dataset: 'test', license: 'test', url: 'https://example.com', dem: 'test.tif' },
  };
}

const V1_TRACK: TrackData = {
  id: 'spawn-test-v1',
  name: 'Spawn Test V1',
  widthMeters: 12,
  lengthMeters: 12,
  officialLengthMeters: 12,
  centerline: CENTERLINE,
  sectors: [0, 1, 2],
  source: { dataset: 'test', license: 'test', url: 'https://example.com' },
};

describe('game spawn with elevation (task 043)', () => {
  it('spawn y is elevation[N-5] + 0.6 on a v2 track', () => {
    // N = 6 → N-5 = 1; elevation[1] = 12 → y = 12.6.
    const pose = spawnFromTrack(v2Track([0, 12, 0, 0, 0, 0]));
    expect(Math.abs(pose.position.y - 12.6)).toBeLessThanOrEqual(1e-9);
    expect(pose.position.x).toBeCloseTo(CENTERLINE[1][0], 9);
    expect(pose.position.z).toBeCloseTo(CENTERLINE[1][1], 9);
  });

  it('spawn y is 0.6 on a v1 track without elevation', () => {
    expect(spawnFromTrack(V1_TRACK).position.y).toBeCloseTo(0.6, 9);
  });

  it('spawn y falls back to 0.6 when the elevation entry is missing', () => {
    expect(spawnFromTrack(v2Track([])).position.y).toBeCloseTo(0.6, 9);
  });
});
