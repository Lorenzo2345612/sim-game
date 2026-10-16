import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

function narrowTrack(): TrackDataV2 {
  const centerline: [number, number][] = Array.from(
    { length: 40 },
    (_, i): [number, number] => [0, -2 * i],
  );
  return {
    version: 2,
    id: 'post-narrow',
    name: 'Post Narrow',
    widthMeters: 1.6,
    lengthMeters: 80,
    officialLengthMeters: 80,
    centerline,
    sectors: [0, 10, 20],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [{ start: 0, end: centerline.length - 1, side: 'right', surface: 'runoff', widthMeters: 8 }],
    barriers: [],
    terrain: { originX: 0, originZ: -40, sizeX: 100, sizeZ: 200, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 narrow track filter post-coder gaps', () => {
  it('POST1: a track narrower than 2 m keeps its asphalt and runoff strips', () => {
    const strips = buildTrackSurfaces(narrowTrack());
    const asphalt = strips.find((s) => s.surface === 'asphalt');
    const runoff = strips.find((s) => s.surface === 'runoff');
    expect(asphalt).toBeDefined();
    expect(asphalt!.indices.length).toBeGreaterThan(0);
    expect(runoff).toBeDefined();
    expect(runoff!.indices.length).toBeGreaterThan(0);
  });
});
