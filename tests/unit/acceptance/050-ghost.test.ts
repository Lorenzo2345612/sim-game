import { describe, it, expect } from 'vitest';
import {
  GHOST_HZ,
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

function pose(t: number): { position: Vec3; rotation: Quat } {
  return {
    position: { x: t, y: 0, z: -t },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };
}

describe('050 best-lap ghost recording and replay acceptance', () => {
  it('AT1: 10 s valid lap recorded at 30 Hz finishes with 300 ±2 samples of [t, x, y, z, qx, qy, qz, qw]', () => {
    const recorder = new GhostRecorder('monza');
    recorder.start();
    const dt = 1 / 120;
    for (let i = 0; i < 1200; i++) {
      const p = pose(i * dt);
      recorder.record(dt, p.position, p.rotation);
    }
    const lap = recorder.finishLap(true, 10);
    if (!lap) throw new Error('finishLap(true) must return a lap');
    expect(lap.trackId).toBe('monza');
    expect(lap.lapTime).toBe(10);
    expect(lap.samples.length).toBeGreaterThanOrEqual(298);
    expect(lap.samples.length).toBeLessThanOrEqual(302);
    expect(lap.samples[0][0]).toBeCloseTo(0, 6);
    const step = lap.samples[1][0] - lap.samples[0][0];
    expect(Math.abs(step - 1 / GHOST_HZ)).toBeLessThanOrEqual(1e-6);
    for (const sample of lap.samples) {
      expect(sample).toHaveLength(8);
      for (const v of sample) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('AT2: finishLap on an invalid lap returns null, so no ghost lap is stored', () => {
    const recorder = new GhostRecorder('monza');
    recorder.start();
    const p = pose(1);
    recorder.record(1 / 120, p.position, p.rotation);
    expect(recorder.finishLap(false, 10)).toBeNull();
  });

  it('AT3: ghostAt(4.95) on a 4.95 s best-lap ghost gives the pose interpolated between the neighbouring samples within 1e-6', () => {
    const lap: GhostLap = {
      trackId: 'monza',
      lapTime: 4.95,
      samples: [
        [0, 0, 0, 0, 0, 0, 0, 1],
        [4.9, 49, 1, -49, 0, 0, 0, 1],
        [5, 50, 1, -50, 0, Math.SQRT1_2, 0, Math.SQRT1_2],
      ],
    };
    const outPos: Vec3 = { x: 0, y: 0, z: 0 };
    const outRot: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(lap, 4.95, outPos, outRot);
    expect(Math.abs(outPos.x - 49.5)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.y - 1)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outPos.z - -49.5)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.x - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.y - Math.sin(Math.PI / 8))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.z - 0)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(outRot.w - Math.cos(Math.PI / 8))).toBeLessThanOrEqual(1e-6);
  });

  it('AT4: save/load round trips under ghost:<trackId> and the stored ghost is replaced only by a faster lap', () => {
    expect(ghostKey('monza')).toBe('ghost:monza');
    const storage = new MemoryStorage();
    const best: GhostLap = {
      trackId: 'monza',
      lapTime: 4.95,
      samples: [
        [0, 0, 0, 0, 0, 0, 0, 1],
        [4.95, 1, 2, 3, 0, 0, 0, 1],
      ],
    };
    expect(saveGhostIfFaster(storage, best)).toBe(true);
    const raw = storage.getItem(ghostKey('monza'));
    if (raw === null) throw new Error('nothing stored under ghost:<trackId>');
    expect(JSON.parse(raw)).toEqual(best);
    expect(loadGhost(storage, 'monza')).toEqual(best);

    const equalTime: GhostLap = { ...best, lapTime: 4.95, samples: [[0, 9, 9, 9, 0, 0, 0, 1]] };
    expect(saveGhostIfFaster(storage, equalTime)).toBe(false);
    expect(loadGhost(storage, 'monza')).toEqual(best);

    const slower: GhostLap = { ...best, lapTime: 5.5 };
    expect(saveGhostIfFaster(storage, slower)).toBe(false);
    expect(loadGhost(storage, 'monza')).toEqual(best);

    const faster: GhostLap = { ...best, lapTime: 4.5 };
    expect(saveGhostIfFaster(storage, faster)).toBe(true);
    expect(loadGhost(storage, 'monza')).toEqual(faster);
  });
});
