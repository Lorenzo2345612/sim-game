import { describe, it, expect } from 'vitest';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;
// Ring points sit on radial lines; the right normal on this CCW circle points inward.
// Positions are Float32Array: quantization at radius ~118 is ~7.7e-6.
const TOL = 1e-5;

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

function all(strips: SurfaceStrip[], kind: SurfaceStrip['surface']): SurfaceStrip[] {
  return strips.filter((s) => s.surface === kind);
}

function rows(s: SurfaceStrip): number {
  return s.positions.length / 6;
}

function indexAt(s: SurfaceStrip, vertex: number): number {
  let idx = Math.round(Math.atan2(s.positions[3 * vertex + 2], s.positions[3 * vertex]) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

function radial(s: SurfaceStrip, vertex: number): number {
  return Math.hypot(s.positions[3 * vertex], s.positions[3 * vertex + 2]);
}

function yAt(s: SurfaceStrip, row: number): number {
  return s.positions[6 * row + 1];
}

function vAt(s: SurfaceStrip, row: number): number {
  return s.uvs[4 * row + 1];
}

describe('096 surface transitions edge cases', () => {
  it('EDGE1: a kerb ending at n-2 still gets both extra rows, but one ending at n-1 (extension would wrap the ring) gets none', () => {
    const wrapped = all(buildTrackSurfaces(circleV2(zeros(), [{ start: 0, end: N - 2, side: 'left' }], [])), 'kerb')[0];
    expect(rows(wrapped)).toBe(N - 1);
    expect(indexAt(wrapped, 0)).toBe(0);
    expect(indexAt(wrapped, 2 * rows(wrapped) - 1)).toBe(N - 2);

    const overlap = all(buildTrackSurfaces(circleV2(zeros(), [{ start: 0, end: N - 3, side: 'left' }], [])), 'kerb')[0];
    expect(rows(overlap)).toBe(N);
    expect(indexAt(overlap, 0)).toBe(N - 1);
    expect(indexAt(overlap, 1)).toBe(N - 1);
    for (let j = 0; j < rows(overlap); j++) {
      expect(indexAt(overlap, 2 * j)).toBe((N - 1 + j) % N);
    }
    expect(indexAt(overlap, 2 * rows(overlap) - 1)).toBe(N - 2);
  });

  it('EDGE2: kerb 118..1 wrapping the ring seam extends to rows 117..2 in consecutive index order', () => {
    const s = all(buildTrackSurfaces(circleV2(zeros(), [{ start: 118, end: 1, side: 'left' }], [])), 'kerb')[0];
    expect(rows(s)).toBe(6);
    for (let j = 0; j < 6; j++) {
      expect(indexAt(s, 2 * j), `row ${j} col 0`).toBe((117 + j) % N);
      expect(indexAt(s, 2 * j + 1), `row ${j} col 1`).toBe((117 + j) % N);
    }
  });

  it('EDGE3: left kerb 10..12 gains one row each side (rows 9..13) keeping both lateral columns 106/107.2 in increasing-lateral order', () => {
    const s = all(buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 12, side: 'left' }], [])), 'kerb')[0];
    expect(rows(s)).toBe(5);
    for (let j = 0; j < 5; j++) {
      expect(indexAt(s, 2 * j)).toBe(9 + j);
      expect(Math.abs(radial(s, 2 * j) - 107.2)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(radial(s, 2 * j + 1) - 106)).toBeLessThanOrEqual(TOL);
    }
  });

  it('EDGE4: v is 0 at row 10, keeps the original row spacing and continues linearly into the extra rows (negative before start)', () => {
    const s = all(buildTrackSurfaces(circleV2(zeros(), [], [{ start: 10, end: 12, side: 'left', surface: 'gravel', widthMeters: 12 }])), 'gravel')[0];
    expect(rows(s)).toBe(5);
    const delta = vAt(s, 2) - vAt(s, 1);
    expect(delta).toBeGreaterThan(0);
    expect(Math.abs(vAt(s, 1))).toBeLessThanOrEqual(1e-6);
    for (let j = 1; j < 4; j++) {
      expect(Math.abs(vAt(s, j + 1) - vAt(s, j) - delta)).toBeLessThanOrEqual(1e-6);
    }
    expect(vAt(s, 0)).toBeLessThan(0);
    expect(Math.abs(vAt(s, 0) - (vAt(s, 1) - delta))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(vAt(s, 4) - (vAt(s, 3) + delta))).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE5: extra rows on an elevation ramp take elevation of their own index, not of start/end', () => {
    const elev = (i: number): number => 0.05 * i;
    const elevation = Array.from({ length: N }, (_, i) => elev(i));
    const strips = buildTrackSurfaces(
      circleV2(elevation, [{ start: 10, end: 12, side: 'left' }], [{ start: 20, end: 24, side: 'right', surface: 'gravel', widthMeters: 8 }]),
    );
    const kerb = all(strips, 'kerb')[0];
    expect(rows(kerb)).toBe(5);
    expect(indexAt(kerb, 0)).toBe(9);
    const offK = yAt(kerb, 1) - elev(10);
    for (let j = 0; j < rows(kerb); j++) {
      expect(Math.abs(yAt(kerb, j) - (elev(9 + j) + offK))).toBeLessThanOrEqual(1e-6);
    }
    const gravel = all(strips, 'gravel')[0];
    expect(rows(gravel)).toBe(7);
    expect(indexAt(gravel, 0)).toBe(19);
    const offG = yAt(gravel, 1) - elev(20);
    for (let j = 0; j < rows(gravel); j++) {
      expect(Math.abs(yAt(gravel, j) - (elev(19 + j) + offG))).toBeLessThanOrEqual(1e-6);
    }
  });

  it('EDGE6: runoff 15..25 beside kerb 15..25: pushed columns 92.8/82.8 inside, kerb-less columns 94/84 at extra rows 14 and 26', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [{ start: 15, end: 25, side: 'right' }], [{ start: 15, end: 25, side: 'right', surface: 'gravel', widthMeters: 10 }]),
    );
    const gravel = all(strips, 'gravel')[0];
    expect(rows(gravel)).toBe(13);
    for (let j = 0; j < 13; j++) {
      const idx = (14 + j) % N;
      expect(indexAt(gravel, 2 * j)).toBe(idx);
      const pushed = idx >= 15 && idx <= 25;
      const inner = pushed ? 92.8 : 94;
      const outer = pushed ? 82.8 : 84;
      expect(Math.abs(radial(gravel, 2 * j) - inner), `row idx ${idx}`).toBeLessThanOrEqual(TOL);
      expect(Math.abs(radial(gravel, 2 * j + 1) - outer), `row idx ${idx}`).toBeLessThanOrEqual(TOL);
    }
  });

  it('EDGE7: buildTrackSurfaces does not mutate the track input', () => {
    const track = circleV2(zeros(), [{ start: 118, end: 1, side: 'left' }], [{ start: 10, end: 12, side: 'right', surface: 'gravel', widthMeters: 12 }]);
    const before = JSON.stringify(track);
    buildTrackSurfaces(track);
    expect(JSON.stringify(track)).toBe(before);
  });

  it('EDGE8: kerb and runoff quads reach the extra rows (6 indices per cell between consecutive rows, last vertex referenced)', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [{ start: 10, end: 12, side: 'left' }], [{ start: 20, end: 22, side: 'right', surface: 'gravel', widthMeters: 10 }]),
    );
    for (const s of [...all(strips, 'kerb'), ...all(strips, 'gravel')]) {
      const k = rows(s);
      expect(k).toBe(5);
      expect(s.indices.length).toBe((k - 1) * 6);
      let max = -1;
      for (const ix of s.indices) max = Math.max(max, ix);
      expect(max).toBe(2 * k - 1);
    }
  });

  it('EDGE9: two kerbs and two runoffs keep one strip per segment in order asphalt, kerb, kerb, gravel, runoff, grass, grass', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [{ start: 10, end: 12, side: 'left' }, { start: 20, end: 22, side: 'right' }], [
        { start: 30, end: 32, side: 'left', surface: 'gravel', widthMeters: 12 },
        { start: 40, end: 42, side: 'right', surface: 'runoff', widthMeters: 12 },
      ]),
    );
    expect(strips.map((s) => s.surface)).toEqual(['asphalt', 'kerb', 'kerb', 'gravel', 'runoff', 'grass', 'grass']);
  });

  it('EDGE10: two same-surface runoffs stay separate strips, each extended, left rows 49..53 (118/106) and right rows 19..25 (94/86)', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [
        { start: 50, end: 52, side: 'left', surface: 'gravel', widthMeters: 12 },
        { start: 20, end: 24, side: 'right', surface: 'gravel', widthMeters: 8 },
      ]),
    );
    const gravel = all(strips, 'gravel');
    expect(gravel.length).toBe(2);
    expect(rows(gravel[0])).toBe(5);
    for (let j = 0; j < 5; j++) {
      expect(indexAt(gravel[0], 2 * j)).toBe(49 + j);
      expect(Math.abs(radial(gravel[0], 2 * j) - 118)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(radial(gravel[0], 2 * j + 1) - 106)).toBeLessThanOrEqual(TOL);
    }
    expect(rows(gravel[1])).toBe(7);
    for (let j = 0; j < 7; j++) {
      expect(indexAt(gravel[1], 2 * j)).toBe(19 + j);
      expect(Math.abs(radial(gravel[1], 2 * j) - 94)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(radial(gravel[1], 2 * j + 1) - 86)).toBeLessThanOrEqual(TOL);
    }
  });
});
