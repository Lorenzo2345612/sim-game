import { readFileSync } from 'node:fs';
import { projectLonLat, type LonLat, type Point2 } from '../../src/track/geo';

export interface Arroyo {
  line: Point2[];
  width: number;
  /** True for permanent rivers; intermittent streams stay dry. */
  water?: boolean;
}

export interface Bridge {
  from: number;
  to: number;
}

export const ARROYO_DEPTH = 2.0;
export const ARROYO_BANK = 3;
export const ABUTMENT = 5;

interface AreaFeature {
  id: number | string;
  kind: string;
  closed: boolean;
  tags: Record<string, unknown>;
  ring: LonLat[];
}

export function distanceToPolyline(line: readonly Point2[], x: number, z: number): number {
  if (line.length === 0) return Infinity;
  let min = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let t = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - t * dx;
    const ez = z - az - t * dz;
    const d = Math.sqrt(ex * ex + ez * ez);
    if (d < min) min = d;
  }
  if (min === Infinity) {
    const [ax, az] = line[line.length - 1];
    min = Math.hypot(x - ax, z - az);
  }
  return min;
}

export function loadArroyos(areasJsonPath: string, origin: LonLat): Arroyo[] {
  let raw: string;
  try {
    raw = readFileSync(areasJsonPath, 'utf8');
  } catch {
    return [];
  }
  const areas = JSON.parse(raw) as { features?: AreaFeature[] };
  const out: Arroyo[] = [];
  for (const f of areas.features ?? []) {
    if (f.kind !== 'water' || f.closed) continue;
    const width = Number(f.tags?.est_width_m);
    if (!Number.isFinite(width) || width <= 0) continue;
    const line = projectLonLat(f.ring, origin);
    if (line.length < 2) continue;
    const water = f.tags?.waterway === 'river' && f.tags?.intermittent !== 'yes';
    out.push(water ? { line, width, water: true } : { line, width });
  }
  return out;
}

function arcLengths(centerline: Point2[]): number[] {
  const cum = new Array<number>(centerline.length);
  cum[0] = 0;
  for (let i = 1; i < centerline.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(
      centerline[i][0] - centerline[i - 1][0],
      centerline[i][1] - centerline[i - 1][1],
    );
  }
  return cum;
}

// Indices are rounded outward so the abutment is at least `meters` of arc.
function extendBack(cum: number[], i: number, meters: number): number {
  const target = cum[i] - meters;
  let lo = 0;
  while (lo + 1 < cum.length && cum[lo + 1] <= target) lo++;
  return lo;
}

function extendForward(cum: number[], i: number, meters: number): number {
  const target = cum[i] + meters;
  let hi = cum.length - 1;
  while (hi - 1 >= 0 && cum[hi - 1] >= target) hi--;
  return hi;
}

export function findBridges(centerline: Point2[], arroyos: Arroyo[]): Bridge[] {
  const n = centerline.length;
  if (n === 0 || arroyos.length === 0) return [];
  const inside = new Array<boolean>(n);
  for (let i = 0; i < n; i++) {
    const [x, z] = centerline[i];
    inside[i] = arroyos.some((a) => distanceToPolyline(a.line, x, z) <= a.width / 2);
  }
  const cum = arcLengths(centerline);
  const spans: Bridge[] = [];
  let i = 0;
  while (i < n) {
    if (!inside[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && inside[j + 1]) j++;
    spans.push({ from: extendBack(cum, i, ABUTMENT), to: extendForward(cum, j, ABUTMENT) });
    i = j + 1;
  }
  spans.sort((a, b) => a.from - b.from);
  const merged: Bridge[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + 1) {
      if (span.to > last.to) last.to = span.to;
    } else {
      merged.push({ ...span });
    }
  }
  for (const bridge of merged) {
    if (bridge.from <= 0 || bridge.to >= n - 1) {
      throw new Error('findBridges: corridor run touches the track start or end');
    }
  }
  return merged;
}

export function applyBridgeElevation(elevation: number[], bridges: Bridge[]): number[] {
  const out = elevation.slice();
  for (const b of bridges) {
    const span = b.to - b.from;
    if (span <= 0) continue;
    for (let i = b.from; i <= b.to; i++) {
      out[i] = elevation[b.from] + ((elevation[b.to] - elevation[b.from]) * (i - b.from)) / span;
    }
  }
  return out;
}

export function arroyoDepthAt(arroyos: Arroyo[], x: number, z: number): number {
  let max = 0;
  for (const a of arroyos) {
    const half = a.width / 2;
    const d = distanceToPolyline(a.line, x, z);
    if (d <= half) {
      if (ARROYO_DEPTH > max) max = ARROYO_DEPTH;
    } else if (d < half + ARROYO_BANK) {
      const depth = ARROYO_DEPTH * 0.5 * (1 + Math.cos((Math.PI * (d - half)) / ARROYO_BANK));
      if (depth > max) max = depth;
    }
  }
  return max;
}
