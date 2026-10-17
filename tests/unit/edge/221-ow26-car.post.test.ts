import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { parseCarSpec, type CarSpec, type TyreCompound } from '../../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput } from '../../../src/core/types';
import { CAR_IDS } from '../../../src/ui/menu';

const ROOT = join(__dirname, '..', '..', '..');
const PRESET_KEYS = ['stable', 'balanced', 'aggressive'] as const;
const EQ_COMPOUND_FIELDS = [
  'Fz0',
  'loadSens',
  'Bx',
  'Cx',
  'Ex',
  'By',
  'Cy',
  'Ey',
  'tempWindowC',
  'heatCoef',
  'coolCoef',
  'wearGripLoss',
  'cliffWear',
] as const;

function rawJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', file), 'utf8')) as Record<string, unknown>;
}

function load(file: string): CarSpec {
  return parseCarSpec(rawJson(file));
}

function collectNumbers(node: unknown, out: number[]): void {
  if (typeof node === 'number') {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectNumbers(child, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const child of Object.values(node)) collectNumbers(child, out);
  }
}

function compounds(spec: CarSpec): Record<'soft' | 'medium' | 'hard', TyreCompound> {
  const { soft, medium, hard } = spec.tyres.compounds;
  return { soft, medium, hard };
}

