import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function circleV2(
  elevation: number[],
  kerbs: TrackSegment[],
  runoffs: RunoffSegment[],
  centerline: [number, number][] = circleTrack.centerline,
): TrackDataV2 {
  return {
    ...fixture,
    version: 2,
    centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    elevation,
    kerbs,
    runoffs,
  };
}

function zeros(n = N): number[] {
  return Array.from({ length: n }, () => 0);
}

function radial(strip: SurfaceStrip, i: number): number {
  return Math.hypot(strip.positions[3 * i], strip.positions[3 * i + 2]);
}

function yAt(strip: SurfaceStrip, i: number): number {
  return strip.positions[3 * i + 1];
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

function expectFinite(strip: SurfaceStrip): void {
  for (let i = 0; i < strip.positions.length; i++) {
    expect(Number.isFinite(strip.positions[i])).toBe(true);
  }
  for (let i = 0; i < strip.uvs.length; i++) {
    expect(Number.isFinite(strip.uvs[i])).toBe(true);
  }
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

describe('031 track surfaces post-code edge cases', () => {
  it('POST1: an empty centerline yields no strips', () => {
    const strips = buildTrackSurfaces(circleV2([], [], [], []));
    expect(strips).toEqual([]);
  });

  it('POST2: missing elevation entries fall back to 0', () => {
    const strips = buildTrackSurfaces(circleV2([5], [{ start: 10, end: 12, side: 'left' }], []));
    const asphalt = strips[0];
    const kerb = strips[1];
    expect(Math.abs(yAt(asphalt, 0) - 5.02)).toBeLessThanOrEqual(1e-4);
    expect(Math.abs(yAt(asphalt, 1) - 5.02)).toBeLessThanOrEqual(1e-4);
    for (const k of [2, 3, 4]) {
      expect(Math.abs(yAt(asphalt, k) - 0.02)).toBeLessThanOrEqual(1e-4);
    }
    for (let j = 0; j <= 2; j++) {
      for (const k of [2 * j, 2 * j + 1]) {
        expect(Math.abs(yAt(kerb, k) - 0.04)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('POST3: segment indices outside 0..N-1 wrap into range', () => {
    const wrapped = buildTrackSurfaces(circleV2(zeros(), [{ start: -5, end: 5, side: 'right' }], []))[1];
    const inRange = buildTrackSurfaces(circleV2(zeros(), [{ start: 115, end: 5, side: 'right' }], []))[1];
    expect(Array.from(wrapped.positions)).toEqual(Array.from(inRange.positions));
    expect(Array.from(wrapped.uvs)).toEqual(Array.from(inRange.uvs));
    const shifted = buildTrackSurfaces(circleV2(zeros(), [{ start: 130, end: 140, side: 'left' }], []))[1];
    const base = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 20, side: 'left' }], []))[1];
    expect(Array.from(shifted.positions)).toEqual(Array.from(base.positions));
  });

  it('POST4: a full-ring segment yields one open strip of 2N vertices and (N-1) quads', () => {
    for (const seg of [
      { start: 0, end: N - 1, side: 'left' },
      { start: 5, end: 4, side: 'left' },
    ] as TrackSegment[]) {
      const s = buildTrackSurfaces(circleV2(zeros(), [seg], []))[1];
      expect(s.positions.length / 3).toBe(2 * N);
      expect(s.indices.length).toBe((N - 1) * 6);
      expectFinite(s);
      facesUp(s);
    }
  });

  it('POST5: zero runoff width emits a degenerate strip with coincident pair vertices', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 0 }]),
    );
    expect(strips.length).toBe(2);
    const s = strips[1];
    expect(s.positions.length / 3).toBe(26);
    for (let j = 0; j <= 12; j++) {
      expect(Math.abs(radial(s, 2 * j) - 94)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(radial(s, 2 * j + 1) - 94)).toBeLessThanOrEqual(1e-3);
    }
    expectFinite(s);
  });

  it('POST6: negative runoff width puts the outer edge at inner + width and still faces up', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: -18 }]),
    );
    const s = strips[1];
    expect(s.positions.length / 3).toBe(26);
    for (let j = 0; j <= 12; j++) {
      expectPairRadii(s, j, [94, 112]);
    }
    expectFinite(s);
    facesUp(s);
  });

  it('POST7: a wrapped kerb pushes the runoff only at the indices it covers', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [{ start: 115, end: 5, side: 'right' }],
        [{ start: 110, end: 10, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    const s = strips[2];
    expect(s.positions.length / 3).toBe(46);
    for (let j = 0; j <= 22; j++) {
      const pushed = j >= 6 && j <= 16;
      expectPairRadii(s, j, pushed ? [92.8, 74.8] : [94, 76]);
    }
  });

  it('POST8: degenerate rings stay finite', () => {
    const one = buildTrackSurfaces(circleV2([0], [], [], [[10, 0]]))[0];
    expect(one.positions.length / 3).toBe(2);
    expectFinite(one);
    const two = buildTrackSurfaces(circleV2([0, 0], [], [], [[0, 0], [10, 0]]))[0];
    expect(two.positions.length / 3).toBe(4);
    expectFinite(two);
    const dup = buildTrackSurfaces(circleV2([0, 0, 0], [], [], [[10, 0], [0, 10], [10, 0]]))[0];
    expect(dup.positions.length / 3).toBe(6);
    expectFinite(dup);
  });

  it('POST9: asphalt v accumulates real centerline distances on non-uniform spacing', () => {
    const centerline: [number, number][] = [
      [0, 0],
      [20, 0],
      [20, 10],
      [0, 10],
    ];
    const s = buildTrackSurfaces(circleV2(zeros(4), [], [], centerline))[0];
    expect(s.positions.length / 3).toBe(8);
    const sExp = [0, 20, 30, 50];
    for (let i = 0; i < 4; i++) {
      for (const k of [2 * i, 2 * i + 1]) {
        expect(s.uvs[2 * k + 1]).toBeCloseTo(sExp[i] / 10, 5);
      }
    }
    expectFinite(s);
  });

  it('POST10: negative elevation offsets asphalt, kerb and runoff heights', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        Array.from({ length: N }, () => -5),
        [{ start: 10, end: 12, side: 'right' }],
        [{ start: 50, end: 52, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    expect(Math.abs(yAt(strips[0], 0) - -4.98)).toBeLessThanOrEqual(1e-4);
    for (let j = 0; j <= 2; j++) {
      for (const k of [2 * j, 2 * j + 1]) {
        expect(Math.abs(yAt(strips[1], k) - -4.96)).toBeLessThanOrEqual(1e-4);
        expect(Math.abs(yAt(strips[2], k) - -4.99)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('POST11: left runoff uv uses signed lateral/10 with the outer edge further left', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 50, end: 60, side: 'left', surface: 'gravel', widthMeters: 18 }]),
    );
    const s = strips[1];
    for (let j = 0; j <= 12; j++) {
      expectPairRadii(s, j, [106, 124]);
      for (const k of [2 * j, 2 * j + 1]) {
        const inner = Math.abs(radial(s, k) - 106) <= 1e-3;
        expect(s.uvs[2 * k]).toBeCloseTo(inner ? -0.6 : -2.4, 5);
        expect(s.uvs[2 * k + 1]).toBeCloseTo(((j - 1) * C) / 10, 3);
      }
    }
  });

  it('POST12: right kerb u runs 0 at the asphalt edge to 1 at the outer edge', () => {
    const s = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'right' }], []))[1];
    for (let j = 0; j <= 20; j++) {
      for (const k of [2 * j, 2 * j + 1]) {
        const inner = Math.abs(radial(s, k) - 94) <= 1e-3;
        expect(s.uvs[2 * k]).toBeCloseTo(inner ? 0 : 1, 5);
      }
    }
  });

  it('POST13: src/track/surfaces.ts imports nothing from three', () => {
    const src = readFileSync(join(root, 'src/track/surfaces.ts'), 'utf8');
    expect(/\bfrom\s+['"]three['"]/.test(src)).toBe(false);
    expect(/\brequire\(['"]three['"]\)/.test(src)).toBe(false);
  });
});
