import { describe, it, expect } from 'vitest';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;

function circleV2(kerbs: TrackSegment[], runoffs: RunoffSegment[]): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs,
    runoffs,
  };
}

function rows(s: SurfaceStrip): number {
  return s.positions.length / 6;
}

function indexAt(s: SurfaceStrip, vertex: number): number {
  let idx = Math.round(Math.atan2(s.positions[3 * vertex + 2], s.positions[3 * vertex]) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

describe('surface transitions', () => {
  it('a runoff of n-1 rows gets no extension, one of n-2 rows fills the ring exactly', () => {
    const tight = buildTrackSurfaces(circleV2([], [{ start: 0, end: N - 2, side: 'right', surface: 'gravel', widthMeters: 8 }]))[1];
    expect(rows(tight)).toBe(N - 1);
    expect(indexAt(tight, 0)).toBe(0);
    expect(indexAt(tight, 2 * (N - 1) - 1)).toBe(N - 2);

    const full = buildTrackSurfaces(circleV2([], [{ start: 0, end: N - 3, side: 'right', surface: 'gravel', widthMeters: 8 }]))[1];
    expect(rows(full)).toBe(N);
    expect(indexAt(full, 0)).toBe(N - 1);
    expect(indexAt(full, 2 * N - 1)).toBe(N - 2);
  });

  it('adjacent same-side runoffs keep two strips and both extend into the shared seam', () => {
    const strips = buildTrackSurfaces(
      circleV2([], [
        { start: 10, end: 30, side: 'left', surface: 'gravel', widthMeters: 12 },
        { start: 31, end: 50, side: 'left', surface: 'gravel', widthMeters: 18 },
      ]),
    ).filter((s) => s.surface === 'gravel');
    expect(strips).toHaveLength(2);
    expect(rows(strips[0])).toBe(23);
    expect(indexAt(strips[0], 2 * 22)).toBe(31);
    expect(rows(strips[1])).toBe(22);
    expect(indexAt(strips[1], 0)).toBe(30);
  });

  it('a single-point segment still emits no strip', () => {
    const strips = buildTrackSurfaces(
      circleV2([{ start: 7, end: 7, side: 'left' }], [{ start: 20, end: 20, side: 'right', surface: 'gravel', widthMeters: 8 }]),
    );
    expect(strips.map((s) => s.surface)).toEqual(['asphalt', 'grass', 'grass']);
  });
});