describe('221 OW-26 car post-code gaps', () => {
  it('POST1: shipped aids are disabled, as the regulations require', () => {
    const { aids } = load('ow26.json');
    expect(aids.tc.enabled).toBe(false);
    expect(aids.abs.enabled).toBe(false);
    expect(aids.tc.slip).toBeGreaterThan(0);
    expect(aids.tc.slip).toBeLessThan(1);
    expect(aids.abs.slip).toBeGreaterThan(0);
    expect(aids.abs.slip).toBeLessThan(1);
  });

  it('POST2: the car is rear-wheel drive', () => {
    expect(load('ow26.json').drive).toBe('rwd');
  });

  it('POST3: gearbox has 8 strictly decreasing ratios and the specified idle/shift rpm', () => {
    const { engine, gearbox } = load('ow26.json');
    expect(gearbox.ratios).toHaveLength(8);
    for (let i = 1; i < gearbox.ratios.length; i++) {
      expect(gearbox.ratios[i], `ratio[${i}]`).toBeLessThan(gearbox.ratios[i - 1]);
    }
    expect(gearbox.ratios[0] * gearbox.final).toBeGreaterThan(1);
    expect(gearbox.reverse).toBeGreaterThan(0);
    expect(engine.idleRpm).toBe(4000);
    expect(gearbox.upRpm).toBe(14200);
    expect(gearbox.downRpm).toBe(9500);
    expect(gearbox.downRpm).toBeLessThan(gearbox.upRpm);
    expect(gearbox.upRpm).toBeLessThan(engine.limiterRpm);
  });

  it('POST4: ICE torque peaks near 330 N·m at 11500 rpm and makes about 400 kW', () => {
    const curve = load('ow26.json').engine.torqueCurve;
    expect(curve.length).toBeGreaterThanOrEqual(4);
    let peakTorque = 0;
    let peakTorqueRpm = 0;
    let peakPowerW = 0;
    for (let i = 0; i < curve.length; i++) {
      const [rpm, torque] = curve[i];
      expect(rpm, `curve[${i}] rpm`).toBeGreaterThan(0);
      expect(torque, `curve[${i}] torque`).toBeGreaterThan(0);
      if (i > 0) expect(rpm, `curve[${i}] rpm ascending`).toBeGreaterThan(curve[i - 1][0]);
      if (torque > peakTorque) {
        peakTorque = torque;
        peakTorqueRpm = rpm;
      }
      peakPowerW = Math.max(peakPowerW, (torque * rpm * 2 * Math.PI) / 60);
    }
    expect(peakTorque).toBeGreaterThanOrEqual(300);
    expect(peakTorque).toBeLessThanOrEqual(360);
    expect(peakTorqueRpm).toBeGreaterThanOrEqual(10500);
    expect(peakTorqueRpm).toBeLessThanOrEqual(12500);
    expect(peakPowerW / 1000).toBeGreaterThanOrEqual(350);
    expect(peakPowerW / 1000).toBeLessThanOrEqual(450);
  });

  it('POST5: chassis and wheel geometry match the OW-26 layout', () => {
    const spec = load('ow26.json');
    expect(spec.chassis.massKg).toBe(768);
    expect(spec.chassis.cgHeight).toBeCloseTo(0.28, 6);
    expect(spec.wheels.radius).toBeCloseTo(0.357711, 3);
    expect(spec.wheels.positions).toHaveLength(4);
    const [fl, fr, rl, rr] = spec.wheels.positions;
    for (const p of [fl, fr, rl, rr]) expect(p[1]).toBe(0);
    expect(fl[0]).toBeCloseTo(-fr[0], 6);
    expect(rl[0]).toBeCloseTo(-rr[0], 6);
    expect(fl[2]).toBeCloseTo(fr[2], 6);
    expect(rl[2]).toBeCloseTo(rr[2], 6);
    const wheelbase = rl[2] - fl[2];
    expect(wheelbase).toBeCloseTo(3.4, 1);
    expect(fr[0] - fl[0]).toBeGreaterThanOrEqual(1.55);
    expect(fr[0] - fl[0]).toBeLessThanOrEqual(1.65);
    expect(spec.chassis.halfExtents.z * 2).toBeGreaterThan(wheelbase);
  });

  it('POST6: fuel load is 60 L of a 100 L tank at bsfc 175', () => {
    const { fuel } = load('ow26.json');
    expect(fuel.capacityL).toBe(100);
    expect(fuel.startL).toBe(60);
    expect(fuel.bsfc).toBe(175);
    expect(fuel.startL).toBeLessThan(fuel.capacityL);
    expect(fuel.densityKgL).toBeGreaterThan(0);
  });

  it('POST7: carbon brakes are stronger than the F4 set and the bias is a fraction', () => {
    const ow = load('ow26.json');
    const f4 = load('f4.json');
    expect(ow.brakes.maxTorque).toBeGreaterThanOrEqual(6000);
    expect(ow.brakes.maxTorque).toBeGreaterThan(f4.brakes.maxTorque);
    expect(ow.brakes.bias).toBeGreaterThan(0);
    expect(ow.brakes.bias).toBeLessThan(1);
  });

  it('POST8: soft/hard compounds follow the medium pattern of the other cars', () => {
    const { soft, medium, hard } = compounds(load('ow26.json'));
    for (const f of EQ_COMPOUND_FIELDS) {
      expect(soft[f], `soft ${f}`).toBeCloseTo(medium[f], 12);
      expect(hard[f], `hard ${f}`).toBeCloseTo(medium[f], 12);
    }
    expect(soft.optTempC).toBeCloseTo(85, 6);
    expect(hard.optTempC).toBeCloseTo(95, 6);
    expect(soft.wearRate).toBeCloseTo(medium.wearRate * 2, 15);
    expect(hard.wearRate).toBeCloseTo(medium.wearRate * 0.46, 15);
    expect(soft.mu0 / medium.mu0).toBeGreaterThanOrEqual(1.055);
    expect(soft.mu0 / medium.mu0).toBeLessThanOrEqual(1.065);
    expect(hard.mu0 / medium.mu0).toBeGreaterThanOrEqual(0.945);
    expect(hard.mu0 / medium.mu0).toBeLessThanOrEqual(0.955);
    expect(soft.mu0).toBeGreaterThan(medium.mu0);
    expect(medium.mu0).toBeGreaterThan(hard.mu0);
  });

  it('POST9: unspecified blocks still carry the F4 values', () => {
    const owRaw = rawJson('ow26.json');
    const f4Raw = rawJson('f4.json');
    const ow = load('ow26.json');
    const f4 = load('f4.json');
    expect(ow.steering).toEqual(f4.steering);
    expect(ow.cockpit.eye).toEqual(f4.cockpit.eye);
    expect(ow.cockpit.wheelRadius).toBe(f4.cockpit.wheelRadius);
    expect(ow.cockpit.lockDeg).toBe(f4.cockpit.lockDeg);
    expect(ow.diff).toEqual(f4.diff);
    expect(ow.tyres.optPressureKpa).toBe(f4.tyres.optPressureKpa);
    expect(ow.tyres.pressureKpa).toBe(f4.tyres.pressureKpa);
    for (const axle of ['front', 'rear'] as const) {
      expect(ow.suspension[axle].restLength, axle).toBe(f4.suspension[axle].restLength);
      expect(ow.suspension[axle].travel, axle).toBe(f4.suspension[axle].travel);
      expect(ow.suspension[axle].bumpStopRate, axle).toBe(f4.suspension[axle].bumpStopRate);
    }
    const owSetup = (owRaw.setup ?? {}) as Record<string, unknown>;
    const f4Setup = (f4Raw.setup ?? {}) as Record<string, unknown>;
    expect(Object.keys(owSetup).sort()).toEqual(Object.keys(f4Setup).sort());
    for (const key of Object.keys(f4Setup)) {
      expect(Object.keys((owSetup[key] ?? {}) as object).sort(), key).toEqual(
        Object.keys((f4Setup[key] ?? {}) as object).sort(),
      );
    }
    const owPresets = (owRaw.presets ?? {}) as Record<string, unknown>;
    const f4Presets = (f4Raw.presets ?? {}) as Record<string, unknown>;
    expect(Object.keys(owPresets).sort()).toEqual(Object.keys(f4Presets).sort());
    for (const name of PRESET_KEYS) {
      expect(Object.keys((owPresets[name] ?? {}) as object).sort(), name).toEqual(
        Object.keys((f4Presets[name] ?? {}) as object).sort(),
      );
    }
  });

  it('POST10: every tuned numeric value stays finite and physically plausible', () => {
    const raw = rawJson('ow26.json');
    const numbers: number[] = [];
    collectNumbers(raw, numbers);
    expect(numbers.length).toBeGreaterThan(50);
    for (const v of numbers) expect(Number.isFinite(v)).toBe(true);

    const spec = load('ow26.json');
    for (const name of ['soft', 'medium', 'hard'] as const) {
      const c = spec.tyres.compounds[name];
      expect(c.mu0, `mu0 ${name}`).toBeGreaterThanOrEqual(1.2);
      expect(c.mu0, `mu0 ${name}`).toBeLessThanOrEqual(2.6);
      expect(c.Fz0, `Fz0 ${name}`).toBeGreaterThan(0);
      expect(c.loadSens, `loadSens ${name}`).toBeGreaterThanOrEqual(0);
      expect(c.loadSens, `loadSens ${name}`).toBeLessThanOrEqual(0.3);
      expect(c.wearRate, `wearRate ${name}`).toBeGreaterThan(0);
      expect(c.wearRate, `wearRate ${name}`).toBeLessThanOrEqual(1e-6);
      expect(c.tempWindowC, `tempWindowC ${name}`).toBeGreaterThan(0);
      expect(c.heatCoef, `heatCoef ${name}`).toBeGreaterThan(0);
      expect(c.coolCoef, `coolCoef ${name}`).toBeGreaterThan(0);
    }
    for (const axle of [spec.suspension.front, spec.suspension.rear]) {
      expect(axle.springRate).toBeGreaterThan(0);
      expect(axle.bumpDamping).toBeGreaterThan(0);
      expect(axle.reboundDamping).toBeGreaterThan(0);
      expect(axle.travel).toBeGreaterThan(0);
    }
    expect(spec.aero.cda).toBeGreaterThan(0);
    expect(spec.aero.cda).toBeLessThanOrEqual(1.3);
    expect(spec.aero.claFront).toBeGreaterThan(0);
    expect(spec.aero.claRear).toBeGreaterThan(0);
    expect(spec.aero.claRear).toBeGreaterThanOrEqual(spec.aero.claFront);
    expect(spec.wheels.inertia).toBeGreaterThan(0);
    expect(spec.chassis.inertia.x).toBeGreaterThan(0);
    expect(spec.chassis.inertia.y).toBeGreaterThan(spec.chassis.inertia.x);
    expect(spec.chassis.inertia.z).toBeGreaterThan(0);
    expect(spec.chassis.inertia.z).toBeLessThan(spec.chassis.inertia.x);
  });

  it('POST11: CAR_IDS matches the cars index ids in order', () => {
    const entries = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'index.json'), 'utf8')) as {
      id: string;
    }[];
    expect([...CAR_IDS]).toEqual(entries.map((e) => e.id));
    expect(CAR_IDS[CAR_IDS.length - 1]).toBe('ow26');
  });

  it('POST12: chassis hull size matches the OW-26 body (1.972 x 1.174 x 5.268 m bbox halves)', () => {
    const he = load('ow26.json').chassis.halfExtents;
    expect(he.x).toBeGreaterThanOrEqual(0.93);
    expect(he.x).toBeLessThanOrEqual(1.03);
    expect(he.z).toBeGreaterThanOrEqual(2.58);
    expect(he.z).toBeLessThanOrEqual(2.68);
  });

  it('POST13: chassis hull half-height stays below the CG so the hull cannot dig into flat ground', () => {
    const { chassis } = load('ow26.json');
    expect(chassis.halfExtents.y).toBeGreaterThan(0);
    expect(chassis.halfExtents.y).toBeLessThan(chassis.cgHeight);
  });

  it('POST14: inertia tracks the solid box of the 0.98 x 0.55 x 2.63 m body at 768 kg', () => {
    const box = {
      x: (768 * (1.1 * 1.1 + 5.26 * 5.26)) / 12,
      y: (768 * (1.96 * 1.96 + 5.26 * 5.26)) / 12,
      z: (768 * (1.96 * 1.96 + 1.1 * 1.1)) / 12,
    };
    const inertia = load('ow26.json').chassis.inertia;
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(inertia[axis] / box[axis], axis).toBeGreaterThanOrEqual(0.85);
      expect(inertia[axis] / box[axis], axis).toBeLessThanOrEqual(1.15);
    }
  });

  it('POST15: the torque curve spans idle to the limiter and launchRpm sits between them', () => {
    const { engine } = load('ow26.json');
    const curve = engine.torqueCurve;
    expect(curve[0][0]).toBeLessThanOrEqual(engine.idleRpm);
    expect(curve[curve.length - 1][0]).toBeGreaterThanOrEqual(engine.limiterRpm);
    expect(engine.launchRpm).toBeGreaterThan(engine.idleRpm);
    expect(engine.launchRpm).toBeLessThan(engine.limiterRpm);
  });

  it('POST16: the balanced preset equals the setup defaults', () => {
    const spec = load('ow26.json');
    for (const key of Object.keys(spec.setup) as (keyof typeof spec.setup)[]) {
      expect(spec.presets.balanced[key], key).toBeCloseTo(spec.setup[key].default, 12);
    }
  });

  it('POST17: the 073 e2e car id list gains ow26 at the end', () => {
    const text = readFileSync(join(ROOT, 'tests', 'e2e', 'acceptance', '073-car-selection.spec.ts'), 'utf8');
    expect(text).toContain(
      "expect(values).toEqual(['f4', 'gt3-a', 'gt3-b', 'gt3-c', 'lmp2-a', 'hyper-a', 'ow26']);",
    );
  });
});

