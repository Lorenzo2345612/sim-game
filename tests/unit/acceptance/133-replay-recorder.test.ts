import { describe, expect, it } from 'vitest';
import { ReplayRecorder, type ReplaySample } from '../../../src/game/replay';
import type { Quat, VehicleState, WheelState } from '../../../src/core/types';

const HZ = 20;
const DT = 1 / 120;
const Q_ID: Quat = { x: 0, y: 0, z: 0, w: 1 };

function makeCar(x: number, q: Quat, speed: number, spin: number): VehicleState {
  const wheel = (i: number): WheelState => ({
    position: { x: i, y: 0, z: 0 },
    steering: 0,
    rotation: spin,
    inContact: true,
  });
  return { position: { x, y: 0, z: 0 }, rotation: q, forwardSpeed: speed, wheels: [wheel(0), wheel(1), wheel(2), wheel(3)] };
}

function emptySample(): ReplaySample {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, speed: 0, steer: 0, wheelSpin: 0 };
}

function yawQuat(deg: number): Quat {
  const half = (deg * Math.PI) / 360;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

type Ctor = new (...args: never[]) => unknown;

function recordCountingConstructions(
  rec: ReplayRecorder,
  states: readonly VehicleState[],
  steers: ArrayLike<number>,
  steps: number,
): number {
  const names = [
    'Array',
    'Object',
    'ArrayBuffer',
    'DataView',
    'Map',
    'Set',
    'Float32Array',
    'Float64Array',
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'Uint8Array',
    'Uint16Array',
    'Uint32Array',
  ];
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: [string, unknown][] = [];
  let constructions = 0;
  for (const name of names) {
    const original = g[name];
    saved.push([name, original]);
    g[name] = new Proxy(original as Ctor, {
      construct(target, args) {
        constructions += 1;
        return Reflect.construct(target, args);
      },
      get(target, prop) {
        if (prop === 'from' || prop === 'of') constructions += 1;
        return Reflect.get(target, prop);
      },
    });
  }
  try {
    let t = 0;
    for (let i = 0; i < steps; i++) {
      t += DT;
      rec.record(t, states, steers);
    }
  } finally {
    for (const [name, original] of saved) g[name] = original;
  }
  return constructions;
}

describe('133 replay recorder acceptance', () => {
  it('AT1: car at x = 10·t recorded for 10 s samples x = 33.5 at t = 3.35 within 1e-3', () => {
    const rec = new ReplayRecorder(1, HZ);
    const states: VehicleState[] = [makeCar(0, Q_ID, 10, 0)];
    const steers = [0];
    for (let i = 0; i <= 1200; i++) {
      const t = i / 120;
      states[0] = makeCar(10 * t, Q_ID, 10, t);
      rec.record(t, states, steers);
    }
    const out = emptySample();
    rec.sampleAt(3.35, 0, out);
    expect(Math.abs(out.x - 33.5)).toBeLessThanOrEqual(1e-3);
  });

  it('AT2: rotating 90°/s about Y sampled mid-frame is within 0.2° of the true angle', () => {
    const rec = new ReplayRecorder(1, HZ);
    const states: VehicleState[] = [makeCar(0, Q_ID, 0, 0)];
    const steers = [0];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      states[0] = makeCar(0, yawQuat(90 * t), 0, 0);
      rec.record(t, states, steers);
    }
    const out = emptySample();
    rec.sampleAt(0.225, 0, out);
    const expected = yawQuat(90 * 0.225);
    const dot = Math.abs(out.qx * expected.x + out.qy * expected.y + out.qz * expected.z + out.qw * expected.w);
    const errDeg = (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    expect(errDeg).toBeLessThanOrEqual(0.2);
  });

  it('AT3: 16 cars × 3600 s allocate at most 32 MB and record() constructs no new arrays', () => {
    const rec = new ReplayRecorder(16, HZ, 3600);
    expect(rec.byteLength).toBeLessThanOrEqual(32 * 2 ** 20);
    const states: VehicleState[] = [];
    for (let car = 0; car < 16; car++) states.push(makeCar(car, Q_ID, 50, 0));
    const steers = new Float32Array(16);
    expect(recordCountingConstructions(rec, states, steers, 2000)).toBe(0);
  });

  it('AT4: sampleAt(0) after recording past maxSeconds returns the oldest kept ring sample without throwing', () => {
    const rec = new ReplayRecorder(1, HZ, 1);
    const states: VehicleState[] = [makeCar(0, Q_ID, 0, 0)];
    const steers = [0];
    for (let k = 0; k <= 60; k++) {
      const t = k / HZ;
      states[0] = makeCar(10 * t, Q_ID, 0, 0);
      rec.record(t, states, steers);
    }
    const out = emptySample();
    rec.sampleAt(0, 0, out);
    expect(out.x).toBeCloseTo(20.5, 3);
  });
});
