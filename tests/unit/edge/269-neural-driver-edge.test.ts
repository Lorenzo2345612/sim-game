import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import {
  N_HID,
  N_IN,
  N_OUT,
  N_W,
  parseNeuralModel,
} from '../../../src/ai/neuralPolicy';
import { NeuralFeatures, type NeuralCarState } from '../../../src/ai/neuralFeatures';
import { NeuralDriver } from '../../../src/ai/neuralDriver';
import { RaceGame, type RaceConfig, type RaceGameOptions } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const BRAKE: DriverInput = { throttle: 0, brake: 1, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function makeState(over: Partial<NeuralCarState> = {}): NeuralCarState {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    forwardSpeed: 0,
    linvel: { x: 0, y: 0, z: 0 },
    angvel: { x: 0, y: 0, z: 0 },
    progress: { index: 0, distance: 0, lateral: 0 },
    fuelMassKg: 0,
    tempFrontC: 90,
    tempRearC: 90,
    optTempC: 90,
    tempWindowC: 20,
    wearMean: 0,
    offWheels: 0,
    compoundGrip: 0,
    others: [],
    ...over,
  };
}

function stubFeatures(f: (out: Float64Array, s: NeuralCarState) => void): NeuralFeatures {
  return { fill: f } as unknown as NeuralFeatures;
}

