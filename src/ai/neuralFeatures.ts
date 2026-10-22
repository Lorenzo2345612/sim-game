import { LOOK, PROD, N_NEAR, N_IN_V1 } from './neuralPolicy';
import { cumulativeLengths } from '../track/centerline';
import { KERB_WIDTH } from '../core/constants';
import { computeRacingLine } from './racingLine';

export interface NeuralCarState {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  forwardSpeed: number;
  linvel: { x: number; y: number; z: number };
  angvel: { x: number; y: number; z: number };
  /** TrackProgress sample of this car (index, distance along lap, lateral from centerline). */
  progress: { index: number; distance: number; lateral: number };
  fuelMassKg: number;
  tempFrontC: number;
  tempRearC: number;
  optTempC: number;
  tempWindowC: number;
  wearMean: number; // 0..1
  offWheels: number; // wheels not on asphalt/kerb
  compoundGrip: number; // mu0/muMedium − 1
  /** Self excluded, player included. */
  others: ReadonlyArray<{ position: { x: number; y: number; z: number }; linvel: { x: number; y: number; z: number } }>;
}

/** Look-ahead target line (same indexing as the centerline) and, for mintime, its QSS speed profile. */
export interface NeuralLine {
  points: readonly [number, number][];
  mintimeSpeed?: ArrayLike<number>;
}

/** Racing line clamped to the usable width: kerbs count (minus a 0.3 m margin), plain edges keep 0.6 m. */
export function racingTargetPoints(
  centerline: readonly [number, number][],
  halfWidthLeft: readonly number[],
  halfWidthRight: readonly number[],
  kerbLeft: readonly boolean[],
  kerbRight: readonly boolean[],
): [number, number][] {
  const cl = centerline, n = cl.length;
  const useL = new Float64Array(n), useR = new Float64Array(n);
  let maxUse = 0;
  for (let i = 0; i < n; i++) {
    useL[i] = halfWidthLeft[i] + (kerbLeft[i] ? KERB_WIDTH - 0.3 : -0.6);
    useR[i] = halfWidthRight[i] + (kerbRight[i] ? KERB_WIDTH - 0.3 : -0.6);
    maxUse = Math.max(maxUse, useL[i], useR[i]);
  }
  const rl = computeRacingLine(cl as [number, number][], maxUse, 0);
  return cl.map((c, i) => {
    const a = cl[(i - 1 + n) % n], b = cl[(i + 1) % n], tx = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(tx, tz) || 1;
    const rx = -tz / l, rz = tx / l;
    const lat = (rl.points[2 * i] - c[0]) * rx + (rl.points[2 * i + 1] - c[1]) * rz;
    const q = Math.max(-useL[i], Math.min(useR[i], lat));
    return [c[0] + rx * q, c[1] + rz * q] as [number, number];
  });
}

const MU_G = 1.5 * 9.81;
const DECEL = 11;
const CORNER_AHEAD = 150; // m scanned for the next corner
const BRAKE_AHEAD = 300; // m scanned for the next braking zone
const BRAKE_DV = 0.05; // m/s drop per centerline segment that counts as braking
const MAX_CARS = 64; // neighbour buffer size (matches the trainer worlds)

// Per-track feature extraction for the neural policy: centerline speed profile,
// cumulative lengths and half widths are built once; fill() writes N_IN doubles
// with no allocation, byte-for-byte equivalent to the trainer in scripts/evolve/worker.mts.
export class NeuralFeatures {
  private readonly points: readonly [number, number][]; // centerline
  private readonly tgt: readonly [number, number][];
  private readonly n: number;
  private readonly cum: Float64Array;
  private readonly L: number;
  private readonly hwL: Float64Array;
  private readonly hwR: Float64Array;
  private readonly vProf: Float64Array;
  private readonly corner: Float64Array; // signed curvature of the strongest corner within CORNER_AHEAD m (right turn > 0)
  private readonly brakeD: Float64Array; // m to the next braking zone (0 inside one)
  private readonly nd = new Float64Array(MAX_CARS);
  private readonly ni = new Int32Array(MAX_CARS);
  private px = 0;
  private pz = 0;
  private pi = 0;

