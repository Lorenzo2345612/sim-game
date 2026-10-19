import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import type { Sausage, TrackDataV2 } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import { createPhysicsWorld, initPhysics } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { fixture } from './022-fixture-trackdatav2';

// Task 150 lands src/render/sausageRenderer.ts; the variable specifier keeps
// typecheck green until the module exists (the 158 pattern).
const SAUSAGE_RENDERER_MODULE = '../../../src/render/sausageRenderer';

interface SausageRenderer {
  createSausageGeometry(length: number): THREE.BufferGeometry;
}

async function loadSausageRenderer(): Promise<SausageRenderer> {
  return (await import(SAUSAGE_RENDERER_MODULE)) as SausageRenderer;
}

function loadF4(): CarSpec {
  const json = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'public', 'cars', 'f4.json'), 'utf8'),
  ) as unknown;
  return parseCarSpec(json);
}

const SPEC = loadF4();

type World = ReturnType<typeof createPhysicsWorld>;

const IDLE = { throttle: 0, brake: 0, steer: 0, reset: false } as const;

// Straight fixture like 032: 60 centerline points, 2 m apart along -Z; heading
// -Z makes the right normal +X. The sausage sits at index 15 (z = -30).
const POINTS = 60;

function straightTrack(sausages?: Sausage[]): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: POINTS }, (_, i) => [0, -2 * i]);
  const track: TrackDataV2 = {
    ...fixture,
    centerline,
    lengthMeters: 236,
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
  };
  if (sausages !== undefined) track.sausages = sausages;
  return track;
}

// Settle on the asphalt, then drive sideways (+X, across the sausage's length)
// at a pinned 25 m/s for 1 s; returns the peak |chassis linvel.y| seen.
async function peakVerticalVelocity(world: World): Promise<number> {
  const car = new Vehicle(world, SPEC, { position: { x: 0, y: 0.6, z: -30 }, yaw: 0 });
  for (let i = 0; i < Math.round(0.5 / FIXED_DT); i++) {
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    world.step();
  }
  let peak = 0;
  for (let i = 0; i < Math.round(1 / FIXED_DT); i++) {
    const lv = car.body.linvel();
    car.body.setLinvel({ x: 25, y: lv.y, z: 0 }, true);
    car.setInput(IDLE);
    car.prePhysicsStep(FIXED_DT);
    world.step();
    peak = Math.max(peak, Math.abs(car.body.linvel().y));
  }
  return peak;
}

describe('150 sausage kerb render and colliders acceptance', () => {
  let world: World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: sausage geometry for length 6 has max y 0.13 over a y=0 base, base width 0.5 and length 6 (± 1e-6)', async () => {
    const { createSausageGeometry } = await loadSausageRenderer();
    const geometry = createSausageGeometry(6);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box === null) throw new Error('sausage geometry has no bounding box');
    expect(Math.abs(box.min.y), 'base at y 0').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.y - 0.13), 'height over ground').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.x - box.min.x - 0.5), 'base width').toBeLessThanOrEqual(1e-6);
    expect(Math.abs(box.max.z - box.min.z - 6), 'length').toBeLessThanOrEqual(1e-6);
    geometry.dispose();
  });

  it('AT2: f4 crossing a sausage perpendicular at 25 m/s peaks above 0.5 m/s vertical velocity; without it below 0.3 m/s', async () => {
    const sausage: Sausage = { index: 15, side: 'right', offset: 7.8, length: 6 };
    world = createPhysicsWorld(straightTrack([sausage]));
    world.step();
    const withSausage = await peakVerticalVelocity(world);
    world.free();
    world = createPhysicsWorld(straightTrack());
    world.step();
    const withoutSausage = await peakVerticalVelocity(world);
    expect(withSausage, 'peak |vy| with sausage').toBeGreaterThan(0.5);
    expect(withoutSausage, 'peak |vy| without sausage').toBeLessThan(0.3);
  }, 30000);
});
