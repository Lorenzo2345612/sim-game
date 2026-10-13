import type { CarSpec } from './carSpec';

const ABS_MIN_SPEED = 3;
const AID_SCALE = 0.5;

export function brakeTorques(
  brakes: CarSpec['brakes'],
  pedal: number,
  bias: number,
  out: number[],
): void {
  const p = Number.isNaN(pedal) ? 0 : Math.min(1, Math.max(0, pedal));
  const total = p * brakes.maxTorque;
  const front = (bias / 2) * total;
  const rear = ((1 - bias) / 2) * total;
  out[0] = front;
  out[1] = front;
  out[2] = rear;
  out[3] = rear;
}

export function absScale(abs: CarSpec['aids']['abs'], kappa: number, speed: number): number {
  if (abs.enabled && speed > ABS_MIN_SPEED && kappa < -abs.slip) return AID_SCALE;
  return 1;
}

export function tcScale(tc: CarSpec['aids']['tc'], drivenKappas: number[]): number {
  if (!tc.enabled) return 1;
  for (const kappa of drivenKappas) {
    if (kappa > tc.slip) return AID_SCALE;
  }
  return 1;
}
