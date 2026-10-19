import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Quat, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

// New fields of task 254, declared here so typecheck stays green pre-implementation.
interface Spec254 extends CarSpec {
  chassis: CarSpec['chassis'] & { weightFront: number };
  tyres: CarSpec['tyres'] & { rearMuScale: number };
  wheels: CarSpec['wheels'] & { widthRear: number };
}

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };

function readCar(id: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function parse(json: unknown): Spec254 {
  return parseCarSpec(json) as unknown as Spec254;
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
}

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
}

function step(vehicle: Vehicle, world: World, inp: DriverInput): void {
  vehicle.setInput(inp);
  vehicle.prePhysicsStep(FIXED_DT);
  world.step();
}

function run(vehicle: Vehicle, world: World, seconds: number, inp: DriverInput): void {
  const n = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < n; i++) step(vehicle, world, inp);
}

function forwardOf(q: Quat): { x: number; y: number; z: number } {
  return {
    x: -2 * (q.w * q.y + q.z * q.x),
    y: 2 * (q.x * q.w - q.y * q.z),
    z: -1 + 2 * (q.x * q.x + q.y * q.y),
  };
}

function yawOf(q: Quat): number {
  const f = forwardOf(q);
  return Math.atan2(f.x, -f.z);
}

function pitchOf(q: Quat): number {
  const f = forwardOf(q);
  return Math.atan2(f.y, Math.hypot(f.x, f.z));
}

function maxAngleAt(spec: Spec254, speed: number): number {
  const st = spec.steering;
  return st.maxAngleLow + (st.maxAngleHigh - st.maxAngleLow) * Math.min(1, speed / st.fullSpeed);
}

// Road-wheel angle `rad` (positive = left): input.steer = -rad / maxAngle.
function steerInput(spec: Spec254, speed: number, rad: number): number {
  const a = maxAngleAt(spec, speed);
  return a > 0 ? Math.max(-1, Math.min(1, -rad / a)) : 0;
}

function snapshot(vehicle: Vehicle): number[] {
  const p = vehicle.body.translation();
  const lv = vehicle.body.linvel();
  return [p.x, p.y, p.z, lv.x, lv.y, lv.z, yawOf(vehicle.getState().rotation)];
}

function expectSameState(a: number[], b: number[]): void {
  for (let k = 0; k < a.length; k++) {
    expect(Math.abs(a[k] - b[k]), `state[${k}]`).toBeLessThanOrEqual(1e-9);
  }
}

const worlds: World[] = [];

function build(spec: Spec254): { world: World; vehicle: Vehicle } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const vehicle = new Vehicle(world, spec, spawn(spec.chassis.cgHeight));
  return { world, vehicle };
}

