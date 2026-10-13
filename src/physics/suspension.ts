import type { CarSpec } from './carSpec';

export type AxleSpec = CarSpec['suspension']['front'];

export function staticCompression(fzStatic: number, springRate: number): number {
  return fzStatic / springRate;
}

export function suspensionForce(axle: AxleSpec, x: number, xDot: number): number {
  const xClamped = Math.min(Math.max(x, 0), axle.travel);
  const spring = axle.springRate * xClamped;
  const damper = xDot > 0 ? axle.bumpDamping * xDot : axle.reboundDamping * xDot;
  const bumpStop = x > axle.travel ? axle.bumpStopRate * (x - axle.travel) : 0;
  return Math.max(0, spring + damper + bumpStop);
}

export function antiRoll(arb: number, xLeft: number, xRight: number): number {
  return arb * (xLeft - xRight);
}
