import { describe, it, expect } from 'vitest';
import {
  Gearbox,
  rpmFor,
  GEAR_RATIOS,
  IDLE_RPM,
  LIMITER_RPM,
  UPSHIFT_RPM,
} from '../../../src/physics/gearbox';

describe('gearbox', () => {
  it('starts in gear 1, auto mode, and setMode round-trips', () => {
    const gb = new Gearbox();
    expect(gb.gear).toBe(1);
    expect(gb.mode).toBe('auto');
    gb.setMode('manual');
    expect(gb.mode).toBe('manual');
    gb.setMode('auto');
    expect(gb.mode).toBe('auto');
  });

  it('auto mode no longer forces gear 1 while reversing', () => {
    const gb = new Gearbox();
    for (let i = 0; i < 6; i++) gb.update(90);
    expect(gb.gear).toBe(6);
    // Backwards speed reads rpm by magnitude; the idle clamp just downshifts.
    gb.update(-1);
    expect(gb.gear).toBe(5);
    expect(gb.rpm(-1)).toBeCloseTo(IDLE_RPM, 0);
    gb.update(-1);
    expect(gb.gear).toBe(4);
  });

  it('auto shifts at most one gear per update and stays in 1..6 at extreme speed', () => {
    const gb = new Gearbox();
    gb.update(200);
    expect(gb.gear).toBe(2);
    for (let i = 0; i < 10; i++) gb.update(200);
    expect(gb.gear).toBe(6);
    for (let i = 0; i < 10; i++) gb.update(0);
    expect(gb.gear).toBe(1);
  });

  it('manual holds the gear on update and auto resumes shifting after setMode', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    gb.shiftUp();
    gb.update(200);
    expect(gb.gear).toBe(2);
    gb.setMode('auto');
    gb.update(200);
    expect(gb.gear).toBe(3);
    expect(UPSHIFT_RPM).toBeLessThan(LIMITER_RPM);
  });

  it('driveScale flips at the limiter without latching', () => {
    const gb = new Gearbox();
    gb.setMode('manual');
    gb.shiftUp(); // gear 2
    expect(gb.driveScale(40)).toBe(0);
    expect(gb.driveScale(39)).toBe(1);
    expect(gb.driveScale(0)).toBe(1);
  });

  it('every gear clamps to idle below its idle threshold', () => {
    for (let gear = 1; gear <= GEAR_RATIOS.length; gear++) {
      expect(rpmFor(0, gear)).toBeCloseTo(IDLE_RPM, 0);
      expect(rpmFor(-0.5, gear)).toBeCloseTo(IDLE_RPM, 0);
    }
  });
});
