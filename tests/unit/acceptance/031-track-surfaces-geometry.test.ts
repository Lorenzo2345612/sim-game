import { describe, it, expect } from 'vitest';
import type { RunoffSegment, SurfaceStrip, TrackDataV2, TrackSegment } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { fixture } from './022-fixture-trackdatav2';
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

function radial(strip: SurfaceStrip, i: number): number {
  return Math.hypot(strip.positions[3 * i], strip.positions[3 * i + 2]);
}

function yAt(strip: SurfaceStrip, i: number): number {
  return strip.positions[3 * i + 1];
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

function expectRadiusIn(strip: SurfaceStrip, candidates: number[]): void {
  for (let i = 0; i < strip.positions.length / 3; i++) {
    const r = radial(strip, i);
    expect(candidates.some((c) => Math.abs(r - c) <= 1e-3)).toBe(true);
  }
}

describe('031 track surfaces geometry acceptance', () => {
  it('AT1: flat circle with no kerbs or runoffs yields one asphalt strip of 240 vertices and 720 indices', () => {
    const strips = buildTrackSurfaces(circleV2(zeros(), [], []));
    expect(strips.length).toBe(1);
    const s = strips[0];
    expect(s.surface).toBe('asphalt');
    expect(s.positions.length / 3).toBe(240);
    for (let i = 0; i < 240; i += 2) {
      const r0 = radial(s, i);
      const r1 = radial(s, i + 1);
      const pair =
        (Math.abs(r0 - 94) <= 1e-3 && Math.abs(r1 - 106) <= 1e-3) ||
        (Math.abs(r0 - 106) <= 1e-3 && Math.abs(r1 - 94) <= 1e-3);
      expect(pair).toBe(true);
      expect(Math.abs(yAt(s, i) - 0.02)).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(yAt(s, i + 1) - 0.02)).toBeLessThanOrEqual(1e-4);
    }
    expect(s.indices.length).toBe(720);
    facesUp(s);
  });

  it('AT2: both vertices of point i sit at elevation[i] + 0.02', () => {
    const elevation = Array.from({ length: N }, (_, i) => (10 * i) / 119);
    const strips = buildTrackSurfaces(circleV2(elevation, [], []));
    const s = strips[0];
    for (let i = 0; i < N; i++) {
      expect(Math.abs(yAt(s, 2 * i) - (elevation[i] + 0.02))).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(yAt(s, 2 * i + 1) - (elevation[i] + 0.02))).toBeLessThanOrEqual(1e-4);
    }
  });

  it('AT3: left kerb 10..30 yields a 42-vertex kerb strip at radii 106 and 107.2 with u 0..1 and v = s/1.5', () => {
    const strips = buildTrackSurfaces(circleV2(zeros(), [{ start: 10, end: 30, side: 'left' }], []));
    expect(strips.length).toBe(2);
    const s = strips[1];
    expect(s.surface).toBe('kerb');
    expect(s.positions.length / 3).toBe(42);
    expectRadiusIn(s, [106, 107.2]);
    for (let i = 0; i < 42; i++) {
      expect(Math.abs(yAt(s, i) - 0.04)).toBeLessThanOrEqual(1e-4);
    }
    for (let j = 0; j <= 20; j++) {
      const vExp = (j * C) / 1.5;
      for (const k of [2 * j, 2 * j + 1]) {
        const inner = Math.abs(radial(s, k) - 106) <= 1e-3;
        expect(s.uvs[2 * k]).toBeCloseTo(inner ? 0 : 1, 5);
        expect(Math.abs(s.uvs[2 * k + 1] - vExp)).toBeLessThanOrEqual(1e-3);
      }
    }
    facesUp(s);
  });

  it('AT4: right gravel runoff 50..60 yields a 22-vertex strip at radii 94 and 76 and y 0.01', () => {
    const strips = buildTrackSurfaces(
      circleV2(zeros(), [], [{ start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 18 }]),
    );
    const s = strips[1];
    expect(s.surface).toBe('gravel');
    expect(s.positions.length / 3).toBe(22);
    expectRadiusIn(s, [94, 76]);
    for (let i = 0; i < 22; i++) {
      expect(Math.abs(yAt(s, i) - 0.01)).toBeLessThanOrEqual(1e-4);
    }
    facesUp(s);
  });

  it('AT5: a kerb under a runoff keeps order asphalt, kerb, gravel and pushes gravel outside the kerb', () => {
    const strips = buildTrackSurfaces(
      circleV2(
        zeros(),
        [{ start: 50, end: 60, side: 'right' }],
        [{ start: 50, end: 60, side: 'right', surface: 'gravel', widthMeters: 18 }],
      ),
    );
    expect(strips.map((s: SurfaceStrip) => s.surface)).toEqual(['asphalt', 'kerb', 'gravel']);
    expectRadiusIn(strips[1], [94, 92.8]);
    expectRadiusIn(strips[2], [92.8, 74.8]);
  });

  it('AT6: wrapped kerb 115..5 is finite, starts at point 115 and keeps inner spacing across index 0', () => {
    const strips = buildTrackSurfaces(circleV2(zeros(), [{ start: 115, end: 5, side: 'right' }], []));
    const s = strips[1];
    expect(s.positions.length / 3).toBe(22);
    for (let i = 0; i < s.positions.length; i++) {
      expect(Number.isFinite(s.positions[i])).toBe(true);
    }
    const innerOf = (pair: number): number => {
      const a = 2 * pair;
      const b = 2 * pair + 1;
      return Math.abs(radial(s, a) - 94) <= Math.abs(radial(s, b) - 94) ? a : b;
    };
    const first = innerOf(0);
    const theta = (2 * Math.PI * 115) / 120;
    expect(Math.abs(s.positions[3 * first] - 94 * Math.cos(theta))).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(s.positions[3 * first + 2] - 94 * Math.sin(theta))).toBeLessThanOrEqual(1e-3);
    for (let j = 0; j < 10; j++) {
      const p = innerOf(j);
      const q = innerOf(j + 1);
      const d = Math.hypot(s.positions[3 * q] - s.positions[3 * p], s.positions[3 * q + 2] - s.positions[3 * p + 2]);
      expect(Math.abs(d - (94 / 100) * C)).toBeLessThanOrEqual(1e-2);
    }
  });

  it('AT7: a kerb segment with a single point yields only the asphalt strip', () => {
    const strips = buildTrackSurfaces(circleV2(zeros(), [{ start: 7, end: 7, side: 'left' }], []));
    expect(strips.length).toBe(1);
    expect(strips[0].surface).toBe('asphalt');
  });
});
