import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Sausage, TrackDataV2 } from '../../../src/core/types';
import { RAPIER, createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { VehicleModel } from '../../../src/physics/vehicleModel';
import { groundHeightAt } from '../../../src/track/ground';
import { sausageHullPoints, sausagePieces, sausagePose } from '../../../src/track/sausages';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

function loadF4(): CarSpec {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

let clevelandTrack: TrackDataV2 | null = null;

function cleveland(): TrackDataV2 {
  if (clevelandTrack === null) {
    clevelandTrack = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'cleveland.json'), 'utf8'),
    ) as TrackDataV2;
  }
  return clevelandTrack;
}

// Task 299 adds sausageColliderPoints; the variable specifier keeps typecheck
// green until the export exists (the 158/247 pattern).
const SAUSAGE_MODULE = '../../../src/track/sausages';
type ColliderPointsFn = (length: number) => Float32Array;

async function loadColliderPoints(): Promise<ColliderPointsFn> {
  const mod = (await import(SAUSAGE_MODULE)) as unknown as { sausageColliderPoints: ColliderPointsFn };
  return mod.sausageColliderPoints;
}

type World = ReturnType<typeof createPhysicsWorld>;

const POINTS = 60;

// Straight fixture like 150: 60 centerline points, 2 m apart along -Z; heading
// -Z makes the right normal +X. The sausage sits at index 15 (z = -30).
function straightTrack(sausages: Sausage[]): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: POINTS }, (_, i) => [0, -2 * i]);
  return {
    ...fixture,
    centerline,
    lengthMeters: 236,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    sausages,
  };
}

interface Crossing {
  maxFz: number;
  maxYaw: number;
}

// Cleveland sausage 0: f4 spawned `lateral` metres toward the track from the
// sausage centre line, 14 m before the first piece along its direction, heading
// rotated `rotateDeg` toward the sausage side, on the ground + 0.5 m at 25 m/s;
// 1.3 s of 1/120 steps, peaks taken after the first 30 steps.
function crossSausage(lateral: number, rotateDeg: number): Crossing {
  const track = cleveland();
  const sausage = (track.sausages ?? [])[0];
  const piece = sausagePieces(track, sausage)[0];
  const ux = Math.sin(piece.yaw);
  const uz = Math.cos(piece.yaw);
  const nx = -uz;
  const nz = ux;
  const sign = sausage.side === 'right' ? 1 : -1;
  const a = (rotateDeg * Math.PI) / 180;
  const hx = ux * Math.cos(a) + sign * nx * Math.sin(a);
  const hz = uz * Math.cos(a) + sign * nz * Math.sin(a);
  const x = piece.position.x - 14 * ux - lateral * sign * nx;
  const z = piece.position.z - 14 * uz - lateral * sign * nz;
  const y = groundHeightAt(track, x, z) + 0.5;
  const world = createPhysicsWorld(track);
  try {
    const car = new VehicleModel(world, SPEC, { position: { x, y, z }, yaw: Math.atan2(-hx, -hz) });
    const speed = 25;
    car.body.setLinvel({ x: speed * hx, y: 0, z: speed * hz }, true);
    const wheels = (car as unknown as { wheels: Array<{ omega: number }> }).wheels;
    for (const w of wheels) w.omega = speed / 0.28;
    for (let i = 0; i < 4; i++) car.shiftUp();
    const input: DriverInput = { throttle: 0.3, brake: 0, steer: 0, reset: false };
    const steps = Math.round(1.3 / FIXED_DT);
    let maxFz = 0;
    let maxYaw = 0;
    for (let i = 0; i < steps; i++) {
      car.setInput(input);
      car.prePhysicsStep(FIXED_DT);
      world.step();
      if (i < 30) continue;
      for (const w of car.getTelemetry().wheels) maxFz = Math.max(maxFz, w.fz);
      maxYaw = Math.max(maxYaw, Math.abs(car.body.angvel().y));
    }
    return { maxFz, maxYaw };
  } finally {
    world.free();
  }
}

describe('299 sausage collider ramp acceptance', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: sausageColliderPoints(6) is an 8-corner prism with y in {0, 0.08}, |x| 0.35 at y 0, 0.1 at y 0.08 and |z| 3 (± 1e-6)', async () => {
    const sausageColliderPoints = await loadColliderPoints();
    const pts = sausageColliderPoints(6);
    expect(pts.length, '24 floats').toBe(24);
    for (let c = 0; c < 8; c++) {
      const x = pts[3 * c];
      const y = pts[3 * c + 1];
      const z = pts[3 * c + 2];
      const base = c < 4;
      expect(Math.abs(y - (base ? 0 : 0.08)), `corner ${c} y`).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(Math.abs(x) - (base ? 0.35 : 0.1)), `corner ${c} |x|`).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(Math.abs(z) - 3), `corner ${c} |z|`).toBeLessThanOrEqual(1e-6);
    }
  });

  it("AT2: a downward ray from y 5 at sausagePose of the straight-track sausage hits a 'kerb' collider at timeOfImpact 4.92 ± 1e-3", async () => {
    const sausage: Sausage = { index: 15, side: 'right', offset: 7.8, length: 6 };
    const track = straightTrack([sausage]);
    world = createPhysicsWorld(track);
    for (let i = 0; i < 5; i++) world.step();
    const { position } = sausagePose(track, sausage);
    const hit = world.castRay(
      new RAPIER.Ray({ x: position.x, y: 5, z: position.z }, { x: 0, y: -1, z: 0 }),
      100,
      true,
    );
    expect(hit, 'ray hit').not.toBeNull();
    if (hit === null) return;
    expect(surfaceOf(hit.collider), 'kerb surface').toBe('kerb');
    expect(hit.timeOfImpact, 'top 0.08 above ground').toBeCloseTo(4.92, 3);
  });

  it('AT3: f4 at 25 m/s 14 m before cleveland sausage 0 with lateral 0.5 toward the track keeps wheel fz <= 10 000 N and |yaw rate| <= 0.25 rad/s', () => {
    const m = crossSausage(0.5, 0);
    expect(m.maxFz, 'peak wheel fz').toBeLessThanOrEqual(10000);
    expect(m.maxYaw, 'peak |yaw rate|').toBeLessThanOrEqual(0.25);
  }, 120000);

  it('AT4: the same run with lateral 0 and heading rotated 10° toward the sausage side keeps wheel fz <= 10 000 N and |yaw rate| <= 0.25 rad/s', () => {
    const m = crossSausage(0, 10);
    expect(m.maxFz, 'peak wheel fz').toBeLessThanOrEqual(10000);
    expect(m.maxYaw, 'peak |yaw rate|').toBeLessThanOrEqual(0.25);
  }, 120000);

  it('AT5: sausageHullPoints(6) is unchanged: max y 0.13 and base |x| 0.25', () => {
    const pts = sausageHullPoints(6);
    expect(pts.length, '24 floats').toBe(24);
    let maxY = -Infinity;
    for (let c = 0; c < 8; c++) {
      const x = pts[3 * c];
      const y = pts[3 * c + 1];
      maxY = Math.max(maxY, y);
      if (Math.abs(y) <= 1e-6) {
        expect(Math.abs(Math.abs(x) - 0.25), `base corner ${c} |x|`).toBeLessThanOrEqual(1e-6);
      }
    }
    expect(Math.abs(maxY - 0.13), 'max y').toBeLessThanOrEqual(1e-6);
  });
});
