import { describe, it, expect } from 'vitest';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces as buildAllSurfaces } from '../../../src/track/surfaces';
// Task 077 appends grass verge strips; these pre-077 contracts cover the other strips only.
const buildTrackSurfaces = (track: Parameters<typeof buildAllSurfaces>[0]) =>
  buildAllSurfaces(track).filter((strip) => strip.surface !== 'grass');
import { fixture } from '../acceptance/022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

const N = 120;
const R = 100;
const C = 2 * R * Math.sin(Math.PI / N);

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

function theta(i: number): number {
  return (2 * Math.PI * i) / N;
}

function onCircle(i: number, r: number): [number, number] {
  return [r * Math.cos(theta(i)), r * Math.sin(theta(i))];
}

function radial(strip: SurfaceStrip, i: number): number {
  return Math.hypot(strip.positions[3 * i], strip.positions[3 * i + 2]);
}

function yAt(strip: SurfaceStrip, i: number): number {
  return strip.positions[3 * i + 1];
}

function vertexNear(strip: SurfaceStrip, i: number, x: number, z: number): boolean {
  return Math.abs(strip.positions[3 * i] - x) <= 1e-3 && Math.abs(strip.positions[3 * i + 2] - z) <= 1e-3;
}

function facesUp(strip: SurfaceStrip): void {
  for (let t = 0; t + 2 < strip.indices.length; t += 3) {
    const a = strip.indices[t];
    const b = strip.indices[t + 1];
    const c = strip.indices[t + 2];
    const ux = strip.positions[3 * b] - strip.positions[3 * a];
    const uz = strip.positions[3 * b + 2] - strip.positions[3 * a + 2];
    const vx = strip.positions[3 * c] - strip.positions[3 * a];
    const vz = strip.positions[3 * c + 2] - strip.positions[3 * a + 2];
    expect(uz * vx - ux * vz).toBeGreaterThan(0);
  }
}

function expectPairRadii(strip: SurfaceStrip, j: number, candidates: number[]): void {
  for (const k of [2 * j, 2 * j + 1]) {
    const r = radial(strip, k);
    expect(candidates.some((c) => Math.abs(r - c) <= 1e-3)).toBe(true);
  }
  for (const c of candidates) {
    expect([2 * j, 2 * j + 1].some((k) => Math.abs(radial(strip, k) - c) <= 1e-3)).toBe(true);
  }
}

