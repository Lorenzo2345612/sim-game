import type { DriverInput } from '../core/types';
import type { AssistLevel, DrivingLineMode } from '../core/settings';

export type { AssistLevel };

export interface AssistPreset {
  abs: boolean;
  tc: boolean;
  autoGear: boolean;
  brakeAssist: boolean;
  steerAssist: number;
  drivingLine: DrivingLineMode;
}

const PRESETS: Record<AssistLevel, AssistPreset> = {
  beginner: { abs: true, tc: true, autoGear: true, brakeAssist: true, steerAssist: 0.5, drivingLine: 'full' },
  intermediate: { abs: true, tc: true, autoGear: true, brakeAssist: false, steerAssist: 0.2, drivingLine: 'braking' },
  pro: { abs: false, tc: false, autoGear: false, brakeAssist: false, steerAssist: 0, drivingLine: 'off' },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function assistPreset(level: AssistLevel): AssistPreset {
  return { ...PRESETS[level] };
}

/** Brake needed to reach `targetSpeed` at `distanceToTarget`, as a fraction of `decel` capacity. */
export function brakeAssist(
  speed: number,
  targetSpeed: number,
  distanceToTarget: number,
  decel: number,
): number {
  if (decel <= 0) throw new Error('brakeAssist: decel must be > 0');
  if (speed <= targetSpeed + 1) return 0;
  const needed = ((speed * speed - targetSpeed * targetSpeed) / (2 * Math.max(distanceToTarget, 0.1))) / decel;
  return clamp(needed, 0, 1);
}

/** `yawRateError` is desired − actual (rad/s, + = left); k = 0 leaves the input unchanged. */
export function steerAssist(input: number, yawRateError: number, k: number): number {
  return clamp(input - k * clamp(yawRateError, -1, 1), -1, 1);
}

export interface AssistContext {
  speed: number;
  targetSpeed: number;
  distanceToTarget: number;
  decel: number;
  yawRateError: number;
}

/** Returns a new input; `input` itself is never mutated. */
export function applyAssists(preset: AssistPreset, input: DriverInput, ctx: AssistContext): DriverInput {
  const out: DriverInput = { ...input };
  if (preset.brakeAssist) {
    const assist = brakeAssist(ctx.speed, ctx.targetSpeed, ctx.distanceToTarget, ctx.decel);
    if (assist > out.brake) out.brake = assist;
    if (assist > 0.05) out.throttle = 0;
  }
  out.steer = steerAssist(out.steer, ctx.yawRateError, preset.steerAssist);
  return out;
}

/** Minimum profile speed within `horizon` m ahead of `distance` (wrapping) and the distance to it. */
export function lookaheadTarget(
  speeds: Float64Array,
  dist: Float64Array,
  length: number,
  distance: number,
  horizon = 150,
): { targetSpeed: number; distance: number } {
  const n = speeds.length;
  if (n === 0 || dist.length !== n || !(length > 0)) throw new Error('lookaheadTarget: bad profile');
  const d = ((distance % length) + length) % length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  // Past the last sample: the first point ahead is the wrapped index 0.
  if (dist[lo] < d) lo = 0;
  let bestSpeed = speeds[lo];
  let bestDist = dist[lo];
  for (let k = 0; k < n; k++) {
    const i = (lo + k) % n;
    const forward = ((dist[i] - d) % length + length) % length;
    if (forward > horizon) break;
    if (speeds[i] < bestSpeed) {
      bestSpeed = speeds[i];
      bestDist = dist[i];
    }
  }
  return { targetSpeed: bestSpeed, distance: bestDist };
}
