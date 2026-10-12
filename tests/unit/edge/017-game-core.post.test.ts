import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { DriverInput, Quat, TrackData, VehicleState } from '../../../src/core/types';
import { FIXED_DT } from '../../../src/core/constants';
import {
  lerpVec3,
  slerpQuat,
  createVehicleState,
  interpolateVehicleState,
} from '../../../src/core/interpolation';
import { Game } from '../../../src/game/game';
import { initPhysics } from '../../../src/physics/physicsWorld';

const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const D2R = Math.PI / 180;

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

function within(a: number, b: number, tol: number): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

function quatEq(a: Quat, b: Quat, tol: number): void {
  within(a.x, b.x, tol);
  within(a.y, b.y, tol);
  within(a.z, b.z, tol);
  within(a.w, b.w, tol);
}

function quatNorm(q: Quat): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

function stateEq(a: VehicleState, b: VehicleState, tol = 1e-12): void {
  within(a.position.x, b.position.x, tol);
  within(a.position.y, b.position.y, tol);
  within(a.position.z, b.position.z, tol);
  quatEq(a.rotation, b.rotation, tol);
  within(a.forwardSpeed, b.forwardSpeed, tol);
  expect(a.wheels.length).toBe(b.wheels.length);
  for (let i = 0; i < a.wheels.length; i++) {
    within(a.wheels[i].position.x, b.wheels[i].position.x, tol);
    within(a.wheels[i].position.y, b.wheels[i].position.y, tol);
    within(a.wheels[i].position.z, b.wheels[i].position.z, tol);
    within(a.wheels[i].steering, b.wheels[i].steering, tol);
    within(a.wheels[i].rotation, b.wheels[i].rotation, tol);
    expect(a.wheels[i].inContact).toBe(b.wheels[i].inContact);
  }
}

function cloneState(s: VehicleState): VehicleState {
  return JSON.parse(JSON.stringify(s)) as VehicleState;
}

function samplePrev(): VehicleState {
  return {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 20,
    wheels: [
      { position: { x: 0, y: 0, z: 0 }, steering: 0.4, rotation: 6.2, inContact: true },
      { position: { x: 1, y: 1, z: 1 }, steering: -1, rotation: 0, inContact: false },
    ],
  };
}

function sampleCurr(): VehicleState {
  return {
    position: { x: 5, y: -7, z: -2 },
    rotation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    forwardSpeed: -5,
    wheels: [
      { position: { x: 4, y: 4, z: 4 }, steering: -0.2, rotation: 0.1, inContact: false },
      { position: { x: 2, y: 2, z: 2 }, steering: 0.6, rotation: 3, inContact: true },
    ],
  };
}

describe('017 interpolation post-code gaps', () => {
  it('POST1: slerpQuat is safe when out aliases a, b or both, in the arc and nlerp branches', () => {
    const ux = 1 / 3, uy = -2 / 3, uz = 2 / 3;
    const qAt = (deg: number): Quat => ({
      x: ux * Math.sin(deg * D2R),
      y: uy * Math.sin(deg * D2R),
      z: uz * Math.sin(deg * D2R),
      w: Math.cos(deg * D2R),
    });
    const a = qAt(30);
    const b = qAt(140); // d < 0: exercises the flip + arc branch
    const ref: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(a, b, 0.35, ref);

    const a1 = { ...a };
    slerpQuat(a1, b, 0.35, a1); // out === a
    quatEq(a1, ref, 1e-12);

    const b1 = { ...b };
    slerpQuat(a, b1, 0.35, b1); // out === b (b is read before writing)
    quatEq(b1, ref, 1e-12);

    const near = qAt(0.2); // 0.4 deg apart: nlerp branch
    const a2 = { ...a };
    const refNear: Quat = { x: 0, y: 0, z: 0, w: 0 };
    slerpQuat(a, near, 0.5, refNear);
    slerpQuat(a2, near, 0.5, a2);
    quatEq(a2, refNear, 1e-12);

    const same = qAt(25);
    slerpQuat(same, same, 0.4, same); // out === a === b
    within(quatNorm(same), 1, 1e-9);
    quatEq(same, qAt(25), 1e-9);

    const v = { x: 1, y: 1, z: 1 };
    lerpVec3(v, { x: 3, y: -1, z: 0 }, 0.5, v); // out === a for vectors, sanity
    within(v.x, 2, 1e-12);
    within(v.y, 0, 1e-12);
    within(v.z, 0.5, 1e-12);
  });

  it('POST2: interpolateVehicleState returns out and is correct when out aliases prev', () => {
    const prev = samplePrev();
    const curr = sampleCurr();

    const fresh = createVehicleState(2);
    const ret = interpolateVehicleState(prev, curr, 0.35, fresh);
    expect(ret).toBe(fresh);

    const aliased = cloneState(prev);
    const aliasedRet = interpolateVehicleState(aliased, curr, 0.35, aliased);
    expect(aliasedRet).toBe(aliased);
    stateEq(aliased, fresh);

    // t=1 in place collapses prev onto curr exactly
    const p2 = cloneState(prev);
    interpolateVehicleState(p2, curr, 1, p2);
    stateEq(p2, curr);
    // t=0 in place keeps prev values but takes inContact from curr
    const p3 = cloneState(prev);
    interpolateVehicleState(p3, curr, 0, p3);
    within(p3.position.x, prev.position.x, 1e-12);
    within(p3.forwardSpeed, prev.forwardSpeed, 1e-12);
    for (let i = 0; i < 2; i++) {
      within(p3.wheels[i].position.x, prev.wheels[i].position.x, 1e-12);
      within(p3.wheels[i].steering, prev.wheels[i].steering, 1e-12);
      within(p3.wheels[i].rotation, prev.wheels[i].rotation, 1e-12);
      expect(p3.wheels[i].inContact).toBe(curr.wheels[i].inContact);
    }
  });

  it('POST3: interpolateVehicleState composes with Game-style reused buffers without mutating inputs', () => {
    const prev = samplePrev();
    const curr = sampleCurr();
    const prevJson = JSON.stringify(prev);
    const currJson = JSON.stringify(curr);
    const out = createVehicleState(2);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      interpolateVehicleState(prev, curr, t, out);
    }
    expect(JSON.stringify(prev)).toBe(prevJson);
    expect(JSON.stringify(curr)).toBe(currJson);
    const at1 = createVehicleState(2);
    interpolateVehicleState(prev, curr, 1, at1);
    stateEq(out, at1); // last reused-out call equals a fresh-buffer call
  });
});

