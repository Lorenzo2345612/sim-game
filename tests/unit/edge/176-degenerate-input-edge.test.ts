import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner, buildTrackSurfaces } from '../../../src/track/surfaces';
import { barrierRuns } from '../../../src/track/barrierPath';

function base(centerline: [number, number][]): TrackDataV2 {
  return {
    version: 2,
    id: 'edge-degenerate',
    name: 'Edge Degenerate',
    widthMeters: 12,
    lengthMeters: 100,
    officialLengthMeters: 100,
    centerline,
    sectors: [0, 0, 0],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [{ start: 0, end: centerline.length - 1, side: 'right', type: 'armco', offsetMeters: 8 }],
    terrain: { originX: 0, originZ: 0, sizeX: 1000, sizeZ: 1000, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 degenerate input edge cases', () => {
  it('EDGE6: zero radius and fewer than 3 centerline points do not throw and emit asphalt', () => {
    const dup = Array.from({ length: 120 }, (_, i) => {
      const a = (2 * Math.PI * i) / 120;
      return [100 * Math.cos(a), 100 * Math.sin(a)] as [number, number];
    });
    dup[5] = [dup[4][0], dup[4][1]];
    const zeroR = base(dup);
    expect(() => buildTrackSurfaces(zeroR)).not.toThrow();
    expect(buildTrackSurfaces(zeroR).some((s) => s.surface === 'asphalt')).toBe(true);
    expect(() => barrierRuns(zeroR, 'right')).not.toThrow();

    const two = base([
      [0, 0],
      [10, 0],
    ]);
    expect(() => buildTrackSurfaces(two)).not.toThrow();
    expect(buildTrackSurfaces(two).some((s) => s.surface === 'asphalt')).toBe(true);
    expect(() => barrierRuns(two, 'right')).not.toThrow();
    expect(() => asphaltOwner(two)(0, 0)).not.toThrow();
  });
});
