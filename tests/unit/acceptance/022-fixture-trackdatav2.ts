// Typed fixture for AT1: compiled by tsc from the acceptance test, not run by vitest.
import type { TrackDataV2, Surface, Terrain } from '../../../src/core/types';

const surfaces: Surface[] = ['asphalt', 'kerb', 'grass', 'gravel', 'runoff'];

const terrain: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 100,
  sizeZ: 100,
  rows: 2,
  cols: 2,
  heights: [0, 0, 0, 0],
};

export const fixture: TrackDataV2 = {
  version: 2,
  id: 'test-track',
  name: 'Test',
  widthMeters: 12,
  lengthMeters: 4,
  officialLengthMeters: 4,
  centerline: [
    [0, 0],
    [0, -2],
    [2, -2],
    [2, 0],
  ],
  sectors: [0, 1, 2],
  elevation: [0, 0, 0.1, 0.2],
  kerbs: [{ start: 1, end: 2, side: 'left' }],
  runoffs: [{ start: 0, end: 3, side: 'right', surface: 'gravel', widthMeters: 18 }],
  barriers: [{ start: 2, end: 1, side: 'left', type: 'tyres', offsetMeters: 8.5 }],
  terrain,
  treeSpecies: [{ name: 'oak', preset: 'Oak Medium', heightMeters: 18 }],
  trees: [{ species: surfaces[0], data: [1, 1, 1, 0] }],
  grandstands: [{ x: 0, z: 0, yaw: 0, lengthMeters: 20, rows: 3, roof: true }],
  pit: { start: 3, end: 0, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
};
