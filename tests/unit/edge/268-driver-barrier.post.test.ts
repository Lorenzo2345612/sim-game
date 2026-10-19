import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AiDriver } from '../../../src/ai/aiDriver';
import { computeRacingLine } from '../../../src/ai/racingLine';
import type { DriverInput } from '../../../src/core/types';
import type { TrackDataV2 } from '../../../src/core/types';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { surfaceOf, BARRIER_GROUP } from '../../../src/physics/trackColliders';
import * as vehicleModel from '../../../src/physics/vehicleModel';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC: CarSpec = parseCarSpec(
  JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')),
);
const CHASSIS_GROUP = 0x0002;

function loadTrack(id: string): TrackDataV2 {
  return parseTrackData(
    JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')),
  ) as TrackDataV2;
}

function findBarrier(world: ReturnType<typeof createPhysicsWorld>): RAPIER.Collider {
  const found: RAPIER.Collider[] = [];
  world.forEachCollider((c) => {
    if (found.length === 0 && surfaceOf(c) === null) found.push(c);
  });
  if (found.length === 0) throw new Error('barrier collider not found');
  return found[0];
}

// Constant-radius arc so a car off the line produces a stable nonzero steer.
function arc(): { line: ReturnType<typeof computeRacingLine>; speeds: Float64Array } {
  const cl: [number, number][] = [];
  const n = 64;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    cl.push([40 * Math.cos(a), 40 * Math.sin(a)]);
  }
  const line = computeRacingLine(cl, 6);
  const speeds = new Float64Array(n).fill(20);
  return { line, speeds };
}

const OUT: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

describe('268 driver and barrier post-code gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST48: the barrier collider is a member of BARRIER_GROUP and the chassis keeps its own group', () => {
    const world = createPhysicsWorld(loadTrack('monza'));
    world.step();
    try {
      const barrier = findBarrier(world);
      expect(barrier.collisionGroups(), 'barrier groups as prescribed').toBe(
        (BARRIER_GROUP << 16) | 0xffff,
      );
      const car = new vehicleModel.VehicleModel(world, SPEC, {
        position: { x: 0, y: 2, z: 0 },
        yaw: 0,
      });
      expect(car.chassisCollider.collisionGroups(), 'chassis groups unchanged').toBe(
        (CHASSIS_GROUP << 16) | 0xffff,
      );
    } finally {
      world.free();
    }
  });

  it('POST49: setMaxSteerAngle scales the normalized steer command', () => {
    const { line, speeds } = arc();
    const obs = { x: 44, z: 0, yaw: -Math.PI / 2, speed: 20 };
    const wide = new AiDriver(line, speeds, { maxSteerAngle: 0.35 });
    const narrow = new AiDriver(line, speeds, { maxSteerAngle: 0.175 });
    const saturated = new AiDriver(line, speeds);
    wide.update(obs, 1 / 120, OUT);
    const a = OUT.steer;
    narrow.update(obs, 1 / 120, OUT);
    const b = OUT.steer;
    expect(Math.abs(a), 'off-line car steers').toBeGreaterThan(1e-3);
    expect(Math.abs(b), 'half the lock doubles the command').toBeCloseTo(Math.min(1, 2 * Math.abs(a)), 6);
    saturated.setMaxSteerAngle(1e-4);
    saturated.update(obs, 1 / 120, OUT);
    expect(Math.abs(OUT.steer), 'tiny lock saturates the command').toBeCloseTo(1, 6);
  });

  it('POST55: a zero steering lock keeps the command finite and saturated', () => {
    const { line, speeds } = arc();
    const obs = { x: 44, z: 0, yaw: -Math.PI / 2, speed: 20 };
    const driver = new AiDriver(line, speeds);
    driver.setMaxSteerAngle(0);
    driver.update(obs, 1 / 120, OUT);
    expect(Number.isFinite(OUT.steer), 'zero lock must not yield a non-finite steer').toBe(true);
    expect(Math.abs(OUT.steer), 'zero lock saturates the command').toBeCloseTo(1, 6);
  });

  it('POST50: a non-finite per-index half width leaves every racing-line offset finite', () => {
    const cl: [number, number][] = [];
    for (let z = 0; z >= -200; z -= 4) cl.push([0, z]);
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI) / 24;
      cl.push([12 * (1 - Math.cos(a)), -200 - 12 * Math.sin(a)]);
    }
    for (let z = -196; z <= 0; z += 4) cl.push([24, z]);
    for (let k = 1; k < 24; k++) {
      const a = (k * Math.PI) / 24;
      cl.push([24 - 12 * (1 - Math.cos(a)), -12 * Math.sin(a)]);
    }
    const n = cl.length;
    const left = new Array<number>(n).fill(8);
    const right = new Array<number>(n).fill(8);
    left[10] = Number.NaN;
    right[10] = Number.NaN;
    const line = computeRacingLine(cl, 8, undefined, undefined, left, right);
    for (let i = 0; i < n; i++) {
      expect(Number.isFinite(line.offsets[i]), `offset ${i} stays finite`).toBe(true);
    }
  });
});
