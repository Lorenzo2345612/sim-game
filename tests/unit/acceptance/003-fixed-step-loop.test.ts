import { describe, it, expect } from 'vitest';
import { FixedStepLoop } from '../../../src/core/fixedStepLoop';
import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../../../src/core/constants';

function countingLoop(fixedDt: number, maxSteps: number) {
  const dts: number[] = [];
  const loop = new FixedStepLoop((dt) => {
    dts.push(dt);
  }, fixedDt, maxSteps);
  return { loop, dts };
}

describe('task 003 acceptance: FixedStepLoop', () => {
  it('AT1: advance(1/60) runs exactly 2 steps of dt 1/120 with alpha in [0, 1]', () => {
    const { loop, dts } = countingLoop(FIXED_DT, MAX_STEPS_PER_FRAME);
    const { steps, alpha } = loop.advance(1 / 60);
    expect(steps).toBe(2);
    expect(dts).toHaveLength(2);
    for (const dt of dts) expect(dt).toBeCloseTo(FIXED_DT, 12);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(1);
  });

  it('AT2: two half frames accumulate into one step', () => {
    const { loop } = countingLoop(FIXED_DT, MAX_STEPS_PER_FRAME);
    const first = loop.advance(0.5 / 120);
    expect(first.steps).toBe(0);
    expect(first.alpha).toBeCloseTo(0.5, 9);
    const second = loop.advance(0.5 / 120);
    expect(second.steps).toBe(1);
  });

  it('AT3: advance(1.0) returns 8 steps and drops the excess (alpha 0)', () => {
    const { loop, dts } = countingLoop(FIXED_DT, MAX_STEPS_PER_FRAME);
    const { steps, alpha } = loop.advance(1.0);
    expect(steps).toBe(8);
    expect(dts).toHaveLength(8);
    expect(alpha).toBeCloseTo(0, 10);
  });

  it('AT4: negative, NaN and Infinity frames return 0 steps and never call step', () => {
    const { loop, dts } = countingLoop(FIXED_DT, MAX_STEPS_PER_FRAME);
    expect(loop.advance(-1).steps).toBe(0);
    expect(loop.advance(NaN).steps).toBe(0);
    expect(loop.advance(Infinity).steps).toBe(0);
    expect(dts).toHaveLength(0);
  });

  it('AT5: reset clears the accumulator', () => {
    const { loop } = countingLoop(FIXED_DT, MAX_STEPS_PER_FRAME);
    loop.advance(0.5 / 120);
    loop.reset();
    expect(loop.advance(0).alpha).toBeCloseTo(0, 10);
  });
});
