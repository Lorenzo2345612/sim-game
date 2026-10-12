import { describe, it, expect } from 'vitest';
import { FixedStepLoop } from '../../../src/core/fixedStepLoop';

function makeLoop(fixedDt = 1 / 120, maxSteps = 8) {
  const dts: number[] = [];
  const loop = new FixedStepLoop((dt) => {
    dts.push(dt);
  }, fixedDt, maxSteps);
  return { loop, dts };
}

describe('FixedStepLoop', () => {
  it('advance(1/60) runs 2 steps with alpha near 0', () => {
    const { loop } = makeLoop();
    const { steps, alpha } = loop.advance(1 / 60);
    expect(steps).toBe(2);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThanOrEqual(1);
    expect(alpha < 1e-6 || alpha > 1 - 1e-6).toBe(true);
  });

  it('partial frames accumulate', () => {
    const { loop } = makeLoop();
    const first = loop.advance(0.5 / 120);
    expect(first.steps).toBe(0);
    expect(first.alpha).toBeCloseTo(0.5, 6);
    const second = loop.advance(0.5 / 120);
    expect(second.steps).toBe(1);
  });

  it('huge frame is clamped to 8 steps and drops remainder', () => {
    const { loop } = makeLoop();
    const { steps, alpha } = loop.advance(1);
    expect(steps).toBe(8);
    expect(alpha).toBeCloseTo(0, 10);
  });

  it('negative frame time adds nothing', () => {
    const { loop } = makeLoop();
    expect(loop.advance(-1).steps).toBe(0);
  });

  it('NaN and Infinity frame time add nothing', () => {
    const { loop, dts } = makeLoop();
    expect(loop.advance(NaN).steps).toBe(0);
    expect(loop.advance(Infinity).steps).toBe(0);
    expect(dts).toHaveLength(0);
  });

  it('step always receives fixedDt', () => {
    const { loop, dts } = makeLoop();
    loop.advance(1 / 60);
    loop.advance(0.5 / 120);
    loop.advance(1);
    for (const dt of dts) expect(dt).toBeCloseTo(1 / 120, 12);
  });

  it('reset clears the accumulator', () => {
    const { loop } = makeLoop();
    loop.advance(0.5 / 120);
    loop.reset();
    expect(loop.advance(0).alpha).toBeCloseTo(0, 10);
  });
});