  constructor(
    centerline: readonly [number, number][],
    halfWidthLeft: readonly number[],
    halfWidthRight: readonly number[],
    line?: NeuralLine,
  ) {
    const n = centerline.length;
    this.points = centerline;
    const tgt = line ? line.points : centerline;
    this.tgt = tgt;
    this.n = n;
    this.cum = cumulativeLengths(centerline as [number, number][], true);
    this.L = this.cum[n];
    this.hwL = Float64Array.from(halfWidthLeft);
    this.hwR = Float64Array.from(halfWidthRight);
    this.vProf = new Float64Array(n);
    // Corner speed sqrt(MU_G/kappa), kappa from points ±10 m; backward passes with constant decel.
    for (let i = 0; i < n; i++) {
      this.sampleAt(this.cum[i] - 10, i, tgt);
      const ax = this.px, az = this.pz;
      const b = tgt[i];
      this.sampleAt(this.cum[i] + 10, i, tgt);
      const cx = this.px, cz = this.pz;
      const ab = Math.hypot(b[0] - ax, b[1] - az);
      const bc = Math.hypot(cx - b[0], cz - b[1]);
      const ca = Math.hypot(ax - cx, az - cz);
      const cross = Math.abs((b[0] - ax) * (cz - az) - (b[1] - az) * (cx - ax));
      const kappa = (2 * cross) / Math.max(ab * bc * ca, 1e-6);
      this.vProf[i] = Math.min(90, Math.sqrt(MU_G / Math.max(kappa, 1e-5)));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const ds = tgt === centerline
          ? this.cum[i + 1] - this.cum[i]
          : Math.hypot(tgt[j][0] - tgt[i][0], tgt[j][1] - tgt[i][1]);
        this.vProf[i] = Math.min(this.vProf[i], Math.sqrt(this.vProf[j] * this.vProf[j] + 2 * DECEL * ds));
      }
    }
    const mt = line?.mintimeSpeed;
    if (mt) for (let i = 0; i < n; i++) this.vProf[i] = Math.min(90, mt[i] * 0.97);
    // v2 combat cues: signed centerline curvature (right > 0) and distance to the next braking zone.
    const kap = new Float64Array(n);
    const cl = centerline;
    for (let i = 0; i < n; i++) {
      this.sampleAt(this.cum[i] - 10, i, cl);
      const ax = this.px, az = this.pz;
      const b = cl[i];
      this.sampleAt(this.cum[i] + 10, i, cl);
      const cx = this.px, cz = this.pz;
      const ab = Math.hypot(b[0] - ax, b[1] - az);
      const bc = Math.hypot(cx - b[0], cz - b[1]);
      const ca = Math.hypot(ax - cx, az - cz);
      kap[i] = (2 * ((b[0] - ax) * (cz - az) - (b[1] - az) * (cx - ax))) / Math.max(ab * bc * ca, 1e-6);
    }
    this.corner = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let k = 0; k < n; k++) {
        const j = (i + k) % n, d = this.cum[i + k >= n ? j : i + k] + (i + k >= n ? this.L : 0) - this.cum[i];
        if (d > CORNER_AHEAD) break;
        if (Math.abs(kap[j]) > Math.abs(best)) best = kap[j];
      }
      this.corner[i] = best;
    }
    this.brakeD = new Float64Array(n).fill(BRAKE_AHEAD);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n;
        const ds = this.cum[i + 1] - this.cum[i];
        this.brakeD[i] = this.vProf[j] < this.vProf[i] - BRAKE_DV ? 0 : Math.min(BRAKE_AHEAD, this.brakeD[j] + ds);
      }
    }
  }

  /** Centerline speed-profile value at a centerline index (brake cue / overspeed penalty). */
  speedAt(index: number): number {
    return this.vProf[index];
  }

  fill(out: Float64Array, s: NeuralCarState): void {
    const q = s.rotation;
    const fx = -2 * (q.w * q.y + q.x * q.z), fz = -1 + 2 * (q.x * q.x + q.y * q.y);
    const rx = -fz, rz = fx;
    const p = s.progress;
    const i = p.index;
    const lv = s.linvel;
    const vf = lv.x * fx + lv.z * fz, vr = lv.x * rx + lv.z * rz;
    out[0] = s.forwardSpeed / 60;
    let hint = i;
    for (let j = 0; j < LOOK.length; j++) {
      this.sampleAt(p.distance + LOOK[j], hint, this.tgt);
      hint = this.pi;
      const dx = this.px - s.position.x, dz = this.pz - s.position.z;
      out[1 + j] = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz) / Math.PI;
    }
    let o = 1 + LOOK.length;
    for (const j of PROD) out[o++] = out[0] * Math.abs(out[1 + j]) * 4;
    this.sampleAt(p.distance + 30, i, this.points);
    const v30 = this.vProf[this.pi];
    out[o++] = Math.max(-3, Math.min(3, (s.forwardSpeed - this.vProf[i]) / 10));
    out[o++] = Math.max(-3, Math.min(3, (s.forwardSpeed - v30) / 10));
    out[o++] = this.vProf[i] / 60;
    out[o] = (this.hwR[i] - p.lateral) / 10;
    out[o + 1] = (this.hwL[i] + p.lateral) / 10;
    out[o + 2] = s.angvel.y / 2;
    out[o + 3] = Math.abs(vf) > 2 ? Math.atan2(vr, Math.abs(vf)) : 0;
    out[o + 4] = 1;
    o += 5;
    out[o++] = s.fuelMassKg / 25;
    out[o++] = s.compoundGrip * 10;
    this.nearest(out, s, fx, fz, vf, o);
    o += 3 * N_NEAR;
    out[o] = (s.tempFrontC - s.optTempC) / s.tempWindowC;
    out[o + 1] = (s.tempRearC - s.optTempC) / s.tempWindowC;
    out[o + 2] = s.wearMean;
    out[o + 3] = s.offWheels / 4;
    this.combat(out, s, fx, fz, vf, N_IN_V1, i);
  }

  // v2 combat inputs (N_COMBAT, all in about [-1, 1]).
  private combat(out: Float64Array, s: NeuralCarState, fx: number, fz: number, vf: number, o: number, i: number): void {
    const cr = Math.max(-1, Math.min(1, this.corner[i] * 50)); // radius 20 m = 1; right > 0
    const sg = Math.abs(cr) > 0.02 ? (cr > 0 ? 1 : -1) : 0;
    const px = s.position.x, pz = s.position.z;
    let ovL = 0, ovR = 0, bGap = 1e9, bLat = 0, bVf = 0, aGap = 1e9, aLat = 0;
    for (let j = 0; j < s.others.length; j++) {
      const op = s.others[j].position;
      const dx = op.x - px, dz = op.z - pz;
      const d = dx * fx + dz * fz, lat = dx * -fz + dz * fx, ad = Math.abs(d), al = Math.abs(lat);
      if (al > 8 || ad > 30) continue;
      if (ad < 6) {
        const ov = 1 - ad / 6;
        if (lat < 0) { if (ov > ovL) ovL = ov; } else if (ov > ovR) ovR = ov;
      }
      if (d < -2.5 && -d < bGap) {
        bGap = -d; bLat = lat;
        const lv = s.others[j].linvel;
        bVf = lv.x * fx + lv.z * fz;
      } else if (d > 2.5 && d < 25 && d < aGap) { aGap = d; aLat = lat; }
    }
    const behind = bGap <= 30;
    out[o] = ovL;
    out[o + 1] = ovR;
    out[o + 2] = behind ? 1 - bGap / 30 : 0;
    out[o + 3] = behind ? Math.max(-1, Math.min(1, (bVf - vf) / 20)) : 0; // > 0: it is closing in
    out[o + 4] = cr;
    out[o + 5] = this.brakeD[i] / BRAKE_AHEAD;
    out[o + 6] = bGap <= 15 ? Math.max(-1, Math.min(1, (bLat / 4) * sg)) : 0; // > 0: attacker on the inside line
    out[o + 7] = aGap <= 25 ? Math.max(-1, Math.min(1, (-aLat / 4) * sg)) : 0; // > 0: I am on the inside of the car ahead
  }

  // Nearest N_NEAR cars within 60 m → forward gap/50, lateral gap/10, closing speed/20 (zeros if none).
  private nearest(
    out: Float64Array,
    s: NeuralCarState,
    fx: number,
    fz: number,
    vf: number,
    o: number,
  ): void {
    const nd = this.nd, ni = this.ni;
    const px = s.position.x, pz = s.position.z;
    let c = 0;
    for (let j = 0; j < s.others.length; j++) {
      const op = s.others[j].position;
      const dx = op.x - px, dz = op.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 3600 || c >= MAX_CARS) continue;
      nd[c] = d2;
      ni[c++] = j;
    }
    for (let a = 0; a < N_NEAR; a++) {
      let bi = -1;
      for (let b = 0; b < c; b++) if (ni[b] >= 0 && (bi < 0 || nd[b] < nd[bi])) bi = b;
      const base = o + 3 * a;
      if (bi < 0) {
        out[base] = 0;
        out[base + 1] = 0;
        out[base + 2] = 0;
        continue;
      }
      const j = ni[bi];
      ni[bi] = -1;
      const other = s.others[j];
      const dx = other.position.x - px, dz = other.position.z - pz;
      out[base] = (dx * fx + dz * fz) / 50;
      out[base + 1] = (dx * -fz + dz * fx) / 10;
      out[base + 2] = (vf - (other.linvel.x * fx + other.linvel.z * fz)) / 20;
    }
  }

  // Point on `pts` at centerline arc length s (wrapped); writes px, pz, pi instead of allocating.
  private sampleAt(s: number, idxHint: number, pts: readonly [number, number][]): void {
    const n = this.n, cum = this.cum, L = this.L;
    s = ((s % L) + L) % L;
    let i = idxHint;
    for (let g = 0; g < n && !(cum[i] <= s && s < cum[i + 1]); g++) i = (i + 1) % n;
    const t = (s - cum[i]) / Math.max(cum[i + 1] - cum[i], 1e-9);
    const a = pts[i], b = pts[(i + 1) % n];
    this.px = a[0] + t * (b[0] - a[0]);
    this.pz = a[1] + t * (b[1] - a[1]);
    this.pi = i;
  }
}
