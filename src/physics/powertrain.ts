import type { CarSpec } from './carSpec';

type Engine = CarSpec['engine'];
type Diff = CarSpec['diff'];

const RPM_PER_RPS = 60 / (2 * Math.PI);
const DIFF_K = 30; // N·m·s/rad coupling coefficient
const MIN_GEAR = 1;

function clamp01(throttle: number): number {
  if (Number.isNaN(throttle)) return 0;
  return Math.min(1, Math.max(0, throttle));
}

function curveTorque(curve: [number, number][], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0);
    }
  }
  return curve[curve.length - 1][1];
}

export function engineTorque(engine: Engine, rpm: number, throttle: number): number {
  const t = clamp01(throttle);
  if (t === 0) return -engine.brakingTorque;
  if (rpm >= engine.limiterRpm) return 0;
  return curveTorque(engine.torqueCurve, rpm) * t;
}

export function engineRpm(spec: CarSpec, gear: number, drivenOmega: number, throttle: number): number {
  const n = spec.gearbox.ratios.length;
  const g = Math.min(Math.max(gear, MIN_GEAR), n);
  const raw = Math.abs(drivenOmega) * spec.gearbox.ratios[g - 1] * spec.gearbox.final * RPM_PER_RPS;
  let rpm = Math.max(raw, spec.engine.idleRpm);
  if (g === MIN_GEAR) {
    const floor = spec.engine.idleRpm + clamp01(throttle) * (spec.engine.launchRpm - spec.engine.idleRpm);
    rpm = Math.max(rpm, floor);
  }
  return rpm;
}

export function diffSplit(
  diff: Diff,
  tIn: number,
  omegaL: number,
  omegaR: number,
  onThrottle: boolean
): [number, number] {
  if (diff.type === 'open') return [tIn / 2, tIn / 2];
  const lock = diff.type === 'locked' ? 1 : onThrottle ? diff.lockPower : diff.lockCoast;
  const lim = diff.preload + lock * Math.abs(tIn);
  const coupling = Math.min(lim, Math.max(-lim, DIFF_K * (omegaL - omegaR)));
  return [tIn / 2 - coupling, tIn / 2 + coupling];
}
