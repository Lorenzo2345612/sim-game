import { describe, it, expect } from 'vitest';
import {
  GHOST_HZ,
  GhostRecorder,
  ghostAt,
  ghostKey,
  loadGhost,
  saveGhostIfFaster,
  type GhostLap,
  type GhostSample,
  type GhostStorage,
} from '../../../src/game/ghost';
import type { Quat, Vec3 } from '../../../src/core/types';

class MemoryStorage implements GhostStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

const IDENTITY: GhostSample = [0, 0, 0, 0, 0, 0, 0, 1];

function lap(samples: GhostSample[], lapTime = 1): GhostLap {
  return { trackId: 'monza', lapTime, samples };
}

function recordSeconds(recorder: GhostRecorder, seconds: number, dt = 1 / 120): void {
  for (let i = 0; i * dt < seconds - 1e-9; i++) {
    recorder.record(dt, { x: i * dt, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
  }
}

describe('ghost recorder edges', () => {
  it('first sample is at t = 0 regardless of first dt', () => {
    const r = new GhostRecorder('monza', 10);
    r.start();
    r.record(0.25, { x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: 0, w: 1 });
    const l = r.finishLap(true, 1);
    expect(l?.samples[0][0]).toBe(0);
    expect(l?.samples[0].slice(1, 4)).toEqual([1, 2, 3]);
  });

  it('custom hz changes the sampling rate', () => {
    const r = new GhostRecorder('monza', 10);
    r.start();
    recordSeconds(r, 2);
    const l = r.finishLap(true, 2);
    expect(l?.samples.length).toBeGreaterThanOrEqual(18);
    expect(l?.samples.length).toBeLessThanOrEqual(22);
  });

  it('samples by accumulated time, not per call (irregular dt)', () => {
    const r = new GhostRecorder('monza'); // 30 Hz
    r.start();
    r.record(0.5, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }); // covers t in [0, 0.5)
    const l = r.finishLap(true, 0.5);
    // one sample at t=0; next boundary 1/30 was crossed inside the single call but only one sample per call
    expect(l?.samples.length).toBe(1);
  });

  it('samples every 1/hz of accumulated time across many calls', () => {
    const r = new GhostRecorder('monza', 20);
    r.start();
    recordSeconds(r, 1);
    const l = r.finishLap(true, 1);
    expect(l?.samples.length).toBeGreaterThanOrEqual(19);
    expect(l?.samples.length).toBeLessThanOrEqual(21);
    expect(l?.samples[1][0]).toBeCloseTo(1 / 20, 6);
  });

  it('finishLap returns a snapshot unaffected by a later start()', () => {
    const r = new GhostRecorder('monza', 10);
    r.start();
    recordSeconds(r, 1);
    const l = r.finishLap(true, 1);
    const count = l?.samples.length ?? 0;
    r.start();
    r.record(1 / 30, { x: 9, y: 9, z: 9 }, { x: 0, y: 0, z: 0, w: 1 });
    expect(l?.samples.length).toBe(count);
    expect(l?.samples.length).toBeGreaterThan(0);
  });

  it('default hz is GHOST_HZ', () => {
    const r = new GhostRecorder('monza');
    r.start();
    recordSeconds(r, 1);
    expect(r.finishLap(true, 1)?.samples.length).toBeGreaterThanOrEqual(GHOST_HZ - 1);
  });
});

describe('ghostAt edges', () => {
  it('clamps t before the first sample', () => {
    const l = lap([[1, 10, 0, 0, 0, 0, 0, 1], [2, 20, 0, 0, 0, 0, 0, 1]]);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(l, -5, p, q);
    expect(p).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('clamps t after the last sample', () => {
    const l = lap([[1, 10, 0, 0, 0, 0, 0, 1], [2, 20, 0, 0, 0, 0, 0, 1]]);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(l, 99, p, q);
    expect(p).toEqual({ x: 20, y: 0, z: 0 });
  });

  it('single-sample lap returns that pose', () => {
    const l = lap([[0.5, 3, 4, 5, 0, 0, 0, 1]]);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(l, 0.25, p, q);
    expect(p).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('nlerp takes the shortest arc across the q/-q seam', () => {
    // (0,-s,0,-s) is the same rotation as +90° about Y but in the opposite hemisphere of identity
    const s = Math.SQRT1_2;
    const l = lap([
      [0, 0, 0, 0, 0, 0, 0, 1],
      [1, 0, 0, 0, 0, -s, 0, -s],
    ]);
    const p: Vec3 = { x: 0, y: 0, z: 0 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(l, 0.5, p, q);
    if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
    // halfway on the short arc is +45° about Y, not the long-way -67.5°
    expect(Math.abs(q.y - Math.sin(Math.PI / 8))).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(q.w - Math.cos(Math.PI / 8))).toBeLessThanOrEqual(1e-6);
  });

  it('empty samples leave outputs untouched', () => {
    const l = lap([]);
    const p: Vec3 = { x: 7, y: 8, z: 9 };
    const q: Quat = { x: 0, y: 0, z: 0, w: 1 };
    ghostAt(l, 0.5, p, q);
    expect(p).toEqual({ x: 7, y: 8, z: 9 });
  });
});

describe('storage edges', () => {
  it('loadGhost returns null for a missing key', () => {
    expect(loadGhost(new MemoryStorage(), 'monza')).toBeNull();
    expect(ghostKey('spa')).toBe('ghost:spa');
  });

  it('loadGhost returns null for corrupt JSON without throwing', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), '{not json');
    expect(loadGhost(storage, 'monza')).toBeNull();
  });

  it('loadGhost returns null for valid JSON of the wrong shape', () => {
    const storage = new MemoryStorage();
    storage.setItem(ghostKey('monza'), JSON.stringify({ foo: 1 }));
    expect(loadGhost(storage, 'monza')).toBeNull();
    storage.setItem(ghostKey('monza'), JSON.stringify({ trackId: 'monza', lapTime: 1, samples: [[1, 2]] }));
    expect(loadGhost(storage, 'monza')).toBeNull();
    storage.setItem(ghostKey('monza'), JSON.stringify({ trackId: 'monza', lapTime: 'x', samples: [] }));
    expect(loadGhost(storage, 'monza')).toBeNull();
  });

  it('saveGhostIfFaster stores into an empty storage', () => {
    const storage = new MemoryStorage();
    expect(saveGhostIfFaster(storage, lap([IDENTITY], 4.95))).toBe(true);
    expect(loadGhost(storage, 'monza')?.lapTime).toBe(4.95);
  });

  it('tracks are keyed independently', () => {
    const storage = new MemoryStorage();
    expect(saveGhostIfFaster(storage, { ...lap([IDENTITY], 5), trackId: 'monza' })).toBe(true);
    expect(saveGhostIfFaster(storage, { ...lap([IDENTITY], 6), trackId: 'spa' })).toBe(true);
    expect(loadGhost(storage, 'monza')?.lapTime).toBe(5);
    expect(loadGhost(storage, 'spa')?.lapTime).toBe(6);
    // a slower monza lap does not clobber; a faster spa lap replaces only spa
    expect(saveGhostIfFaster(storage, { ...lap([IDENTITY], 5.5), trackId: 'monza' })).toBe(false);
    expect(saveGhostIfFaster(storage, { ...lap([IDENTITY], 4), trackId: 'spa' })).toBe(true);
    expect(loadGhost(storage, 'monza')?.lapTime).toBe(5);
    expect(loadGhost(storage, 'spa')?.lapTime).toBe(4);
  });
});
