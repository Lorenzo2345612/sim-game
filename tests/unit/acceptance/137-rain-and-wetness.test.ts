import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { TrackWeather, gripFactor } from '../../../src/physics/weather';

const ROOT = join(__dirname, '..', '..', '..');

function f4Json(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8'),
  ) as Record<string, unknown>;
}

describe('137 rain and wetness model acceptance', () => {
  it('AT1: rain 1 for 50 s from dry drives wetness to 1.0 ± 1e-9 (clamped after 50 s)', () => {
    const weather = new TrackWeather(1);
    weather.setRain(1);
    const dt = 1 / 120;
    for (let i = 0; i < 6000; i++) weather.update(dt, 0);
    expect(Math.abs(weather.wetness - 1.0)).toBeLessThanOrEqual(1e-9);
  });

  it('AT2: wetness 1, rain 0, lineUsage 0 for 100 s yields 0.6 ± 1e-6', () => {
    const weather = new TrackWeather(1);
    weather.setWetness(1);
    weather.setRain(0);
    const dt = 1 / 120;
    for (let i = 0; i < 12000; i++) weather.update(dt, 0);
    expect(Math.abs(weather.wetness - 0.6)).toBeLessThanOrEqual(1e-6);
  });

  it('AT3: gripFactor at wetness 0, 0.5, 1 is slick 1/0.775/0.55, inter 0.78/0.93/0.78, wet 0.85/0.875/0.9', () => {
    expect(gripFactor('slick', 0)).toBeCloseTo(1, 10);
    expect(gripFactor('slick', 0.5)).toBeCloseTo(0.775, 10);
    expect(gripFactor('slick', 1)).toBeCloseTo(0.55, 10);
    expect(gripFactor('inter', 0)).toBeCloseTo(0.78, 10);
    expect(gripFactor('inter', 0.5)).toBeCloseTo(0.93, 10);
    expect(gripFactor('inter', 1)).toBeCloseTo(0.78, 10);
    expect(gripFactor('wet', 0)).toBeCloseTo(0.85, 10);
    expect(gripFactor('wet', 0.5)).toBeCloseTo(0.875, 10);
    expect(gripFactor('wet', 1)).toBeCloseTo(0.9, 10);
  });

  it('AT4: parseCarSpec of f4.json has inter and wet compounds', () => {
    const spec = parseCarSpec(f4Json());
    expect(Object.keys(spec.tyres.compounds).sort()).toEqual([
      'hard',
      'inter',
      'medium',
      'soft',
      'wet',
    ]);
  });
});