describe('269 neural driver edge cases', () => {
  it('EDGE1: parseNeuralModel pads a paddable shorter genome (nIn 34) and throws on shorter non-paddable lengths', () => {
    const nInOld = 34;
    const lenOld = nInOld * N_HID + N_HID + N_HID * N_OUT + N_OUT;
    expect(lenOld).toBe(594);
    const old = new Float64Array(lenOld);
    for (let i = 0; i < lenOld; i++) old[i] = ((i * 11) % 13 - 6) / 30;
    const padded = parseNeuralModel({ weights: Array.from(old) });
    expect(padded.length).toBe(N_W);
    for (let h = 0; h < N_HID; h++) {
      for (let i = 0; i < nInOld; i++) expect(padded[h * N_IN + i]).toBe(old[h * nInOld + i]);
      expect(padded[h * N_IN + nInOld]).toBe(0);
    }
    const tailOld = nInOld * N_HID;
    const tail = N_IN * N_HID;
    for (let i = 0; i < N_HID + N_HID * N_OUT + N_OUT; i++) expect(padded[tail + i]).toBe(old[tailOld + i]);

    for (const bad of [600, 609]) {
      expect(() => parseNeuralModel({ weights: new Array<number>(bad).fill(0) }), `len ${bad}`).toThrow(
        /Invalid neural model/,
      );
    }
  });

  it('EDGE2: parseNeuralModel throws Invalid neural model on missing or non-array weights', () => {
    expect(() => parseNeuralModel({})).toThrow(/Invalid neural model/);
    expect(() => parseNeuralModel({ weights: null })).toThrow(/Invalid neural model/);
    expect(() => parseNeuralModel({ weights: 'nope' })).toThrow(/Invalid neural model/);
  });

  it('EDGE3: decide holds the last evaluated outputs across state changes on non-evaluation steps', () => {
    const w = new Float64Array(N_W);
    w[0] = 1; // x[0] -> hid[0]
    w[N_IN * N_HID + N_HID] = 1; // hid[0] -> out[0]
    const driver = new NeuralDriver(
      w,
      stubFeatures((out, s) => {
        out.fill(0);
        out[0] = s.forwardSpeed / 60;
      }),
    );
    const s = makeState();
    const steerOf = (fs: number): number => Math.tanh(Math.tanh(fs / 60));
    s.forwardSpeed = 12;
    const d0 = { ...driver.decide(0, s) };
    expect(d0.steer).toBeCloseTo(steerOf(12), 12);
    expect(d0.throttle).toBe(0);
    expect(d0.brake).toBe(0);
    s.forwardSpeed = 1000;
    for (const step of [1, 2, 3]) {
      const d = { ...driver.decide(step, s) };
      expect(d.steer, `step ${step} steer`).toBeCloseTo(steerOf(12), 12);
      expect(d.throttle, `step ${step} throttle`).toBe(0);
      expect(d.brake, `step ${step} brake`).toBe(0);
    }
    s.forwardSpeed = 24;
    const d4 = { ...driver.decide(4, s) };
    expect(d4.steer).toBeCloseTo(steerOf(24), 12);
    expect(Math.abs(d4.steer - d0.steer)).toBeGreaterThan(1e-3);
    s.forwardSpeed = -50;
    const d5 = { ...driver.decide(5, s) };
    expect(d5.steer).toBeCloseTo(steerOf(24), 12);
  });

  it('EDGE4: decide maps outputs as steer = out[0], throttle = max(out[1], 0), brake = max(-out[1], 0)', () => {
    const features = stubFeatures((out) => out.fill(0));
    const s = makeState();
    const wA = new Float64Array(N_W);
    wA[N_W - 2] = 0.5;
    wA[N_W - 1] = 0.8;
    const a = new NeuralDriver(wA, features).decide(0, s);
    expect(a.steer).toBeCloseTo(Math.tanh(0.5), 12);
    expect(a.throttle).toBeCloseTo(Math.tanh(0.8), 12);
    expect(a.brake).toBe(0);

    const wB = new Float64Array(N_W);
    wB[N_W - 1] = -0.8;
    const b = new NeuralDriver(wB, features).decide(0, s);
    expect(b.steer).toBe(0);
    expect(b.throttle).toBe(0);
    expect(b.brake).toBeCloseTo(Math.tanh(0.8), 12);
  });

  it('EDGE5: fill writes speed, edge, yaw, bias, fuel and grip slots with the documented scalings', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    feats.fill(
      out,
      makeState({
        forwardSpeed: 30,
        angvel: { x: 0, y: 3, z: 0 },
        fuelMassKg: 40,
        compoundGrip: 0.5,
        progress: { index: 0, distance: 0, lateral: 2 },
      }),
    );
    expect(out[0]).toBeCloseTo(0.5, 12);
    expect(out[16]).toBeCloseTo(1.0, 12); // (hwR 12 - lateral 2) / 10
    expect(out[17]).toBeCloseTo(1.0, 12); // (hwL 8 + lateral 2) / 10
    expect(out[18]).toBeCloseTo(1.5, 12); // angvel.y / 2
    expect(out[19]).toBeCloseTo(0, 12); // |forward component| <= 2
    expect(out[20]).toBe(1); // bias
    expect(out[21]).toBeCloseTo(1.6, 12); // fuelMassKg / 25
    expect(out[22]).toBeCloseTo(5, 12); // compoundGrip * 10

    feats.fill(out, makeState({ progress: { index: 0, distance: 0, lateral: -3 } }));
    expect(out[16]).toBeCloseTo(1.5, 12); // (12 - (-3)) / 10
    expect(out[17]).toBeCloseTo(0.5, 12); // (8 + (-3)) / 10
  });

  it('EDGE6: speed-profile cues cap vProf at 90 m/s and clamp the overspeed cues to [-3, 3]', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    feats.fill(out, makeState({ forwardSpeed: 0 }));
    expect(out[13]).toBeCloseTo(-3, 12); // clamp((0 - 90) / 10)
    expect(out[14]).toBeCloseTo(-3, 12); // same vs the profile 30 m ahead
    expect(out[15]).toBeCloseTo(1.5, 12); // 90 / 60 on a zero-curvature straight
    feats.fill(out, makeState({ forwardSpeed: 100 }));
    expect(out[13]).toBeCloseTo(1, 12);
    expect(out[14]).toBeCloseTo(1, 12);
    feats.fill(out, makeState({ forwardSpeed: 130 }));
    expect(out[13]).toBeCloseTo(3, 12);
    expect(out[14]).toBeCloseTo(3, 12);
    expect(out[15]).toBeCloseTo(1.5, 12);
  });

  it('EDGE7: traffic sensor keeps the nearest 4 others within 60 m (inclusive), ordered and scaled, zero-filling the rest', () => {
    const feats = new NeuralFeatures(STRAIGHT, HW_L8, HW_R12);
    const out = new Float64Array(N_IN);
    feats.fill(out, makeState({ others: [other(0, -60)] }));
    expect(out[23]).toBeCloseTo(1.2, 12); // exactly 60 m ahead: 60 / 50
    expect(out[24]).toBeCloseTo(0, 12);
    expect(out[25]).toBeCloseTo(0, 12);
    for (let i = 26; i < N_IN; i++) expect(out[i], `slot ${i}`).toBeCloseTo(0, 12);

    feats.fill(out, makeState({ others: [other(0, -60.0001)] }));
    for (let i = 23; i < N_IN; i++) expect(out[i], `beyond 60 m slot ${i}`).toBeCloseTo(0, 12);

    feats.fill(
      out,
      makeState({
        others: [
          other(0, -10, { x: 0, y: 0, z: -5 }),
          other(4, -20),
          other(0, -30),
          other(0, -40),
          other(0, -50), // fifth car: dropped
        ],
      }),
    );
    const expected = [
      0.2, 0, -0.25, // 10 m ahead; closing (0 - 5) / 20
      0.4, 0.4, 0, // 20 m ahead, 4 m right
      0.6, 0, 0,
      0.8, 0, 0,
    ];
    for (let i = 0; i < 12; i++) expect(out[23 + i], `nearest slot ${i}`).toBeCloseTo(expected[i], 12);
  });

  it('EDGE8: fill mutates only out, never the state, others or the track arrays', () => {
    const centerline = STRAIGHT.map(([x, z]): [number, number] => [x, z]);
    const hwL = HW_L8.slice();
    const hwR = HW_R12.slice();
    const feats = new NeuralFeatures(centerline, hwL, hwR);
    const out = new Float64Array(N_IN);
    const s = makeState({
      forwardSpeed: 25,
      fuelMassKg: 30,
      compoundGrip: 0.2,
      progress: { index: 2, distance: 20, lateral: 1 },
      others: [other(3, -12, { x: 1, y: 0, z: -2 })],
    });
    const snapState = JSON.stringify(s);
    const snapCl = JSON.stringify(centerline);
    const snapL = JSON.stringify(hwL);
    const snapR = JSON.stringify(hwR);
    feats.fill(out, s);
    expect(JSON.stringify(s)).toBe(snapState);
    expect(JSON.stringify(centerline)).toBe(snapCl);
    expect(JSON.stringify(hwL)).toBe(snapL);
    expect(JSON.stringify(hwR)).toBe(snapR);
  });

  it('EDGE9: default aiDriver is classic and ignores a provided neural model; neural diverges when selected', async () => {
    const expert = parseNeuralModel(readJson('public/ai-models/monza-f4/expert.json'));
    const config: RaceConfig = {
      trackId: 'monza',
      carId: 'f4',
      laps: 3,
      aiCount: 1,
      difficulty: 'expert',
      seed: 3,
    };
    const classic = await aiFinalPosition(config, 10);
    const deflt = await aiFinalPosition(config, 10, { neuralModels: { expert } });
    const neural = await aiFinalPosition(config, 10, { aiDriver: 'neural', neuralModels: { expert } });
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(deflt[axis] - classic[axis]), `default vs classic ${axis}`).toBeLessThanOrEqual(1e-9);
    }
    const dx = neural.x - classic.x;
    const dy = neural.y - classic.y;
    const dz = neural.z - classic.z;
    expect(Math.hypot(dx, dy, dz), 'neural vs classic distance').toBeGreaterThan(0.1);
  }, 120_000);

  it('EDGE10: look-ahead angles wrap past the start line instead of clamping at the last centerline point', () => {
    const feats = new NeuralFeatures(RECT, RECT_HW_L, RECT_HW_R);
    const out = new Float64Array(N_IN);
    const SQRT1_2 = Math.SQRT1_2;
    feats.fill(
      out,
      makeState({
        position: { x: 5, y: 0, z: 0 },
        rotation: { x: 0, y: SQRT1_2, z: 0, w: SQRT1_2 }, // forward -X along the closing side
        progress: { index: 59, distance: 595, lateral: 0 },
      }),
    );
    expect(out[1]).toBeCloseTo(0, 12); // +5 m wraps onto the start point, straight ahead
    expect(out[2]).toBeCloseTo(0.25, 12); // +10 m wraps to s=5: the first side turns right
    expect(out[3]).toBeCloseTo(Math.atan2(15, 5) / Math.PI, 12);
    expect(out[9]).toBeCloseTo(Math.atan2(195, 5) / Math.PI, 12);
  });
});

