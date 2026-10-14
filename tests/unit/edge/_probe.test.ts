import { describe, it } from 'vitest';
import { computeRacingLine, mengerCurvature, type RacingLine } from '../../../src/ai/racingLine';
import { cornerSpeed, speedProfile, type CarLimits } from '../../../src/ai/speedProfile';

const G = 9.81;

function limits(over: Partial<CarLimits>): CarLimits {
  return { muLat: 1.5, muLong: 1.5, aeroK: 0, dragK: 0, powerPerMass: 1e6, vMax: 100, ...over };
}

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
  const ic = (i + 1) % n * 2;
  return Math.abs(mengerCurvature(points[ia], points[ia + 1], points[ib], points[ib + 1], points[ic], points[ic + 1]));
}

function aG(v: number, kappa: number, lim: CarLimits): number {
  const normal = G + lim.aeroK * v * v;
  const used = (v * v * kappa) / (lim.muLat * normal);
  return lim.muLong * normal * Math.sqrt(Math.max(0, 1 - used * used));
}

function feasibility(line: RacingLine, profile: Float64Array, lim: CarLimits) {
  const n = profile.length;
  let worstBrake = -Infinity;
  let worstAcc = -Infinity;
  let worstCorner = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ds = Math.hypot(line.points[2 * j] - line.points[2 * i], line.points[2 * j + 1] - line.points[2 * i + 1]);
    const v1 = profile[i];
    const v2 = profile[j];
    const ag = aG(v1, kappaAt(line.points, i), lim);
    if (v2 <= v1) {
      worstBrake = Math.max(worstBrake, (v1 * v1 - v2 * v2) / (2 * ds) - (ag + lim.dragK * v1 * v1));
    } else {
      worstAcc = Math.max(worstAcc, (v2 * v2 - v1 * v1) / (2 * ds) - (Math.min(ag, lim.powerPerMass / Math.max(v1, 1)) - lim.dragK * v1 * v1));
    }
    worstCorner = Math.max(worstCorner, v1 - cornerSpeed(kappaAt(line.points, i), lim));
  }
  return { worstBrake, worstAcc, worstCorner };
}

