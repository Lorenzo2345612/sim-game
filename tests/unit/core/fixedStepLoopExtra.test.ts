import { describe, it, expect } from 'vitest';
import { FixedStepLoop } from '../../../src/core/fixedStepLoop';
import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../../../src/core/constants';

function makeLoop(fixedDt?: number, maxSteps?: number) {
  const dts: number[] = [];
  const loop = new FixedStepLoop((dt) => {
    dts.push(dt);
  }, fixedDt, maxSteps);
  return { loop, dts };
}

describe('FixedStepLoop edge cases', () => {
  it('constructor defaults to FIXED_DT and MAX_STEPS_PER_FRAME', () => {
    const { loop, dts } = makeLoop();
    const { steps, alpha } = loop.advance(1);
    expect(steps).toBe(MAX_STEPS_PER_FRAME);
    expect(alpha).toBeCloseTo(0, 10);
    for (const dt of dts) expect(dt).toBeCloseTo(FIXED_DT, 12);
  });

  it('advance(0) with a partial accumulator keeps it without stepping', () => {
    const { loop, dts } = makeLoop(1 / 120, 8);
    loop.advance(0.5 / 120);
    const { steps, alpha } = loop.advance(0);
    expect(steps).toBe(0);
    expect(alpha).toBeCloseTo(0.5, 6);
    expect(dts).toHaveLength(0);
  });

  it('advance(0) on a fresh loop returns steps 0 and alpha 0', () => {
    const { loop, dts } = makeLoop(1 / 120, 8);
    const { steps, alpha } = loop.advance(0);
    expect(steps).toBe(0);
    expect(alpha).toBe(0);
    expect(dts).toHaveLength(0);
  });

  it('frame of exactly maxSteps*fixedDt runs maxSteps steps with alpha near 0', () => {
    const { loop } = makeLoop(1 / 120, 8);
    const { steps, alpha } = loop.advance(8 / 120);
    expect(steps).toBe(8);
    expect(alpha).toBeCloseTo(0, 10);
  });

  it('frame slightly over the clamp keeps the remainder instead of dropping it', () => {
    const { loop } = makeLoop(1 / 120, 8);
    const { steps, alpha } = loop.advance(8.5 / 120);
    expect(steps).toBe(8);
    expect(alpha).toBeCloseTo(0.5, 6);
  });

  it('after dropping excess the accumulator restarts from zero', () => {
    const { loop } = makeLoop(1 / 120, 8);
    loop.advance(1);
    const { steps, alpha } = loop.advance(0.5 / 120);
    expect(steps).toBe(0);
    expect(alpha).toBeCloseTo(0.5, 6);
  });

  it('alpha stays within [0, 1) across a long frame sequence', () => {
    const { loop } = makeLoop(1 / 120, 8);
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const r = loop.advance(0.013 + (i % 7) * 0.002);
      expect(r.alpha).toBeGreaterThanOrEqual(0);
      expect(r.alpha).toBeLessThan(1);
      total += r.steps;
    }
    expect(total).toBeGreaterThan(0);
  });

  it('exact fixed-dt frames accumulate no drift over many steps', () => {
    const { loop, dts } = makeLoop(1 / 120, 8);
    for (let i = 0; i < 100; i++) {
      const { steps, alpha } = loop.advance(1 / 120);
      expect(steps).toBe(1);
      expect(alpha).toBeLessThan(1);
    }
    expect(dts).toHaveLength(100);
  });

  it('custom fixedDt and maxSteps are honored', () => {
    const { loop, dts } = makeLoop(1 / 30, 3);
    const { steps, alpha } = loop.advance(1);
    expect(steps).toBe(3);
    expect(alpha).toBeCloseTo(0, 10);
    for (const dt of dts) expect(dt).toBeCloseTo(1 / 30, 12);
  });

  it('reset on a fresh loop is a no-op', () => {
    const { loop } = makeLoop(1 / 120, 8);
    loop.reset();
    expect(loop.advance(0.5 / 120).alpha).toBeCloseTo(0.5, 6);
  });
});
