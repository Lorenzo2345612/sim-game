import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRacingLine, mengerCurvature } from '../../../src/ai/racingLine';
import type { TrackDataV2 } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

const ROOT = join(__dirname, '..', '..', '..');
const HALF_WIDTH = 6;
const MARGIN = 1;

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

function flatten(cl: [number, number][]): Float64Array {
  const out = new Float64Array(cl.length * 2);
  for (let i = 0; i < cl.length; i++) {
    out[2 * i] = cl[i][0];
    out[2 * i + 1] = cl[i][1];
  }
  return out;
}

function maxAbsCurvature(points: Float64Array): number {
  const n = points.length / 2;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const ia = ((i + n - 1) % n) * 2;
    const ib = (i % n) * 2;
    const ic = ((i + 1) % n) * 2;
    const k = Math.abs(mengerCurvature(
      points[ia], points[ia + 1],
      points[ib], points[ib + 1],
      points[ic], points[ic + 1],
    ));
    if (k > max) max = k;
  }
  return max;
}

interface RoundedSquare {
  centerline: [number, number][];
  apex: number[];
  preCorner: number[];
  arcCenters: [number, number][];
}

// Turtle: 4 straights of 200 m joined by 90-degree right-hand arcs of R 30,
// 2 m spacing (arcs in 24 steps so each arc midpoint is an exact sample).
function roundedSquare(): RoundedSquare {
  const R = 30;
  const straight = 200;
  const arcSteps = 24;
  const centerline: [number, number][] = [];
  const apex: number[] = [];
  const preCorner: number[] = [];
  const arcCenters: [number, number][] = [];
  let x = 0;
  let z = 0;
  let phi = 0;
  centerline.push([0, 0]);
  for (let corner = 0; corner < 4; corner++) {
    for (let t = 2; t <= straight; t += 2) {
      x += 2 * Math.cos(phi);
      z += 2 * Math.sin(phi);
      centerline.push([x, z]);
      if (t === straight - 40) preCorner.push(centerline.length - 1);
    }
    const cx = x - R * Math.sin(phi);
    const cz = z + R * Math.cos(phi);
    arcCenters.push([cx, cz]);
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
  return { centerline, apex, preCorner, arcCenters };
}

function bytes(a: Float64Array): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

describe('087 racing line acceptance', () => {
  it('AT1: circle racing line sits on the outer bound at radius 105 +/- 0.05', () => {
    const line = computeRacingLine(circleTrack.centerline, HALF_WIDTH, MARGIN);
    for (let i = 0; i < line.points.length; i += 2) {
      const r = Math.hypot(line.points[i], line.points[i + 1]);
      expect(Math.abs(r - 105)).toBeLessThanOrEqual(0.05);
    }
  });

  it('AT2: rounded-square line runs wide before corners, cuts apexes and keeps max |kappa| <= 0.022', () => {
    const square = roundedSquare();
    const n = square.centerline.length;
    expect(maxAbsCurvature(flatten(square.centerline))).toBeCloseTo(0.0333, 3);
    const line = computeRacingLine(square.centerline, HALF_WIDTH, MARGIN);
    for (let c = 0; c < 4; c++) {
      const i = square.apex[c];
      const p = square.centerline[i];
      const ux = square.arcCenters[c][0] - p[0];
      const uz = square.arcCenters[c][1] - p[1];
      const ul = Math.hypot(ux, uz);
      const dx = line.points[2 * i] - p[0];
      const dz = line.points[2 * i + 1] - p[1];
      expect((dx * ux + dz * uz) / ul).toBeGreaterThanOrEqual(4.5);
    }
    for (let c = 0; c < 4; c++) {
      const i = square.preCorner[c];
      const p = square.centerline[i];
      const prev = square.centerline[(i + n - 1) % n];
      const next = square.centerline[(i + 1) % n];
      const tx = next[0] - prev[0];
      const tz = next[1] - prev[1];
      const ux = square.arcCenters[c][0] - p[0];
      const uz = square.arcCenters[c][1] - p[1];
      const along = (ux * tx + uz * tz) / (tx * tx + tz * tz);
      const lx = ux - along * tx;
      const lz = uz - along * tz;
      const ll = Math.hypot(lx, lz);
      const dx = line.points[2 * i] - p[0];
      const dz = line.points[2 * i + 1] - p[1];
      expect(-(dx * lx + dz * lz) / ll).toBeGreaterThanOrEqual(3.5);
    }
    expect(maxAbsCurvature(line.points)).toBeLessThanOrEqual(0.022);
  });

  it('AT3: monza line offsets stay within 5 m and max |kappa| <= 0.9 of the centerline', () => {
    const cl = loadTrack('monza').centerline;
    const line = computeRacingLine(cl, HALF_WIDTH, MARGIN);
    for (let i = 0; i < line.offsets.length; i++) {
      expect(Math.abs(line.offsets[i])).toBeLessThanOrEqual(5 + 1e-9);
    }
    expect(maxAbsCurvature(line.points))
      .toBeLessThanOrEqual(0.9 * maxAbsCurvature(flatten(cl)));
  });

  it('AT4: two monza runs produce byte-identical outputs', () => {
    const cl = loadTrack('monza').centerline;
    const a = computeRacingLine(cl, HALF_WIDTH, MARGIN);
    const b = computeRacingLine(cl, HALF_WIDTH, MARGIN);
    expect(bytes(a.offsets)).toEqual(bytes(b.offsets));
    expect(bytes(a.points)).toEqual(bytes(b.points));
    expect(bytes(a.dist)).toEqual(bytes(b.dist));
    expect(a.length).toBe(b.length);
  });

  it('AT5: monza racing line computes in under 3 s in Node', () => {
    const cl = loadTrack('monza').centerline;
    const t0 = performance.now();
    computeRacingLine(cl, HALF_WIDTH, MARGIN);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('AT6: mengerCurvature is 0 for collinear points and +0.02 for a right turn on R 50', () => {
    expect(mengerCurvature(0, 0, 1, 0, 2, 0)).toBeCloseTo(0, 9);
    const k = mengerCurvature(50, 0, 0, 50, -50, 0);
    expect(Math.abs(k - 0.02)).toBeLessThanOrEqual(1e-9);
  });
});