describe('probe', () => {
  it('AT5 fixture diagnostics', () => {
    const sq = roundedSquare();
    const line = computeRacingLine(sq.centerline, 6, 1);
    const lim = limits({ muLat: 1.6, muLong: 1.6, aeroK: 0.002, dragK: 0.0004, powerPerMass: 400, vMax: 80 });
    const p = speedProfile(line, lim);
    const n = p.length;
    let minI = 0;
    for (let i = 1; i < n; i++) if (p[i] < p[minI]) minI = i;
    console.log('n', n, 'minI', minI, 'apexes', sq.apex, 'min', p[minI]);
    console.log('feas', feasibility(line, p, lim));
    for (const a of sq.apex) {
      console.log('apex', a, 'v', p[a], 'corner', cornerSpeed(kappaAt(line.points, a), lim), 'kappa', kappaAt(line.points, a));
    }
    let maxV = 0;
    for (const v of p) maxV = Math.max(maxV, v);
    console.log('max', maxV, 'vMax', lim.vMax);
    // maximality: implied accel/decel vs available at non-capped points
    let worstLowBrake = Infinity;
    let worstLowAcc = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ds = Math.hypot(line.points[2 * j] - line.points[2 * i], line.points[2 * j + 1] - line.points[2 * i + 1]);
      const v1 = p[i];
      const v2 = p[j];
      const ag = aG(v1, kappaAt(line.points, i), lim);
      const cap = cornerSpeed(kappaAt(line.points, i), lim);
      if (v2 < v1 - 1e-9 && v1 < cap - 1e-6) {
        worstLowBrake = Math.min(worstLowBrake, (v1 * v1 - v2 * v2) / (2 * ds) / Math.max(ag + lim.dragK * v1 * v1, 1e-9));
      }
      if (v2 > v1 + 1e-9 && v2 < cornerSpeed(kappaAt(line.points, j), lim) - 1e-6) {
        worstLowAcc = Math.min(worstLowAcc, (v2 * v2 - v1 * v1) / (2 * ds) / Math.max(Math.min(ag, lim.powerPerMass / Math.max(v1, 1)) - lim.dragK * v1 * v1, 1e-9));
      }
    }
    console.log('worstLowBrake(ratio)', worstLowBrake, 'worstLowAcc(ratio)', worstLowAcc);
  });

  it('power-limited circle', () => {
    const cl: [number, number][] = [];
    for (let i = 0; i < 120; i++) {
      const a = (2 * Math.PI * i) / 120;
      cl.push([1000 * Math.cos(a), 1000 * Math.sin(a)]);
    }
    const line = computeRacingLine(cl, 6, 1);
    const lim = limits({ powerPerMass: 50, vMax: 100 });
    const p = speedProfile(line, lim);
    const n = p.length;
    let eqErr = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ds = Math.hypot(line.points[2 * j] - line.points[2 * i], line.points[2 * j + 1] - line.points[2 * i + 1]);
      const v1 = p[i];
      const v2 = p[j];
      const ag = aG(v1, kappaAt(line.points, i), lim);
      const a = Math.min(ag, lim.powerPerMass / Math.max(v1, 1)) - lim.dragK * v1 * v1;
      if (v2 > v1 && v2 < cornerSpeed(kappaAt(line.points, j), lim) - 1e-6) {
        eqErr = Math.max(eqErr, Math.abs((v2 * v2 - v1 * v1) / (2 * ds) - a));
        cnt++;
      }
    }
    console.log('power-limited: eqErr', eqErr, 'points', cnt, 'v0', p[0], 'vmax corner', cornerSpeed(1 / 1000, lim));
    const hi = speedProfile(line, limits({ powerPerMass: 1e6, vMax: 100 }));
    let lower = 0;
    for (let i = 0; i < n; i++) if (hi[i] < p[i] - 1e-9) lower++;
    console.log('hiPower below lowPower at', lower, 'points');
  });

  it('sparse triangle line feasibility', () => {
    const tri: RacingLine = (() => {
      const pts = Float64Array.from([0, 0, 400, 0, 200, 350]);
      const n = 3;
      const dist = new Float64Array(n);
      dist[1] = 400;
      dist[2] = Math.hypot(200 - 400, 350);
      return { offsets: new Float64Array(n), points: pts, dist, length: 1e9 };
    })();
    const lim = limits({ muLat: 1.2, muLong: 1.2, aeroK: 0.004, dragK: 0.001, powerPerMass: 300, vMax: 90 });
    const p = speedProfile(tri, lim);
    console.log('tri profile', Array.from(p), feasibility(tri, p, lim));
    const p2 = speedProfile(tri, limits({ muLat: 1.2, muLong: 1.2, aeroK: 0.004, dragK: 0.001, powerPerMass: 1e6, vMax: 90 }));
    console.log('tri profile hi power', Array.from(p2), feasibility(tri, p2, lim));
  });

  it('harsh dense line: tight corner, aero, low power', () => {
    // stadium: 2 straights 300 m + 2 hairpins R 25, spacing 2 m
    const cl: [number, number][] = [];
    let x = 0;
    let z = 0;
    let phi = 0;
    cl.push([0, 0]);
    const R = 25;
    for (let c = 0; c < 2; c++) {
      for (let t = 2; t <= 300; t += 2) {
        x += 2 * Math.cos(phi);
        z += 2 * Math.sin(phi);
        cl.push([x, z]);
      }
      const cx = x - R * Math.sin(phi);
      const cz = z + R * Math.cos(phi);
      const phi0 = phi;
      for (let k = 1; k <= 48; k++) {
        const a = phi0 + (k * Math.PI) / 48;
        x = cx + R * Math.sin(a);
        z = cz - R * Math.cos(a);
        phi = a;
        if (k === 48 && c === 1) break;
        cl.push([x, z]);
      }
    }
    const line = computeRacingLine(cl, 6, 1);
    const lim = limits({ muLat: 1.6, muLong: 1.6, aeroK: 0.003, dragK: 0.0006, powerPerMass: 350, vMax: 85 });
    const p = speedProfile(line, lim);
    console.log('stadium n', p.length, feasibility(line, p, lim));
    let minI = 0;
    for (let i = 1; i < p.length; i++) if (p[i] < p[minI]) minI = i;
    console.log('min', p[minI], 'at', minI, 'corner', cornerSpeed(kappaAt(line.points, minI), lim));
  });

  it('zero power / zero vMax behaviour', () => {
    const cl: [number, number][] = [];
    for (let i = 0; i < 40; i++) {
      const a = (2 * Math.PI * i) / 40;
      cl.push([100 * Math.cos(a), 100 * Math.sin(a)]);
    }
    const line = computeRacingLine(cl, 6, 1);
    const zeroV = speedProfile(line, limits({ vMax: 0 }));
    console.log('vMax0', Array.from(zeroV).slice(0, 5), 'allZero', Array.from(zeroV).every((v) => Object.is(v, 0)));
    const zeroP = speedProfile(line, limits({ powerPerMass: 0, dragK: 0 }));
    const uniq = new Set(Array.from(zeroP).map((v) => v.toFixed(9)));
    console.log('power0 drag0 distinct values', uniq.size, Array.from(uniq));
    const zeroP2 = speedProfile(line, limits({ powerPerMass: 0, dragK: 0.001 }));
    console.log('power0 drag>0 range', Math.min(...zeroP2), Math.max(...zeroP2));
  });
});
