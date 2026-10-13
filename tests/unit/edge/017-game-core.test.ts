import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { DriverInput, Quat, TrackData, VehicleState, Vec3, WheelState } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import {
  lerpVec3,
  slerpQuat,
  createVehicleState,
  copyVehicleState,
  interpolateVehicleState,
} from '../../../src/core/interpolation';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const RESET: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true };
const D2R = Math.PI / 180;
const ID: Quat = { x: 0, y: 0, z: 0, w: 1 };

function within(a: number, b: number, tol: number): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

function v(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function wheel(x: number, y: number, z: number, steering: number, rotation: number, inContact: boolean): WheelState {
  return { position: v(x, y, z), steering, rotation, inContact };
}

// Circle r=200 resampled at ~2 m, index 0 at (200,0), like the spec fixture.
function circleTrack(r: number, spacing: number): TrackData {
  const n = Math.round((2 * Math.PI * r) / spacing);
  const centerline: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    centerline.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return {
    id: `circle-${r}`,
    name: `Circle ${r}`,
    widthMeters: 12,
    lengthMeters: 2 * Math.PI * r,
    officialLengthMeters: 2 * Math.PI * r,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    source: { dataset: 'fixture', license: 'fixture', url: 'fixture' },
  };
}

function trackOf(centerline: [number, number][]): TrackData {
  return {
    id: 'mini',
    name: 'Mini',
    widthMeters: 12,
    lengthMeters: 2 * centerline.length,
    officialLengthMeters: 2 * centerline.length,
    centerline,
    sectors: [0, 0, 0],
    source: { dataset: 'fixture', license: 'fixture', url: 'fixture' },
  };
}

function quatDist(a: Quat, b: Quat): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z, a.w - b.w);
}

function expectQuatSameRotation(q: Quat, e: Quat, tol: number): void {
  within(Math.hypot(q.x, q.y, q.z, q.w), 1, tol);
  expect(Math.min(quatDist(q, e), quatDist(q, { x: -e.x, y: -e.y, z: -e.z, w: -e.w }))).toBeLessThanOrEqual(tol);
}

function expectStateEquals(a: VehicleState, b: VehicleState): void {
  within(a.position.x, b.position.x, 1e-12);
  within(a.position.y, b.position.y, 1e-12);
  within(a.position.z, b.position.z, 1e-12);
  within(a.rotation.x, b.rotation.x, 1e-12);
  within(a.rotation.y, b.rotation.y, 1e-12);
  within(a.rotation.z, b.rotation.z, 1e-12);
  within(a.rotation.w, b.rotation.w, 1e-12);
  within(a.forwardSpeed, b.forwardSpeed, 1e-12);
  expect(a.wheels.length).toBe(b.wheels.length);
  for (let i = 0; i < a.wheels.length; i++) {
    within(a.wheels[i].position.x, b.wheels[i].position.x, 1e-12);
    within(a.wheels[i].position.y, b.wheels[i].position.y, 1e-12);
    within(a.wheels[i].position.z, b.wheels[i].position.z, 1e-12);
    within(a.wheels[i].steering, b.wheels[i].steering, 1e-12);
    within(a.wheels[i].rotation, b.wheels[i].rotation, 1e-12);
    expect(a.wheels[i].inContact).toBe(b.wheels[i].inContact);
  }
}

function samplePrev(): VehicleState {
  return {
    position: v(1, 2, 3),
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 20,
    wheels: [wheel(0, 0, 0, 0.4, 6.2, true), wheel(0, 0, 0, 0.2, 1, true)],
  };
}

function sampleCurr(): VehicleState {
  return {
    position: v(5, 7, -2),
    rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    forwardSpeed: -5,
    wheels: [wheel(4, 4, 4, -0.2, 0.1, false), wheel(2, 2, 2, 0.6, 3, true)],
  };
}

