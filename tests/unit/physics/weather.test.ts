import { describe, it, expect } from 'vitest';
import {
  TrackWeather,
  compoundClass,
  gripFactor,
  wearMultiplier,
} from '../../../src/physics/weather';

describe('weather model extra edges', () => {
  it('stores the seed', () => {
    expect(new TrackWeather(42).seed).toBe(42);
  });

  it('treats non-finite lineUsage as 0 while drying', () => {
    const w = new TrackWeather(1);
    w.setWetness(1);
    w.update(1, Number.NaN);
    expect(w.wetness).toBeCloseTo(0.996, 12);
    w.update(1, Number.POSITIVE_INFINITY);
    expect(w.wetness).toBeCloseTo(0.992, 12);
  });

  it('wetting ignores lineUsage entirely', () => {
    const w = new TrackWeather(1);
    w.setRain(1);
    w.update(1, 1000);
    expect(w.wetness).toBeCloseTo(0.02, 12);
  });

  it('gripFactor feeds off TrackWeather wetness without rounding', () => {
    const w = new TrackWeather(1);
    w.setWetness(0.5);
    expect(gripFactor(compoundClass('medium'), w.wetness)).toBeCloseTo(0.775, 12);
    expect(gripFactor('wet', w.wetness)).toBeCloseTo(0.875, 12);
  });

  it('wearMultiplier with non-finite wetness is 1', () => {
    expect(wearMultiplier('wet', Number.NaN)).toBe(1);
  });
});
