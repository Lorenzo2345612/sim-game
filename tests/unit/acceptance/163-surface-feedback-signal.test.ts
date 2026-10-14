import { describe, expect, it } from 'vitest';
import { surfaceFeedback, type Feedback } from '../../../src/core/surfaceFeedback';
import type { Surface } from '../../../src/core/types';

interface Wheel { surface: Surface; kappa: number }

// Out-of-range sentinels: a no-op implementation fails instead of passing on zeros.
const fresh = (): Feedback => ({ shake: -1, low: -1, high: -1 });

const W = (surface: Surface, n: number, kappa = 0): Wheel[] =>
  Array.from({ length: n }, () => ({ surface, kappa }));

function expectFeedback(f: Feedback, shake: number, low: number, high: number): void {
  expect(f.shake).toBeCloseTo(shake, 9);
  expect(f.low).toBeCloseTo(low, 9);
  expect(f.high).toBeCloseTo(high, 9);
}

describe('163 surfaceFeedback', () => {
  it('AT1: 4 asphalt wheels at speed 50 give no feedback', () => {
    expectFeedback(surfaceFeedback(W('asphalt', 4), 50, fresh()), 0, 0, 0);
  });

  it('AT2: 4 gravel wheels at speed 30 give 0.8 shake and low, no high', () => {
    expectFeedback(surfaceFeedback(W('gravel', 4), 30, fresh()), 0.8, 0.8, 0);
  });

  it('AT3: 2 kerb + 2 asphalt at speed 15 scale roughness and kerb fraction by s', () => {
    const wheels: Wheel[] = [...W('kerb', 2), ...W('asphalt', 2)];
    expectFeedback(surfaceFeedback(wheels, 15, fresh()), 0.15, 0.15, 0.25);
  });

  it('AT4: 4 grass wheels at speed 60 give 0.3 shake and low, no high', () => {
    expectFeedback(surfaceFeedback(W('grass', 4), 60, fresh()), 0.3, 0.3, 0);
  });

  it('AT5: asphalt with max kappa 0.5 gives high 0.5 and no roughness channels', () => {
    const wheels: Wheel[] = [
      { surface: 'asphalt', kappa: 0 },
      { surface: 'asphalt', kappa: 0.5 },
      { surface: 'asphalt', kappa: 0.1 },
      { surface: 'asphalt', kappa: 0 },
    ];
    expectFeedback(surfaceFeedback(wheels, 40, fresh()), 0, 0, 0.5);
  });

  it('AT6: 4 kerb wheels at kappa 0.85 clamp high to 1', () => {
    expect(surfaceFeedback(W('kerb', 4, 0.85), 30, fresh()).high).toBeCloseTo(1, 9);
  });

  it('AT7: NaN or negative speed gives all 0; all-NaN kappas on gravel give 0.8/0.8/0', () => {
    expectFeedback(surfaceFeedback(W('gravel', 4), NaN, fresh()), 0, 0, 0);
    expectFeedback(surfaceFeedback(W('gravel', 4), -5, fresh()), 0, 0, 0);
    expectFeedback(surfaceFeedback(W('gravel', 4, NaN), 30, fresh()), 0.8, 0.8, 0);
  });

  it('AT8: empty wheel array at speed 30 gives all 0', () => {
    expectFeedback(surfaceFeedback([], 30, fresh()), 0, 0, 0);
  });

  it('AT9: returns the same out object passed in', () => {
    const out = fresh();
    expect(surfaceFeedback(W('kerb', 4), 30, out)).toBe(out);
  });
});
