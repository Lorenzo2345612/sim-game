import { describe, it, expect } from 'vitest';
import { crackleSchedule, windGain, kerbRumbleHz, shiftEnvelope } from '../../../src/audio/effects';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('110 audio effects acceptance', () => {
  it('AT1: lift-off above 0.7 limiter schedules 3-8 sorted offsets in [0, 0.6] s', () => {
    const offsets = crackleSchedule(0.9, 0.05, 6000, 7000, 1, lcg(110));
    expect(offsets.length).toBeGreaterThanOrEqual(3);
    expect(offsets.length).toBeLessThanOrEqual(8);
    for (let i = 0; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(0);
      expect(offsets[i]).toBeLessThanOrEqual(0.6);
      if (i > 0) expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
    }
  });

  it('AT2: no crackle below 0.7 limiter, with crackle 0, or without lift-off past 0.5 throttle', () => {
    const rng = lcg(110);
    expect(crackleSchedule(0.9, 0.05, 4000, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 0, rng)).toEqual([]);
    expect(crackleSchedule(0.5, 0.3, 6000, 7000, 1, rng)).toEqual([]);
  });

  it('AT3: windGain is 0 / 0.1 / 0.4 / 0.4 at 0 / 40 / 80 / 120 m/s', () => {
    expect(Math.abs(windGain(0) - 0)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(windGain(40) - 0.1)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(windGain(80) - 0.4)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(windGain(120) - 0.4)).toBeLessThanOrEqual(1e-9);
  });

  it('AT4: kerbRumbleHz at 30 m/s over a 1.5 m stripe is 20 Hz', () => {
    expect(kerbRumbleHz(30, 1.5)).toBeCloseTo(20, 9);
  });

  it('AT5: shiftEnvelope is 1 at 0, holds 0.3 through 0.04, recovers to 1 by 0.08 and stays', () => {
    expect(Math.abs(shiftEnvelope(0) - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.01) - 0.65)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.02) - 0.3)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.04) - 0.3)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.06) - 0.3)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.07) - 0.65)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.08) - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(0.2) - 1)).toBeLessThanOrEqual(1e-6);
  });
});
