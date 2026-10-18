import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import type { VehicleModel } from '../../../src/physics/vehicleModel';
import { cumulativeLengths } from '../../../src/track/centerline';
import type { Point2 } from '../../../src/track/geo';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TrackProgress, type ProgressSample } from '../../../src/track/trackProgress';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
const TOL = 1e-9;
const MIN_LEN2 = 1e-18;
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function stadium(): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i <= 400; i++) pts.push([i, 0]);
  for (let k = 1; k < 16; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 16;
    pts.push([400 + 5 * Math.cos(a), 5 + 5 * Math.sin(a)]);
  }
  for (let i = 0; i <= 400; i++) pts.push([400 - i, 10]);
  for (let k = 1; k < 16; k++) {
    const a = Math.PI / 2 + (Math.PI * k) / 16;
    pts.push([5 * Math.cos(a), 5 + 5 * Math.sin(a)]);
  }
  return pts;
}

const TRACK: Point2[] = stadium();

function fullSearch(points: Point2[], x: number, z: number): ProgressSample {
  const n = points.length;
  const cum = cumulativeLengths(points, true);
  let bestIndex = -1;
  let bestT = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    if (len2 < MIN_LEN2) continue;
    const rx = x - a[0];
    const rz = z - a[1];
    let t = (rx * dx + rz * dz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const qx = a[0] + t * dx;
    const qz = a[1] + t * dz;
    const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestIndex = i;
      bestT = t;
    }
  }
  if (bestIndex === n - 1 && bestT === 1) {
    bestIndex = 0;
    bestT = 0;
  }
  const a = points[bestIndex];
  const b = points[(bestIndex + 1) % n];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const segLen = cum[bestIndex + 1] - cum[bestIndex];
  const qx = a[0] + bestT * dx;
  const qz = a[1] + bestT * dz;
  const lateral = segLen > 0
    ? ((x - qx) * -dz + (z - qz) * dx) / segLen
    : Math.hypot(x - qx, z - qz);
  return { index: bestIndex, distance: cum[bestIndex] + bestT * segLen, lateral };
}

function expectClose(a: number, b: number, label: string): void {
  expect(Math.abs(a - b), label).toBeLessThanOrEqual(TOL);
}

async function positionsAfter(track: TrackDataV2, spec: CarSpec, ticks: number): Promise<Array<{ x: number; y: number; z: number }>> {
  const game = await RaceGame.create(track, spec, raceConfig(15));
  try {
    for (let i = 0; i < ticks; i++) game.step(IDLE);
    const states = game.getStates(
      Array.from({ length: game.carCount }, () => createVehicleState(4)),
    );
    return states.map((s: VehicleState) => ({ x: s.position.x, y: s.position.y, z: s.position.z }));
  } finally {
    game.dispose();
  }
}

function flaggedHandles(world: World): number[] {
  const out: number[] = [];
  world.colliders.forEach((c) => {
    if ((c.activeEvents() & RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS) !== 0) out.push(c.handle);
  });
  return out.sort((a, b) => a - b);
}

describe('153 simulation cost edge cases', () => {
  it('EDGE1: windowed update matches a full search for on-track motion across the seam', () => {
    const tp = new TrackProgress(TRACK);
    const walk: number[] = [];
    for (let k = 780; k <= 831; k++) walk.push(k);
    for (let k = 0; k <= 140; k++) walk.push(k);
    for (const k of walk) {
      const x = TRACK[k][0];
      const z = TRACK[k][1] + 3;
      const got = tp.update(x, z);
      const want = fullSearch(TRACK, x, z);
      expect(got.index, `k=${k} index`).toBe(want.index);
      expectClose(got.distance, want.distance, `k=${k} distance`);
      expectClose(got.lateral, want.lateral, `k=${k} lateral`);
    }
  });

  it('EDGE2: a query 110 samples ahead but within 25 m of the window stays windowed', () => {
    const tp = new TrackProgress(TRACK);
    const at = tp.update(150.5, 0);
    expect(at.index).toBe(150);
    const s = tp.update(260, 0);
    expect(s.index).toBe(250);
    expect(s.distance).toBeCloseTo(251, 9);
    expect(s.lateral).toBeCloseTo(0, 9);
  });

  it('EDGE3: a query whose best windowed distance exceeds 25 m falls back to a full search', () => {
    const tp = new TrackProgress(TRACK);
    const at = tp.update(150.5, 0);
    expect(at.index).toBe(150);
    const s = tp.update(350, 0);
    expect(s.index).toBe(349);
    expect(s.distance).toBeCloseTo(350, 9);
    expect(s.lateral).toBeCloseTo(0, 9);
  });

  it('EDGE4: reset() restores a full search even when the windowed distance is within 25 m', () => {
    const tp = new TrackProgress(TRACK);
    const at = tp.update(150.5, 10);
    expect(at.index).toBe(665);
    tp.reset();
    const s = tp.update(155, 0);
    expect(s.index).toBe(154);
    expect(s.distance).toBeCloseTo(155, 9);
    expect(s.lateral).toBeCloseTo(0, 9);
  });

  it('EDGE5: the first update performs a full search from any position', () => {
    const tp = new TrackProgress(TRACK);
    const s = tp.update(115, 0);
    expect(s.index).toBe(114);
    expect(s.distance).toBeCloseTo(115, 9);
    expect(s.lateral).toBeCloseTo(0, 9);
  });

  it('EDGE6: contact force events are enabled on chassis colliders only', async () => {
    await initPhysics();
    const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(3));
    try {
      const g = game as unknown as { world: World; vehicles: VehicleModel[] };
      expect(g.vehicles.length).toBe(game.carCount);
      const chassis = [...g.vehicles.map((v) => v.chassisCollider.handle)].sort((a, b) => a - b);
      expect(chassis.length).toBeGreaterThan(0);
      expect(flaggedHandles(g.world)).toEqual(chassis);
      const v = g.vehicles[0];
      v.damageMode = 'full';
      v.damage.detached[0] = true;
      v.setInput(IDLE);
      v.prePhysicsStep(FIXED_DT);
      expect(flaggedHandles(g.world)).toEqual(chassis);
    } finally {
      game.dispose();
    }
  });

  it(
    'EDGE7: two 16-car runs with the same seed give bit-identical positions after 60 s',
    async () => {
      const track = loadTrack();
      const spec = loadSpec();
      const ticks = Math.round(60 / FIXED_DT);
      const a = await positionsAfter(track, spec, ticks);
      const b = await positionsAfter(track, spec, ticks);
      expect(a.length, 'car count').toBe(b.length);
      expect(a.length).toBe(16);
      for (let i = 0; i < a.length; i++) {
        expect(a[i].x, `car ${i} x`).toBe(b[i].x);
        expect(a[i].y, `car ${i} y`).toBe(b[i].y);
        expect(a[i].z, `car ${i} z`).toBe(b[i].z);
      }
    },
    300000,
  );
});
