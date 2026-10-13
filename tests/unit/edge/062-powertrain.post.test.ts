import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { engineTorque, engineRpm, diffSplit } from '../../../src/physics/powertrain';
import { Gearbox } from '../../../src/physics/gearbox';

const ROOT = join(__dirname, '..', '..', '..');
const RPM_PER_RPS = 60 / (2 * Math.PI);

function f4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe('062 powertrain post-code gaps', () => {
  it('engineTorque cuts at the limiter inclusively — one rpm below still gives curve torque', () => {
    const engine = f4().engine;
    expect(engineTorque(engine, engine.limiterRpm - 1, 1)).toBeCloseTo(156.464, 6);
  });

  it('engineRpm gear 1 returns the raw rpm when it already exceeds the launch floor', () => {
    const spec = f4();
    const raw = 60 * spec.gearbox.ratios[0] * spec.gearbox.final * RPM_PER_RPS;
    expect(raw).toBeGreaterThan(spec.engine.launchRpm);
    expect(engineRpm(spec, 1, 60, 1)).toBeCloseTo(raw, 6);
  });

  it('engineRpm clamps throttle to 0..1 on the launch floor and treats NaN as 0', () => {
    const spec = f4();
    expect(engineRpm(spec, 1, 0, 5)).toBeCloseTo(spec.engine.launchRpm, 6);
    expect(engineRpm(spec, 1, 0, -0.4)).toBeCloseTo(spec.engine.idleRpm, 6);
    expect(engineRpm(spec, 1, 0, Number.NaN)).toBeCloseTo(spec.engine.idleRpm, 6);
  });

  it('lsd with equal wheel speeds splits evenly despite preload and lock', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const [tL, tR] = diffSplit(diff, 400, 10, 10, true);
    expect(tL).toBeCloseTo(200, 9);
    expect(tR).toBeCloseTo(200, 9);
  });

  it('lsd coupling mirrors with the wheel speeds — the slower wheel gains torque', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const [tL, tR] = diffSplit(diff, 400, 100, 0, true);
    expect(tL + tR).toBeCloseTo(400, 9);
    expect(tL).toBeCloseTo(30, 9); // 200 − (50 + 0.3·400)
    expect(tR).toBeCloseTo(370, 9);
  });

  it('lsd with zero preload and zero lock transfers nothing at any speed difference', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 0, lockPower: 0, lockCoast: 0 };
    expect(diffSplit(diff, 400, 0, 50, true)).toEqual([200, 200]);
    expect(diffSplit(diff, 400, 0, 50, false)).toEqual([200, 200]);
  });

  it('lsd with zero input torque splits to minus and plus preload', () => {
    const diff: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.35, lockCoast: 0.2 };
    const [tL, tR] = diffSplit(diff, 0, 0, 100, true);
    expect(tL).toBeCloseTo(50, 9); // slower left wheel gains preload
    expect(tR).toBeCloseTo(-50, 9);
    expect(tL + tR).toBeCloseTo(0, 9);
  });

  it('powertrain.ts imports only types from ./carSpec (acceptance criterion)', () => {
    const src = readFileSync(join(ROOT, 'src', 'physics', 'powertrain.ts'), 'utf8');
    const stmts = [...src.matchAll(/\bimport\b[^;]*;/g)].map((m) => m[0]);
    expect(stmts.length).toBeGreaterThan(0);
    for (const stmt of stmts) {
      expect(stmt.startsWith('import type ')).toBe(true);
      expect(stmt).toContain("from './carSpec'");
    }
  });

  it('powertrain functions and the Gearbox never mutate their inputs', () => {
    const spec = deepFreeze(f4());
    engineTorque(spec.engine, 3000, 1);
    engineTorque(spec.engine, 3000, 0);
    engineRpm(spec, 1, 0, 1);
    engineRpm(spec, 6, 50, 0.5);
    diffSplit(spec.diff, 400, 0, 50, true);
    diffSplit(spec.diff, 400, 50, 0, false);
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.shiftDown();
    gb.update(20, 0.1);
    gb.update(20, 0.1);
    expect(spec.gearbox.ratios).toEqual([2.3, 1.68, 1.33, 1.1, 0.93, 0.8]);
    expect(spec.gearbox.shiftTime).toBe(0.15);
  });

  it('a manual shiftDown serves the same shift delay as shiftUp', () => {
    const spec = f4();
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.shiftDown();
    expect(gb.gear).toBe(1);
    gb.update(20, 0.1);
    expect(gb.driveScale(20)).toBe(0);
    gb.update(20, 0.1);
    expect(gb.driveScale(20)).toBe(1);
  });

  it('a single update with a large dt ends the shift delay at once', () => {
    const spec = f4();
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.update(20, 1);
    expect(gb.driveScale(20)).toBe(1);
  });

  it('update with dt 0 never advances the shift timer', () => {
    const spec = f4();
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.update(20, 0);
    expect(gb.driveScale(20)).toBe(0);
    gb.update(20, 0);
    expect(gb.driveScale(20)).toBe(0);
    gb.update(20, spec.gearbox.shiftTime);
    expect(gb.driveScale(20)).toBe(1);
  });

  it('params with shiftTime 0 shift with no delay', () => {
    const spec = f4();
    const gb = new Gearbox({ ...spec.gearbox, shiftTime: 0 }, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.update(20);
    expect(gb.driveScale(20)).toBe(1);
  });

  it('auto mode holds the current gear while a shift is in progress, then shifts', () => {
    const params: CarSpec['gearbox'] = {
      ratios: [2, 2, 2],
      final: 3.4,
      reverse: -3,
      upRpm: 6000,
      downRpm: 4000,
      shiftTime: 0.15,
      efficiency: 1,
    };
    const gb = new Gearbox(params, 0.33, { idleRpm: 1200, limiterRpm: 9000 });
    expect(gb.rpm(32)).toBeGreaterThanOrEqual(6000); // equal ratios: still above upRpm in gear 2
    gb.update(32);
    expect(gb.gear).toBe(2);
    gb.update(32);
    expect(gb.gear).toBe(2);
    gb.update(32, 1);
    expect(gb.gear).toBe(3);
  });

  it('without the engine argument the gearbox falls back to the 045 idle and limiter', () => {
    const spec = f4();
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius);
    expect(gb.rpm(0)).toBeCloseTo(3000, 6); // F4 idle is 1200
    expect(gb.driveScale(26)).toBe(1); // gear 1 ≈ 7171 rpm: below the 9000 default, at/above the F4 6900
  });

  it('auto downshift uses the params downRpm instead of the 045 default', () => {
    const spec = f4();
    const gb = new Gearbox(spec.gearbox, spec.wheels.radius, spec.engine);
    gb.setMode('manual');
    gb.shiftUp();
    gb.setMode('auto');
    gb.update(20); // gear 2 ≈ 4011 rpm: above F4 downRpm 3200, below the 045 default 5000
    expect(gb.gear).toBe(2);
  });

  it('shiftUp clamps at the params ratios length, not at 6', () => {
    const params: CarSpec['gearbox'] = {
      ratios: [3, 2, 1.5],
      final: 3.5,
      reverse: -3,
      upRpm: 6400,
      downRpm: 3200,
      shiftTime: 0.1,
      efficiency: 1,
    };
    const gb = new Gearbox(params, 0.28, { idleRpm: 1200, limiterRpm: 6900 });
    gb.setMode('manual');
    for (let i = 0; i < 5; i++) gb.shiftUp();
    expect(gb.gear).toBe(3);
    gb.shiftDown();
    expect(gb.gear).toBe(2);
  });
});