describe('221 OW-26 chassis hull on flat ground', () => {
  let world: ReturnType<typeof createPhysicsWorld> | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('POST18: the hull rides clear of the ground while the wheels drive the car', () => {
    const spec = load('ow26.json');
    world = createPhysicsWorld();
    const vehicle = new Vehicle(world, spec, {
      position: { x: 0, y: spec.chassis.cgHeight, z: 0 },
      yaw: 0,
    });
    const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
    const state = vehicle.getState();
    let minHullBottom = Number.POSITIVE_INFINITY;
    for (let i = 0; i < Math.round(10 / FIXED_DT); i++) {
      vehicle.setInput(FULL);
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      vehicle.getState(state);
      minHullBottom = Math.min(minHullBottom, state.position.y - spec.chassis.halfExtents.y);
    }
    expect(state.forwardSpeed).toBeGreaterThan(20);
    expect(minHullBottom).toBeGreaterThanOrEqual(0.1);
  }, 60000);
});

describe('221 e2e 073 car-picker expectations vs the cars index', () => {
  function jsArray(src: string | undefined): string[] {
    if (!src) return [];
    return JSON.parse(src.replace(/'/g, '"')) as string[];
  }

  it('POST19: the option count and the id/name lists in 073 match the cars index', () => {
    const text = readFileSync(
      join(ROOT, 'tests', 'e2e', 'acceptance', '073-car-selection.spec.ts'),
      'utf8',
    );
    const entries = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'index.json'), 'utf8')) as {
      id: string;
      name: string;
    }[];
    const count = Number(/toHaveCount\((\d+)\)/.exec(text)?.[1]);
    const values = jsArray(/expect\(values\)\.toEqual\((\[[^\]]*\])\)/.exec(text)?.[1]);
    const names = jsArray(/expect\(names\)\.toEqual\((\[[^\]]*\])\)/.exec(text)?.[1]);
    expect(count).toBe(entries.length);
    expect(values).toEqual(entries.map((e) => e.id));
    expect(names).toEqual(entries.map((e) => e.name));
  });
});
