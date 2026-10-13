import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { engineTorque, engineRpm, diffSplit } from '../../../src/physics/powertrain';

const ROOT = join(__dirname, '..', '..', '..');
const RPM_PER_RPS = 60 / (2 * Math.PI);

function f4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

describe('powertrain', () => {
  it('interpolates the torque curve and clamps throttle to 0..1', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, 1750, 1)).toBeCloseTo(205, 9);
    expect(engineTorque(engine, 2000, 0.5)).toBeCloseTo(117.5, 9);
    expect(engineTorque(engine, 2000, 2)).toBeCloseTo(235, 9);
  });

  it('cuts at the limiter with throttle and returns engine braking at throttle 0', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, engine.limiterRpm, 1)).toBe(0);
    expect(engineTorque(engine, 3000, 0)).toBe(-engine.brakingTorque);
    expect(engineTorque(engine, 3000, Number.NaN)).toBe(-engine.brakingTorque);
  });

  it('engineRpm floors at idle and applies the gear-1 launch rule', () => {
    const spec = f4();
    expect(engineRpm(spec, 1, 0, 1)).toBeCloseTo(4000, 9);
    expect(engineRpm(spec, 1, 0, 0)).toBeCloseTo(spec.engine.idleRpm, 9);
    expect(engineRpm(spec, 4, 0, 1)).toBeCloseTo(spec.engine.idleRpm, 9);
    const raw = 60 * spec.gearbox.ratios[3] * spec.gearbox.final * RPM_PER_RPS;
    expect(engineRpm(spec, 4, 60, 1)).toBeCloseTo(raw, 6);
  });

  it('diffSplit open halves, lsd couples within the cap, sum preserved', () => {
    const open: CarSpec['diff'] = { type: 'open', preload: 10, lockPower: 0.5, lockCoast: 0.5 };
    expect(diffSplit(open, 300, 0, 40, true)).toEqual([150, 150]);

    const lsd: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const [tL, tR] = diffSplit(lsd, 400, 10, 20, true);
    expect(tL + tR).toBeCloseTo(400, 9);
    expect(tL - tR).toBeCloseTo(2 * (50 + 0.3 * 400), 9);
    expect(tL).toBeGreaterThan(tR);

    const [cL, cR] = diffSplit(lsd, 400, 10, 20, false);
    expect(cL - cR).toBeCloseTo(2 * (50 + 0.2 * 400), 9);
    expect(cL + cR).toBeCloseTo(400, 9);
  });
});