describe('031 track surfaces edge cases', () => {
  it('EDGE1: right-side kerb mirrors the left-side kerb about the centerline and faces up', () => {
    const left = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'left' }], []))[1];
    const right = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'right' }], []))[1];
    for (let j = 0; j <= 22; j++) {
      const [cx, cz] = onCircle(9 + j, R);
      expectPairRadii(left, j, [106, 107.2]);
      expectPairRadii(right, j, [94, 92.8]);
      for (const ka of [2 * j, 2 * j + 1]) {
        const ax = left.positions[3 * ka];
        const az = left.positions[3 * ka + 2];
        const mirrored = [2 * j, 2 * j + 1].some(
          (kb) =>
            Math.abs(right.positions[3 * kb] - (2 * cx - ax)) <= 1e-3 &&
            Math.abs(right.positions[3 * kb + 2] - (2 * cz - az)) <= 1e-3,
        );
        expect(mirrored).toBe(true);
        expect(yAt(right, ka)).toBeCloseTo(0.04, 4);
      }
    }
    facesUp(right);
  });

  it('EDGE2: a two-point open segment yields 4 rows (transition rows included) of 8 vertices and 18 indices', () => {
    const s = buildTrackSurfaces(circleV2(zeros(), [{ start: 0, end: 1, side: 'left' }], []))[1];
    expect(s.positions.length / 3).toBe(8);
    expect(s.indices.length).toBe(18);
    const used = new Set(Array.from(s.indices));
    expect(used).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7]));
    facesUp(s);
  });

  it('EDGE3: kerb and runoff strips keep the input array order of their segments', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [
          { start: 80, end: 82, side: 'right' },
          { start: 10, end: 12, side: 'left' },
        ],
        [
          { start: 40, end: 42, side: 'right', surface: 'gravel', widthMeters: 10 },
          { start: 20, end: 22, side: 'right', surface: 'runoff', widthMeters: 20 },
        ],
      ),
    );
    expect(strips.map((s: SurfaceStrip) => s.surface)).toEqual(['asphalt', 'kerb', 'kerb', 'gravel', 'runoff']);
    const starts = [79, 9, 39, 19];
    const innerRadii = [94, 106, 94, 94];
    for (let n = 0; n < 4; n++) {
      const s = strips[n + 1];
      const [ex, ez] = onCircle(starts[n], innerRadii[n]);
      expect(vertexNear(s, 0, ex, ez) || vertexNear(s, 1, ex, ez)).toBe(true);
    }
  });

  it('EDGE4: the asphalt closing quad links pair N-1 to pair 0', () => {
    const s = buildTrackSurfaces(circleV2(zeros(), [], []))[0];
    const tris: number[][] = [];
    for (let t = 0; t + 2 < s.indices.length; t += 3) {
      tris.push([s.indices[t], s.indices[t + 1], s.indices[t + 2]]);
    }
    expect(tris.some((tri) => tri.includes(238) && tri.includes(0))).toBe(true);
    expect(tris.some((tri) => tri.includes(239) && tri.includes(1))).toBe(true);
  });

  it('EDGE5: asphalt uv is (lateral/10, s/10) with signed lateral and s from point 0', () => {
    const s = buildTrackSurfaces(circleV2(zeros(), [], []))[0];
    for (let j = 0; j < N; j++) {
      expectPairRadii(s, j, [94, 106]);
      const vExp = (j * C) / 10;
      for (const k of [2 * j, 2 * j + 1]) {
        const uExp = Math.abs(radial(s, k) - 106) <= 1e-3 ? -0.6 : 0.6;
        expect(s.uvs[2 * k]).toBeCloseTo(uExp, 5);
        expect(s.uvs[2 * k + 1]).toBeCloseTo(vExp, 3);
      }
    }
  });

  it('EDGE6: runoff uv is (lateral/10, s/10) with s from the first point of the segment', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 18 }]),
    );
    const s = strips[1];
    for (let j = 0; j <= 12; j++) {
      expectPairRadii(s, j, [94, 76]);
      const vExp = ((j - 1) * C) / 10;
      for (const k of [2 * j, 2 * j + 1]) {
        const uExp = Math.abs(radial(s, k) - 94) <= 1e-3 ? 0.6 : 2.4;
        expect(s.uvs[2 * k]).toBeCloseTo(uExp, 5);
        expect(s.uvs[2 * k + 1]).toBeCloseTo(vExp, 3);
      }
    }
  });

  it('EDGE7: a kerb pushes the runoff band only at the indices it covers', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [{ start: 50, end: 60, side: 'right' }],
        [{ start: 40, end: 60, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    const s = strips[2];
    expect(s.positions.length / 3).toBe(46);
    for (let j = 0; j <= 22; j++) {
      expectPairRadii(s, j, j >= 11 && j <= 21 ? [92.8, 74.8] : [94, 76]);
    }
  });

  it('EDGE8: a kerb on the opposite side does not push the runoff', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [{ start: 50, end: 60, side: 'right' }],
        [{ start: 50, end: 60, side: 'left', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    const s = strips[2];
    expect(s.surface).toBe('gravel');
    for (let j = 0; j <= 12; j++) {
      expectPairRadii(s, j, [106, 124]);
    }
    facesUp(s);
  });

  it('EDGE9: a wrapped kerb keeps v = s/1.5 continuous across index 0', () => {
    const s = buildTrackSurfaces(circleV2(zeros(), [{ start: 115, end: 5, side: 'left' }], []))[1];
    for (let j = 0; j <= 12; j++) {
      const vExp = ((j - 1) * C) / 1.5;
      for (const k of [2 * j, 2 * j + 1]) {
        const inner = Math.abs(radial(s, k) - 106) <= 1e-3;
        expect(s.uvs[2 * k]).toBeCloseTo(inner ? 0 : 1, 5);
        expect(s.uvs[2 * k + 1]).toBeCloseTo(vExp, 3);
      }
    }
  });

  it('EDGE10: elevation sets the base height of kerb and runoff strips', () => {
    const elevation = Array.from({ length: N }, (_, i) => (3 * i) / 100);
    const strips = buildTrackSurfaces(
      circleV2(
        elevation,
        [{ start: 10, end: 12, side: 'left' }],
        [{ start: 50, end: 52, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    const kerb = strips[1];
    const gravel = strips[2];
    for (let j = 0; j <= 4; j++) {
      for (const k of [2 * j, 2 * j + 1]) {
        expect(yAt(kerb, k)).toBeCloseTo(elevation[9 + j] + 0.04, 4);
        expect(yAt(gravel, k)).toBeCloseTo(elevation[49 + j] + 0.01, 4);
      }
    }
  });
});
