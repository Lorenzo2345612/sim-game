import { describe, it, expect } from 'vitest';
import {
  TelemetryRecorder,
  deltaTrace,
  loadTelemetry,
  saveIfBest,
  telemetryKey,
  type Channel,
  type LapTelemetry,
  type TelemetryValues,
} from '../../../src/game/telemetry';
import type { GhostStorage } from '../../../src/game/ghost';

const TRACK = 'monza';
const CAR = 'f4';
const LAP_LENGTH = 1000;
const DT = 1 / 120;
const SAMPLES = 500; // floor(1000 / 2)

const CHANNEL_NAMES: readonly Channel[] = [
  'time', 'speed', 'throttle', 'brake', 'steer', 'gear', 'rpm', 'latG', 'x', 'z',
];

class MemoryStorage implements GhostStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function recordLap(speed: number, lapTime: number): LapTelemetry {
  const recorder = new TelemetryRecorder(TRACK, CAR, LAP_LENGTH);
  recorder.start();
  const step = speed * DT;
  const ticks = Math.ceil(LAP_LENGTH / step);
  for (let i = 0; i <= ticks; i++) {
    const distance = i * step;
    const v: TelemetryValues = {
      speed, throttle: 1, brake: 0, steer: 0, gear: 6, rpm: 9000, latG: 0,
      x: distance, z: -distance,
    };
    recorder.record(distance, i * DT, v);
  }
  const lap = recorder.finishLap(true, lapTime);
  if (!lap) throw new Error('finishLap(true) must return a lap');
  return lap;
}

describe('131 telemetry recorder and store acceptance', () => {
  it('AT1: constant 50 m/s for a 1000 m lap gives 500 samples, speed all 50 ± 1e-4 and time at sample k = 2k/50 ± 1e-3', () => {
    const lap = recordLap(50, 20);
    for (const ch of CHANNEL_NAMES) expect(lap.channels[ch].length).toBe(SAMPLES);
    for (const s of lap.channels.speed) expect(Math.abs(s - 50)).toBeLessThanOrEqual(1e-4);
    for (let k = 0; k < SAMPLES; k++) {
      expect(Math.abs(lap.channels.time[k] - (2 * k) / 50)).toBeLessThanOrEqual(1e-3);
    }
  });

  it('AT2: deltaTrace of the 0.9×-speed lap against the base lap ends at lapTime B − lapTime A ± 0.01', () => {
    const lapA = recordLap(50, 20);
    const lapB = recordLap(45, LAP_LENGTH / 45);
    const delta = deltaTrace(lapB, lapA);
    const last = delta[delta.length - 1];
    expect(Math.abs(last - (lapB.lapTime - lapA.lapTime))).toBeLessThanOrEqual(0.01);
  });

  it('AT3: save then load round-trips channels within float32 precision (≤ 1e-6 relative)', () => {
    const storage = new MemoryStorage();
    const lap = recordLap(50, 20);
    expect(telemetryKey(TRACK, CAR)).toBe('telemetry:monza:f4');
    expect(saveIfBest(storage, lap)).toBe(true);
    const loaded = loadTelemetry(storage, TRACK, CAR);
    if (!loaded) throw new Error('loadTelemetry must return the saved lap');
    expect(loaded.trackId).toBe(TRACK);
    expect(loaded.carId).toBe(CAR);
    expect(loaded.lapTime).toBe(lap.lapTime);
    expect(loaded.spacing).toBe(lap.spacing);
    for (const ch of CHANNEL_NAMES) {
      const a = lap.channels[ch];
      const b = loaded.channels[ch];
      expect(b.length).toBe(a.length);
      for (let i = 0; i < a.length; i++) {
        expect(Math.abs(b[i] - a[i])).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(a[i])));
      }
    }
  });

  it('AT4: saving a slower lap or an invalid lap returns false and the stored lap stays unchanged', () => {
    const storage = new MemoryStorage();
    const best = recordLap(50, 20);
    expect(saveIfBest(storage, best)).toBe(true);
    const key = telemetryKey(TRACK, CAR);
    const stored = storage.getItem(key);
    if (stored === null) throw new Error('best lap not stored under telemetry:<track>:<car>');

    expect(saveIfBest(storage, recordLap(45, LAP_LENGTH / 45))).toBe(false);
    expect(storage.getItem(key)).toBe(stored);

    const invalid = new TelemetryRecorder(TRACK, CAR, LAP_LENGTH);
    invalid.start();
    expect(saveIfBest(storage, invalid.finishLap(false, 15))).toBe(false);
    expect(storage.getItem(key)).toBe(stored);
  });
});