describe('017 interpolation edge cases', () => {
  it('EDGE1: lerpVec3 is safe when out aliases a or b and returns out', () => {
    const a = v(1, -2, 3);
    const b = v(-4, 5, 0.5);

    const ret = lerpVec3(a, b, 0.25, a); // out === a
    expect(ret).toBe(a);
    within(a.x, 1 + (-4 - 1) * 0.25, 1e-12);
    within(a.y, -2 + (5 - -2) * 0.25, 1e-12);
    within(a.z, 3 + (0.5 - 3) * 0.25, 1e-12);

    const a2 = v(1, -2, 3);
    const b2 = v(-4, 5, 0.5);
    const ret2 = lerpVec3(a2, b2, 1, b2); // out === b, full travel
    expect(ret2).toBe(b2);
    within(b2.x, -4, 1e-12);
    within(b2.y, 5, 1e-12);
    within(b2.z, 0.5, 1e-12);

    const a3 = v(7, -1, 2);
    lerpVec3(a3, v(0, 0, 0), 0, a3); // out === a, t=0 leaves a unchanged
    within(a3.x, 7, 1e-12);
    within(a3.y, -1, 1e-12);
    within(a3.z, 2, 1e-12);
  });

  it('EDGE2: lerpVec3, slerpQuat and interpolateVehicleState clamp t to [0,1] and treat non-finite t as 1', () => {
    const a = v(1, 2, 3);
    const b = v(9, -4, 5);
    const o = v(0, 0, 0);
    for (const t of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      lerpVec3(a, b, t, o);
      within(o.x, b.x, 1e-12);
      within(o.y, b.y, 1e-12);
      within(o.z, b.z, 1e-12);
    }
    for (const t of [-0.25, -1]) {
      lerpVec3(a, b, t, o);
      within(o.x, a.x, 1e-12);
      within(o.y, a.y, 1e-12);
      within(o.z, a.z, 1e-12);
    }

    const q90: Quat = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }; // 90 deg about Y
    const qo: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(ID, q90, 2, qo);
    expectQuatSameRotation(qo, q90, 1e-9);
    slerpQuat(ID, q90, Number.NaN, qo);
    expectQuatSameRotation(qo, q90, 1e-9);
    slerpQuat(ID, q90, -1, qo);
    expectQuatSameRotation(qo, ID, 1e-9);

    const prev = samplePrev();
    const curr = sampleCurr();
    const at1 = interpolateVehicleState(prev, curr, 1, createVehicleState(2));
    const clamped = interpolateVehicleState(prev, curr, Number.NaN, createVehicleState(2));
    expectStateEquals(clamped, at1);
    const back = interpolateVehicleState(prev, curr, -1.7, createVehicleState(2));
    within(back.position.x, prev.position.x, 1e-12);
    within(back.position.y, prev.position.y, 1e-12);
    within(back.position.z, prev.position.z, 1e-12);
    within(back.forwardSpeed, prev.forwardSpeed, 1e-12);
    expectQuatSameRotation(back.rotation, prev.rotation, 1e-9);
    for (let i = 0; i < 2; i++) {
      within(back.wheels[i].position.x, prev.wheels[i].position.x, 1e-12);
      within(back.wheels[i].steering, prev.wheels[i].steering, 1e-12);
      within(back.wheels[i].rotation, prev.wheels[i].rotation, 1e-12);
      expect(back.wheels[i].inContact).toBe(curr.wheels[i].inContact); // inContact always from curr
    }
  });

  it('EDGE3: createVehicleState gives independent zeroed wheels with identity rotation; copyVehicleState copies in place and detaches out from src', () => {
    const s = createVehicleState(3);
    expect(s.wheels.length).toBe(3);
    within(s.position.x, 0, 12);
    within(s.position.y, 0, 12);
    within(s.position.z, 0, 12);
    within(s.rotation.w, 1, 12);
    within(s.rotation.x, 0, 12);
    within(s.forwardSpeed, 0, 12);
    for (const w of s.wheels) {
      within(w.position.x, 0, 12);
      within(w.position.y, 0, 12);
      within(w.position.z, 0, 12);
      within(w.steering, 0, 12);
      within(w.rotation, 0, 12);
      expect(w.inContact).toBe(false);
    }
    // Each position must be its own Vec3: a shared object would make wheels corrupt each other.
    expect(s.wheels[0].position).not.toBe(s.wheels[1].position);
    expect(s.position).not.toBe(s.wheels[0].position);
    s.wheels[0].position.x = 7;
    within(s.wheels[1].position.x, 0, 12);
    within(s.position.x, 0, 12);

    const src: VehicleState = {
      position: v(1.5, 0.6, -2.5),
      rotation: { x: 0.1, y: 0.2, z: -0.3, w: Math.sqrt(0.86) },
      forwardSpeed: 12.5,
      wheels: [wheel(0, 1, 2, 0.3, 4, true), wheel(5, 6, 7, -0.3, 8, false), wheel(9, 10, 11, 0.1, 12, true)],
    };
    const out = createVehicleState(3);
    const ret = copyVehicleState(src, out);
    expect(ret).toBe(out);
    expectStateEquals(out, src);
    expect(out.position).not.toBe(src.position);
    expect(out.wheels[0].position).not.toBe(src.wheels[0].position);

    src.position.x = 99;
    src.rotation.w = -0.5;
    src.forwardSpeed = -77;
    src.wheels[1].position.z = 123;
    src.wheels[2].rotation = 999;
    src.wheels[2].inContact = false;
    within(out.position.x, 1.5, 12);
    within(out.rotation.w, Math.sqrt(0.86), 12);
    within(out.forwardSpeed, 12.5, 12);
    within(out.wheels[1].position.z, 7, 12);
    within(out.wheels[2].rotation, 12, 12);
    expect(out.wheels[2].inContact).toBe(true);
  });

  it('EDGE4: slerpQuat follows the spec formula: endpoints, interior arc, short path when a.b < 0, nlerp fallback when nearly equal', () => {
    const ux = 1 / 3, uy = -2 / 3, uz = 2 / 3;
    const qAt = (deg: number): Quat => ({
      x: ux * Math.sin(deg * D2R),
      y: uy * Math.sin(deg * D2R),
      z: uz * Math.sin(deg * D2R),
      w: Math.cos(deg * D2R),
    }); // rotation of 2*deg about u
    const a: Quat = { x: 0, y: 0, z: 0, w: 1 };
    const b = qAt(80); // 160 deg about u
    const out: Quat = { x: 0, y: 0, z: 0, w: 0 };

    slerpQuat(a, b, 0, out);
    expectQuatSameRotation(out, a, 1e-9);

    slerpQuat(a, b, 0.3, out); // 48 deg about u -> half angle 24
    expectQuatSameRotation(out, qAt(24), 1e-9);

    slerpQuat(a, b, 1, out);
    expectQuatSameRotation(out, b, 1e-9);

    // d < 0 branch: b2 is 200 deg about u == 160 deg about -u; short path at t=0.5 is 80 deg about -u.
    slerpQuat(a, qAt(100), 0.5, out);
    const eFlip: Quat = { x: -ux * Math.sin(40 * D2R), y: -uy * Math.sin(40 * D2R), z: -uz * Math.sin(40 * D2R), w: Math.cos(40 * D2R) };
    expectQuatSameRotation(out, eFlip, 1e-9);

    // Nearly equal (0.5 deg apart, d > 0.9995): nlerp fallback, finite result at the arc midpoint.
    const bNear: Quat = { x: 0, y: Math.sin(0.25 * D2R), z: 0, w: Math.cos(0.25 * D2R) };
    const out2: Quat = { x: 1, y: 1, z: 1, w: 1 }; // garbage prefill must be fully overwritten
    slerpQuat(a, bNear, 0.5, out2);
    for (const c of [out2.x, out2.y, out2.z, out2.w]) expect(Number.isFinite(c)).toBe(true);
    within(out2.y, Math.sin(0.125 * D2R), 1e-6);
    within(out2.w, Math.cos(0.125 * D2R), 1e-6);

    // Identical unit quaternions: result is that rotation, normalized.
    const same: Quat = { x: 0.1, y: 0.2, z: -0.3, w: Math.sqrt(0.86) };
    const out3: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(same, { x: 0.1, y: 0.2, z: -0.3, w: Math.sqrt(0.86) }, 0.5, out3);
    expectQuatSameRotation(out3, same, 1e-9);
  });

  it('EDGE5: interpolateVehicleState writes every field at t=0/0.5/1: inContact from curr, wheel rotation lerped linearly across 2pi wrap, inputs untouched', () => {
    const prev = samplePrev();
    const curr = sampleCurr();
    const prevJson = JSON.stringify(prev);
    const currJson = JSON.stringify(curr);

    const at0 = interpolateVehicleState(prev, curr, 0, createVehicleState(2));
    for (let i = 0; i < 2; i++) {
      expectStateEquals(
        { ...at0, wheels: at0.wheels.map((w, j) => ({ ...w, inContact: prev.wheels[j].inContact })) },
        { ...prev, wheels: prev.wheels.map((w, j) => ({ ...w, inContact: prev.wheels[j].inContact })) },
      );
      within(at0.wheels[i].position.x, prev.wheels[i].position.x, 1e-12);
      within(at0.wheels[i].steering, prev.wheels[i].steering, 1e-12);
      expect(at0.wheels[i].inContact).toBe(curr.wheels[i].inContact);
    }
    within(at0.forwardSpeed, prev.forwardSpeed, 1e-12);

    const at1 = interpolateVehicleState(prev, curr, 1, createVehicleState(2));
    expectStateEquals(at1, curr);

    const mid = interpolateVehicleState(prev, curr, 0.5, createVehicleState(2));
    within(mid.position.x, 3, 1e-9);
    within(mid.position.y, 4.5, 1e-9);
    within(mid.position.z, 0.5, 1e-9);
    within(mid.forwardSpeed, 7.5, 1e-9); // 20 -> -5 linear
    // identity -> 90 deg about Y: arc midpoint 45 deg -> half angle 22.5
    within(mid.rotation.x, 0, 1e-9);
    within(mid.rotation.y, Math.sin(22.5 * D2R), 1e-9);
    within(mid.rotation.z, 0, 1e-9);
    within(mid.rotation.w, Math.cos(22.5 * D2R), 1e-9);
    within(mid.wheels[0].position.x, 2, 1e-9);
    within(mid.wheels[0].position.y, 2, 1e-9);
    within(mid.wheels[0].position.z, 2, 1e-9);
    within(mid.wheels[0].steering, 0.1, 1e-9);
    within(mid.wheels[0].rotation, 3.15, 1e-9); // plain (6.2 + 0.1) / 2, no shortest-angle wrap
    expect(mid.wheels[0].inContact).toBe(false); // from curr
    expect(mid.wheels[1].inContact).toBe(true);

    expect(JSON.stringify(prev)).toBe(prevJson);
    expect(JSON.stringify(curr)).toBe(currJson);
  });
});

