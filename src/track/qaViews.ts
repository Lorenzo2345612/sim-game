import type { TrackDataV2 } from '../core/types';
import { groundHeightAt } from './ground';

export interface QaView {
  name: string;
  eye: [number, number, number];
  target: [number, number, number];
}

const WINDOW = 10;           // curvature window half-length, metres
const MIN_SPACING = 150;     // minimum lap distance between corner apexes, metres
const MIN_CURVATURE = 1e-4;  // /m; flatter than this is not a corner
const APEX_PLATEAU = 0.98;   // contiguous indices within this fraction of the max form the apex
const START_BACK = 30;       // start eye distance behind index 0, metres
const EYE_BACK = 40;         // corner eye distance behind the apex, metres
const EYE_LATERAL = 15;      // corner eye offset to the outside of the turn, metres
const EYE_ABOVE_START = 6;
const EYE_ABOVE_GROUND = 8;

function wrapPi(a: number): number {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

export function qaViews(track: TrackDataV2, count: number): QaView[] {
  const n = track.centerline.length;
  const corners = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const views: QaView[] = [];
  if (n === 0) return views;

  const c0 = track.centerline[0];
  const c1 = track.centerline[n > 1 ? 1 : 0];
  const tx = c1[0] - c0[0];
  const tz = c1[1] - c0[1];
  const tlen = Math.hypot(tx, tz) || 1;
  const startView: QaView = {
    name: 'start',
    eye: [c0[0] - (START_BACK * tx) / tlen, (track.elevation[0] ?? 0) + EYE_ABOVE_START, c0[1] - (START_BACK * tz) / tlen],
    target: [c0[0], track.elevation[0] ?? 0, c0[1]],
  };

  const cum: number[] = [0];
  for (let i = 1; i < n; i++) {
    const dx = track.centerline[i][0] - track.centerline[i - 1][0];
    const dz = track.centerline[i][1] - track.centerline[i - 1][1];
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const segLen = (i: number): number => {
    const j = (i + 1) % n;
    return Math.hypot(track.centerline[j][0] - track.centerline[i][0], track.centerline[j][1] - track.centerline[i][1]);
  };
  const total = cum[n - 1] + segLen(n - 1);
  if (!(total > 0)) {
    views.push(startView);
    return views;
  }
  const arcAt = (i: number): number => ((cum[i] % total) + total) % total;

  // Unit tangent and interpolated point at a closed-lap arclength (binary search over cum).
  const headingAt = (s: number): { hx: number; hz: number; x: number; z: number } => {
    const t = ((s % total) + total) % total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const i = lo;
    const len = segLen(i) || 1;
    const f = Math.min(Math.max((t - cum[i]) / len, 0), 1);
    const ax = track.centerline[i][0];
    const az = track.centerline[i][1];
    const j = (i + 1) % n;
    return {
      hx: (track.centerline[j][0] - ax) / len,
      hz: (track.centerline[j][1] - az) / len,
      x: ax + (track.centerline[j][0] - ax) * f,
      z: az + (track.centerline[j][1] - az) * f,
    };
  };

  const curv: number[] = new Array(n);
  const turn: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = headingAt(arcAt(i) - WINDOW);
    const b = headingAt(arcAt(i) + WINDOW);
    const d = wrapPi(Math.atan2(b.hz, b.hx) - Math.atan2(a.hz, a.hx));
    turn[i] = d;
    curv[i] = Math.abs(d) / (2 * WINDOW);
  }

  // Apex = arclength centre of the contiguous indices around the pick with curvature >= 0.98 * max.
  const apexIndex = (pick: number, value: number): number => {
    const thr = APEX_PLATEAU * value;
    let lo = pick;
    let hi = pick;
    for (let span = 1; span < n && curv[(lo - 1 + n) % n] >= thr; span++) lo = (lo - 1 + n) % n;
    for (let span = 1; span < n && curv[(hi + 1) % n] >= thr; span++) hi = (hi + 1) % n;
    if (((hi - lo + n) % n) + 1 >= n) return pick;
    const mid = (arcAt(lo) + ((arcAt(hi) - arcAt(lo) + total) % total) / 2) % total;
    let best = pick;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.min(Math.abs(arcAt(i) - mid), total - Math.abs(arcAt(i) - mid));
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  const picks: { index: number; apex: number }[] = [];
  while (picks.length < corners) {
    const chosenArcs = picks.map((p) => arcAt(p.apex));
    let best = -1;
    let bestV = 0;
    let bestApex = 0;
    for (let i = 0; i < n; i++) {
      if (curv[i] < MIN_CURVATURE) continue;
      if (best >= 0 && curv[i] <= bestV) continue; // ties keep the lowest index
      const apex = apexIndex(i, curv[i]);
      const spaced = chosenArcs.every((a) => {
        const d = Math.abs(arcAt(apex) - a);
        return Math.min(d, total - d) >= MIN_SPACING;
      });
      if (!spaced) continue;
      bestV = curv[i];
      best = i;
      bestApex = apex;
    }
    if (best < 0) break;
    picks.push({ index: best, apex: bestApex });
  }

  const cornerViews = picks.map((p) => {
    const eyePt = headingAt(arcAt(p.apex) - EYE_BACK);
    // The centre of curvature lies along sign(turn) * (-hz, hx); the eye goes to the outside.
    const sign = turn[p.index] >= 0 ? -1 : 1;
    const ex = eyePt.x + EYE_LATERAL * (sign * -eyePt.hz);
    const ez = eyePt.z + EYE_LATERAL * (sign * eyePt.hx);
    return {
      apexArc: arcAt(p.apex),
      view: {
        eye: [ex, groundHeightAt(track, ex, ez) + EYE_ABOVE_GROUND, ez] as [number, number, number],
        target: [track.centerline[p.apex][0], track.elevation[p.apex] ?? 0, track.centerline[p.apex][1]] as [number, number, number],
      },
    };
  });
  cornerViews.sort((a, b) => a.apexArc - b.apexArc);
  cornerViews.forEach((c, k) => views.push({ name: `corner${k + 1}`, ...c.view }));

  views.unshift(startView);
  return views;
}
