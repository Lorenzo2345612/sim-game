import { describe, it, expect } from 'vitest';
import {
  FIXED_DT,
  MAX_STEPS_PER_FRAME,
  GRAVITY,
  AIR_DENSITY,
  MS_TO_KMH,
} from '../../../src/core/constants';

describe('constants values not covered by the 3 required tests', () => {
  it('GRAVITY is -9.81 (negative, Y axis down)', () => {
    expect(GRAVITY).toBeCloseTo(-9.81, 10);
  });

  it('AIR_DENSITY is 1.225 kg/m³', () => {
    expect(AIR_DENSITY).toBeCloseTo(1.225, 10);
  });
});

describe('constants edge cases', () => {
  it('FIXED_DT times 120 is exactly one second', () => {
    expect(FIXED_DT * 120).toBeCloseTo(1, 10);
  });

  it('MAX_STEPS_PER_FRAME is a positive integer (frame budget of 8 fixed steps)', () => {
    expect(Number.isInteger(MAX_STEPS_PER_FRAME)).toBe(true);
    expect(MAX_STEPS_PER_FRAME * FIXED_DT).toBeCloseTo(8 / 120, 10);
  });

  it('MS_TO_KMH converts zero and negative speeds (reversing) consistently', () => {
    expect(0 * MS_TO_KMH).toBe(0);
    expect(-10 * MS_TO_KMH).toBeCloseTo(-36, 10);
    expect(1 * MS_TO_KMH).toBeCloseTo(3.6, 10);
  });

  it('all constants are finite numbers', () => {
    for (const c of [FIXED_DT, MAX_STEPS_PER_FRAME, GRAVITY, AIR_DENSITY, MS_TO_KMH]) {
      expect(Number.isFinite(c)).toBe(true);
    }
  });
});
