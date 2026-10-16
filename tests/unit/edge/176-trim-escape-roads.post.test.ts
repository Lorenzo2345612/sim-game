import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { escapeRoadStrips, stripOffenceRows } from '../../../src/track/surfaces';
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
    id: 'post-trim',
    name: 'Post Trim',
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

function withRoads(points: [number, number][], width = 6): TrackDataV2 {
  return { ...circleTrack(), escapeRoads: [{ points, width }] };
}

describe('176 trimEscapeRoads post-coder gaps', () => {
  it('POST1: no escape roads trims to { roads: [], dropped: 0 }', () => {
    expect(trimEscapeRoads(circleTrack())).toEqual({ roads: [], dropped: 0 });
  });

  it('POST2: a road entirely inside the asphalt is dropped and counted', () => {
    const out = trimEscapeRoads(withRoads([[200, -10], [200, 10]]));
    expect(out.roads).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });

  it('POST3: a road crossing another asphalt between its ends is dropped via interior offence rows', () => {
    const crossing: [number, number][] = [];
    for (let x = 220; x >= 180; x -= 5) crossing.push([x, 0]);
    const raw = escapeRoadStrips(withRoads(crossing))[0];
    const rows = stripOffenceRows(circleTrack(), raw);
    expect(rows.some((r) => r >= 2)).toBe(true);
    const out = trimEscapeRoads(withRoads(crossing));
    expect(out.roads).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });

  it('POST4: a road whose mouth sits on the asphalt is trimmed until every point is outside it', () => {
    const out = trimEscapeRoads(withRoads([[200, 0], [210, 0], [220, 0]]));
    expect(out.dropped).toBe(0);
    expect(out.roads).toHaveLength(1);
    const kept = out.roads[0].points;
    expect(kept[0]).toEqual([210, 0]);
    expect(kept[kept.length - 1]).toEqual([220, 0]);
  });

  it('POST5: stripOffenceRows is empty for a clean strip and head-only for a mouth on the track', () => {
    const track = circleTrack();
    const clean = escapeRoadStrips(withRoads([[215, -20], [215, 20]]))[0];
    expect(stripOffenceRows(track, clean)).toEqual([]);
    const onTrack = escapeRoadStrips(withRoads([[200, -10], [200, 10]]))[0];
    expect(stripOffenceRows(track, onTrack).every((r) => r <= 1)).toBe(true);
  });

  it('POST6: a road that cannot be cleared of asphalt offences is dropped and counted', () => {
    // Spine 7 m outside the asphalt with width 6: every strip row dips onto it,
    // so the head/tail trim can never produce a clean road.
    const out = trimEscapeRoads(withRoads([[207, -20], [207, 20]]));
    expect(out.roads).toHaveLength(0);
    expect(out.dropped).toBe(1);
  });
});
