import type { CarSpec } from './carSpec';

export function fuelFlowKgS(bsfc: number, powerW: number, mult: number): number {
  return (bsfc * Math.max(0, powerW) * mult) / 3.6e9;
}

export class FuelTank {
  massKg: number;
  litres: number;
  private readonly densityKgL: number;
  private readonly bsfc: number;

  constructor(spec: CarSpec['fuel'], startL?: number) {
    this.densityKgL = spec.densityKgL;
    this.bsfc = spec.bsfc;
    const start = Math.min(spec.capacityL, Math.max(0, startL ?? spec.startL));
    this.massKg = start * spec.densityKgL;
    this.litres = start;
  }

  burn(powerW: number, dt: number, mult: number): void {
    const used = fuelFlowKgS(this.bsfc, powerW, mult) * dt;
    if (!(used > 0)) return;
    this.massKg = Math.max(0, this.massKg - used);
    this.litres = this.densityKgL > 0 ? this.massKg / this.densityKgL : 0;
  }

  empty(): boolean {
    return this.massKg <= 0;
  }
}
