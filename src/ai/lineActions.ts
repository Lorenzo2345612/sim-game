export const ACTION_THROTTLE = 0;
export const ACTION_COAST = 1;
export const ACTION_BRAKE = 2;

const COAST_BAND = 0.05; // m/s
const THROTTLE_FRACTION = 0.97;

/** Per-point action from the speed profile: brake into deceleration, coast below vMax at flat speed, else throttle. */
export function lineActions(speeds: Float64Array, dist: Float64Array, length: number): Uint8Array {
  void dist; // kept for signature stability (143 boards reuse the trio)
  void length;
  const n = speeds.length;
  const out = new Uint8Array(n);
  if (n === 0) return out;
  let max = speeds[0];
  for (let i = 1; i < n; i++) {
    if (speeds[i] > max) max = speeds[i];
  }
  const throttleCeiling = THROTTLE_FRACTION * max;
  for (let i = 0; i < n; i++) {
    const next = speeds[(i + 1) % n];
    const dv = next - speeds[i];
    if (dv < -COAST_BAND) out[i] = ACTION_BRAKE;
    else if (dv <= COAST_BAND && speeds[i] < throttleCeiling) out[i] = ACTION_COAST;
    else out[i] = ACTION_THROTTLE;
  }
  return out;
}
