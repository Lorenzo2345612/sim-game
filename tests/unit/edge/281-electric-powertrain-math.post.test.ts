import { describe, expect, it } from 'vitest';
import { Battery, motorWheelTorque, regenSplit, splitPower } from '../../../src/physics/electric';
import type { MotorSpec } from '../../../src/physics/electric';

const R: MotorSpec = { maxPowerW: 350e3, maxTorqueNm: 557, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };
const F: MotorSpec = { maxPowerW: 250e3, maxTorqueNm: 400, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };

function relClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-3 * Math.abs(expected) + 1e-12);
}

describe('281 electric powertrain post-code gaps', () => {
  it('POST1: powerCapW above the motor max does not raise torque', () => {
    relClose(motorWheelTorque(R, 161.107, 1e9, 1), 2172.4);
    relClose(motorWheelTorque(R, 161.107, 700e3, 1), 2172.4);
  });

  it('POST2: standstill torque is throttle·maxTorqueNm·ratio and ignores powerCapW', () => {
    relClose(motorWheelTorque(R, 0, 350e3, 1), 557 * 7.8);
    relClose(motorWheelTorque(R, 0, 0, 1), 557 * 7.8);
    relClose(motorWheelTorque(R, 0, 1e9, 0.5), 0.5 * 557 * 7.8);
  });

  it('POST3: zero ratio or zero maxRpm gives zero wheel torque', () => {
    const zeroRatio: MotorSpec = { ...R, ratio: 0 };
    expect(motorWheelTorque(zeroRatio, 50, 350e3, 1)).toBe(0);
    const zeroRpm: MotorSpec = { ...R, maxRpm: 0 };
    expect(motorWheelTorque(zeroRpm, 0, 350e3, 1)).toBe(0);
    expect(motorWheelTorque(zeroRpm, 50, 350e3, 1)).toBe(0);
  });

  it('POST4: motorWheelTorque does not mutate the MotorSpec', () => {
    const spec: MotorSpec = { ...R };
    motorWheelTorque(spec, 161.107, 262.5e3, 0.7);
    expect(spec).toEqual(R);
  });

  it('POST5: splitPower with zero total motor power gives [0, 0]', () => {
    const z: MotorSpec = { ...R, maxPowerW: 0 };
    const a = splitPower(450e3, z, z);
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
  });

  it('POST6: splitPower gives zero share to a zero-power motor', () => {
    const z: MotorSpec = { ...F, maxPowerW: 0 };
    const a = splitPower(400e3, z, R);
    expect(a[0]).toBe(0);
    expect(a[1]).toBeCloseTo(350e3, 6);
  });

  it('POST7: unclamped splitPower shares sum to capW and follow maxPowerW ratio', () => {
    const a = splitPower(300e3, F, R);
    expect(a[0]).toBeCloseTo(125000, 6);
    expect(a[1]).toBeCloseTo(175000, 6);
    expect(a[0] + a[1]).toBeCloseTo(300e3, 6);
  });

  it('POST8: splitPower does not mutate the MotorSpec inputs', () => {
    const f: MotorSpec = { ...F };
    const r: MotorSpec = { ...R };
    splitPower(450e3, f, r);
    expect(f).toEqual(F);
    expect(r).toEqual(R);
  });

  it('POST9: regenSplit with regenMaxW 0 sends all torque to friction', () => {
    const noRegen: MotorSpec = { ...R, regenMaxW: 0 };
    const a = regenSplit(3000, 50, noRegen, false);
    expect(a.regenNm).toBe(0);
    expect(a.frictionNm).toBe(3000);
  });

  it('POST10: regen is fully used when the power limit equals the request', () => {
    const omega = R.regenMaxW / 3000;
    const a = regenSplit(3000, omega, R, false);
    relClose(a.regenNm, 3000);
    expect(a.frictionNm).toBeCloseTo(0, 6);
  });

  it('POST11: regenNm + frictionNm equals the request exactly across cases', () => {
    const cases: Array<[number, number, boolean]> = [
      [3000, 50, false],
      [3000, 200, false],
      [3000, 2, false],
      [3000, 50, true],
      [1, 1e6, false],
      [1234.5, 77.7, false],
    ];
    for (const [brake, omega, full] of cases) {
      const a = regenSplit(brake, omega, R, full);
      expect(a.regenNm + a.frictionNm).toBeCloseTo(brake, 9);
    }
  });

  it('POST12: regenSplit does not mutate the MotorSpec', () => {
    const spec: MotorSpec = { ...R };
    regenSplit(3000, 200, spec, false);
    expect(spec).toEqual(R);
  });

  it('POST13: Battery defaults to a full charge and keeps capacityJ', () => {
    const b = new Battery(184.5e6);
    expect(b.capacityJ).toBe(184.5e6);
    expect(b.socJ).toBe(184.5e6);
    expect(b.frac).toBe(1);
    expect(b.full).toBe(true);
    expect(b.empty).toBe(false);
  });

  it('POST14: startJ is clamped into [0, capacityJ] in the constructor', () => {
    const neg = new Battery(1e6, -5e5);
    expect(neg.socJ).toBe(0);
    expect(neg.empty).toBe(true);
    const over = new Battery(1e6, 2e6);
    expect(over.socJ).toBe(1e6);
    expect(over.full).toBe(true);
  });

  it('POST15: drain on an empty battery and charge on a full battery are no-ops', () => {
    const b = new Battery(1e6, 0);
    b.drain(1e5, 1, 0.95);
    expect(b.socJ).toBe(0);
    const c = new Battery(1e6);
    c.charge(1e5, 1, 0.95);
    expect(c.socJ).toBe(1e6);
  });

  it('POST16: a huge dt clamps drain to empty and charge to full', () => {
    const b = new Battery(1e6, 5e5);
    b.drain(1e6, 1e9, 1);
    expect(b.socJ).toBe(0);
    const c = new Battery(1e6, 5e5);
    c.charge(1e6, 1e9, 1);
    expect(c.socJ).toBe(1e6);
  });

  it('POST17: eff 1 moves exactly mechW·dt joules', () => {
    const b = new Battery(184.5e6);
    b.drain(100e3, 2, 1);
    expect(b.socJ).toBeCloseTo(184.5e6 - 200e3, 6);
    b.charge(50e3, 2, 1);
    expect(b.socJ).toBeCloseTo(184.5e6 - 100e3, 6);
  });
});
