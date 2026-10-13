import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { engineTorque, engineRpm, diffSplit } from '../../../src/physics/powertrain';
import { Gearbox, type GearboxMode } from '../../../src/physics/gearbox';
import { FIXED_DT } from '../../../src/core/constants';

const ROOT = join(__dirname, '..', '..', '..');
const RPM_PER_RPS = 60 / (2 * Math.PI);

// Task 062 target signature; the cast keeps this file typechecking before gearbox.ts has it.
type GearboxSpec = {
  gear: number;
  rpm(speedMs: number): number;
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

function rawRpm(spec: CarSpec, gear: number, omega: number): number {
  return Math.abs(omega) * spec.gearbox.ratios[gear - 1] * spec.gearbox.final * RPM_PER_RPS;
}

describe('062 powertrain edge cases', () => {
  it('EDGE1: engineTorque cuts only on throttle above 0 and gives minus brakingTorque on throttle 0 at any rpm', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, engine.limiterRpm, 0.01)).toBeCloseTo(0, 9);
    expect(engineTorque(engine, engine.limiterRpm + 500, 0.5)).toBeCloseTo(0, 9);
    expect(engineTorque(engine, engine.limiterRpm, 0)).toBeCloseTo(-engine.brakingTorque, 9);
    expect(engineTorque(engine, engine.limiterRpm + 500, 0)).toBeCloseTo(-engine.brakingTorque, 9);
    // Below idle the spec still gives minus brakingTorque (no rpm gate on the throttle-0 branch).
    expect(engineTorque(engine, 800, 0)).toBeCloseTo(-engine.brakingTorque, 9);
  });

  it('EDGE2: engineTorque scales the curve by throttle clamped to 0..1 and treats NaN as 0', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, 2000, 0.5)).toBeCloseTo(117.5, 9);
    expect(engineTorque(engine, 2000, 1.7)).toBeCloseTo(235, 9);
    expect(engineTorque(engine, 2000, -0.4)).toBeCloseTo(-engine.brakingTorque, 9);
    expect(engineTorque(engine, 5000, Number.NaN)).toBeCloseTo(-engine.brakingTorque, 9);
  });

  it('EDGE3: engineRpm gear 1 takes the max of raw rpm and the throttle-scaled launch floor', () => {
    const spec = f4();
    expect(engineRpm(spec, 1, 0, 0.5)).toBeCloseTo(2600, 6); // idle 1200 + 0.5·(launch 4000 − 1200)
    expect(engineRpm(spec, 1, 20, 1)).toBeCloseTo(4000, 6); // raw 1537 < launch floor
    expect(engineRpm(spec, 1, 20, 0)).toBeCloseTo(rawRpm(spec, 1, 20), 6); // raw above idle, launch off
  });

  it('EDGE4: engineRpm uses the absolute driven omega and floors at idleRpm above gear 1', () => {
    const spec = f4();
    expect(engineRpm(spec, 3, -50, 1)).toBeCloseTo(engineRpm(spec, 3, 50, 1), 6);
    expect(engineRpm(spec, 3, -50, 1)).toBeCloseTo(rawRpm(spec, 3, 50), 6);
    expect(engineRpm(spec, 2, 0, 1)).toBeCloseTo(spec.engine.idleRpm, 6);
    expect(engineRpm(spec, 6, 0.05, 1)).toBeCloseTo(spec.engine.idleRpm, 6);
  });

  it('EDGE5: engineRpm clamps an invalid gear index to 1..N', () => {
    const spec = f4();
    const n = spec.gearbox.ratios.length;
    expect(engineRpm(spec, 0, 50, 0)).toBeCloseTo(rawRpm(spec, 1, 50), 6);
    expect(engineRpm(spec, -3, 50, 0)).toBeCloseTo(rawRpm(spec, 1, 50), 6);
    expect(engineRpm(spec, n + 1, 50, 1)).toBeCloseTo(rawRpm(spec, n, 50), 6);
  });

  it('EDGE6: lsd split in the linear region transfers K·delta-omega with K = 30 N·m·s/rad', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 200, lockPower: 0, lockCoast: 0 };
    const [tL, tR] = diffSplit(diff, 400, 0, 2, true);
    expect(tL + tR).toBeCloseTo(400, 9);
    expect(tL).toBeCloseTo(260, 9); // 200 + 30·2; K = 50 would give 300
    expect(tR).toBeCloseTo(140, 9);
  });

  it('EDGE7: diffSplit locks with lockCoast off throttle, uses lock 1 for a locked diff and the absolute tIn in the cap', () => {
    const lsd: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const [cL, cR] = diffSplit(lsd, 400, 0, 100, false);
    expect(cL + cR).toBeCloseTo(400, 9);
    expect(cL - cR).toBeCloseTo(2 * (50 + 0.2 * 400), 9);
    expect(cL).toBeGreaterThan(cR);

    const [bL, bR] = diffSplit(lsd, -400, 0, 100, false);
    expect(bL + bR).toBeCloseTo(-400, 9);
    expect(bL - bR).toBeCloseTo(2 * (50 + 0.2 * 400), 9); // cap uses |tIn|

    const locked: CarSpec['diff'] = { type: 'locked', preload: 50, lockPower: 0.9, lockCoast: 0.9 };
    const [tL, tR] = diffSplit(locked, 400, 0, 100, true);
    expect(tL + tR).toBeCloseTo(400, 9);
    expect(tL - tR).toBeCloseTo(2 * (50 + 1 * 400), 9); // lock 1, lockPower ignored
  });

  it('EDGE8: Gearbox with F4 params auto-upshifts at the spec upRpm and serves the shift delay', () => {
    const spec = f4();
    const gb = new SpecGearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    // 24 m/s in gear 1 ≈ 6589 rpm: above F4 upRpm 6400, below limiter 6900 and below default 8500.
    expect(gb.rpm(24)).toBeCloseTo((24 / spec.wheels.radius) * spec.gearbox.ratios[0] * spec.gearbox.final * RPM_PER_RPS, 6);
    gb.update(24);
    expect(gb.gear).toBe(2);
    expect(gb.driveScale(24)).toBe(0);
  });

  it('EDGE9: Gearbox with F4 params reads idleRpm and limiterRpm from the engine', () => {
    const spec = f4();
    const gb = new SpecGearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    expect(gb.rpm(0)).toBeCloseTo(spec.engine.idleRpm, 6);
    expect(gb.driveScale(25)).toBe(1); // gear 1 ≈ 6864 rpm, below the 6900 limiter
    expect(gb.driveScale(26)).toBe(0); // gear 1 ≈ 7138 rpm, at or above the limiter
  });

  it('EDGE10: Gearbox.update without dt advances the shift timer by FIXED_DT each call', () => {
    const spec = f4();
    const gb = new SpecGearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    const steps = Math.round(spec.gearbox.shiftTime / FIXED_DT); // 18 ticks = 0.15 s
    for (let i = 0; i < steps - 1; i++) gb.update(20); // 17/120 s < shiftTime
    expect(gb.driveScale(20)).toBe(0);
    for (let i = 0; i < 2; i++) gb.update(20); // 19/120 s > shiftTime
    expect(gb.driveScale(20)).toBe(1);
  });
});
