import { describe, it, expect } from 'vitest';
import { FIXED_DT, MAX_STEPS_PER_FRAME, MS_TO_KMH } from '../../../src/core/constants';

describe('constants', () => {
  it('FIXED_DT is 1/120', () => {
    expect(FIXED_DT).toBeCloseTo(1 / 120, 10);
  });

  it('MAX_STEPS_PER_FRAME is 8', () => {
    expect(MAX_STEPS_PER_FRAME).toBe(8);
  });

  it('MS_TO_KMH is 3.6', () => {
    expect(MS_TO_KMH).toBeCloseTo(3.6, 10);
  });
});
