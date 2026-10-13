import type { TyreCompound } from './carSpec';

export const AMBIENT_C = 25;

export interface TyreState {
  tempC: number;
  wear: number;
}

export function newTyreState(): TyreState {
  return { tempC: 70, wear: 0 };
}

export function updateTyreState(
  s: TyreState,
  c: TyreCompound,
  slipPower: number,
  speed: number,
  dt: number,
  wearMult: number,
  pressureKpa: number,
  optPressureKpa: number,
): void {
  const power = Number.isFinite(slipPower) && slipPower > 0 ? slipPower : 0;
  const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const mult = Number.isFinite(wearMult) && wearMult > 0 ? wearMult : 0;
  const spd = Number.isFinite(speed) && speed > 0 ? speed : 0;
  const heat = c.heatCoef * (pressureKpa / optPressureKpa) * power;
  const cool = c.coolCoef * (s.tempC - AMBIENT_C) * (1 + 0.05 * spd);
  s.tempC += (heat - cool) * step;
  s.wear = Math.min(1, Math.max(0, s.wear + c.wearRate * power * mult * step));
}

export function tempFactor(c: TyreCompound, tempC: number): number {
  const d = (tempC - c.optTempC) / c.tempWindowC;
  return 1 - Math.min(0.25, 0.25 * d * d);
}

export function wearFactor(c: TyreCompound, wear: number): number {
  const w = Math.min(1, Math.max(0, wear));
  const cliff = w > c.cliffWear ? (0.15 * (w - c.cliffWear)) / (1 - c.cliffWear) : 0;
  return 1 - c.wearGripLoss * w - cliff;
}

export function pressureFactor(p: number, opt: number): number {
  const d = p - opt;
  return Math.max(0.9, 1 - (0.002 * d * d) / 10);
}

export function gripFactor(c: TyreCompound, s: TyreState, p: number, opt: number): number {
  return tempFactor(c, s.tempC) * wearFactor(c, s.wear) * pressureFactor(p, opt);
}
