import { describe, expect, it } from 'vitest';
import { Battery, motorWheelTorque, regenSplit, splitPower } from '../../../src/physics/electric';
import type { MotorSpec } from '../../../src/physics/electric';

const R: MotorSpec = { maxPowerW: 350e3, maxTorqueNm: 557, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };
const F: MotorSpec = { maxPowerW: 250e3, maxTorqueNm: 400, maxRpm: 20000, ratio: 7.8, regenMaxW: 350e3 };

function relClose(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-3 * Math.abs(expected));
}

function absClose(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe('281 electric powertrain math acceptance', () => {
  it('AT1: rear motor gives 4344.6 Nm at standstill and at 3000 rpm motor speed', () => {
    relClose(motorWheelTorque(R, 0, 350e3, 1), 4344.6);
    relClose(motorWheelTorque(R, 40.2768, 350e3, 1), 4344.6);
  });

  it('AT2: rear motor is power-limited at 12000 rpm giving 2172.4 Nm', () => {
    relClose(motorWheelTorque(R, 161.107, 350e3, 1), 2172.4);
  });

  it('AT3: cap 262.5e3 at 12000 rpm gives 1629.3 Nm', () => {
    relClose(motorWheelTorque(R, 161.107, 262.5e3, 1), 1629.3);
  });

  it('AT4: torque is zero once motor speed reaches maxRpm', () => {
    relClose(motorWheelTorque(R, 270, 350e3, 1), 0);
  });

  it('AT5: throttle 0.5 halves wheel torque; negative throttle gives zero', () => {
    relClose(motorWheelTorque(R, 40.2768, 350e3, 0.5), 2172.3);
    relClose(motorWheelTorque(R, 40.2768, 350e3, -0.2), 0);
  });

  it('AT6: splitPower divides by maxPowerW share, clamped to each motor max', () => {
    const a = splitPower(450e3, F, R);
    expect(a[0]).toBeCloseTo(187500, 6);
    expect(a[1]).toBeCloseTo(262500, 6);
    const b = splitPower(600e3, F, R);
    expect(b[0]).toBeCloseTo(250000, 6);
    expect(b[1]).toBeCloseTo(350000, 6);
    const c = splitPower(700e3, F, R);
    expect(c[0]).toBeCloseTo(250000, 6);
    expect(c[1]).toBeCloseTo(350000, 6);
  });

  it('AT7: regen blends into friction by power limit, speed floor and battery-full', () => {
    const a = regenSplit(3000, 50, R, false);
    relClose(a.regenNm, 3000);
    relClose(a.frictionNm, 0);
    const b = regenSplit(3000, 200, R, false);
    relClose(b.regenNm, 1750);
    relClose(b.frictionNm, 1250);
    const c = regenSplit(3000, 2, R, false);
    relClose(c.regenNm, 0);
    relClose(c.frictionNm, 3000);
    const d = regenSplit(3000, 50, R, true);
    relClose(d.regenNm, 0);
    relClose(d.frictionNm, 3000);
  });

  it('AT8: drain removes mechW*dt/eff joules', () => {
    const b = new Battery(184.5e6);
    b.drain(100e3, 1, 0.95);
    absClose(b.socJ, 184.5e6 - 105263.158, 1e-3);
  });

  it('AT9: charge adds mechW*dt*eff joules', () => {
    const b = new Battery(184.5e6, 1e6);
    b.charge(100e3, 1, 0.95);
    relClose(b.socJ, 1.095e6);
  });

  it('AT10: socJ clamps to [0, capacity] with empty/full flags', () => {
    const b = new Battery(1e6, 100);
    b.drain(1e6, 1, 0.95);
    absClose(b.socJ, 0, 1e-3);
    expect(b.empty).toBe(true);
    b.charge(1e9, 1, 1);
    absClose(b.socJ, 1e6, 1e-3);
    expect(b.full).toBe(true);
  });
});