describe('017 game post-code gaps', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('POST4: step reuses the prev/current state buffers across calls (no per-step allocation)', async () => {
    game = await Game.create(circleTrack(200, 2));
    const prev0 = game.getPrevState();
    const cur0 = game.getCurrentState();
    const pos0 = cur0.position;
    const rot0 = cur0.rotation;
    const wheels0 = cur0.wheels;
    const wheelPos0 = cur0.wheels[0].position;
    for (let i = 0; i < 30; i++) game.step(FULL);
    expect(game.getPrevState()).toBe(prev0);
    expect(game.getCurrentState()).toBe(cur0);
    expect(cur0.position).toBe(pos0);
    expect(cur0.rotation).toBe(rot0);
    expect(cur0.wheels).toBe(wheels0);
    expect(cur0.wheels[0].position).toBe(wheelPos0);
    expect(game.simTime).toBeGreaterThan(0);
  }, 20000);

  it('POST5: getLapInfo.currentLapTime becomes non-null when lap 1 starts and tracks simTime', async () => {
    game = await Game.create(circleTrack(200, 2));
    let started = -1;
    for (let i = 0; i < 1200 && started < 0; i++) {
      game.step(FULL);
      if (game.getLapInfo().lap === 1) started = i;
    }
    expect(started).toBeGreaterThanOrEqual(0);

    const cross = game.drainEvents().find((e) => e.type === 'lapStarted');
    expect(cross).toBeDefined();
    if (!cross || cross.type !== 'lapStarted') return;
    const info = game.getLapInfo();
    expect(info.lap).toBe(1);
    expect(info.currentLapTime).not.toBeNull();
    if (info.currentLapTime === null) return;
    within(info.currentLapTime, game.simTime - cross.time, 1e-12);
    expect(info.lastLapTime).toBeNull();
    expect(info.bestLapTime).toBeNull();

    for (let i = 0; i < 60; i++) game.step(FULL);
    const later = game.getLapInfo().currentLapTime;
    expect(later).not.toBeNull();
    if (later === null) return;
    within(later - info.currentLapTime, 60 * FIXED_DT, 1e-9);
    within(later, game.simTime - cross.time, 1e-12);
  }, 30000);

  it('POST6: after dispose the getters keep returning the last state and only step throws', async () => {
    const g = await Game.create(circleTrack(200, 2));
    for (let i = 0; i < 10; i++) g.step(FULL);
    const snapshot = cloneState(g.getCurrentState());
    const sim = g.simTime;
    g.dispose();
    expect(() => g.getPrevState()).not.toThrow();
    expect(() => g.getCurrentState()).not.toThrow();
    expect(() => g.getLapInfo()).not.toThrow();
    expect(() => g.drainEvents()).not.toThrow();
    stateEq(g.getCurrentState(), snapshot, 1e-12);
    expect(g.simTime).toBe(sim);
    g.dispose(); // second dispose still a no-op on this path too
  }, 20000);
});
