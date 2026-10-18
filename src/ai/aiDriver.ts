import type { DriverInput } from '../core/types';
import type { RacingLine } from './racingLine';

export interface AiObservation {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  rearSlip?: number;
  yawRate?: number;
  steerAngle?: number;
}

export interface AiParams {
  speedScale: number;
  lookaheadTime: number;
  minLookahead: number;
  maxLookahead: number;
  wheelbase: number;
  maxSteerAngle: number;
  kp: number;
  kb: number;
}

export const DEFAULT_AI_PARAMS: AiParams = {
  speedScale: 1,
  lookaheadTime: 0.6,
  minLookahead: 8,
  maxLookahead: 45,
  wheelbase: 2.6,
  maxSteerAngle: 0.35,
  kp: 0.5,
  kb: 0.25,
};

const OFFSET_SLEW_RATE = 1.5;
const SPEED_PREVIEW_TIME = 0.3;
const LOCAL_SEARCH = 50;
const REAR_SLIP_LIMIT = (6 * Math.PI) / 180;
const YAW_RATE_ERROR_LIMIT = 0.25;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class AiDriver {
  private p: AiParams;
  private reqOffset = 0;
  private offset = 0;
  private speedCap: number | null = null;
  private lastSteer = 0;
  private idx = 0;
  private segIdx = 0;
  private s = 0;
  private located = false;
  // reusable temporaries: update must not allocate
  private nx = 0;
  private nz = 0;
  private ax = 0;
  private az = 0;
  private tx = 0;
  private tz = 0;

  constructor(
    private line: RacingLine,
    private speeds: Float64Array,
    params?: Partial<AiParams>,
  ) {
    this.p = { ...DEFAULT_AI_PARAMS, ...params };
  }

  setLateralOffset(m: number): void {
    this.reqOffset = m;
  }

  setSpeedCap(v: number | null): void {
    this.speedCap = v;
  }

  setSpeedScale(v: number): void {
    this.p.speedScale = v;
  }

  reset(obs: AiObservation): void {
    const n = this.line.points.length / 2;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      this.shiftedAt(i, n);
      const d = (obs.x - this.ax) * (obs.x - this.ax) + (obs.z - this.az) * (obs.z - this.az);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.idx = best;
    this.located = true;
  }

  update(obs: AiObservation, dt: number, out: DriverInput): DriverInput {
    const n = this.line.points.length / 2;

    if (dt > 0) {
      const step = OFFSET_SLEW_RATE * dt;
      const d = this.reqOffset - this.offset;
      this.offset += d > step ? step : d < -step ? -step : d;
    }

    if (!this.located) {
      this.reset(obs);
    } else {
      let best = this.idx;
      let bd = Infinity;
      for (let k = -LOCAL_SEARCH; k <= LOCAL_SEARCH; k++) {
        const i = (((this.idx + k) % n) + n) % n;
        this.shiftedAt(i, n);
        const d = (obs.x - this.ax) * (obs.x - this.ax) + (obs.z - this.az) * (obs.z - this.az);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      this.idx = best;
    }

    this.projectS(obs.x, obs.z, n);

    const lookahead = clamp(
      obs.speed * this.p.lookaheadTime,
      this.p.minLookahead,
      this.p.maxLookahead,
    );
    this.pointAtS(this.s + lookahead, n);

    const fx = -Math.sin(obs.yaw);
    const fz = -Math.cos(obs.yaw);
    const dx = this.tx - obs.x;
    const dz = this.tz - obs.z;
    const ld = Math.sqrt(dx * dx + dz * dz);
    if (ld < 1e-6) {
      out.steer = 0;
    } else {
      const rx = -fz;
      const rz = fx;
      const alpha = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      const delta = Math.atan((2 * this.p.wheelbase * Math.sin(alpha)) / ld);
      out.steer = clamp(delta / this.p.maxSteerAngle, -1, 1);
    }

    let vTarget = this.previewSpeed(n, obs.speed);
    if (this.speedCap !== null && vTarget > this.speedCap) vTarget = this.speedCap;
    vTarget *= this.p.speedScale;
    const err = vTarget - obs.speed;
    out.throttle = clamp(this.p.kp * err, 0, 1);
    out.brake = clamp(-this.p.kb * err, 0, 1);

    // Stability aid: past the rear-slip or yaw-rate-error threshold, ease the
    // throttle and hold same-sign steering growth while the car still yaws as
    // its steering geometry asks; once yaw diverges the steering is free to
    // catch the slide.
    const scale = this.stabilityScale(obs);
    if (scale < 1) {
      out.throttle *= scale;
      const yawErr = this.yawError(obs);
      if (yawErr <= YAW_RATE_ERROR_LIMIT && Math.abs(out.steer) > Math.abs(this.lastSteer)) {
        out.steer = out.steer > 0 ? Math.abs(this.lastSteer) : -Math.abs(this.lastSteer);
      }
    }
    this.lastSteer = out.steer;
    out.reset = false;
    return out;
  }

  // |yaw rate - v * steer curvature|; 0 when the observation carries no yaw rate
  private yawError(obs: AiObservation): number {
    if (obs.yawRate === undefined) return 0;
    const kappa = Math.tan(obs.steerAngle ?? 0) / this.p.wheelbase;
    return Math.abs(obs.yawRate - obs.speed * kappa);
  }

  // min throttle scale from rear slip and yaw-rate error; 1 when both are calm
  private stabilityScale(obs: AiObservation): number {
    let scale = 1;
    if (obs.rearSlip !== undefined) {
      const slip = Math.abs(obs.rearSlip);
      if (slip > REAR_SLIP_LIMIT) {
        const s = 1 - (slip - REAR_SLIP_LIMIT) / REAR_SLIP_LIMIT;
        if (s < scale) scale = s > 0 ? s : 0;
      }
    }
    const yawErr = this.yawError(obs);
    if (yawErr > YAW_RATE_ERROR_LIMIT) {
      const s = 1 - (yawErr - YAW_RATE_ERROR_LIMIT) / YAW_RATE_ERROR_LIMIT;
      if (s < scale) scale = s > 0 ? s : 0;
    }
    return scale;
  }

  private normalAt(i: number, n: number): void {
    const pts = this.line.points;
    const ia = i === 0 ? n - 1 : i - 1;
    const ic = i === n - 1 ? 0 : i + 1;
    const dx = pts[2 * ic] - pts[2 * ia];
    const dz = pts[2 * ic + 1] - pts[2 * ia + 1];
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 1e-12) {
      this.nx = 0;
      this.nz = 0;
    } else {
      this.nx = -dz / len;
      this.nz = dx / len;
    }
  }

  // point i displaced by the effective offset along its right normal
  private shiftedAt(i: number, n: number): void {
    this.normalAt(i, n);
    const pts = this.line.points;
    this.ax = pts[2 * i] + this.offset * this.nx;
    this.az = pts[2 * i + 1] + this.offset * this.nz;
  }

  private segLen(i: number, n: number): number {
    const dist = this.line.dist;
    return i === n - 1 ? this.line.length - dist[n - 1] : dist[i + 1] - dist[i];
  }

  // projection arc length s on the shifted path, refined on the segments around idx
  private projectS(x: number, z: number, n: number): void {
    const dist = this.line.dist;
    let bestS = dist[this.idx];
    let bestSeg = this.idx;
    let bd = Infinity;
    for (let a = 0; a < 2; a++) {
      const i0 = a === 0 ? this.idx : (this.idx - 1 + n) % n;
      const i1 = (i0 + 1) % n;
      this.shiftedAt(i0, n);
      const ax = this.ax;
      const az = this.az;
      this.shiftedAt(i1, n);
      const ex = this.ax - ax;
      const ez = this.az - az;
      const el = ex * ex + ez * ez;
      let t = el > 0 ? ((x - ax) * ex + (z - az) * ez) / el : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = ax + ex * t;
      const pz = az + ez * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < bd) {
        bd = d;
        bestS = dist[i0] + t * Math.sqrt(el);
        bestSeg = i0;
      }
    }
    this.s = bestS;
    this.segIdx = bestSeg;
  }

  // shifted-path coordinates at arc length sT, interpolated, into (tx, tz)
  private pointAtS(sT: number, n: number): void {
    const dist = this.line.dist;
    let sW = sT % this.line.length;
    if (sW < 0) sW += this.line.length;
    let i = this.segIdx;
    let fwd = sW - dist[i];
    if (fwd < 0) fwd += this.line.length;
    let guard = 0;
    while (guard++ < n) {
      const segLen = this.segLen(i, n);
      if (fwd <= segLen || segLen <= 0) break;
      fwd -= segLen;
      i = (i + 1) % n;
    }
    const segLen = this.segLen(i, n);
    const t = segLen > 0 ? fwd / segLen : 0;
    this.shiftedAt(i, n);
    const ax = this.ax;
    const az = this.az;
    this.shiftedAt((i + 1) % n, n);
    this.tx = ax + (this.ax - ax) * t;
    this.tz = az + (this.az - az) * t;
  }

  // min profile speed from s up to a 0.3 s preview distance
  private previewSpeed(n: number, speed: number): number {
    const preview = SPEED_PREVIEW_TIME * speed;
    let v = this.speeds[this.segIdx];
    let acc = 0;
    let i = this.segIdx;
    let guard = 0;
    while (guard++ < n) {
      const seg = this.segLen(i, n);
      if (seg <= 0 || acc + seg > preview) break;
      acc += seg;
      i = (i + 1) % n;
      if (this.speeds[i] < v) v = this.speeds[i];
    }
    return v;
  }
}