describe('254 weight distribution and rear grip edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('EDGE1: explicit default fields on ow26 run bit-identical to leaving them out', () => {
    const json = readCar('ow26') as Record<string, unknown>;
    const bareJson = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
    delete (bareJson.chassis as Record<string, unknown>).weightFront;
    delete (bareJson.tyres as Record<string, unknown>).rearMuScale;
    delete (bareJson.wheels as Record<string, unknown>).widthRear;
    const bare = parse(bareJson);
    const explicit = parse({
      ...json,
      chassis: { ...(json.chassis as Record<string, unknown>), weightFront: 0.5 },
      tyres: { ...(json.tyres as Record<string, unknown>), rearMuScale: 1 },
      wheels: {
        ...(json.wheels as Record<string, unknown>),
        widthRear: (json.wheels as Record<string, unknown>).width,
      },
    });
    const ends = [bare, explicit].map((spec) => {
      const { world, vehicle } = build(spec);
      const n = Math.round(3 / FIXED_DT);
      for (let i = 0; i < n; i++) {
        const lv = vehicle.body.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        const inp =
          i * FIXED_DT < 1.5
            ? FULL
            : { throttle: 1, brake: 0, steer: steerInput(spec, speed, 0.1), reset: false };
        step(vehicle, world, inp);
      }
      return snapshot(vehicle);
    });
    expectSameState(ends[0], ends[1]);
  }, 30000);

  it('EDGE2: widthRear is stored on the spec and never changes physics', () => {
    const json = readCar('ow26') as Record<string, unknown>;
    const narrow = parse({
      ...json,
      wheels: { ...(json.wheels as Record<string, unknown>), widthRear: 0.2 },
    });
    const wide = parse({
      ...json,
      wheels: { ...(json.wheels as Record<string, unknown>), widthRear: 1.5 },
    });
    expect(narrow.wheels.widthRear).toBeCloseTo(0.2, 10);
    expect(wide.wheels.widthRear).toBeCloseTo(1.5, 10);
    const ends = [narrow, wide].map((spec) => {
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, FULL);
      return snapshot(vehicle);
    });
    expectSameState(ends[0], ends[1]);
  }, 30000);

  it('EDGE3: weightFront 0.3 and 0.7 and rearMuScale 0.8 and 1.3 parse (bounds inclusive)', () => {
    const base = readCar('f4') as Record<string, unknown>;
    for (const wf of [0.3, 0.7]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
      });
      expect(spec.chassis.weightFront).toBeCloseTo(wf, 10);
    }
    for (const ms of [0.8, 1.3]) {
      const spec = parse({
        ...base,
        tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: ms },
      });
      expect(spec.tyres.rearMuScale).toBeCloseTo(ms, 10);
    }
  });

  it('EDGE4: NaN, non-numeric and out-of-range new fields are rejected with a field-path error', () => {
    const base = readCar('f4') as Record<string, unknown>;
    for (const bad of [Number.NaN, '0.5', 0.29, 0.71]) {
      const json = {
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: bad },
      };
      expect(() => parseCarSpec(json), `weightFront ${String(bad)}`).toThrow(
        /Invalid car spec: chassis\.weightFront/,
      );
    }
    for (const bad of [Number.NaN, '1', 0.79, 1.31]) {
      const json = {
        ...base,
        tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: bad },
      };
      expect(() => parseCarSpec(json), `rearMuScale ${String(bad)}`).toThrow(
        /Invalid car spec: tyres\.rearMuScale/,
      );
    }
  });

  it('EDGE5: parseCarSpec does not mutate its input', () => {
    for (const id of ['f4', 'ow26']) {
      const frozen = deepFreeze(JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8')));
      expect(() => parseCarSpec(frozen), id).not.toThrow();
    }
  });

  it('EDGE6: at rest the front axle carries weightFront of the total normal load', () => {
    const base = readCar('f4') as Record<string, unknown>;
    for (const wf of [0.3, 0.65]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
      });
      const { world, vehicle } = build(spec);
      run(vehicle, world, 3, IDLE);
      const wheels = vehicle.getTelemetry().wheels;
      const front = wheels[0].fz + wheels[1].fz;
      const total = wheels.reduce((a, w) => a + w.fz, 0);
      expect(total, `total load weightFront=${wf}`).toBeGreaterThan(0);
      expect(Math.abs(front / total - wf), `front share weightFront=${wf}`).toBeLessThanOrEqual(0.01);
    }
  }, 30000);

  it('EDGE7: the car settles level for any weightFront (static corner loads use the CoM)', () => {
    const base = readCar('ow26') as Record<string, unknown>;
    for (const wf of [0.3, 0.7]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
      });
      const { world, vehicle } = build(spec);
      run(vehicle, world, 3, IDLE);
      const pitch = pitchOf(vehicle.getState().rotation);
      expect(Math.abs(pitch), `pitch weightFront=${wf}`).toBeLessThan(0.003);
    }
  }, 30000);

  it('EDGE8: ow26.json carries weightFront 0.455, rearMuScale 1.00–1.10, width 0.275, widthRear 0.375', () => {
    const spec = parse(readCar('ow26'));
    expect(spec.chassis.weightFront).toBeCloseTo(0.455, 10);
    expect(spec.tyres.rearMuScale).toBeGreaterThanOrEqual(1.0);
    expect(spec.tyres.rearMuScale).toBeLessThanOrEqual(1.1);
    expect(spec.wheels.width).toBeCloseTo(0.275, 10);
    expect(spec.wheels.widthRear).toBeCloseTo(0.375, 10);
  });

  it('EDGE10: body mass stays massKg + fuel mass when the new fields are set', () => {
    const base = readCar('ow26') as Record<string, unknown>;
    for (const wf of [0.3, 0.5, 0.7]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
      });
      const { vehicle } = build(spec);
      const expected = spec.chassis.massKg + spec.fuel.startL * spec.fuel.densityKgL;
      expect(vehicle.body.mass(), `mass weightFront=${wf}`).toBeCloseTo(expected, 3);
    }
  });
});
