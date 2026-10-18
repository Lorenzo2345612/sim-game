import type { TrackDataV2 } from '../core/types';
import { cumulativeLengths } from '../track/centerline';
import { halfWidthAt } from '../track/surfaces';
import { mengerCurvature, type RacingLine } from './racingLine';

/** Frenet view of one car on the lap. */
export interface CarView {
  /** lap distance (m) */
  s: number;
  /** lateral from centerline (+ right, m) */
  d: number;
  /** speed (m/s) */
  v: number;
  halfLen: number;
  halfWid: number;
  stopped: boolean;
  offTrack: boolean;
}

/** Another car seen from `self`, gap wrapped into (−L/2, L/2]. */
export interface Neighbour {
  car: CarView;
  /** wrapped `other.s − self.s` (m) */
  gap: number;
}

/** Sampled track corridor; sample k sits at s = k·ds. */
export interface TrackCorridor {
  lapLength: number;
  ds: number;
  halfLeft: Float64Array;
  halfRight: Float64Array;
  lineD: Float64Array;
  profileV: Float64Array;
  curv: Float64Array;
}

export interface CorridorSample {
  halfLeft: number;
  halfRight: number;
  lineD: number;
  profileV: number;
  curv: number;
}

/** Shared bias for the lane planner and racecraft (tasks 259/260). */
export interface PlanBias {
  preferD: number | null;
  preferWeight: number;
  speedCap: number | null;
}

export interface BrakingPoint {
  distance: number;
  cornerSign: 1 | -1;
}

const STOP_SPEED = 3;
const STOP_TIME = 1.0 - 1e-9;
const OFF_TRACK_MARGIN = 0.3;
const BRAKE_SCAN = 400;
const BRAKE_DROP = 5;
const AHEAD_DEFAULT = 120;
const BEHIND_DEFAULT = 60;

// reused by isOffTrack / brakingPoint so per-tick calls allocate nothing
const scratch: CorridorSample = {
  halfLeft: 0,
  halfRight: 0,
  lineD: 0,
  profileV: 0,
  curv: 0,
};

/** Wrap a raw gap into (−L/2, L/2]; exactly −L/2 maps to +L/2. */
function wrapGap(raw: number, lapLength: number): number {
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

export function collectNeighbours(
  self: CarView,
  others: readonly CarView[],
  lapLength: number,
  out: Neighbour[],
  ahead: number = AHEAD_DEFAULT,
  behind: number = BEHIND_DEFAULT,
): number {
  let m = 0;
  for (const other of others) {
    const gap = wrapGap(other.s - self.s, lapLength);
    if (gap <= -behind || gap > ahead) continue;
    let slot = out[m];
    if (slot === undefined) {
      slot = { car: other, gap };
      out[m] = slot;
    } else {
      slot.car = other;
      slot.gap = gap;
    }
    m++;
  }
  for (let i = 1; i < m; i++) {
    const item = out[i];
    const key = Math.abs(item.gap);
    let j = i - 1;
    while (j >= 0 && Math.abs(out[j].gap) > key) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = item;
  }
  return m;
}

export function buildCorridor(
  track: TrackDataV2,
  line: RacingLine,
  speeds: Float64Array,
  ds: number = 2,
): TrackCorridor {
  const pts = track.centerline;
  const m = pts.length;
  const cum = cumulativeLengths(pts, true);
  const lapLength = cum[m];
  const n = Math.ceil(lapLength / ds);
  const halfLeft = new Float64Array(n);
  const halfRight = new Float64Array(n);
  const lineD = new Float64Array(n);
  const profileV = new Float64Array(n);
  const curv = new Float64Array(n);

  const lp = line.points;
  const kappa = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const ia = (((i - 1) % m) + m) % m;
    const ic = (i + 1) % m;
    kappa[i] = mengerCurvature(
      lp[2 * ia], lp[2 * ia + 1],
      lp[2 * i], lp[2 * i + 1],
      lp[2 * ic], lp[2 * ic + 1],
    );
  }

  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    while (seg < m - 1 && cum[seg + 1] <= s) seg++;
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (s - cum[seg]) / segLen : 0;
    const nxt = (seg + 1) % m;
    const l = halfWidthAt(track, 'left', seg);
    const l2 = halfWidthAt(track, 'left', nxt);
    halfLeft[k] = l + (l2 - l) * t;
    const r = halfWidthAt(track, 'right', seg);
    const r2 = halfWidthAt(track, 'right', nxt);
    halfRight[k] = r + (r2 - r) * t;
    const o = line.offsets[seg];
    const o2 = line.offsets[nxt];
    lineD[k] = o + (o2 - o) * t;
    const v = speeds[seg];
    const v2 = speeds[nxt];
    profileV[k] = v + (v2 - v) * t;
    const kv = kappa[seg];
    const kv2 = kappa[nxt];
    curv[k] = kv + (kv2 - kv) * t;
  }
  return { lapLength, ds, halfLeft, halfRight, lineD, profileV, curv };
}

