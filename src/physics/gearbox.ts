export const GEAR_RATIOS: readonly number[] = [3.2, 2.3, 1.8, 1.45, 1.2, 1.0];
export const FINAL_DRIVE = 3.4;
export const IDLE_RPM = 3000;
export const LIMITER_RPM = 9000;
export const UPSHIFT_RPM = 8500;
export const DOWNSHIFT_RPM = 5000;

const WHEEL_RADIUS_M = 0.33;
const RPM_PER_RPS = 60 / (2 * Math.PI);
const MIN_GEAR = 1;
const MAX_GEAR = GEAR_RATIOS.length;

export type GearboxMode = 'auto' | 'manual';

export function rpmFor(speedMs: number, gear: number): number {
  const ratio = GEAR_RATIOS[Math.min(Math.max(gear, MIN_GEAR), MAX_GEAR) - 1];
  const raw = (Math.abs(speedMs) / WHEEL_RADIUS_M) * ratio * FINAL_DRIVE * RPM_PER_RPS;
  return raw < IDLE_RPM ? IDLE_RPM : raw;
}

export class Gearbox {
  gear = MIN_GEAR;
  mode: GearboxMode = 'auto';

  setMode(mode: GearboxMode): void {
    this.mode = mode;
  }

  shiftUp(): void {
    if (this.mode !== 'manual') return;
    this.gear = Math.min(MAX_GEAR, this.gear + 1);
  }

  shiftDown(): void {
    if (this.mode !== 'manual') return;
    this.gear = Math.max(MIN_GEAR, this.gear - 1);
  }

  update(speedMs: number): void {
    if (this.mode !== 'auto') return;
    if (speedMs < 0) {
      this.gear = MIN_GEAR;
      return;
    }
    const rpm = this.rpm(speedMs);
    if (rpm >= UPSHIFT_RPM && this.gear < MAX_GEAR) this.gear++;
    else if (rpm < DOWNSHIFT_RPM && this.gear > MIN_GEAR) this.gear--;
  }

  rpm(speedMs: number): number {
    return rpmFor(speedMs, this.gear);
  }

  driveScale(speedMs: number): number {
    return this.rpm(speedMs) >= LIMITER_RPM ? 0 : 1;
  }
}
