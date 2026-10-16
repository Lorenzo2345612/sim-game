import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { asphaltOwner } from '../../../src/track/surfaces';
import { trimEscapeRoads } from '../../../tools/track-builder/hazards';

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
    id: 'post-both-ends',
    name: 'Post Both Ends',
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

describe('176 trimEscapeRoads both-end mouths post-coder gaps', () => {
  it('POST1: a road that starts and ends on the asphalt keeps only its outside middle, width intact', () => {
    const owner = asphaltOwner(circleTrack());
    const out = trimEscapeRoads({
      ...circleTrack(),
      escapeRoads: [
        {
          points: [
            [202, -12],
            [210, -6],
            [220, 0],
            [210, 6],
            [202, 12],
          ],
          width: 7,
        },
      ],
    });
    expect(out.dropped).toBe(0);
    expect(out.roads).toHaveLength(1);
    expect(out.roads[0].width).toBe(7);
    expect(out.roads[0].points).toEqual([
      [210, -6],
      [220, 0],
      [210, 6],
    ]);
    for (const [x, z] of out.roads[0].points) expect(owner(x, z)).toBe(-1);
  });

  it('POST2: a single-point road is dropped and counted', () => {
    const out = trimEscapeRoads({
      ...circleTrack(),
      escapeRoads: [{ points: [[220, 0]], width: 6 }],
    });
    expect(out.roads).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });
});
