import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner } from '../../../src/track/surfaces';

// Straight leg (0,0)->(30,0) with half-width 6, then a narrow leg (30,0)->(40,0)
// with right half-width 0.1; the ring closes far away.
function track(): TrackDataV2 {
  const centerline: [number, number][] = [
    [0, 0],
    [30, 0],
    [40, 0],
    [40, 30],
    [0, 30],
  ];
  return {
    version: 2,
    id: 'post-owner-seg',
    name: 'Post Owner Segment',
    widthMeters: 12,
    lengthMeters: 130,
    officialLengthMeters: 130,
    centerline,
    sectors: [0, 1, 2],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    halfWidthRight: [6, 0.1, 6, 6, 6],
    terrain: { originX: 20, originZ: 15, sizeX: 200, sizeZ: 200, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 asphaltOwner own-segment containment post-coder gaps', () => {
  it('POST1: a point past the wide segment end is not owned by it when the next segment is too narrow', () => {
    const owner = asphaltOwner(track());
    expect(owner(30.05, 5)).toBe(-1);
    expect(owner(29.9, 5)).toBe(0);
  });

  it('POST2: a margin below the narrow half-width still owns the narrow leg, the default margin does not', () => {
    const t = track();
    expect(asphaltOwner(t, 0)(30.05, 0.05)).toBe(1);
    expect(asphaltOwner(t)(30.05, 0.05)).toBe(-1);
  });
});
