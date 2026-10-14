import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRacingLine } from '../../../src/ai/racingLine';
import {
  carLimitsFromSpec,
  cornerSpeed,
  speedProfile,
  type CarLimits,
} from '../../../src/ai/speedProfile';
import { parseCarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const G = 9.81;

function limits(over: Partial<CarLimits>): CarLimits {
  return { muLat: 1.5, muLong: 1.5, aeroK: 0, dragK: 0, powerPerMass: 1e6, vMax: 100, ...over };
}

function lineFrom(points: number[]): { offsets: Float64Array; points: Float64Array; dist: Float64Array; length: number } {
  const pts = Float64Array.from(points);
  const n = pts.length / 2;
  const dist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
    dist[i] = acc;
  }
  return { offsets: new Float64Array(n), points: pts, dist, length: acc };
}

describe('088 speedProfile unit', () => {
  it('cornerSpeed matches the closed form and uses |kappa|', () => {
    expect(cornerSpeed(0.01, limits({}))).toBeCloseTo(Math.sqrt((1.5 * G) / 0.01), 10);
    expect(cornerSpeed(-0.01, limits({}))).toBe(cornerSpeed(0.01, limits({})));
  });

  it('cornerSpeed returns vMax at and below the aero threshold', () => {
    const lim = limits({ aeroK: 0.003 });
    expect(cornerSpeed(0.0045, lim)).toBe(lim.vMax);
    expect(cornerSpeed(0.001, lim)).toBe(lim.vMax);
    expect(cornerSpeed(0.0046, lim)).toBe(lim.vMax);
  });

  it('speedProfile caps at vMax on a low-curvature circle', () => {
    const pts: number[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (2 * Math.PI * i) / 60;
      pts.push(500 * Math.cos(a), 500 * Math.sin(a));
    }
    const profile = speedProfile(lineFrom(pts), limits({ vMax: 40 }));
    const corner = Math.sqrt((1.5 * G) * 500);
    expect(corner).toBeGreaterThan(40);
    for (const v of profile) expect(v).toBe(40);
  });

  it('speedProfile throws on short lines and negative fuel; does not mutate input', () => {
    const short = lineFrom([0, 0, 10, 0]);
    expect(() => speedProfile(short, limits({}))).toThrow(Error);
    const pts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (2 * Math.PI * i) / 12;
      pts.push(100 * Math.cos(a), 100 * Math.sin(a));
    }
    const line = lineFrom(pts);
    const pointsBefore = Array.from(line.points);
    speedProfile(line, limits({ dragK: 0.001 }));
    expect(Array.from(line.points)).toEqual(pointsBefore);

    const json: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
    expect(() => carLimitsFromSpec(parseCarSpec(json), -1)).toThrow(Error);
  });

  it('carLimitsFromSpec scales mass-dependent fields with fuel', () => {
    const json: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'));
    const spec = parseCarSpec(json);
    const dry = carLimitsFromSpec(spec, 0);
    const wet = carLimitsFromSpec(spec, 50);
    expect(wet.aeroK * (spec.chassis.massKg + 50)).toBeCloseTo(dry.aeroK * spec.chassis.massKg, 10);
    expect(wet.dragK * (spec.chassis.massKg + 50)).toBeCloseTo(dry.dragK * spec.chassis.massKg, 10);
    expect(wet.vMax).toBe(dry.vMax);
    expect(wet.muLat).toBe(dry.muLat);
    for (const v of [dry.muLat, dry.aeroK, dry.dragK, dry.powerPerMass, dry.vMax]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('circle line with high power yields a constant profile at the corner speed', () => {
    const centerline = Array.from({ length: 48 }, (_, i) => {
      const a = (2 * Math.PI * i) / 48;
      return [200 * Math.cos(a), 200 * Math.sin(a)] as [number, number];
    });
    const line = computeRacingLine(centerline, 6, 1);
    const profile = speedProfile(line, limits({}));
    const target = cornerSpeed(1 / 200, limits({}));
    for (const v of profile) {
      expect(Math.abs(v - target)).toBeLessThanOrEqual(0.005 * target);
    }
  });
});
