import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec, DEFAULT_WEIGHT_FRONT } from '../../../src/physics/carSpec';
import { relaxAlpha, V_LOW } from '../../../src/physics/tyre';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Quat, SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

interface Spec254 extends CarSpec {
  chassis: CarSpec['chassis'] & { weightFront: number };
  tyres: CarSpec['tyres'] & { rearMuScale: number };
  wheels: CarSpec['wheels'] & { widthRear: number };
}

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readCar(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function parse(json: unknown): Spec254 {
  return parseCarSpec(json) as unknown as Spec254;
}

function spawn(y: number): SpawnPose {
  return { position: { x: 0, y, z: 0 }, yaw: 0 };
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

function yawOf(q: Quat): number {
  return Math.atan2(-2 * (q.w * q.y + q.z * q.x), -1 + 2 * (q.x * q.x + q.y * q.y));
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

describe('254 weight distribution and rear grip post-implementation gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('POST1: ow26 with the new fields omitted equals explicit default values', () => {
    const json = readCar('ow26');
    const bareJson = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
    delete (bareJson.chassis as Record<string, unknown>).weightFront;
    delete (bareJson.tyres as Record<string, unknown>).rearMuScale;
    delete (bareJson.wheels as Record<string, unknown>).widthRear;
    const bare = parse(bareJson);
    const explicit = parse({
      ...json,
      chassis: { ...(json.chassis as Record<string, unknown>), weightFront: DEFAULT_WEIGHT_FRONT },
      tyres: { ...(json.tyres as Record<string, unknown>), rearMuScale: 1 },
      wheels: { ...(json.wheels as Record<string, unknown>), widthRear: (json.wheels as Record<string, unknown>).width },
    });
    expect(bare.chassis.weightFront).toBeCloseTo(DEFAULT_WEIGHT_FRONT, 12);
    expect(bare.tyres.rearMuScale).toBeCloseTo(1, 12);
    expect(bare.wheels.widthRear).toBeCloseTo(bare.wheels.width, 12);
    expect(bare).toEqual(explicit);
    const ends = [bare, explicit].map((spec) => {
      const { world, vehicle } = build(spec);
      run(vehicle, world, 2, FULL);
      return snapshot(vehicle);
    });
    expectSameState(ends[0], ends[1]);
  }, 30000);

  it('POST2: local CoM z follows zFront + (1 - weightFront) * (zRear - zFront)', () => {
    const ow = parse(readCar('ow26'));
    const owZ = ow.wheels.positions;
    const zF = (owZ[0][2] + owZ[1][2]) / 2;
    const zR = (owZ[2][2] + owZ[3][2]) / 2;
    const { vehicle: vOw } = build(ow);
    expect(vOw.body.localCom().z).toBeCloseTo(zF + (1 - ow.chassis.weightFront) * (zR - zF), 6);

    const base = readCar('f4');
    const pos = (base.wheels as Record<string, unknown>).positions as [number, number, number][];
    const asym = [0, 1, 2, 3].map((i, k): [number, number, number] => [
      pos[i][0],
      pos[i][1],
      k < 2 ? -1.2 : 2.0,
    ]);
    for (const wf of [0.3, 0.455, 0.7]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
        wheels: { ...(base.wheels as Record<string, unknown>), positions: asym },
      });
      const { vehicle } = build(spec);
      expect(vehicle.body.localCom().z, `weightFront ${wf}`).toBeCloseTo(-1.2 + (1 - wf) * 3.2, 6);
    }
  }, 30000);

  it('POST3: weightFront exactly 0.5 keeps the CoM at the body origin even on an asymmetric wheelbase', () => {
    const base = readCar('f4');
    const pos = (base.wheels as Record<string, unknown>).positions as [number, number, number][];
    const asym = [0, 1, 2, 3].map((i, k): [number, number, number] => [
      pos[i][0],
      pos[i][1],
      k < 2 ? -1.2 : 2.0,
    ]);
    const spec = parse({
      ...base,
      chassis: { ...(base.chassis as Record<string, unknown>), weightFront: 0.5 },
      wheels: { ...(base.wheels as Record<string, unknown>), positions: asym },
    });
    const { vehicle } = build(spec);
    expect(vehicle.body.localCom().z).toBeCloseTo(0, 12);
  });

  it('POST4: weightFront does not change mass or principal inertia', () => {
    const base = readCar('ow26');
    const refs = [0.3, 0.5, 0.7].map((wf) => {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
      });
      const { vehicle } = build(spec);
      const I = vehicle.body.principalInertia();
      return { mass: vehicle.body.mass(), ix: I.x, iy: I.y, iz: I.z };
    });
    for (const r of refs.slice(1)) {
      expect(r.mass).toBeCloseTo(refs[0].mass, 6);
      expect(r.ix).toBeCloseTo(refs[0].ix, 4);
      expect(r.iy).toBeCloseTo(refs[0].iy, 4);
      expect(r.iz).toBeCloseTo(refs[0].iz, 4);
    }
    const spec = parse(base);
    expect(refs[0].mass).toBeCloseTo(
      spec.chassis.massKg + spec.fuel.startL * spec.fuel.densityKgL,
      3,
    );
  });

  it('POST5: zero, negative and non-numeric widthRear are rejected with a field-path error', () => {
    const base = readCar('f4');
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.35', null]) {
      const json = {
        ...base,
        wheels: { ...(base.wheels as Record<string, unknown>), widthRear: bad },
      };
      expect(() => parseCarSpec(json), `widthRear ${String(bad)}`).toThrow(
        /Invalid car spec: wheels\.widthRear/,
      );
    }
  });

  it('POST6: zero and negative weightFront / rearMuScale are rejected', () => {
    const base = readCar('f4');
    for (const bad of [0, -0.5]) {
      const json = {
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: bad },
      };
      expect(() => parseCarSpec(json), `weightFront ${String(bad)}`).toThrow(
        /Invalid car spec: chassis\.weightFront/,
      );
    }
    for (const bad of [0, -1]) {
      const json = {
        ...base,
        tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: bad },
      };
      expect(() => parseCarSpec(json), `rearMuScale ${String(bad)}`).toThrow(
        /Invalid car spec: tyres\.rearMuScale/,
      );
    }
    const ok = parse({
      ...base,
      wheels: {
        ...(base.wheels as Record<string, unknown>),
        widthRear: (base.wheels as Record<string, unknown>).width,
      },
    });
    expect(ok.wheels.widthRear).toBeCloseTo(ok.wheels.width, 12);
    expect(parse(base).wheels.widthRear).toBeCloseTo(
      (base.wheels as Record<string, unknown>).width as number,
      12,
    );
  });

  // Engine braking loads the driven axle even at brake bias 1, so remove it to isolate front grip.
  // Distance is taken in a speed band so wheel spin-up and entry-speed differences drop out.
  function brakeBandDistance(ms: number, bias: number): number {
    const base = readCar('ow26');
    const spec = parse({
      ...base,
      tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: ms },
      brakes: { ...(base.brakes as Record<string, unknown>), bias },
      engine: { ...(base.engine as Record<string, unknown>), brakingTorque: 0 },
    });
    const { world, vehicle } = build(spec);
    vehicle.setGearMode('manual');
    vehicle.body.setLinvel({ x: 0, y: 0, z: -30 }, true);
    run(vehicle, world, 1, IDLE);
    let z0: number | undefined;
    let z1: number | undefined;
    const n = Math.round(6 / FIXED_DT);
    for (let i = 0; i < n; i++) {
      step(vehicle, world, BRAKE);
      const lv = vehicle.body.linvel();
      const v = Math.hypot(lv.x, lv.z);
      const z = vehicle.body.translation().z;
      if (z0 === undefined && v <= 15) z0 = z;
      if (z0 !== undefined && v <= 5) {
        z1 = z;
        break;
      }
    }
    if (z0 === undefined || z1 === undefined) throw new Error('brake band not reached');
    return Math.abs(z1 - z0);
  }

  it('POST7: front-only braking in a speed band does not depend on rearMuScale', () => {
    const dLo = brakeBandDistance(1, 1);
    const dHi = brakeBandDistance(1.3, 1);
    expect(dLo).toBeGreaterThan(1);
    expect(Math.abs(dHi - dLo), `dLo=${dLo} dHi=${dHi}`).toBeLessThanOrEqual(0.005 * dLo);
  }, 60000);

  it('POST8: rear-only braking in a speed band shrinks when rearMuScale grows', () => {
    const dLo = brakeBandDistance(1, 0);
    const dHi = brakeBandDistance(1.3, 0);
    expect(dLo).toBeGreaterThan(1);
    expect(dHi, `dLo=${dLo} dHi=${dHi}`).toBeLessThan(0.9 * dLo);
  }, 60000);

  it('POST9: zero, negative and non-finite dt leave the state unchanged; large dt stays finite', () => {
    const spec = parse(readCar('ow26'));
    const { world, vehicle } = build(spec);
    run(vehicle, world, 0.5, FULL);
    const before = snapshot(vehicle);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      vehicle.setInput(FULL);
      vehicle.prePhysicsStep(dt);
    }
    expectSameState(before, snapshot(vehicle));
    vehicle.prePhysicsStep(0.5);
    world.step();
    const after = snapshot(vehicle);
    for (const v of after) expect(Number.isFinite(v), `finite ${v}`).toBe(true);
    expect(Math.abs(after[2] - before[2])).toBeGreaterThan(0);
  }, 30000);

  function launchSpeed(ms: number, compound?: string): number {
    const base = readCar('ow26');
    const spec = parse({
      ...base,
      tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: ms },
    });
    const { world, vehicle } = build(spec);
    if (compound) vehicle.setCompound(compound as 'soft');
    run(vehicle, world, 1, IDLE);
    run(vehicle, world, 0.8, FULL);
    const lv = vehicle.body.linvel();
    return Math.hypot(lv.x, lv.z);
  }

  it('POST11: rearMuScale raises driven-axle launch traction', () => {
    const vLo = launchSpeed(1);
    const vHi = launchSpeed(1.3);
    expect(vLo).toBeGreaterThan(5);
    expect(vHi, `vLo=${vLo} vHi=${vHi}`).toBeGreaterThan(1.02 * vLo);
  }, 60000);

  it('POST12: rearMuScale raises launch traction on every compound', () => {
    for (const c of ['soft', 'medium', 'hard']) {
      const vLo = launchSpeed(1, c);
      const vHi = launchSpeed(1.3, c);
      expect(vHi, `compound ${c} vLo=${vLo} vHi=${vHi}`).toBeGreaterThan(vLo);
    }
  }, 90000);

  it('POST13: null, boolean and object values for the new fields are rejected', () => {
    const base = readCar('f4');
    for (const bad of [null, true, {}, []]) {
      const badFront = {
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: bad },
      };
      expect(() => parseCarSpec(badFront), `weightFront ${String(bad)}`).toThrow(
        /Invalid car spec: chassis\.weightFront/,
      );
      const badRear = {
        ...base,
        tyres: { ...(base.tyres as Record<string, unknown>), rearMuScale: bad },
      };
      expect(() => parseCarSpec(badRear), `rearMuScale ${String(bad)}`).toThrow(
        /Invalid car spec: tyres\.rearMuScale/,
      );
    }
  });

  // One step from a known state: hub velocity is linvel + av × (hub − CoM).
  // With yaw rate about Y and comZ ≠ 0 the lateral component differs from the
  // body-origin arm by avY * comZ, so alpha separates the two kinematics.
  it('POST14: wheel slip kinematics measure r from the CoM, not the body origin', () => {
    const base = readCar('ow26');
    const spec = parse({
      ...base,
      chassis: { ...(base.chassis as Record<string, unknown>), weightFront: 0.455 },
    });
    const pos = spec.wheels.positions;
    const zF = (pos[0][2] + pos[1][2]) / 2;
    const zR = (pos[2][2] + pos[3][2]) / 2;
    const comZ = zF + (1 - spec.chassis.weightFront) * (zR - zF);
    expect(Math.abs(comZ)).toBeGreaterThan(0.05);
    const { world, vehicle } = build(spec);
    world.step(); // warm the query pipeline so the first ray casts hit
    vehicle.body.setTranslation({ x: 0, y: spec.chassis.cgHeight, z: 0 }, true);
    vehicle.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    vehicle.body.setLinvel({ x: 0, y: 0, z: -20 }, true);
    vehicle.body.setAngvel({ x: 0, y: 1.5, z: 0 }, true);
    vehicle.setInput(IDLE);
    vehicle.prePhysicsStep(FIXED_DT);
    const tel = vehicle.getTelemetry();
    const avY = 1.5;
    for (let i = 0; i < 4; i++) {
      const vx = avY * (pos[i][2] - comZ);
      const vz = -20 - avY * pos[i][0];
      const vl = -vz;
      const vt = -vx;
      const expected = relaxAlpha(
        0,
        Math.atan2(vt, Math.max(Math.abs(vl), V_LOW)),
        vl,
        FIXED_DT,
      );
      const wrong = relaxAlpha(
        0,
        Math.atan2(vt + avY * comZ, Math.max(Math.abs(vl), V_LOW)),
        vl,
        FIXED_DT,
      );
      expect(Math.abs(expected - wrong), `separation wheel ${i}`).toBeGreaterThan(1e-4);
      expect(tel.wheels[i].alpha, `wheel ${i}`).toBeCloseTo(expected, 12);
      expect(tel.wheels[i].alpha, `wheel ${i} vs origin arm`).not.toBeCloseTo(wrong, 12);
    }
  }, 30000);

  it('POST15: only weightFront exactly 0.5 pins the CoM at the body origin', () => {
    const base = readCar('f4');
    const pos = (base.wheels as Record<string, unknown>).positions as [number, number, number][];
    const asym = [0, 1, 2, 3].map((i, k): [number, number, number] => [
      pos[i][0],
      pos[i][1],
      k < 2 ? -1.2 : 2.0,
    ]);
    const at = (wf: number): number => {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
        wheels: { ...(base.wheels as Record<string, unknown>), positions: asym },
      });
      return build(spec).vehicle.body.localCom().z;
    };
    expect(at(0.5)).toBeCloseTo(0, 12);
    expect(at(0.5 + 1e-9)).toBeCloseTo(-1.2 + 0.5 * 3.2, 6);
    expect(at(0.5 - 1e-9)).toBeCloseTo(-1.2 + 0.5 * 3.2, 6);
  });

  it('POST10: on an asymmetric wheelbase the settled front share equals weightFront', () => {
    const base = readCar('f4');
    const pos = (base.wheels as Record<string, unknown>).positions as [number, number, number][];
    const asym = [0, 1, 2, 3].map((i, k): [number, number, number] => [
      pos[i][0],
      pos[i][1],
      k < 2 ? -1.2 : 2.0,
    ]);
    for (const wf of [0.35, 0.62]) {
      const spec = parse({
        ...base,
        chassis: { ...(base.chassis as Record<string, unknown>), weightFront: wf },
        wheels: { ...(base.wheels as Record<string, unknown>), positions: asym },
      });
      const { world, vehicle } = build(spec);
      run(vehicle, world, 3, IDLE);
      const wheels = vehicle.getTelemetry().wheels;
      const front = wheels[0].fz + wheels[1].fz;
      const total = wheels.reduce((a, w) => a + w.fz, 0);
      expect(total, `total weightFront=${wf}`).toBeGreaterThan(0);
      expect(Math.abs(front / total - wf), `share weightFront=${wf}`).toBeLessThanOrEqual(0.01);
    }
  }, 30000);
});
