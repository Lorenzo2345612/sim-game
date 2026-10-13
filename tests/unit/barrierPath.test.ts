import { describe, expect, it } from 'vitest';
import type { BarrierSegment, TrackDataV2 } from '../../src/core/types';
import { barrierRuns, type BarrierVertex } from '../../src/track/barrierPath';
import { fixture } from './acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../fixtures/circleTrack';

const N = 120;

function ringTrack(
  barriers: BarrierSegment[],
  elevation: number[] = Array.from({ length: N }, () => 0),
  centerline: [number, number][] = circleTrack.centerline,
): TrackDataV2 {
  return {
    ...fixture,
    centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    officialLengthMeters: circleTrack.officialLengthMeters,
    elevation,
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

describe('barrierRuns', () => {
  it('empty barriers and an empty centerline give no runs and never throw', () => {
    expect(barrierRuns(ringTrack([]), 'left')).toEqual([]);
    expect(barrierRuns(ringTrack([]), 'right')).toEqual([]);
    const empty: TrackDataV2 = { ...ringTrack([]), centerline: [], elevation: [] };
    expect(() => barrierRuns(empty, 'left')).not.toThrow();
    expect(barrierRuns(empty, 'left')).toEqual([]);
  });

  it('a single covered index yields a one-vertex run', () => {
    const runs = barrierRuns(
      ringTrack([{ start: 30, end: 30, side: 'left', type: 'tyres', offsetMeters: 10 }]),
      'left',
    );
    expect(runs.length).toBe(1);
    expect(runs[0].length).toBe(1);
    expect(runs[0][0].index).toBe(30);
    expect(runs[0][0].type).toBe('tyres');
  });

  it('segment ends are inclusive and a wrapped segment is one run starting at start', () => {
    const runs = barrierRuns(
      ringTrack([{ start: 110, end: 10, side: 'right', type: 'armco', offsetMeters: 5 }]),
      'right',
    );
    expect(runs.length).toBe(1);
    expect(runs[0].map((v: BarrierVertex) => v.index)).toEqual(
      Array.from({ length: 21 }, (_, k) => (110 + k) % N),
    );
  });

  it('full coverage gives one closed run of n vertices starting at index 0', () => {
    const runs = barrierRuns(
      ringTrack([
        { start: 0, end: 59, side: 'left', type: 'armco', offsetMeters: 10 },
        { start: 60, end: 119, side: 'left', type: 'wall', offsetMeters: 20 },
      ]),
      'left',
    );
    expect(runs.length).toBe(1);
    expect(runs[0].length).toBe(N);
    expect(runs[0][0].index).toBe(0);
    expect(runs[0][N - 1].index).toBe(N - 1);
  });

  it('a gap joins the wrap into one run that starts at the first covered index', () => {
    const runs = barrierRuns(
      ringTrack([
        { start: 0, end: 39, side: 'left', type: 'armco', offsetMeters: 10 },
        { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 10 },
      ]),
      'left',
    );
    expect(runs.length).toBe(1);
    expect(runs[0][0].index).toBe(60);
    expect(runs[0][runs[0].length - 1].index).toBe(39);
  });

  it('separated ranges give independent runs in first-index order', () => {
    const runs = barrierRuns(
      ringTrack([
        { start: 60, end: 79, side: 'left', type: 'wall', offsetMeters: 15 },
        { start: 0, end: 39, side: 'left', type: 'armco', offsetMeters: 10 },
      ]),
      'left',
    );
    expect(runs.map((r) => r[0].index)).toEqual([0, 60]);
    expect(runs.map((r) => r.length)).toEqual([40, 20]);
  });

  it('the last segment covering an index wins for offset and type', () => {
    const runs = barrierRuns(
      ringTrack([
        { start: 0, end: 70, side: 'left', type: 'wall', offsetMeters: 10 },
        { start: 50, end: 119, side: 'left', type: 'armco', offsetMeters: 20 },
      ]),
      'left',
    );
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run[49].type).toBe('wall');
    expect(Math.hypot(run[49].x, run[49].z)).toBeCloseTo(110, 12);
    expect(run[50].type).toBe('armco');
    expect(Math.hypot(run[50].x, run[50].z)).toBeCloseTo(120, 12);
  });

  it('vertices sit at centerline + sign·offset·rightNormal with y from elevation, no rounding', () => {
    const elevation = Array.from({ length: N }, (_, i) => i * 0.05);
    const track = ringTrack(
      [{ start: 10, end: 20, side: 'right', type: 'armco', offsetMeters: 10 }],
      elevation,
    );
    const run = barrierRuns(track, 'right')[0];
    const cx = track.centerline;
    for (let k = 0; k < run.length; k++) {
      const v = run[k];
      const i = v.index;
      const [rx, rz] = rightNormalAt(cx, i);
      expect(v.x).toBe(cx[i][0] + 10 * rx);
      expect(v.z).toBe(cx[i][1] + 10 * rz);
      expect(v.y).toBe(elevation[i]);
    }
    const left = barrierRuns(
      ringTrack([{ start: 10, end: 20, side: 'left', type: 'armco', offsetMeters: 10 }]),
      'left',
    )[0];
    const [rx, rz] = rightNormalAt(cx, 15);
    expect(left[5].x).toBe(cx[15][0] - 10 * rx);
    expect(left[5].z).toBe(cx[15][1] - 10 * rz);
  });

  it('missing elevation entries fall back to 0 and degenerate normals use [0,-1]', () => {
    const cx: [number, number][] = [0, 1, 2, 3].map((i) => (i % 2 === 0 ? [0, 0] : [10, 0])) as [
      number,
      number,
    ][];
    const track = ringTrack(
      [{ start: 0, end: 3, side: 'right', type: 'armco', offsetMeters: 2 }],
      [0, 1],
      cx,
    );
    const run = barrierRuns(track, 'right')[0];
    expect(run.map((v) => v.index)).toEqual([0, 1, 2, 3]);
    for (const v of run) {
      expect(Number.isFinite(v.x)).toBe(true);
      expect(Number.isFinite(v.z)).toBe(true);
      expect(v.z).toBe(-2);
    }
    expect(run[0].y).toBe(0);
    expect(run[1].y).toBe(1);
    expect(run[2].y).toBe(0);
    expect(run[3].y).toBe(0);
  });

  it('sides are independent and the track object is not mutated', () => {
    const track = ringTrack([
      { start: 0, end: 59, side: 'left', type: 'wall', offsetMeters: 12 },
      { start: 0, end: 119, side: 'right', type: 'tyres', offsetMeters: 6 },
    ]);
    const before = JSON.stringify(track);
    const left = barrierRuns(track, 'left');
    const right = barrierRuns(track, 'right');
    expect(JSON.stringify(track)).toBe(before);
    expect(left[0].length).toBe(60);
    expect(right[0].length).toBe(N);
    expect(right[0][0].type).toBe('tyres');
    expect(barrierRuns(track, 'left')[0][0].type).toBe('wall');
  });
});
