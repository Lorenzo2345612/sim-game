import { cumulativeLengths } from './centerline';

export interface AeroZone {
  start: number;
  end: number;
}

export const AERO_ZONE_WINDOW_M = 50;
export const AERO_ZONE_MAX_CURVATURE = 1 / 800;
export const AERO_ZONE_MIN_LENGTH_M = 300;

function mod(a: number, m: number): number {
  return ((a % m) + m) % m;
}

function nearestIndex(cum: Float64Array, n: number, total: number, arc: number): number {
  const a = mod(arc, total);
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= a) lo = mid;
    else hi = mid - 1;
  }
  const before = a - cum[lo];
  const after = cum[lo + 1] - a;
  const next = (lo + 1) % n;
  return after <= before ? next : lo;
}

export function deriveAeroZones(centerline: [number, number][]): AeroZone[] {
  const n = centerline.length;
  if (n < 3) return [];
  const cum = cumulativeLengths(centerline, true);
  const total = cum[n];
  if (!(total > 0)) return [];

  const heading = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = centerline[i];
    const b = centerline[(i + 1) % n];
    heading[i] = Math.atan2(b[1] - a[1], b[0] - a[0]);
  }

  const half = AERO_ZONE_WINDOW_M / 2;
  const straight = new Array<boolean>(n);
  let straightCount = 0;
  for (let i = 0; i < n; i++) {
    const ahead = heading[nearestIndex(cum, n, total, cum[i] + half)];
    const behind = heading[nearestIndex(cum, n, total, cum[i] - half)];
    let d = ahead - behind;
    d = mod(d + Math.PI, 2 * Math.PI) - Math.PI;
    if (d === -Math.PI) d = Math.PI;
    straight[i] = Math.abs(d) / AERO_ZONE_WINDOW_M < AERO_ZONE_MAX_CURVATURE;
    if (straight[i]) straightCount++;
  }

  if (straightCount === 0) return [];
  if (straightCount === n) return [{ start: 0, end: total }];

  const zones: AeroZone[] = [];
  for (let i = 0; i < n; i++) {
    if (!straight[i] || straight[(i - 1 + n) % n]) continue;
    let last = i;
    while (straight[(last + 1) % n]) last = (last + 1) % n;
    const length = mod(cum[last] - cum[i], total);
    if (length >= AERO_ZONE_MIN_LENGTH_M) zones.push({ start: cum[i], end: cum[i] + length });
  }
  zones.sort((a, b) => a.start - b.start);
  return zones;
}

export function inAeroZone(zones: readonly AeroZone[], d: number, lapLength: number): boolean {
  if (zones.length === 0) return false;
  for (const z of zones) {
    if (mod(d - z.start, lapLength) <= z.end - z.start) return true;
  }
  return false;
}
