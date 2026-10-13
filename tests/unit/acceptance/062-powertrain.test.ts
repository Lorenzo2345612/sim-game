import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { engineTorque, engineRpm, diffSplit } from '../../../src/physics/powertrain';
import { Gearbox, type GearboxMode } from '../../../src/physics/gearbox';

const ROOT = join(__dirname, '..', '..', '..');

// Task 062 target signature; the cast keeps this file typechecking before gearbox.ts has it.
type GearboxSpec = {
  gear: number;
  setMode(mode: GearboxMode): void;
  shiftUp(): void;
  update(speedMs: number, dt?: number): void;
  driveScale(speedMs: number): number;
};
const SpecGearbox = Gearbox as unknown as new (
  params?: CarSpec['gearbox'],
  wheelRadius?: number,
  engine?: Pick<CarSpec['engine'], 'idleRpm' | 'limiterRpm'>
) => GearboxSpec;

function f4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

describe('062 powertrain acceptance', () => {
  it('AT1: F4 torque curve interpolates linearly between points and clamps to the end values outside it', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, 1250, 1)).toBeCloseTo(137.5, 9);
    expect(engineTorque(engine, 4000, 1)).toBeCloseTo(252.5, 9);
    expect(engineTorque(engine, 500, 1)).toBeCloseTo(100, 9);
    expect(engineTorque({ ...engine, limiterRpm: 10000 }, 7500, 1)).toBeCloseTo(150, 9);
  });

  it('AT2: rpm at or above limiterRpm with throttle 1 gives 0 torque', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, engine.limiterRpm, 1)).toBeCloseTo(0, 9);
    expect(engineTorque(engine, engine.limiterRpm + 600, 1)).toBeCloseTo(0, 9);
  });

  it('AT3: throttle 0 at 5000 rpm gives minus brakingTorque', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, 5000, 0)).toBeCloseTo(-engine.brakingTorque, 9);
  });

  it('AT4: gear 1 at omega 0 gives launchRpm with throttle 1 and idleRpm with throttle 0', () => {
    const spec = f4();
    expect(engineRpm(spec, 1, 0, 1)).toBeCloseTo(4000, 9);
    expect(engineRpm(spec, 1, 0, 0)).toBeCloseTo(spec.engine.idleRpm, 9);
  });

  it('AT5: gear 3 at 50 rad/s gives 50·ratio3·final·60/(2π) within 1e-6', () => {
    const spec = f4();
    const expected = 50 * spec.gearbox.ratios[2] * spec.gearbox.final * (60 / (2 * Math.PI));
    const actual = engineRpm(spec, 3, 50, 1);
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1e-6);
  });

  it('AT6: open diff with tIn 400 and different wheel speeds splits 200/200', () => {
    const diff: CarSpec['diff'] = { type: 'open', preload: 0, lockPower: 0, lockCoast: 0 };
    const [tL, tR] = diffSplit(diff, 400, 5, 15, true);
    expect(tL).toBeCloseTo(200, 9);
    expect(tR).toBeCloseTo(200, 9);
  });

  it('AT7: lsd with preload 50 and lock 0.3 caps the split difference at 2·(50 + 0.3·400) and keeps sum 400', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const [tL, tR] = diffSplit(diff, 400, 0, 100, true);
    const cap = 2 * (50 + 0.3 * 400);
    expect(tL + tR).toBeCloseTo(400, 9);
    expect(Math.abs(tL - tR)).toBeCloseTo(cap, 9);
    expect(tL).toBeGreaterThan(tR);
  });

  it('AT8: F4 gearbox shift keeps driveScale 0 during the 0.15 s delay and restores 1 after', () => {
    const spec = f4();
    const gb = new SpecGearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    expect(gb.gear).toBe(1);
    gb.shiftUp();
    expect(gb.gear).toBe(2);
    gb.update(20, 0.1);
    expect(gb.driveScale(20)).toBe(0);
    gb.update(20, 0.1);
    expect(gb.driveScale(20)).toBe(1);
  });
});
