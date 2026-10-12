import { describe, it, expect } from 'vitest';
import {
  GhostRecorder,
  ghostAt,
  ghostKey,
  loadGhost,
  saveGhostIfFaster,
  type GhostLap,
  type GhostStorage,
} from '../../../src/game/ghost';
import type { Quat, Vec3 } from '../../../src/core/types';

class MemoryStorage implements GhostStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const SIN_22_5 = Math.sin(Math.PI / 8);
const COS_22_5 = Math.cos(Math.PI / 8);

describe('050 ghost edge cases', () => {
  it('EDGE1: start() clears previous samples and resets accumulated time', () => {
    const recorder = new GhostRecorder('monza');
    recorder.start();
    for (let i = 0; i < 1200; i++) {
      recorder.record(1 / 120, { x: i / 120, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    }
    const first = recorder.finishLap(true, 10);
    if (!first) throw new Error('first lap must be valid');
    expect(first.samples.length).toBeGreaterThan(100);

    recorder.start();
    recorder.record(1 / 120, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    const second = recorder.finishLap(true, 1 / 120);
    if (!second) throw new Error('second lap must be valid');
    expect(second.samples.length).toBeLessThanOrEqual(2);
    expect(second.samples[0][0]).toBeCloseTo(0, 6);
    for (const s of second.samples) expect(s[0]).toBeLessThan(1);
  });

  it('EDGE2: ghostAt clamps t below the first sample to the first sample pose', () => {
    const lap: GhostLap = {
      trackId: 'monza',
      lapTime: 2,
      samples: [
        [1, 10, 1, -1, 0, 0, 0, 1],
        [2, 20, 2, -2, 0, 0, 0, 1],
      ],
    };
    const outPos: Vec3 = { x: -999, y: -999, z: -999 };
    const outRot: Quat = { x: 9, y: 9, z: 9, w: 9 };
    ghostAt(lap, -100, outPos, outRot);
    expect(Math.abs(outPos.x - 10)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.y - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.z - -1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.x - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.y - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.z - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.w - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE3: ghostAt clamps t beyond the last sample to the last sample pose', () => {
    const lap: GhostLap = {
      trackId: 'monza',
      lapTime: 5,
      samples: [
        [0, 0, 0, 0, 0, 0, 0, 1],
        [4.9, 49, 1, -49, 0, 0, 0, 1],
      ],
    };
    const outPos: Vec3 = { x: 0, y: 0, z: 0 };
    const outRot: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(lap, 999, outPos, outRot);
    expect(Math.abs(outPos.x - 49)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.y - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.z - -49)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.w - 1)).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE4: ghostAt nlerp takes the shortest arc when the quaternion dot product is negative', () => {
    // identity vs +270° about Y (dot < 0): shortest arc is -90°, midpoint is -45°
    const lap: GhostLap = {
      trackId: 'monza',
      lapTime: 1,
      samples: [
        [0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 0, 0, 0, Math.SQRT1_2, 0, -Math.SQRT1_2],
      ],
    };
    const outPos: Vec3 = { x: 0, y: 0, z: 0 };
    const outRot: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(lap, 0.5, outPos, outRot);
    expect(Math.abs(outPos.x - 0.5)).toBeLessThanOrEqual(1e-6);
    const sign = outRot.w < 0 ? -1 : 1;
    expect(Math.abs(sign * outRot.x - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(sign * outRot.y - -SIN_22_5)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(sign * outRot.z - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(sign * outRot.w - COS_22_5)).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE5: loadGhost returns null without throwing on corrupt JSON', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), '{not json');
    expect(loadGhost(storage, 'monza')).toBeNull();
  });

  it('EDGE6: loadGhost returns null for a track with nothing stored, even when another track has a ghost', () => {
    const storage = new MemoryStorage();
    const lap: GhostLap = { trackId: 'monza', lapTime: 4.95, samples: [[0, 0, 0, 0, 0, 0, 0, 1]] };
    expect(saveGhostIfFaster(storage, lap)).toBe(true);
    expect(loadGhost(storage, 'monza')).toEqual(lap);
    expect(loadGhost(storage, 'suzuki')).toBeNull();
    expect(loadGhost(new MemoryStorage(), 'monza')).toBeNull();
  });

  it('EDGE7: constructor honours a custom hz for the sampling cadence', () => {
    const recorder = new GhostRecorder('monza', 10);
    recorder.start();
    const dt = 1 / 120;
    for (let i = 0; i < 1200; i++) {
      recorder.record(dt, { x: i * dt, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    }
    const lap = recorder.finishLap(true, 10);
    if (!lap) throw new Error('lap must be valid');
    expect(lap.samples.length).toBeGreaterThanOrEqual(98);
    expect(lap.samples.length).toBeLessThanOrEqual(102);
    const step = lap.samples[1][0] - lap.samples[0][0];
    expect(Math.abs(step - 0.1)).toBeLessThanOrEqual(1e-6);
  });

  it('EDGE8: ghostAt on a single-sample lap returns that pose for any t', () => {
    const lap: GhostLap = {
      trackId: 'monza',
      lapTime: 5,
      samples: [[2.5, 7, 8, 9, 0, 0, 0, 1]],
    };
    const outPos: Vec3 = { x: 0, y: 0, z: 0 };
    const outRot: Quat = { x: 0, y: 0, z: 0, w: 1 };
    for (const t of [-1, 2.5, 99]) {
      ghostAt(lap, t, outPos, outRot);
      expect(Math.abs(outPos.x - 7)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(outPos.y - 8)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(outPos.z - 9)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(outRot.w - 1)).toBeLessThanOrEqual(1e-6);
    }
  });

  it('EDGE9: saveGhostIfFaster stores over a corrupt existing entry', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), 'garbage');
    const lap: GhostLap = { trackId: 'monza', lapTime: 4.95, samples: [[0, 1, 2, 3, 0, 0, 0, 1]] };
    expect(saveGhostIfFaster(storage, lap)).toBe(true);
    expect(loadGhost(storage, 'monza')).toEqual(lap);
  });

  it('EDGE10: recorded samples store the pose passed to record', () => {
    const recorder = new GhostRecorder('monza');
    recorder.start();
    const position: Vec3 = { x: 5, y: 1, z: -2 };
    const rotation: Quat = { x: 0, y: 0.6, z: 0, w: 0.8 };
    for (let i = 0; i < 1200; i++) {
      recorder.record(1 / 120, position, rotation);
    }
    const lap = recorder.finishLap(true, 10);
    if (!lap) throw new Error('lap must be valid');
    expect(lap.samples.length).toBeGreaterThanOrEqual(298);
    expect(lap.samples.length).toBeLessThanOrEqual(302);
    for (const s of lap.samples) {
      expect(Math.abs(s[1] - position.x)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[2] - position.y)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[3] - position.z)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[4] - rotation.x)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[5] - rotation.y)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[6] - rotation.z)).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(s[7] - rotation.w)).toBeLessThanOrEqual(1e-9);
    }
  });
});
