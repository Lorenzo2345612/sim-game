import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import {
  TrackWeather,
  compoundClass,
  gripFactor,
  wearMultiplier,
} from '../../../src/physics/weather';

const ROOT = join(__dirname, '..', '..', '..');
const DT = 1 / 120;

function f4Json(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function weather(seed = 1, wetness = 0, rain = 0): TrackWeather {
  const w = new TrackWeather(seed);
  w.setWetness(wetness);
  w.setRain(rain);
  return w;
}

function run(w: TrackWeather, seconds: number, lineUsage = 0): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) w.update(DT, lineUsage);
}

const SLICK_FIELDS = [
  'Fz0', 'loadSens', 'Bx', 'Cx', 'Ex', 'By', 'Cy', 'Ey',
  'optTempC', 'tempWindowC', 'heatCoef', 'coolCoef',
  'wearRate', 'wearGripLoss', 'cliffWear',
] as const;

describe('137 rain and wetness edge cases', () => {
  it('EDGE1: compoundClass maps soft/medium/hard to slick and keeps inter and wet', () => {
    expect(compoundClass('soft')).toBe('slick');
    expect(compoundClass('medium')).toBe('slick');
    expect(compoundClass('hard')).toBe('slick');
    expect(compoundClass('inter')).toBe('inter');
    expect(compoundClass('wet')).toBe('wet');
  });

  it('EDGE2: gripFactor clamps wetness to [0, 1] for every class', () => {
    expect(gripFactor('slick', -0.5)).toBeCloseTo(1, 10);
    expect(gripFactor('slick', 2)).toBeCloseTo(0.55, 10);
    expect(gripFactor('inter', -1)).toBeCloseTo(0.78, 10);
    expect(gripFactor('inter', 1.7)).toBeCloseTo(0.78, 10);
    expect(gripFactor('wet', -0.3)).toBeCloseTo(0.85, 10);
    expect(gripFactor('wet', 3)).toBeCloseTo(0.9, 10);
  });

  it('EDGE3: wearMultiplier is 3 for inter/wet strictly below 0.2, else 1, and slick is always 1', () => {
    expect(wearMultiplier('slick', 0)).toBeCloseTo(1, 10);
    expect(wearMultiplier('slick', 1)).toBeCloseTo(1, 10);
    expect(wearMultiplier('inter', 0)).toBeCloseTo(3, 10);
    expect(wearMultiplier('inter', 0.19)).toBeCloseTo(3, 10);
    expect(wearMultiplier('inter', 0.2)).toBeCloseTo(1, 10);
    expect(wearMultiplier('inter', 1)).toBeCloseTo(1, 10);
    expect(wearMultiplier('wet', 0)).toBeCloseTo(3, 10);
    expect(wearMultiplier('wet', 0.19)).toBeCloseTo(3, 10);
    expect(wearMultiplier('wet', 0.2)).toBeCloseTo(1, 10);
    expect(wearMultiplier('wet', 1)).toBeCloseTo(1, 10);
  });

  it('EDGE4: setRain and setWetness clamp to [0, 1] and ignore non-finite inputs', () => {
    const w = weather(7);
    w.setRain(0.25);
    expect(w.rain).toBeCloseTo(0.25, 10);
    w.setRain(-3);
    expect(w.rain).toBeCloseTo(0, 10);
    w.setRain(7);
    expect(w.rain).toBeCloseTo(1, 10);
    w.setRain(Number.NaN);
    expect(w.rain).toBeCloseTo(1, 10);
    w.setRain(Number.POSITIVE_INFINITY);
    expect(w.rain).toBeCloseTo(1, 10);
    w.setWetness(0.42);
    expect(w.wetness).toBeCloseTo(0.42, 10);
    w.setWetness(-1);
    expect(w.wetness).toBeCloseTo(0, 10);
    w.setWetness(2.5);
    expect(w.wetness).toBeCloseTo(1, 10);
    w.setWetness(Number.NaN);
    expect(w.wetness).toBeCloseTo(1, 10);
    w.setWetness(Number.NEGATIVE_INFINITY);
    expect(w.wetness).toBeCloseTo(1, 10);
  });

  it('EDGE5: update with dt <= 0 or non-finite dt leaves wetness unchanged', () => {
    const w = weather(1, 0.5, 1);
    w.update(0, 0);
    expect(w.wetness).toBeCloseTo(0.5, 10);
    w.update(-0.5, 0);
    expect(w.wetness).toBeCloseTo(0.5, 10);
    w.update(Number.NaN, 0);
    expect(w.wetness).toBeCloseTo(0.5, 10);
    w.update(Number.POSITIVE_INFINITY, 0);
    expect(w.wetness).toBeCloseTo(0.5, 10);
    w.update(1, 0);
    expect(w.wetness).toBeCloseTo(0.52, 10);
  });

  it('EDGE6: drying rate uses lineUsage clamped >= 0 (negative acts as 0, 10 doubles the rate)', () => {
    const a = weather(1, 1, 0);
    run(a, 100, -50);
    expect(a.wetness).toBeCloseTo(0.6, 9);
    const b = weather(1, 1, 0);
    run(b, 50, 10);
    expect(b.wetness).toBeCloseTo(0.6, 9);
  });

  it('EDGE7: rain 0.04 still adds wetness while drying (net rate -0.0032/s from wetness 1)', () => {
    const w = weather(1, 1, 0.04);
    run(w, 100, 0);
    expect(w.wetness).toBeCloseTo(0.68, 9);
  });

  it('EDGE8: rain exactly 0.05 does not dry (strict boundary; only +0.001/s wetting)', () => {
    const w = weather(1, 0.5, 0.05);
    run(w, 100, 0);
    expect(w.wetness).toBeCloseTo(0.6, 9);
  });

  it('EDGE9: wetness clamps at 0 under extended drying and never goes negative', () => {
    const w = weather(1, 0.1, 0);
    run(w, 100, 0);
    expect(w.wetness).toBeGreaterThanOrEqual(0);
    expect(w.wetness).toBeCloseTo(0, 12);
  });

  it('EDGE10: parseCarSpec derives absent inter/wet from medium (mu0 x0.93 / x0.88) and parses explicit ones verbatim', () => {
    const spec = parseCarSpec(f4Json());
    const m = spec.tyres.compounds.medium;
    const inter = spec.tyres.compounds.inter;
    const wet = spec.tyres.compounds.wet;
    expect(inter.mu0).toBeCloseTo(1.59588, 10);
    expect(wet.mu0).toBeCloseTo(1.51008, 10);
    expect(m.mu0).toBeCloseTo(1.716, 10);
    for (const key of SLICK_FIELDS) {
      expect(inter[key]).toBeCloseTo(m[key], 12);
      expect(wet[key]).toBeCloseTo(m[key], 12);
    }

    const j2 = f4Json();
    const compounds = (j2.tyres as { compounds: Record<string, Record<string, unknown>> })
      .compounds;
    const explicit: TyreCompound = { ...m, mu0: 1.234, optTempC: 80 } as TyreCompound;
    compounds.inter = explicit as unknown as Record<string, unknown>;
    const spec2 = parseCarSpec(j2);
    expect(spec2.tyres.compounds.inter.mu0).toBeCloseTo(1.234, 10);
    expect(spec2.tyres.compounds.inter.optTempC).toBeCloseTo(80, 10);
    expect(spec2.tyres.compounds.wet.mu0).toBeCloseTo(spec2.tyres.compounds.medium.mu0 * 0.88, 10);
    expect(spec2.tyres.compounds.wet.optTempC).toBeCloseTo(90, 10);
  });
});
