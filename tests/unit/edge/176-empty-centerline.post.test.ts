import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner, buildTrackSurfaces } from '../../../src/track/surfaces';
import { barrierRuns } from '../../../src/track/barrierPath';

function base(centerline: [number, number][]): TrackDataV2 {
  return {
    version: 2,
    id: 'post-empty',
    name: 'Post Empty',
    widthMeters: 12,
    lengthMeters: 0,
    officialLengthMeters: 0,
    centerline,
    sectors: [0, 0, 0],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [{ start: 0, end: Math.max(0, centerline.length - 1), side: 'right', type: 'armco', offsetMeters: 8 }],
    terrain: { originX: 0, originZ: 0, sizeX: 1000, sizeZ: 1000, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 empty and single-point centerline post-coder gaps', () => {
  it('POST1: an empty centerline emits no strips, no barrier runs and an owner that answers -1', () => {
    const t = base([]);
    expect(buildTrackSurfaces(t)).toEqual([]);
    expect(barrierRuns(t, 'right')).toEqual([]);
    expect(asphaltOwner(t)(0, 0)).toBe(-1);
  });

  it('POST2: a single-point centerline does not throw', () => {
    const t = base([[0, 0]]);
    expect(() => buildTrackSurfaces(t)).not.toThrow();
    expect(() => barrierRuns(t, 'right')).not.toThrow();
    expect(asphaltOwner(t)(0, 0)).toBe(-1);
  });
});
