import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';

// Two straights 6 m apart with U-turns: a barrier offset of 2 m (half-width) on
// either side stays clear of every distant centerline point.
function rectangleLoop(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 300; x += 2) pts.push([x, 0]);
  pts.push([300, 2], [300, 4]);
  for (let x = 300; x >= 2; x -= 2) pts.push([x, 6]);
  pts.push([0, 6], [0, 4], [0, 2]);
  return pts;
}

function track(): TrackDataV2 {
  const centerline = rectangleLoop();
  return {
    version: 2,
    id: 'post-full-ring',
    name: 'Post Full Ring',
    widthMeters: 4,
    lengthMeters: 624,
    officialLengthMeters: 624,
    centerline,
    sectors: [0, 102, 204],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [
      { start: 0, end: centerline.length - 1, side: 'right', type: 'armco', offsetMeters: 2 },
      { start: 0, end: centerline.length - 1, side: 'left', type: 'armco', offsetMeters: 2 },
    ],
    terrain: { originX: 150, originZ: 3, sizeX: 800, sizeZ: 100, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 barrier full-ring no-drop post-coder gaps', () => {
  it('POST1: full-ring barriers that cross nothing return one closed run with every index in order', () => {
    const t = track();
    const n = t.centerline.length;
    for (const side of ['right', 'left'] as const) {
      const runs = barrierRuns(t, side);
      expect(runs).toHaveLength(1);
      expect(runs[0].map((v) => v.index)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });
});
