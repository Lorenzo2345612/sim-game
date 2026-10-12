import type { Point2 } from './geo';

function dist(a: Point2, b: Point2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function catmullRomClosed(
  points: Point2[],
  samplesPerSegment: number,
  alpha = 0.5,
): Point2[] {
  const n = points.length;
  if (n < 3) throw new Error('catmullRomClosed: need at least 3 points');
  const d = (a: Point2, b: Point2): number =>
    Math.pow(Math.max(dist(a, b), 1e-6), alpha);
  const out: Point2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    const p3 = points[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + d(p0, p1);
    const t2 = t1 + d(p1, p2);
    const t3 = t2 + d(p2, p3);
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / samplesPerSegment;
      const c: Point2 = [0, 0];
      for (let axis = 0; axis < 2; axis++) {
        const a1 = ((t1 - t) / (t1 - t0)) * p0[axis] + ((t - t0) / (t1 - t0)) * p1[axis];
        const a2 = ((t2 - t) / (t2 - t1)) * p1[axis] + ((t - t1) / (t2 - t1)) * p2[axis];
        const a3 = ((t3 - t) / (t3 - t2)) * p2[axis] + ((t - t2) / (t3 - t2)) * p3[axis];
        const b1 = ((t2 - t) / (t2 - t0)) * a1 + ((t - t0) / (t2 - t0)) * a2;
        const b2 = ((t3 - t) / (t3 - t1)) * a2 + ((t - t1) / (t3 - t1)) * a3;
        c[axis] = ((t2 - t) / (t2 - t1)) * b1 + ((t - t1) / (t2 - t1)) * b2;
      }
      out.push(c);
    }
  }
  return out;
}

export function resampleClosed(points: Point2[], spacing: number): Point2[] {
  const n = points.length;
  if (n === 0) return [];
  const segLen = new Float64Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    segLen[i] = dist(points[i], points[(i + 1) % n]);
    total += segLen[i];
  }
  const N = Math.max(3, Math.round(total / spacing));
  const step = total / N;
  const out: Point2[] = [[points[0][0], points[0][1]]];
  let idx = 0;
  let segStart = 0;
  for (let k = 1; k < N; k++) {
    const target = k * step;
    while (idx < n - 1 && segStart + segLen[idx] <= target) {
      segStart += segLen[idx];
      idx++;
    }
    if (segLen[idx] === 0) {
      out.push([points[idx][0], points[idx][1]]);
      continue;
    }
    const s = (target - segStart) / segLen[idx];
    const a = points[idx];
    const b = points[(idx + 1) % n];
    out.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
  }
  return out;
}

export function cumulativeLengths(points: Point2[], closed: boolean): Float64Array {
  const n = points.length;
  if (n === 0) return closed ? new Float64Array([0]) : new Float64Array(0);
  const out = new Float64Array(closed ? n + 1 : n);
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + dist(points[i - 1], points[i]);
  if (closed) out[n] = out[n - 1] + dist(points[n - 1], points[0]);
  return out;
}
