import { describe, it, expect } from 'vitest';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;

function circleV2(elevation: number[], kerbs: TrackSegment[], runoffs: RunoffSegment[]): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation,
    kerbs,
    runoffs,
  };
}

function zeros(): number[] {
  return Array.from({ length: N }, () => 0);
}

function radial(strip: SurfaceStrip, i: number): number {
  return Math.hypot(strip.positions[3 * i], strip.positions[3 * i + 2]);
}

describe('buildTrackSurfaces', () => {
  it('mirrors a right-side kerb to the left-side kerb about the centerline', () => {
    const left = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'left' }], []))[1];
    const right = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'right' }], []))[1];
    expect(left.positions.length).toBe(right.positions.length);
    for (let i = 0; i < left.positions.length / 3; i++) {
      const pair = Math.floor(i / 2);
      const [cx, cz] = circleTrack.centerline[(10 + pair) % N];
      const mirror = [2 * pair, 2 * pair + 1].some((k) => {
        return (
          Math.abs(right.positions[3 * k] - (2 * cx - left.positions[3 * i])) <= 1e-3 &&
          Math.abs(right.positions[3 * k + 2] - (2 * cz - left.positions[3 * i + 2])) <= 1e-3
        );
      });
      expect(mirror).toBe(true);
      expect(radial(left, i)).toBeGreaterThan(100);
      expect(radial(right, i)).toBeLessThan(100);
    }
  });

  it('gives a kerb of k points exactly 2k vertices', () => {
    for (const [start, end] of [
      [10, 30],
      [115, 5],
      [0, 1],
    ] as const) {
      const k = ((end - start + N) % N) + 1;
      const s = buildTrackSurfaces(circleV2(zeros(), [{ start, end, side: 'left' }], []))[1];
      expect(s.positions.length / 3).toBe(2 * k);
    }
  });

  it('drops a strip whose segment has a single point', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [{ start: 7, end: 7, side: 'left' }],
        [{ start: 20, end: 20, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    expect(strips.length).toBe(3);
    expect(strips[0].surface).toBe('asphalt');
    expect(strips.slice(1).every((s) => s.surface === 'grass')).toBe(true);
  });

  it('keeps every index below the vertex count', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [
          { start: 115, end: 5, side: 'right' },
          { start: 7, end: 7, side: 'left' },
        ],
        [{ start: 40, end: 60, side: 'left', surface: 'runoff', widthMeters: 20 }],
      ),
    );
    for (const s of strips) {
      const count = s.positions.length / 3;
      for (const idx of s.indices) expect(idx).toBeLessThan(count);
    }
  });
});
