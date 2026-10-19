import { describe, expect, it } from 'vitest';
import { Battery, motorWheelTorque, regenSplit, splitPower, REGEN_MIN_OMEGA } from '../../../src/physics/electric';
import type { MotorSpec } from '../../../src/physics/electric';

const R: MotorSpec = { maxPowerW: 350e3, maxTorqueNm: 557, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };
const F: MotorSpec = { maxPowerW: 250e3, maxTorqueNm: 400, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };

function relClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-3 * Math.abs(expected));
}

describe('281 electric powertrain edge cases', () => {
  it('EDGE1: throttle is clamped to [0, 1]', () => {
    relClose(motorWheelTorque(R, 40.2768, 350e3, 1.5), 4344.6);
    relClose(motorWheelTorque(R, 40.2768, 350e3, 2), 4344.6);
    relClose(motorWheelTorque(R, 40.2768, 350e3, 0), 0);
  });

  it('EDGE2: motor torque uses |wheelOmega| so reverse spin gives same torque', () => {
    relClose(motorWheelTorque(R, -40.2768, 350e3, 1), 4344.6);
  });

  it('EDGE3: non-positive powerCapW gives zero wheel torque at rolling speed', () => {
    relClose(motorWheelTorque(R, 40.2768, 0, 1), 0);
    relClose(motorWheelTorque(R, 161.107, -1e3, 1), 0);
  });

  it('EDGE4: torque cuts exactly at maxRpm (>=) but not just below', () => {
    const wCut = (R.maxRpm * 2 * Math.PI) / 60 / R.ratio;
    relClose(motorWheelTorque(R, wCut, 350e3, 1), 0);
    const wBelow = wCut - 1e-6;
    relClose(motorWheelTorque(R, wBelow, 350e3, 1), 350e3 / (wBelow * R.ratio) * R.ratio);
  });

  it('EDGE5: regenSplit with axleBrakeNm <= 0 returns { regenNm: 0, frictionNm: 0 }', () => {
    const a = regenSplit(0, 50, R, false);
    expect(a.regenNm).toBe(0);
    expect(a.frictionNm).toBe(0);
    const b = regenSplit(-2000, 50, R, false);
    expect(b.regenNm).toBe(0);
    expect(b.frictionNm).toBe(0);
  });

  it('EDGE6: regenSplit uses |wheelOmega| so reverse spin still regenerates', () => {
    const a = regenSplit(3000, -200, R, false);
    relClose(a.regenNm, 1750);
    relClose(a.frictionNm, 1250);
  });

  it('EDGE7: regen speed floor is strict (< REGEN_MIN_OMEGA) and safe at zero speed', () => {
    expect(REGEN_MIN_OMEGA).toBe(3);
    const atFloor = regenSplit(3000, REGEN_MIN_OMEGA, R, false);
    relClose(atFloor.regenNm, 3000);
    relClose(atFloor.frictionNm, 0);
    const belowFloor = regenSplit(3000, REGEN_MIN_OMEGA - 0.001, R, false);
    relClose(belowFloor.regenNm, 0);
    relClose(belowFloor.frictionNm, 3000);
    const standstill = regenSplit(3000, 0, R, false);
    relClose(standstill.regenNm, 0);
    relClose(standstill.frictionNm, 3000);
    expect(Number.isFinite(standstill.regenNm)).toBe(true);
    expect(Number.isFinite(standstill.frictionNm)).toBe(true);
  });

  it('EDGE8: splitPower with non-positive capW gives [0, 0]', () => {
    const a = splitPower(0, F, R);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    const b = splitPower(-1e5, F, R);
    expect(b[0]).toBe(0);
    expect(b[1]).toBe(0);
  });

  it('EDGE9: Battery frac is socJ/capacityJ and empty/full are false mid-range', () => {
    const b = new Battery(1e6, 2.5e5);
    relClose(b.frac, 0.25);
    expect(b.empty).toBe(false);
    expect(b.full).toBe(false);
  });

  it('EDGE10: negative mechW or dt are treated as 0 in drain and charge', () => {
    const b = new Battery(1e6, 5e5);
    b.drain(-1e3, 1, 0.95);
    expect(b.socJ).toBeCloseTo(5e5, 6);
    b.charge(-1e3, 1, 0.95);
    expect(b.socJ).toBeCloseTo(5e5, 6);
    b.drain(1e3, -1, 0.95);
    expect(b.socJ).toBeCloseTo(5e5, 6);
    b.charge(1e3, -1, 0.95);
    expect(b.socJ).toBeCloseTo(5e5, 6);
  });
});
