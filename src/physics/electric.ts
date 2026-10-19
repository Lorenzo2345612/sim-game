export interface MotorSpec {
  maxPowerW: number;
  maxTorqueNm: number;
  maxRpm: number;
  ratio: number;
  regenMaxW: number;
}

export const REGEN_MIN_OMEGA = 3;

export function motorWheelTorque(
  m: MotorSpec,
  wheelOmega: number,
  powerCapW: number,
  throttle: number,
): number {
  const omegaMotor = Math.abs(wheelOmega) * m.ratio;
  if (omegaMotor >= (m.maxRpm * 2 * Math.PI) / 60) return 0;
  const t = Math.min(1, Math.max(0, throttle));
  if (!(omegaMotor > 0)) return t * m.maxTorqueNm * m.ratio;
  const capW = Math.min(m.maxPowerW, Math.max(0, powerCapW));
  return t * Math.min(m.maxTorqueNm, capW / omegaMotor) * m.ratio;
}

export function splitPower(capW: number, front: MotorSpec, rear: MotorSpec): [number, number] {
  const total = front.maxPowerW + rear.maxPowerW;
  if (!(total > 0) || !(capW > 0)) return [0, 0];
  return [
    Math.min(front.maxPowerW, (capW * front.maxPowerW) / total),
    Math.min(rear.maxPowerW, (capW * rear.maxPowerW) / total),
  ];
}

export function regenSplit(
  axleBrakeNm: number,
  wheelOmega: number,
  m: MotorSpec,
  batteryFull: boolean,
): { regenNm: number; frictionNm: number } {
  const request = Math.max(0, axleBrakeNm);
  const omega = Math.abs(wheelOmega);
  let regenNm = 0;
  if (request > 0 && !batteryFull && omega >= REGEN_MIN_OMEGA) {
    regenNm = Math.min(request, m.regenMaxW / omega);
  }
  return { regenNm, frictionNm: request - regenNm };
}

export class Battery {
  readonly capacityJ: number;
  private soc: number;

  constructor(capacityJ: number, startJ?: number) {
    this.capacityJ = capacityJ;
    this.soc = Math.min(capacityJ, Math.max(0, startJ ?? capacityJ));
  }

  get socJ(): number {
    return this.soc;
  }

  get frac(): number {
    return this.soc / this.capacityJ;
  }

  get empty(): boolean {
    return this.soc <= 0;
  }

  get full(): boolean {
    return this.soc >= this.capacityJ;
  }

  drain(mechW: number, dt: number, eff: number): void {
    const joules = (Math.max(0, mechW) * Math.max(0, dt)) / eff;
    if (!(joules > 0)) return;
    this.soc = Math.max(0, this.soc - joules);
  }

  charge(mechW: number, dt: number, eff: number): void {
    const joules = Math.max(0, mechW) * Math.max(0, dt) * eff;
    if (!(joules > 0)) return;
    this.soc = Math.min(this.capacityJ, this.soc + joules);
  }
}
