import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import type { SpawnPose } from '../../../src/core/types';

type World = ReturnType<typeof createPhysicsWorld>;

const worlds: World[] = [];

function build(spec: CarSpec): { world: World; vehicle: Vehicle } {
  const world = createPhysicsWorld();
  worlds.push(world);
  const spawn: SpawnPose = { position: { x: 0, y: spec.chassis.cgHeight, z: 0 }, yaw: 0 };
  const vehicle = new Vehicle(world, spec, spawn);
  return { world, vehicle };
}

const ROOT = join(__dirname, '..', '..', '..');

// Table values of task 255. weightFront is exact (no retune allowance);
// rearMuScale targets admit the spec's ±0.05 retune envelope.
const WEIGHT_FRONT: Record<string, number> = {
  'gt3-a': 0.48,
  'gt3-b': 0.4,
  'gt3-c': 0.44,
  'gt3-d': 0.43,
  'hyper-a': 0.47,
  'lmp2-a': 0.44,
  ow26: 0.455,
};

const REAR_MU: Record<string, number> = {
  'gt3-a': 1.0,
  'gt3-b': 1.05,
  'gt3-c': 1.03,
  'gt3-d': 1.03,
  'hyper-a': 1.08,
  'lmp2-a': 1.03,
};

function readCar(id: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'cars', `${id}.json`), 'utf8'));
}

function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

// Keys the task is allowed to change: the four table fields plus the retune
// levers (rearMuScale ±0.05, claFront/claRear split with total constant).
const ALLOWED: [string, string][] = [
  ['chassis', 'weightFront'],
  ['tyres', 'rearMuScale'],
  ['wheels', 'width'],
  ['wheels', 'widthRear'],
  ['aero', 'claFront'],
  ['aero', 'claRear'],
];

const FROZEN: Record<string, string> = {
  'f4.json': 'c803885f0b22970c7a562931502229862d0e229a73d41d0f2db4fd3282fc9b75',
  'gt3-a.json': '43e6392bd7f395a3e40d17371a2e7a60312240e5d030d908294b72e067f69318',
  'gt3-b.json': '521b825e87ba064b124da224f7fd18b51595f59e23e8eb1807a2a0455bb25912',
  'gt3-c.json': '0615535efb5da8bb6f0760f6b86a044785195ad4cdc4265c502130da8705f2f0',
  'gt3-d.json': '405e6148020380b85bc5f617536d5b6b9489e71ca77c91570c467b3c1df085fa',
  'hyper-a.json': 'd61f4ee9388e71f5ebe85a336e99e737f84211025a5e4685164e2ae27fee5028',
  'index.json': 'ae277e0021615e04acbf70d386f85377340e752c0de7f6245744b6f6761eb829',
  'lmp2-a.json': '6651c99ce816eeb390e4a50f53b4cefee41d49867f3e01efa13823657863f14f',
  'ow26.json': '6c9c04df9f80b0b7fe8d141332505f78a97b72bc6b8068433e9da962448549d4',
};

// Master totals of claFront + claRear; only the split may move.
const CLA_TOTAL: Record<string, number> = {
  f4: 2,
  'gt3-a': 3,
  'gt3-b': 3,
  'gt3-c': 3,
  'gt3-d': 3,
  'hyper-a': 5,
  'lmp2-a': 5.6,
  ow26: 4.2,
};

describe('255 per-car weight distribution and tyre widths edge cases', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    for (const w of worlds) w.free();
    worlds.length = 0;
  });

  it('EDGE1: every car parses the table weightFront on the spec', () => {
    for (const [id, target] of Object.entries(WEIGHT_FRONT)) {
      const spec = parseCarSpec(readCar(id));
      expect(spec.chassis.weightFront, `${id}.chassis.weightFront`).toBeCloseTo(target, 9);
    }
  });

  it('EDGE2: every non-ow26 car sets tyres.rearMuScale within the ±0.05 retune envelope of its target', () => {
    for (const [id, target] of Object.entries(REAR_MU)) {
      const tyres = (readCar(id) as { tyres?: Record<string, unknown> }).tyres ?? {};
      const raw = tyres.rearMuScale;
      expect(typeof raw, `${id}.json tyres.rearMuScale present`).toBe('number');
      expect(Math.abs((raw as number) - target), `${id}.tyres.rearMuScale`).toBeLessThanOrEqual(0.05);
      expect(parseCarSpec(readCar(id)).tyres.rearMuScale, `${id} parsed`).toBeCloseTo(raw as number, 9);
    }
  });

  it('EDGE3: car JSONs change only the allowed keys (mass, power, gearbox, wheel positions frozen)', () => {
    for (const [file, hash] of Object.entries(FROZEN)) {
      const json = readCar(file.replace(/\.json$/, '')) as Record<string, unknown>;
      for (const [a, b] of ALLOWED) {
        const section = json[a] as Record<string, unknown> | undefined;
        if (section && b in section) delete section[b];
      }
      const actual = createHash('sha256').update(canon(json)).digest('hex');
      expect(actual, file).toBe(hash);
    }
  });

  it('EDGE4: an aero balance retune keeps claFront + claRear at the master total', () => {
    for (const [id, total] of Object.entries(CLA_TOTAL)) {
      const aero = (readCar(id) as { aero: Record<string, unknown> }).aero;
      const sum = (aero.claFront as number) + (aero.claRear as number);
      expect(Math.abs(sum - total), `${id} aero cla total`).toBeLessThanOrEqual(1e-9);
    }
  });

  it('EDGE5: the body CoM sits at the weightFront formula point on the body z axis', () => {
    for (const id of Object.keys(WEIGHT_FRONT)) {
      const spec = parseCarSpec(readCar(id));
      const pos = spec.wheels.positions;
      const zFront = (pos[0][2] + pos[1][2]) / 2;
      const zRear = (pos[2][2] + pos[3][2]) / 2;
      const expected = zFront + (1 - spec.chassis.weightFront) * (zRear - zFront);
      const { vehicle } = build(spec);
      const com = vehicle.body.localCom();
      expect(com.x, `${id} com.x`).toBeCloseTo(0, 7);
      expect(com.y, `${id} com.y`).toBeCloseTo(0, 7);
      expect(com.z, `${id} com.z`).toBeCloseTo(Math.fround(expected), 7);
    }
  }, 60000);
});
