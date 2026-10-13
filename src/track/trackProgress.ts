import type { Point2 } from './geo';
import { cumulativeLengths } from './centerline';

export interface ProgressSample { index: number; distance: number; lateral: number }

const WINDOW = 60;
const MIN_LEN2 = 1e-18; // (1e-9 m)^2

export class TrackProgress {
  readonly length: number;
  private readonly points: Point2[];
  private readonly cumulative: Float64Array;
  private readonly sample: ProgressSample = { index: 0, distance: 0, lateral: 0 };
  private lastIndex = -1;

  constructor(centerline: Point2[]) {
    const n = centerline.length;
    if (n < 3) throw new Error('TrackProgress: need at least 3 points');
    this.points = centerline;
    this.cumulative = cumulativeLengths(centerline, true);
    this.length = this.cumulative[n];
  }

  update(x: number, z: number): ProgressSample {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return this.sample;
    const n = this.points.length;
    const global = this.lastIndex < 0 || n <= 2 * WINDOW + 1;
    const count = global ? n : 2 * WINDOW + 1;
    let bestIndex = -1;
    let bestT = 0;
    let bestD2 = Infinity;
    for (let k = 0; k < count; k++) {
      const i = global ? k : (((this.lastIndex + k - WINDOW) % n) + n) % n;
      const a = this.points[i];
      const b = this.points[(i + 1) % n];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len2 = dx * dx + dz * dz;
      if (len2 < MIN_LEN2) continue;
      const rx = x - a[0];
      const rz = z - a[1];
      let t = (rx * dx + rz * dz) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const qx = a[0] + t * dx;
      const qz = a[1] + t * dz;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIndex = i;
        bestT = t;
      }
    }
    if (bestIndex < 0) return this.sample;
    // Closed ring: the end of the closing segment is the start of segment 0;
    // without this the sample sticks at distance = length and laps never wrap.
    if (bestIndex === n - 1 && bestT === 1) {
      bestIndex = 0;
      bestT = 0;
    }
    const a = this.points[bestIndex];
    const b = this.points[(bestIndex + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const segLen = this.cumulative[bestIndex + 1] - this.cumulative[bestIndex];
    const qx = a[0] + bestT * dx;
    const qz = a[1] + bestT * dz;
    const s = this.sample;
    s.index = bestIndex;
    s.distance = this.cumulative[bestIndex] + bestT * segLen;
    // right of travel direction; unsigned distance for a degenerate segment
    s.lateral = segLen > 0
      ? ((x - qx) * -dz + (z - qz) * dx) / segLen
      : Math.hypot(x - qx, z - qz);
    this.lastIndex = bestIndex;
    return s;
  }

  reset(): void {
    this.lastIndex = -1;
  }
}
