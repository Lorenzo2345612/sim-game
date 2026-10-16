import type { TyreName } from './carSpec';

export type CompoundClass = 'slick' | 'inter' | 'wet';

export function compoundClass(name: TyreName): CompoundClass {
  if (name === 'inter') return 'inter';
  if (name === 'wet') return 'wet';
  return 'slick';
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function gripFactor(cls: CompoundClass, wetness: number): number {
  const w = clamp01(wetness);
  if (cls === 'slick') return 1 - 0.45 * w;
  if (cls === 'inter') return 0.93 - 0.15 * Math.abs(w - 0.5) * 2;
  return 0.85 + 0.05 * w;
}

export function wearMultiplier(cls: CompoundClass, wetness: number): number {
  return cls !== 'slick' && wetness < 0.2 ? 3 : 1;
}

export class TrackWeather {
  readonly seed: number;
  private wet = 0;
  private rainLevel = 0;

  constructor(seed: number) {
    this.seed = seed;
  }

  get wetness(): number {
    return this.wet;
  }

  get rain(): number {
    return this.rainLevel;
  }

  setRain(r: number): void {
    if (!Number.isFinite(r)) return;
    this.rainLevel = clamp01(r);
  }

  setWetness(w: number): void {
    if (!Number.isFinite(w)) return;
    this.wet = clamp01(w);
  }

  update(dt: number, lineUsage: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const usage = Number.isFinite(lineUsage) && lineUsage > 0 ? lineUsage : 0;
    const dryRate = this.rainLevel < 0.05 ? 0.004 * (1 + 0.1 * usage) : 0;
    this.wet = clamp01(this.wet + dt * (0.02 * this.rainLevel - dryRate));
  }
}
