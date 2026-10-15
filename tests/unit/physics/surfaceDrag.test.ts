import { describe, it, expect } from 'vitest';
import { rollingDrag } from '../../../src/physics/surfaceDrag';

describe('rollingDrag', () => {
  it('is 0 on asphalt, kerb and runoff at any speed and load', () => {
    for (const surface of ['asphalt', 'kerb', 'runoff'] as const) {
      expect(rollingDrag(surface, 50, 1500)).toBe(0);
      expect(rollingDrag(surface, 0, 4000)).toBe(0);
    }
  });

  it('is c0*fz at standstill and grows with speed', () => {
    expect(rollingDrag('grass', 0, 1000)).toBeCloseTo(100, 9);
    expect(rollingDrag('gravel', 0, 1000)).toBeCloseTo(80, 9);
    expect(rollingDrag('gravel', 60, 1000)).toBeGreaterThan(rollingDrag('gravel', 30, 1000));
  });

  it('is symmetric in speed sign and linear in load', () => {
    expect(rollingDrag('gravel', -20, 1500)).toBe(rollingDrag('gravel', 20, 1500));
    expect(rollingDrag('grass', 20, 3000)).toBeCloseTo(rollingDrag('grass', 20, 1000) * 3, 9);
  });

  it('returns 0 for non-finite speed or load and clamps negative load', () => {
    expect(rollingDrag('grass', Number.NaN, 1500)).toBe(0);
    expect(rollingDrag('grass', Number.POSITIVE_INFINITY, 1500)).toBe(0);
    expect(rollingDrag('grass', 20, Number.NaN)).toBe(0);
    expect(rollingDrag('grass', 20, Number.NEGATIVE_INFINITY)).toBe(0);
    expect(rollingDrag('grass', 20, -5)).toBe(0);
    expect(rollingDrag('grass', 20, 0)).toBe(0);
  });
});