// 200 m x 100 m rectangle, 60 points every 10 m; side 4 runs from (10, 0) to the start (0, 0).
const RECT: [number, number][] = [];
for (let k = 0; k <= 20; k++) RECT.push([0, -10 * k]);
for (let k = 1; k <= 10; k++) RECT.push([10 * k, -200]);
for (let k = 1; k <= 20; k++) RECT.push([100, -200 + 10 * k]);
for (let k = 1; k <= 9; k++) RECT.push([100 - 10 * k, 0]);
const RECT_HW_L: number[] = new Array(RECT.length).fill(8);
const RECT_HW_R: number[] = new Array(RECT.length).fill(12);

async function aiFinalPosition(
  config: RaceConfig,
  seconds: number,
  options?: RaceGameOptions,
): Promise<{ x: number; y: number; z: number }> {
  const track = parseTrackData(readJson(`public/tracks/${config.trackId}.json`)) as TrackDataV2;
  const spec: CarSpec = parseCarSpec(readJson(`public/cars/${config.carId}.json`));
  const game = await RaceGame.create(track, spec, config, options);
  const buf = Array.from({ length: game.carCount }, () => createVehicleState(4));
  try {
    const n = Math.round(seconds / FIXED_DT);
    for (let i = 0; i < n; i++) game.step(BRAKE);
    game.getStates(buf);
    return { ...buf[1].position };
  } finally {
    game.dispose();
  }
}

// Straight 200 m centerline along -Z (identity rotation faces -Z), closed under pointAt wrap.
const STRAIGHT: [number, number][] = Array.from({ length: 21 }, (_, i): [number, number] => [0, -10 * i]);
const HW_L8: number[] = new Array(21).fill(8);
const HW_R12: number[] = new Array(21).fill(12);

function other(
  x: number,
  z: number,
  linvel: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
): { position: { x: number; y: number; z: number }; linvel: { x: number; y: number; z: number } } {
  return { position: { x, y: 0, z }, linvel };
}
