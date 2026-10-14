import type { CameraMode } from './cameraRig';

export const SHAKE_MAX_M = 0.015;
export const SHAKE_MAX_ROLL = 0.004; // m, rad

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

export function shakeOffset(
  amount: number,
  t: number,
  mode: CameraMode,
  out: { y: number; roll: number },
): { y: number; roll: number } {
  const a = Number.isFinite(amount) ? clamp01(amount) : 0;
  const k = mode === 'chase' ? 0.5 : 1;
  out.y = SHAKE_MAX_M * a * k * (0.6 * Math.sin(TAU * 17 * t) + 0.4 * Math.sin(TAU * 29 * t + 1.3));
  out.roll = SHAKE_MAX_ROLL * a * k * Math.sin(TAU * 11 * t + 0.7);
  return out;
}
