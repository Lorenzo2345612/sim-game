export interface RacingLine {
  offsets: Float64Array;
  points: Float64Array;
  dist: Float64Array;
  length: number;
}

const FD_EPS = 1e-4;
const MIN_DK = 1e-12;
const STEPS = [64, 32, 16, 8, 4, 2, 1] as const;

export function mengerCurvature(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const bcx = cx - bx;
  const bcz = cz - bz;
  const cross = abx * bcz - abz * bcx;
  if (cross === 0) return 0;
  const cax = ax - cx;
  const caz = az - cz;
  const denom =
    Math.sqrt(abx * abx + abz * abz) *
    Math.sqrt(bcx * bcx + bcz * bcz) *
    Math.sqrt(cax * cax + caz * caz);
  if (denom === 0) return 0;
  return (2 * cross) / denom;
}

function curvatureAt(pts: Float64Array, n: number, i: number, s: number): number {
  const ia = (((i - s) % n) + n) % n;
  const ic = (i + s) % n;
  return mengerCurvature(
    pts[2 * ia], pts[2 * ia + 1],
    pts[2 * i], pts[2 * i + 1],
    pts[2 * ic], pts[2 * ic + 1],
  );
}

// Per-index lateral bound is [-(left - margin), right - margin]; an inverted
// interval collapses to 0. Absent arrays the bound is the uniform halfWidth.
function clampTo(i: number, lo: Float64Array, hi: Float64Array, o: number): number {
  return o < lo[i] ? lo[i] : o > hi[i] ? hi[i] : o;
}

// K1999 (Coulom, TORCS): multi-resolution Newton steps on lateral offsets
// driving each sampled point's curvature toward its neighbours' average.
export function computeRacingLine(
  centerline: [number, number][],
  halfWidth: number,
  margin?: number,
  iterations = 25,
  halfWidthLeft?: readonly number[],
  halfWidthRight?: readonly number[],
): RacingLine {
  const n = centerline.length;
  if (n < 3) throw new Error('centerline needs at least 3 points');
  const perIndex =
    halfWidthLeft !== undefined &&
    halfWidthRight !== undefined &&
    halfWidthLeft.length === n &&
    halfWidthRight.length === n;
  // 1.4 m edge margin on the per-index bound; the uniform bound keeps the
  // historical 1.0 m default so absent-array callers are unchanged.
  const m = margin ?? (perIndex ? 1.4 : 1.0);
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  let anyBound = false;
  for (let i = 0; i < n; i++) {
    let a: number;
    let b: number;
    if (perIndex) {
      a = -(halfWidthLeft[i] - m);
      b = halfWidthRight[i] - m;
      if (a > b) {
        a = 0;
        b = 0;
      }
    } else {
      const bound = Math.max(0, halfWidth - m);
      a = -bound;
      b = bound;
    }
    lo[i] = a;
    hi[i] = b;
    if (a < 0 || b > 0) anyBound = true;
  }

  const nrmX = new Float64Array(n);
  const nrmZ = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const prev = centerline[(i - 1 + n) % n];
    const next = centerline[(i + 1) % n];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-9) {
      nrmX[i] = 0;
      nrmZ[i] = -1;
    } else {
      nrmX[i] = -dz / len;
      nrmZ[i] = dx / len;
    }
  }

  const offsets = new Float64Array(n);
  const points = new Float64Array(2 * n);

  const applyPoint = (i: number): void => {
    points[2 * i] = centerline[i][0] + offsets[i] * nrmX[i];
    points[2 * i + 1] = centerline[i][1] + offsets[i] * nrmZ[i];
  };
  for (let i = 0; i < n; i++) applyPoint(i);

  if (anyBound && iterations > 0) {
    for (const s of STEPS) {
      // s > n/4 would wrap the ±s stencil past half the ring and break its symmetry
      if (s > n / 4) continue;
      for (let pass = 0; pass < iterations; pass++) {
        for (let i = 0; i < n; i += s) {
          const k = curvatureAt(points, n, i, s);
          const km = curvatureAt(points, n, (((i - s) % n) + n) % n, s);
          const kp = curvatureAt(points, n, (i + s) % n, s);
          const target = 0.5 * (km + kp);
          const px = points[2 * i];
          const pz = points[2 * i + 1];
          points[2 * i] = px + FD_EPS * nrmX[i];
          points[2 * i + 1] = pz + FD_EPS * nrmZ[i];
          const dk = (curvatureAt(points, n, i, s) - k) / FD_EPS;
          points[2 * i] = px;
          points[2 * i + 1] = pz;
          if (Math.abs(dk) < MIN_DK) continue;
          offsets[i] = clampTo(i, lo, hi, offsets[i] + (target - k) / dk);
          applyPoint(i);
        }
      }
      for (let j = 0; j < n; j++) {
        if (j % s === 0) continue;
        const p = Math.floor(j / s) * s;
        let q = p + s;
        let seg = s;
        if (q >= n) {
          q = 0;
          seg = n - p;
        }
        const t = (j - p) / seg;
        offsets[j] = clampTo(j, lo, hi, offsets[p] * (1 - t) + offsets[q] * t);
        applyPoint(j);
      }
    }
  }

  const dist = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const dx = points[2 * i] - points[2 * i - 2];
    const dz = points[2 * i + 1] - points[2 * i - 1];
    acc += Math.sqrt(dx * dx + dz * dz);
    dist[i] = acc;
  }
  const cdx = points[0] - points[2 * n - 2];
  const cdz = points[1] - points[2 * n - 1];
  const length = acc + Math.sqrt(cdx * cdx + cdz * cdz);

  return { offsets, points, dist, length };
}