export function corridorAt(c: TrackCorridor, s: number, out: CorridorSample): CorridorSample {
  const n = c.profileV.length;
  const sw = ((s % c.lapLength) + c.lapLength) % c.lapLength;
  const k = Math.min(Math.floor(sw / c.ds), n - 1);
  const k2 = k + 1 < n ? k + 1 : 0;
  const t = (sw - k * c.ds) / c.ds;
  out.halfLeft = c.halfLeft[k] + (c.halfLeft[k2] - c.halfLeft[k]) * t;
  out.halfRight = c.halfRight[k] + (c.halfRight[k2] - c.halfRight[k]) * t;
  out.lineD = c.lineD[k] + (c.lineD[k2] - c.lineD[k]) * t;
  out.profileV = c.profileV[k] + (c.profileV[k2] - c.profileV[k]) * t;
  out.curv = c.curv[k] + (c.curv[k2] - c.curv[k]) * t;
  return out;
}

export function brakingPoint(c: TrackCorridor, s: number, out?: BrakingPoint): BrakingPoint | null {
  const ds = c.ds;
  const steps = Math.floor(BRAKE_SCAN / ds);
  const v0 = corridorAt(c, s, scratch).profileV;
  let brakeS = -1;
  let vPrev = v0;
  for (let i = 1; i <= steps + 1; i++) {
    const cur = corridorAt(c, s + i * ds, scratch).profileV;
    if (i >= 2 && vPrev < v0 - BRAKE_DROP && cur < vPrev) {
      brakeS = s + (i - 1) * ds;
      break;
    }
    vPrev = cur;
  }
  if (brakeS < 0) return null;

  let cornerSign: 1 | -1 = 1;
  let a = corridorAt(c, brakeS, scratch).profileV;
  let b = corridorAt(c, brakeS + ds, scratch).profileV;
  for (let i = 2; i <= steps; i++) {
    const cur = corridorAt(c, brakeS + i * ds, scratch).profileV;
    if (a >= b && cur >= b && (a > b || cur > b)) {
      const kv = corridorAt(c, brakeS + (i - 1) * ds, scratch).curv;
      cornerSign = kv < 0 ? -1 : 1;
      break;
    }
    a = b;
    b = cur;
  }

  const res = out ?? { distance: 0, cornerSign: 1 };
  res.distance = brakeS - s;
  res.cornerSign = cornerSign;
  return res;
}

export class StopTracker {
  private timer = 0;

  update(v: number, dt: number, afterGo: boolean): boolean {
    if (!afterGo || v >= STOP_SPEED) this.timer = 0;
    else this.timer += dt;
    return this.stopped;
  }

  get stopped(): boolean {
    return this.timer >= STOP_TIME;
  }
}

export function isOffTrack(c: TrackCorridor, s: number, d: number): boolean {
  corridorAt(c, s, scratch);
  return d < -scratch.halfLeft - OFF_TRACK_MARGIN || d > scratch.halfRight + OFF_TRACK_MARGIN;
}
