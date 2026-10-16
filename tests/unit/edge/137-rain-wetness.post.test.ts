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

describe('137 rain and wetness post-code gaps', () => {
  it('starts dry: wetness 0 and rain 0 before any input', () => {
    const w = new TrackWeather(5);
    expect(w.wetness).toBeCloseTo(0, 12);
    expect(w.rain).toBeCloseTo(0, 12);
  });

  it('fractional rain wets at 0.02·rain per second', () => {
    const w = new TrackWeather(1);
    w.setRain(0.5);
    w.update(10, 0);
    expect(w.wetness).toBeCloseTo(0.1, 12);
  });

  it('single update with a very large dt clamps wetness at 1 when raining and at 0 when drying', () => {
    const a = new TrackWeather(1);
    a.setRain(1);
    a.update(1e6, 0);
    expect(a.wetness).toBeCloseTo(1, 12);

    const b = new TrackWeather(1);
    b.setWetness(1);
    b.update(1e6, 0);
    expect(b.wetness).toBeCloseTo(0, 12);
  });

  it('drying rate keeps scaling with large lineUsage (usage 100 → 0.044/s)', () => {
    const w = new TrackWeather(1);
    w.setWetness(1);
    w.update(10, 100);
    expect(w.wetness).toBeCloseTo(0.56, 12);
  });

  it('gripFactor follows the closed-form curves at wetness values outside the AT anchors', () => {
    expect(gripFactor('slick', 0.3)).toBeCloseTo(0.865, 10);
    expect(gripFactor('slick', 0.8)).toBeCloseTo(0.64, 10);
    expect(gripFactor('inter', 0.3)).toBeCloseTo(0.87, 10);
    expect(gripFactor('inter', 0.8)).toBeCloseTo(0.84, 10);
    expect(gripFactor('wet', 0.3)).toBeCloseTo(0.865, 10);
    expect(gripFactor('wet', 0.8)).toBeCloseTo(0.89, 10);
  });

  it('explicit wet compound is parsed verbatim while inter derives from medium', () => {
    const j = f4Json();
    const compounds = (j.tyres as { compounds: Record<string, Record<string, unknown>> })
      .compounds;
    compounds.wet = { ...compounds.medium, mu0: 1.111, optTempC: 70 };
    const spec = parseCarSpec(j);
    expect(spec.tyres.compounds.wet.mu0).toBeCloseTo(1.111, 10);
    expect(spec.tyres.compounds.wet.optTempC).toBeCloseTo(70, 10);
    expect(spec.tyres.compounds.inter.mu0).toBeCloseTo(
      spec.tyres.compounds.medium.mu0 * 0.93,
      10,
    );
    expect(spec.tyres.compounds.inter.optTempC).toBeCloseTo(
      spec.tyres.compounds.medium.optTempC,
      10,
    );
  });

  it('explicit inter with an invalid field fails parsing instead of deriving', () => {
    const j = f4Json();
    const compounds = (j.tyres as { compounds: Record<string, Record<string, unknown>> })
      .compounds;
    compounds.inter = { ...compounds.medium, mu0: 'nope' };
    expect(() => parseCarSpec(j)).toThrow(/tyres\.compounds\.inter\.mu0/);
  });

  it('derived inter and wet are copies: mutating medium does not affect them', () => {
    const spec = parseCarSpec(f4Json());
    const interMu = spec.tyres.compounds.inter.mu0;
    const wetMu = spec.tyres.compounds.wet.mu0;
    spec.tyres.compounds.medium.mu0 = 999;
    expect(spec.tyres.compounds.inter.mu0).toBeCloseTo(interMu, 12);
    expect(spec.tyres.compounds.wet.mu0).toBeCloseTo(wetMu, 12);
  });
});
