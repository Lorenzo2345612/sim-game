import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { suspensionForce, antiRoll } from '../../../src/physics/suspension';
import { aeroForces } from '../../../src/physics/aero';

const ROOT = join(__dirname, '..', '..', '..');

function f4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

describe('061 suspension, anti-roll and aero acceptance', () => {
  it('AT1: suspensionForce with k 52000, x 0.02, xDot 0 is 1040 N', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, 0.02, 0)).toBeCloseTo(1040, 6);
  });

  it('AT2: positive xDot uses bumpDamping and negative xDot uses reboundDamping', () => {
    const axle = f4().suspension.front;
    const x = 0.02;
    const spring = axle.springRate * x;
    expect(suspensionForce(axle, x, 0.1)).toBeCloseTo(spring + axle.bumpDamping * 0.1, 6);
    expect(suspensionForce(axle, x, -0.1)).toBeCloseTo(spring - axle.reboundDamping * 0.1, 6);
  });

  it('AT3: x = travel + 0.01 includes bumpStopRate·0.01 on top of the clamped spring', () => {
    const axle = f4().suspension.front;
    const expected = axle.springRate * axle.travel + axle.bumpStopRate * 0.01;
    expect(suspensionForce(axle, axle.travel + 0.01, 0)).toBeCloseTo(expected, 6);
  });

  it('AT4: strong rebound (x 0.001, xDot -1) clamps to 0 (never pulls)', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, 0.001, -1)).toBeCloseTo(0, 9);
  });

  it('AT5: antiRoll with arb 18000, xLeft 0.03, xRight 0.01 gives +360 left and -360 right', () => {
    const left = antiRoll(18000, 0.03, 0.01);
    const right = -left;
    expect(left).toBeCloseTo(360, 9);
    expect(right).toBeCloseTo(-360, 9);
  });

  it('AT6: F4 at 50 m/s, rideDrop 0, default setup gives front 1225 N, rear 1837.5 N, drag 1225 N', () => {
    const spec = f4();
    const out = aeroForces(spec, 50, 0, {
      frontWing: spec.setup.frontWing.default,
      rearWing: spec.setup.rearWing.default,
    });
    expect(Math.abs(out.front - 1225)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(out.rear - 1837.5)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(out.drag - 1225)).toBeLessThanOrEqual(1e-6);
  });

  it('AT7: rearWing default + 2 steps adds 2·0.09 to claRear and 2·0.015 to cda', () => {
    const spec = f4();
    const out = aeroForces(spec, 50, 0, {
      frontWing: spec.setup.frontWing.default,
      rearWing: spec.setup.rearWing.default + 2,
    });
    const q = 0.5 * 1.225 * 2500;
    const claRear = spec.aero.claRear + 2 * spec.aero.wingStep.claRear;
    const cda = spec.aero.cda + 2 * spec.aero.wingStep.cda;
    expect(out.rear).toBeCloseTo(q * claRear, 6);
    expect(out.drag).toBeCloseTo(q * cda, 6);
  });

  it('AT8: speed 0 yields zero front, rear and drag forces', () => {
    const out = aeroForces(f4(), 0, 0);
    expect(out.front).toBeCloseTo(0, 9);
    expect(out.rear).toBeCloseTo(0, 9);
    expect(out.drag).toBeCloseTo(0, 9);
  });
});
