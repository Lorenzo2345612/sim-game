import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { Vehicle } from '../../../src/physics/vehicle';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Quat, SpawnPose, TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function loadF4(): CarSpec {
  return parseCarSpec(
    JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
  );
}

function applyQ(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

describe('174 bank-aware spawn and banked drive post-coder gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('POST1: roll equal to the bank puts the up vector along the banked surface normal, sign included', () => {
    const world = createPhysicsWorld();
    const vehicle = new Vehicle(world, loadF4(), {
      position: { x: 0, y: 0.6, z: 0 },
      yaw: 0,
      roll: 0,
    });
    // Centerline running -Z (yaw 0): right is +X, so bank b tilts the normal to (-sin b, cos b, 0).
    for (const b of [0.5, -0.5]) {
      vehicle.reset({ position: { x: 0, y: 0.6, z: 0 }, yaw: 0, roll: b });
      const up = applyQ(vehicle.getState().rotation, 0, 1, 0);
      const expected: [number, number, number] = [-Math.sin(b), Math.cos(b), 0];
      expect(up[0]).toBeCloseTo(expected[0], 2);
      expect(up[1]).toBeCloseTo(expected[1], 2);
      expect(up[2]).toBeCloseTo(expected[2], 2);
    }
    world.free();
  });

  it('POST2: 5 s of throttle from the turn 3-4 spawn stays on asphalt with the car on the banked trimesh', () => {
    const track = parseTrackData(
      JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8')),
    ) as TrackDataV2;
    const cx = track.centerline;
    const n = cx.length;
    const cum = [0];
    for (let i = 1; i < n; i++) {
      cum.push(cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]));
    }
    let idx = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(cum[i] - 4620);
      if (d < best) {
        best = d;
        idx = i;
      }
    }
    const world = createPhysicsWorld(track);
    const p = cx[idx];
    const next = cx[(idx + 1) % n];
    const spawn: SpawnPose = {
      position: { x: p[0], y: (track.elevation?.[idx] ?? 0) + 0.6, z: p[1] },
      yaw: Math.atan2(-(next[0] - p[0]), -(next[1] - p[1])),
      roll: track.bank?.[idx] ?? 0,
    };
    expect(Math.abs(spawn.roll ?? 0) / DEG).toBeGreaterThanOrEqual(30);
    const vehicle = new Vehicle(world, loadF4(), spawn);
    const input: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
    const state = vehicle.getState();
    let checked = 0;
    for (let s = 0; s < 600; s++) {
      vehicle.setInput(input);
      vehicle.prePhysicsStep(FIXED_DT);
      world.step();
      if (s % 12 !== 11) continue;
      vehicle.getState(state);
      const hit = world.castRay(
        new RAPIER.Ray(
          { x: state.position.x, y: state.position.y + 1, z: state.position.z },
          { x: 0, y: -1, z: 0 },
        ),
        600,
        true,
        undefined,
        undefined,
        undefined,
        vehicle.body,
        (c) => surfaceOf(c) !== null,
      );
      expect(hit, `ground hit at step ${s}`).not.toBeNull();
      const surface = surfaceOf(hit!.collider);
      expect(surface, `surface at step ${s}`).toBe('asphalt');
      const groundY = state.position.y + 1 - hit!.timeOfImpact;
      const dy = state.position.y - groundY;
      expect(dy, `dy at step ${s}`).toBeGreaterThanOrEqual(0);
      expect(dy, `dy at step ${s}`).toBeLessThanOrEqual(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const lin = vehicle.body.linvel();
    expect(Math.hypot(lin.x, lin.y, lin.z) * 3.6).toBeGreaterThan(30);
    world.free();
  }, 120000);
});
