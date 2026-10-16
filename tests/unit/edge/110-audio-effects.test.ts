import { describe, it, expect } from 'vitest';
import { crackleSchedule, windGain, kerbRumbleHz, shiftEnvelope } from '../../../src/audio/effects';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('110 audio effects edges', () => {
  it('EDGE1: lift-off requires prevThrottle strictly above 0.5', () => {
    expect(crackleSchedule(0.5, 0.05, 6000, 7000, 1, lcg(1))).toEqual([]);
    expect(crackleSchedule(0.5001, 0.05, 6000, 7000, 1, lcg(1)).length).toBeGreaterThanOrEqual(3);
  });

  it('EDGE2: lift-off requires throttle strictly below 0.15', () => {
    expect(crackleSchedule(0.9, 0.15, 6000, 7000, 1, lcg(2))).toEqual([]);
    expect(crackleSchedule(0.9, 0.149, 6000, 7000, 1, lcg(2)).length).toBeGreaterThanOrEqual(3);
  });

  it('EDGE3: crackle triggers at rpm equal to 0.7 times limiter and not just below', () => {
    expect(crackleSchedule(0.9, 0.05, 0.7 * 7000, 7000, 1, lcg(3)).length).toBeGreaterThanOrEqual(3);
    expect(crackleSchedule(0.9, 0.05, 0.7 * 7000 - 1e-6, 7000, 1, lcg(3))).toEqual([]);
  });

  it('EDGE4: crackle count is round(3 + 5·crackle·rng) clamped to 3..8 and offsets are 0.6·rng', () => {
    const at = (r: number) => () => r;
    const six = crackleSchedule(0.9, 0.05, 6000, 7000, 1, at(0.6));
    expect(six).toHaveLength(6);
    for (const o of six) expect(Math.abs(o - 0.36)).toBeLessThanOrEqual(1e-12);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 1, at(0))).toEqual([0, 0, 0]);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 1, at(1))).toEqual([0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, 4, at(1))).toHaveLength(8);
  });

  it('EDGE5: crackle at or below 0 never schedules', () => {
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, -1, lcg(5))).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, -0.001, lcg(5))).toEqual([]);
  });

  it('EDGE6: any non-finite numeric input yields no crackle', () => {
    const rng = lcg(6);
    expect(crackleSchedule(NaN, 0.05, 6000, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(Infinity, 0.05, 6000, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, NaN, 6000, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, NaN, 7000, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, 6000, Infinity, 1, rng)).toEqual([]);
    expect(crackleSchedule(0.9, 0.05, 6000, 7000, NaN, rng)).toEqual([]);
  });

  it('EDGE7: windGain interpolates linearly inside each segment', () => {
    expect(Math.abs(windGain(20) - 0.05)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(windGain(60) - 0.25)).toBeLessThanOrEqual(1e-9);
  });

  it('EDGE8: windGain is 0 for negative speed', () => {
    expect(windGain(-1)).toBe(0);
    expect(windGain(-80)).toBe(0);
  });

  it('EDGE9: kerbRumbleHz is 0 when stripeMeters is 0 or negative', () => {
    expect(kerbRumbleHz(30, 0)).toBe(0);
    expect(kerbRumbleHz(30, -2)).toBe(0);
  });

  it('EDGE10: shiftEnvelope is 1 for negative t', () => {
    expect(Math.abs(shiftEnvelope(-0.1) - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(shiftEnvelope(-5) - 1)).toBeLessThanOrEqual(1e-6);
  });
});
