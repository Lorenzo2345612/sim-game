import { FIXED_DT } from '../core/constants';

// Type-only reference (no `from` import): the 045 contract keeps gearbox.ts free of imports outside src/core.
type GearboxParams = import('./carSpec').CarSpec['gearbox'];
type EngineLimits = Pick<import('./carSpec').CarSpec['engine'], 'idleRpm' | 'limiterRpm'>;

export const GEAR_RATIOS: readonly number[] = [3.2, 2.3, 1.8, 1.45, 1.2, 1.0];
export const FINAL_DRIVE = 3.4;
export const IDLE_RPM = 3000;
export const LIMITER_RPM = 9000;
export const UPSHIFT_RPM = 8500;
export const DOWNSHIFT_RPM = 5000;

const WHEEL_RADIUS_M = 0.33;
const RPM_PER_RPS = 60 / (2 * Math.PI);
const MIN_GEAR = 1;
const REVERSE_RATIO = 3.0;
const REVERSE_MAX_SPEED_MS = 30 / 3.6;
const STOP_SPEED_MS = 0.5;
const REVERSE_HOLD_S = 0.4;

export type GearboxMode = 'auto' | 'manual';
export type PedalInput = { throttle: number; brake: number };

export function rpmFor(speedMs: number, gear: number): number {
  const ratio = GEAR_RATIOS[Math.min(Math.max(gear, MIN_GEAR), GEAR_RATIOS.length) - 1];
  const raw = (Math.abs(speedMs) / WHEEL_RADIUS_M) * ratio * FINAL_DRIVE * RPM_PER_RPS;
  return raw < IDLE_RPM ? IDLE_RPM : raw;
}

export class Gearbox {
  gear = MIN_GEAR;
  mode: GearboxMode = 'auto';

  private readonly ratios: readonly number[];
  private readonly final: number;
  private readonly upRpm: number;
  private readonly downRpm: number;
  private readonly shiftTime: number;
  private readonly wheelRadius: number;
  private readonly idleRpm: number;
  private readonly limiterRpm: number;
  private shiftT = 0;
  private lastSpeedMs = 0;
  private reverseHoldT = 0;

  constructor(
    params?: GearboxParams,
    wheelRadius: number = WHEEL_RADIUS_M,
    engine?: EngineLimits
  ) {
    this.ratios = params?.ratios ?? GEAR_RATIOS;
    this.final = params?.final ?? FINAL_DRIVE;
    this.upRpm = params?.upRpm ?? UPSHIFT_RPM;
    this.downRpm = params?.downRpm ?? DOWNSHIFT_RPM;
    this.shiftTime = params?.shiftTime ?? 0;
    this.wheelRadius = wheelRadius;
    this.idleRpm = engine?.idleRpm ?? IDLE_RPM;
    this.limiterRpm = engine?.limiterRpm ?? LIMITER_RPM;
  }

  setMode(mode: GearboxMode): void {
    this.mode = mode;
  }

  shiftUp(): void {
    if (this.mode !== 'manual') return;
    this.setGear(Math.min(this.ratios.length, this.gear < MIN_GEAR ? MIN_GEAR : this.gear + 1));
  }

  shiftDown(): void {
    if (this.mode !== 'manual') return;
    if (this.gear === MIN_GEAR && Math.abs(this.lastSpeedMs) < STOP_SPEED_MS) {
      this.setGear(-1);
      return;
    }
    // At -1 the max clamp brings the box back to gear 1.
    this.setGear(Math.max(MIN_GEAR, this.gear - 1));
  }

  update(speedMs: number, dt: number = FIXED_DT, input?: PedalInput): void {
    if (this.shiftT > 0) this.shiftT = Math.max(0, this.shiftT - dt);
    this.lastSpeedMs = speedMs;
    if (this.gear === -1) {
      if (input && input.throttle >= 0.5 && Math.abs(speedMs) < STOP_SPEED_MS) this.setGear(MIN_GEAR);
      return;
    }
    if (this.mode !== 'auto') return;
    const hold =
      input !== undefined &&
      Math.abs(speedMs) < STOP_SPEED_MS &&
      input.brake >= 0.5 &&
      input.throttle < 0.05;
    if (!hold) this.reverseHoldT = 0;
    else {
      this.reverseHoldT += dt;
      if (this.reverseHoldT >= REVERSE_HOLD_S) {
        this.setGear(-1);
        this.reverseHoldT = 0;
        return;
      }
    }
    if (this.shiftT > 0) return;
    const rpm = this.rpm(speedMs);
    if (rpm >= this.upRpm && this.gear < this.ratios.length) this.setGear(this.gear + 1);
    else if (rpm < this.downRpm && this.gear > MIN_GEAR) this.setGear(this.gear - 1);
  }

  rpm(speedMs: number): number {
    const ratio =
      this.gear === -1
        ? REVERSE_RATIO
        : this.ratios[Math.min(Math.max(this.gear, MIN_GEAR), this.ratios.length) - 1];
    const raw = (Math.abs(speedMs) / this.wheelRadius) * ratio * this.final * RPM_PER_RPS;
    return raw < this.idleRpm ? this.idleRpm : raw;
  }

  driveTorque(engineTorqueNm: number, input: PedalInput, speedMs: number): number {
    if (this.gear === -1) {
      if (speedMs <= -REVERSE_MAX_SPEED_MS) return 0;
      return -engineTorqueNm * input.brake * REVERSE_RATIO * this.final;
    }
    const ratio = this.ratios[Math.min(Math.max(this.gear, MIN_GEAR), this.ratios.length) - 1];
    return engineTorqueNm * input.throttle * ratio * this.final;
  }

  brakeRequest(input: PedalInput): number {
    return this.gear === -1 ? input.throttle : input.brake;
  }

  driveScale(speedMs: number): number {
    if (this.shiftT > 0) return 0;
    return this.rpm(speedMs) >= this.limiterRpm ? 0 : 1;
  }

  private setGear(gear: number): void {
    if (gear === this.gear) return;
    this.gear = gear;
    this.shiftT = this.shiftTime;
  }
}
