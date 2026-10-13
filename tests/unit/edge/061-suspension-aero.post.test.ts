import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { staticCompression, suspensionForce, antiRoll } from '../../../src/physics/suspension';
import { aeroForces, type AeroForces } from '../../../src/physics/aero';

const ROOT = join(__dirname, '..', '..', '..');

function f4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

function defaultSetup(spec: CarSpec): { frontWing: number; rearWing: number } {
  return {
    frontWing: spec.setup.frontWing.default,
    rearWing: spec.setup.rearWing.default,
  };
}

describe('061 post-implementation gap tests', () => {
  it('POST1: suspensionForce uses the given axle, not front constants', () => {
    const rear = f4().suspension.rear;
    expect(suspensionForce(rear, 0.02, 0)).toBeCloseTo(1160, 6);
    expect(suspensionForce(rear, 0.02, -0.1)).toBeCloseTo(1160 - rear.reboundDamping * 0.1, 6);
  });

  it('POST2: x exactly at travel adds no bump stop', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, axle.travel, 0)).toBeCloseTo(axle.springRate * axle.travel, 6);
  });

  it('POST3: beyond travel with bump velocity combines clamped spring, bump stop and bump damper', () => {
    const axle = f4().suspension.front;
    const expected =
      axle.springRate * axle.travel + axle.bumpStopRate * 0.01 + axle.bumpDamping * 0.5;
    expect(suspensionForce(axle, axle.travel + 0.01, 0.5)).toBeCloseTo(expected, 6);
  });

  it('POST4: beyond travel with strong rebound still clamps to zero', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, axle.travel + 0.01, -10)).toBeCloseTo(0, 9);
  });

  it('POST5: at zero compression the damper alone still produces force', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, 0, 0.1)).toBeCloseTo(axle.bumpDamping * 0.1, 6);
  });

  it('POST6: very large xDot scales the damper linearly and stays finite', () => {
    const axle = f4().suspension.front;
    const expected = axle.springRate * 0.05 + axle.bumpDamping * 1000;
    expect(suspensionForce(axle, 0.05, 1000)).toBeCloseTo(expected, 3);
    expect(Number.isFinite(suspensionForce(axle, 0.05, 1000))).toBe(true);
  });

  it('POST7: antiRoll with zero rate is zero regardless of compression difference', () => {
    expect(antiRoll(0, 0.03, 0.01)).toBeCloseTo(0, 12);
  });

  it('POST8: staticCompression follows plain division for zero and negative rates', () => {
    expect(staticCompression(2600, 0)).toBe(Infinity);
    expect(staticCompression(2600, -52000)).toBeCloseTo(-0.05, 12);
  });

  it('POST9: aero forces grow with v² — 100 m/s gives four times the 50 m/s forces', () => {
    const spec = f4();
    const setup = defaultSetup(spec);
    const slow = aeroForces(spec, 50, 0, setup);
    const fast = aeroForces(spec, 100, 0, setup);
    expect(fast.front).toBeCloseTo(4 * slow.front, 6);
    expect(fast.rear).toBeCloseTo(4 * slow.rear, 6);
    expect(fast.drag).toBeCloseTo(4 * slow.drag, 6);
    expect(fast.front).toBeCloseTo(0.5 * 1.225 * 10000 * spec.aero.claFront, 6);
  });

  it('POST10: speed zero stays zero with non-default setup and non-zero rideDrop', () => {
    const spec = f4();
    const out = aeroForces(spec, 0, 0.05, {
      frontWing: spec.setup.frontWing.default + 2,
      rearWing: spec.setup.rearWing.default + 3,
    });
    expect(out.front).toBeCloseTo(0, 9);
    expect(out.rear).toBeCloseTo(0, 9);
    expect(out.drag).toBeCloseTo(0, 9);
  });

  it('POST11: out overwrites junk in all three fields', () => {
    const spec = f4();
    const out: AeroForces = { front: -7, rear: 999, drag: 12.5 };
    const res = aeroForces(spec, 50, 0, defaultSetup(spec), out);
    expect(res).toBe(out);
    expect(res.front).toBeCloseTo(1225, 6);
    expect(res.rear).toBeCloseTo(1837.5, 6);
    expect(res.drag).toBeCloseTo(1225, 6);
  });

  it('POST12: ClA floor applies after both ride-height and wing terms', () => {
    const spec = f4();
    const q = 0.5 * 1.225 * 2500;
    const wingsUp = {
      frontWing: spec.setup.frontWing.default + 5,
      rearWing: spec.setup.rearWing.default + 5,
    };
    const floored = aeroForces(spec, 50, -1, wingsUp);
    expect(floored.front).toBeCloseTo(0, 9);
    expect(floored.rear).toBeCloseTo(0, 9);
    expect(floored.drag).toBeCloseTo(q * (spec.aero.cda + 5 * spec.aero.wingStep.cda), 6);

    const ride = spec.aero.rideHeightSens * -0.4;
    const combined = aeroForces(spec, 50, -0.4, wingsUp);
    expect(combined.front).toBeCloseTo(q * (spec.aero.claFront + ride + 5 * spec.aero.wingStep.claFront), 6);
    expect(combined.rear).toBeCloseTo(q * (spec.aero.claRear + ride + 5 * spec.aero.wingStep.claRear), 6);
  });

  it('POST13: sources import neither three nor Rapier', () => {
    for (const file of ['suspension.ts', 'aero.ts']) {
      const src = readFileSync(join(ROOT, 'src', 'physics', file), 'utf8');
      expect(src).not.toMatch(/from ['"]three['"]/);
      expect(src).not.toMatch(/rapier/i);
    }
  });
});
