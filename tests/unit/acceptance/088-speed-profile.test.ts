import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRacingLine, mengerCurvature } from '../../../src/ai/racingLine';
import {
  carLimitsFromSpec,
  cornerSpeed,
  speedProfile,
  type CarLimits,
} from '../../../src/ai/speedProfile';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { circleTrack } from '../../fixtures/circleTrack';

const ROOT = join(__dirname, '..', '..', '..');
const G = 9.81;

function limits(over: Partial<CarLimits>): CarLimits {
  return { muLat: 1.5, muLong: 1.5, aeroK: 0, dragK: 0, powerPerMass: 1e6, vMax: 100, ...over };
}

// Turtle: 4 straights of 200 m joined by 90-degree right-hand arcs of R 30,
// 2 m spacing (arcs in 24 steps so each arc midpoint is an exact sample).
function roundedSquare(): { centerline: [number, number][]; apex: number[] } {
  const R = 30;
  const straight = 200;
  const arcSteps = 24;
  const centerline: [number, number][] = [];
  const apex: number[] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  centerline.push([0, 0]);
  for (let corner = 0; corner < 4; corner++) {
    for (let t = 2; t <= straight; t += 2) {
      x += 2 * Math.cos(phi);
      z += 2 * Math.sin(phi);
      centerline.push([x, z]);
    }
    const cx = x - R * Math.sin(phi);
    const cz = z + R * Math.cos(phi);
    const phi0 = phi;
    for (let k = 1; k <= arcSteps; k++) {
      const a = phi0 + (k * Math.PI) / (2 * arcSteps);
      x = cx + R * Math.sin(a);
      z = cz - R * Math.cos(a);
      phi = a;
      if (k === arcSteps && corner === 3) break;
      centerline.push([x, z]);
      if (k === arcSteps / 2) apex.push(centerline.length - 1);
    }
  }
  return { centerline, apex };
}

function kappaAt(points: Float64Array, i: number): number {
  const n = points.length / 2;
  const ia = ((i - 1 + n) % n) * 2;
  const ib = (i % n) * 2;
  const ic = ((i + 1) % n) * 2;
  return Math.abs(
    mengerCurvature(
      points[ia], points[ia + 1],
      points[ib], points[ib + 1],
      points[ic], points[ic + 1],
    ),
  );
}

function aG(v: number, kappa: number, lim: CarLimits): number {
  const normal = G + lim.aeroK * v * v;
  const used = (v * v * kappa) / (lim.muLat * normal);
  return lim.muLong * normal * Math.sqrt(Math.max(0, 1 - used * used));
}

describe('088 speed profile acceptance', () => {
  it('AT1: cornerSpeed of kappa 0.01 with muLat 1.5, aeroK 0, vMax 100 is 38.361 ± 0.01', () => {
    const v = cornerSpeed(0.01, limits({}));
    expect(Math.abs(v - 38.361)).toBeLessThanOrEqual(0.01);
  });

  it('AT2: cornerSpeed with aeroK 0.003 is sqrt(14.715/0.0055) = 51.725 ± 0.01', () => {
    const v = cornerSpeed(0.01, limits({ aeroK: 0.003 }));
    expect(Math.abs(v - 51.7248)).toBeLessThanOrEqual(0.01);
  });

  it('AT3: cornerSpeed of kappa 0.004 with muLat 1.5, aeroK 0.003 returns vMax', () => {
    const lim = limits({ aeroK: 0.003 });
    expect(cornerSpeed(0.004, lim)).toBe(lim.vMax);
  });

  it('AT4: circle racing line profile is constant within 0.5% and between cornerSpeed(1/95) and cornerSpeed(1/105)', () => {
    const line = computeRacingLine(circleTrack.centerline, 6, 1);
    const profile = speedProfile(line, limits({}));
    expect(profile.length).toBe(line.points.length / 2);
    const sorted = Array.from(profile).sort((x, y) => x - y);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThanOrEqual(Math.sqrt((1.5 * G) / (1 / 95)) * 0.995);
    expect(median).toBeLessThanOrEqual(Math.sqrt((1.5 * G) / (1 / 105)) * 1.005);
    for (let i = 0; i < profile.length; i++) {
      expect(Math.abs(profile[i] - median)).toBeLessThanOrEqual(0.005 * median);
    }
  });

  it('AT5: rounded-square profile has its minimum inside the arcs, obeys the friction circle between points and never exceeds cornerSpeed', () => {
    const square = roundedSquare();
    const n = square.centerline.length;
    const line = computeRacingLine(square.centerline, 6, 1);
    const lim = limits({
      muLat: 1.6,
      muLong: 1.6,
      aeroK: 0.002,
      dragK: 0.0004,
      powerPerMass: 400,
      vMax: 80,
    });
    const profile = speedProfile(line, lim);
    expect(profile.length).toBe(n);

    let minI = 0;
    for (let i = 1; i < n; i++) {
      if (profile[i] < profile[minI]) minI = i;
    }
    const insideArc = square.apex.some((a) => {
      let d = (((minI - a) % n) + n) % n;
      if (d > n / 2) d -= n;
      return Math.abs(d) <= 12;
    });
    expect(insideArc).toBe(true);

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ds = Math.hypot(
        line.points[2 * j] - line.points[2 * i],
        line.points[2 * j + 1] - line.points[2 * i + 1],
      );
      const v1 = profile[i];
      const v2 = profile[j];
      const kappa = kappaAt(line.points, i);
      const ag = aG(v1, kappa, lim);
      if (v2 <= v1) {
        expect((v1 * v1 - v2 * v2) / (2 * ds))
          .toBeLessThanOrEqual(ag + lim.dragK * v1 * v1 + 1e-6);
      } else {
        expect((v2 * v2 - v1 * v1) / (2 * ds))
          .toBeLessThanOrEqual(
            Math.min(ag, lim.powerPerMass / Math.max(v1, 1)) - lim.dragK * v1 * v1 + 1e-6,
          );
      }
      expect(v1).toBeLessThanOrEqual(cornerSpeed(kappa, lim) + 1e-9);
    }
  });

  it('AT6: carLimitsFromSpec of f4.json with fuel 0 has finite positive fields and vMax in [55, 85]', () => {
    const json: unknown = JSON.parse(
      readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
    );
    const lim = carLimitsFromSpec(parseCarSpec(json), 0);
    for (const v of [lim.muLat, lim.muLong, lim.aeroK, lim.dragK, lim.powerPerMass, lim.vMax]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
    expect(lim.vMax).toBeGreaterThanOrEqual(55);
    expect(lim.vMax).toBeLessThanOrEqual(85);
  });
});