describe('017 game edge cases', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('EDGE6: spawnFromTrack throws Track too short below 5 centerline points and places at centerline[0] with exactly 5', () => {
    expect(() => spawnFromTrack(trackOf([[0, 0], [1, 0], [2, 0], [3, 0]]))).toThrow('Track too short');
    expect(() => spawnFromTrack(trackOf([]))).toThrow('Track too short');

    const pose = spawnFromTrack(trackOf([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]));
    within(pose.position.x, 0, 1e-12);
    within(pose.position.z, 0, 1e-12);
    expect(pose.position.y).toBeCloseTo(0.6, 12);
    within(-Math.sin(pose.yaw), 1, 1e-9); // forward towards centerline[1] = +x
    within(-Math.cos(pose.yaw), 0, 1e-9);
  });

  it('EDGE7: a fresh Game has prev deep-equal to current at the spawn pose at rest, simTime 0 and empty lap info', async () => {
    const track = circleTrack(200, 2);
    const spawn = spawnFromTrack(track);
    game = await Game.create(track);
    const cur = game.getCurrentState();
    expect(cur.wheels.length).toBe(4);
    expectStateEquals(game.getPrevState(), cur);
    within(cur.position.x, spawn.position.x, 0.05);
    within(cur.position.y, spawn.position.y, 0.05);
    within(cur.position.z, spawn.position.z, 0.05);
    within(cur.forwardSpeed, 0, 1e-6);
    within(game.simTime, 0, 1e-12);
    expect(game.getLapInfo()).toEqual({ lap: 0, currentLapTime: null, lastLapTime: null, bestLapTime: null, valid: true });
  }, 20000);

  it('EDGE8: the reset step snapshots prev from the pre-reset current state and still advances simTime by exactly one FIXED_DT', async () => {
    game = await Game.create(circleTrack(200, 2));
    for (let i = 0; i < 60; i++) game.step(FULL);
    const before = JSON.parse(JSON.stringify(game.getCurrentState())) as VehicleState;
    const t0 = game.simTime;
    game.step(RESET);
    within(game.simTime - t0, FIXED_DT, 1e-12);
    expectStateEquals(game.getPrevState(), before);
  }, 20000);

  it('EDGE9: a reset step keeps already-queued lap events; drainEvents returns detached copies and empties the queue', async () => {
    game = await Game.create(circleTrack(200, 2));
    // Drive until the lap starts WITHOUT draining, so the event sits in the queue when the reset happens.
    let lap = 0;
    for (let i = 0; i < 1200 && lap === 0; i++) {
      game.step(FULL);
      lap = game.getLapInfo().lap;
    }
    expect(lap).toBe(1);
    const tReset = game.simTime;
    game.step(RESET);
    expect(game.getLapInfo().lap).toBe(0); // lapTimer was reset...

    const x = game.drainEvents(); // ...but the queued event survived
    expect(x.length).toBe(1);
    const first = x[0];
    if (!first || first.type !== 'lapStarted') return;
    expect(first.lap).toBe(1);
    const crossTime = first.time;
    expect(crossTime).toBeGreaterThan(0);
    expect(crossTime).toBeLessThanOrEqual(tReset);

    // Drive to a second lap start (after the reset) without draining, then drain again.
    lap = 0;
    for (let i = 0; i < 1200 && lap === 0; i++) {
      game.step(FULL);
      lap = game.getLapInfo().lap;
    }
    expect(lap).toBe(1);
    const y = game.drainEvents();
    expect(y).not.toBe(x);
    expect(y.length).toBe(1);
    const second = y[0];
    if (!second || second.type !== 'lapStarted') return;
    expect(second.lap).toBe(1);
    expect(second.time).toBeGreaterThan(crossTime);
    // x is a detached copy: unaffected by what happened after it was returned.
    expect(x.length).toBe(1);
    expect(first.time).toBe(crossTime);

    expect(game.drainEvents()).toEqual([]);
  }, 30000);

  it('EDGE10: dispose twice is a no-op and step after dispose throws Game disposed', async () => {
    const g = await Game.create(circleTrack(200, 2));
    g.step(IDLE);
    g.dispose();
    expect(() => g.dispose()).not.toThrow();
    expect(() => g.step(IDLE)).toThrow('Game disposed');
  }, 20000);
});
