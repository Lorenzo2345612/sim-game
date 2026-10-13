import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { staticCompression, suspensionForce, antiRoll } from '../../../src/physics/suspension';
import { AIR_DENSITY, aeroForces, type AeroForces } from '../../../src/physics/aero';

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

describe('061 suspension and aero edge cases', () => {
  it('EDGE1: staticCompression is fzStatic / springRate', () => {
    expect(staticCompression(2600, 52000)).toBeCloseTo(0.05, 12);
    expect(staticCompression(0, 52000)).toBeCloseTo(0, 12);
  });

  it('EDGE2: compression below 0 clamps the spring and the result never goes negative', () => {
    const axle = f4().suspension.front;
    expect(suspensionForce(axle, -0.05, 0)).toBeCloseTo(0, 12);
    expect(suspensionForce(axle, -0.1, -1)).toBeCloseTo(0, 12);
  });

  it('EDGE3: antiRoll is signed by xLeft - xRight and zero when both sides match', () => {
    expect(antiRoll(18000, 0.01, 0.03)).toBeCloseTo(-360, 9);
    expect(antiRoll(18000, 0.02, 0.02)).toBeCloseTo(0, 12);
  });

  it('EDGE4: negative speed uses the absolute value', () => {
    const spec = f4();
    const setup = defaultSetup(spec);
    const fwd = aeroForces(spec, 50, 0, setup);
    const rev = aeroForces(spec, -50, 0, setup);
    expect(rev.front).toBeCloseTo(fwd.front, 9);
    expect(rev.rear).toBeCloseTo(fwd.rear, 9);
    expect(rev.drag).toBeCloseTo(fwd.drag, 9);
    expect(rev.front).toBeCloseTo(1225, 6);
  });

  it('EDGE5: positive rideDrop raises front and rear downforce, drag unchanged', () => {
    const spec = f4();
    const q = 0.5 * 1.225 * 2500;
    const out = aeroForces(spec, 50, 0.05, defaultSetup(spec));
    const drop = spec.aero.rideHeightSens * 0.05;
    expect(out.front).toBeCloseTo(q * (spec.aero.claFront + drop), 6);
    expect(out.rear).toBeCloseTo(q * (spec.aero.claRear + drop), 6);
    expect(out.drag).toBeCloseTo(q * spec.aero.cda, 6);
  });

  it('EDGE6: large negative rideDrop floors ClA prime at 0 while drag stays positive', () => {
    const spec = f4();
    const out = aeroForces(spec, 50, -1, defaultSetup(spec));
    expect(out.front).toBeCloseTo(0, 9);
    expect(out.rear).toBeCloseTo(0, 9);
    expect(out.drag).toBeCloseTo(0.5 * 1.225 * 2500 * spec.aero.cda, 6);
  });

  it('EDGE7: wing deltas stay isolated — front wing leaves rear and drag alone, rear wing leaves front alone', () => {
    const spec = f4();
    const q = 0.5 * 1.225 * 2500;
    const base = defaultSetup(spec);
    const frontUp = aeroForces(spec, 50, 0, {
      frontWing: base.frontWing + 3,
      rearWing: base.rearWing,
    });
    expect(frontUp.front).toBeCloseTo(q * (spec.aero.claFront + 3 * spec.aero.wingStep.claFront), 6);
    expect(frontUp.rear).toBeCloseTo(q * spec.aero.claRear, 6);
    expect(frontUp.drag).toBeCloseTo(q * spec.aero.cda, 6);
    const rearUp = aeroForces(spec, 50, 0, {
      frontWing: base.frontWing,
      rearWing: base.rearWing + 3,
    });
    expect(rearUp.front).toBeCloseTo(q * spec.aero.claFront, 6);
  });

  it('EDGE8: aeroForces without setup applies no wing delta at speed', () => {
    const spec = f4();
    const out = aeroForces(spec, 50, 0);
    expect(out.front).toBeCloseTo(1225, 6);
    expect(out.rear).toBeCloseTo(1837.5, 6);
    expect(out.drag).toBeCloseTo(1225, 6);
  });

  it('EDGE9: out is reused and returned, and spec and setup are not mutated', () => {
    const spec = f4();
    const aeroBefore = JSON.parse(JSON.stringify(spec.aero));
    const setup = { frontWing: spec.setup.frontWing.default + 2, rearWing: spec.setup.rearWing.default + 4 };
    const setupBefore = { ...setup };
    const out: AeroForces = { front: -1, rear: -1, drag: -1 };

    const first = aeroForces(spec, 50, 0, setup, out);
    expect(first).toBe(out);
    expect(first.front).toBeCloseTo(0.5 * 1.225 * 2500 * (spec.aero.claFront + 2 * spec.aero.wingStep.claFront), 6);
    const q = 0.5 * 1.225 * 900;
    const second = aeroForces(spec, 30, 0.02, setup, out);
    expect(second).toBe(out);
    expect(second.front).toBeCloseTo(
      q *
        (spec.aero.claFront +
          2 * spec.aero.wingStep.claFront +
          spec.aero.rideHeightSens * 0.02),
      6,
    );
    expect(spec.aero).toEqual(aeroBefore);
    expect(setup).toEqual(setupBefore);
  });

  it('EDGE10: AIR_DENSITY is 1.225 kg/m³', () => {
    expect(AIR_DENSITY).toBeCloseTo(1.225, 12);
  });
});
