const WIND_FULL_MS = 40;
const WIND_FULL_GAIN = 0.1;
const WIND_MAX_MS = 80;
const WIND_MAX_GAIN = 0.4;
const CRACKLE_MIN = 3;
const CRACKLE_MAX = 8;
const CRACKLE_SPAN_S = 0.6;
const SHIFT_DOWN_END = 0.02;
const SHIFT_HOLD_END = 0.06;
const SHIFT_UP_END = 0.08;
const SHIFT_DIP = 0.3;

const finite = (...vs: number[]): boolean => vs.every((v) => Number.isFinite(v));

export function crackleSchedule(
  prevThrottle: number,
  throttle: number,
  rpm: number,
  limiterRpm: number,
  crackle: number,
  rng: () => number,
): number[] {
  if (!finite(prevThrottle, throttle, rpm, limiterRpm, crackle)) return [];
  if (crackle <= 0) return [];
  if (!(prevThrottle > 0.5) || !(throttle < 0.15) || !(rpm >= 0.7 * limiterRpm)) return [];
  const count = Math.min(CRACKLE_MAX, Math.max(CRACKLE_MIN, Math.round(3 + 5 * crackle * rng())));
  const offsets = new Array<number>(count);
  for (let i = 0; i < count; i++) offsets[i] = CRACKLE_SPAN_S * rng();
  offsets.sort((a, b) => a - b);
  return offsets;
}

export function windGain(speed: number): number {
  if (!(speed > 0)) return 0;
  if (speed >= WIND_MAX_MS) return WIND_MAX_GAIN;
  if (speed >= WIND_FULL_MS) {
    return WIND_FULL_GAIN + ((speed - WIND_FULL_MS) / (WIND_MAX_MS - WIND_FULL_MS)) * (WIND_MAX_GAIN - WIND_FULL_GAIN);
  }
  return (speed / WIND_FULL_MS) * WIND_FULL_GAIN;
}

export function kerbRumbleHz(speed: number, stripeMeters: number): number {
  if (!(stripeMeters > 0)) return 0;
  return speed / stripeMeters;
}

export function shiftEnvelope(t: number): number {
  if (!(t > 0)) return 1;
  if (t < SHIFT_DOWN_END) return 1 - (t / SHIFT_DOWN_END) * (1 - SHIFT_DIP);
  if (t < SHIFT_HOLD_END) return SHIFT_DIP;
  if (t < SHIFT_UP_END) return SHIFT_DIP + ((t - SHIFT_HOLD_END) / (SHIFT_UP_END - SHIFT_HOLD_END)) * (1 - SHIFT_DIP);
  return 1;
}
