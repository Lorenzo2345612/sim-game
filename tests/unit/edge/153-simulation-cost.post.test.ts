import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { diffSplit } from '../../../src/physics/powertrain';
import { trafficDecision, type TrafficDecision } from '../../../src/ai/traffic';
import { cumulativeLengths } from '../../../src/track/centerline';
import type { Point2 } from '../../../src/track/geo';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { TrackProgress, type ProgressSample } from '../../../src/track/trackProgress';

type World = ReturnType<typeof createPhysicsWorld>;

const ROOT = join(__dirname, '..', '..', '..');
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
    if (len2 < 1e-18) continue;
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

describe('153 simulation cost post-code gaps', () => {
  it('POST1: a windowed best distance of exactly 25 m stays windowed; 25 m + ε falls back', () => {
    const TRACK = stadium();
    const tp = new TrackProgress(TRACK);
    expect(tp.update(150.5, 0).index).toBe(150);
    const exact = tp.update(276, 0);
    expect(exact.index, 'exactly 25 m keeps the windowed hit').toBe(250);
    expect(exact.distance).toBeCloseTo(251, 9);
    const over = tp.update(276.0001, 0);
    expect(over.index, 'over 25 m re-searches the ring').toBe(276);
    expect(over.distance).toBeCloseTo(276.0001, 9);
  });

  it('POST2: update returns the same sample object every call (reset and fallback included)', () => {
    const tp = new TrackProgress(stadium());
    const first = tp.update(10, 0);
    expect(tp.update(20, 0)).toBe(first);
    expect(tp.update(400, 0), 'full-search fallback').toBe(first);
    tp.reset();
    expect(tp.update(30, 0), 'after reset').toBe(first);
    expect(tp.update(Number.NaN, 0), 'non-finite input').toBe(first);
  });

  it('POST3: a ring of degenerate segments never throws and yields the initial sample', () => {
    const pts: Point2[] = Array.from({ length: 10 }, () => [0, 0] as Point2);
    const tp = new TrackProgress(pts);
    const s = tp.update(1, 1);
    expect(s.index).toBe(0);
    expect(s.distance).toBe(0);
    expect(s.lateral).toBe(0);
    expect(tp.update(5, 5)).toBe(s);
  });

  it('POST4: a track with fewer than 203 points always searches globally (matches full search)', () => {
    const pts: Point2[] = [];
    const n = 50;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n;
      pts.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    const tp = new TrackProgress(pts);
    for (let i = 0; i < n; i++) {
      const [x, z] = pts[i];
      const got = tp.update(x, z);
      const want = fullSearch(pts, x, z);
      expect(got.index, `i=${i} index`).toBe(want.index);
      expect(got.distance, `i=${i} distance`).toBeCloseTo(want.distance, 9);
      expect(got.lateral, `i=${i} lateral`).toBeCloseTo(want.lateral, 9);
    }
  });

  it('POST5: diffSplit fills and returns the caller-provided pair, matching the allocating call', () => {
    const open = { type: 'open' } as CarSpec['diff'];
    const lsd: CarSpec['diff'] = { type: 'lsd', preload: 50, lockPower: 0.3, lockCoast: 0.2 };
    const locked: CarSpec['diff'] = { type: 'locked', preload: 0, lockPower: 0, lockCoast: 0 };
    const out: [number, number] = [0, 0];
    for (const diff of [open, lsd, locked]) {
      for (const [tIn, wL, wR, on] of [
        [400, 10, 10, true],
        [400, 100, 0, true],
        [-200, 50, 10, false],
        [0, 0, 0, true],
        [0, -40, 10, false],
      ] as const) {
        const got = diffSplit(diff, tIn, wL, wR, on, out);
        expect(got, 'returns the out array').toBe(out);
        const [a, b] = diffSplit(diff, tIn, wL, wR, on);
        expect(got[0], `tIn=${tIn} left`).toBeCloseTo(a, 12);
        expect(got[1], `tIn=${tIn} right`).toBeCloseTo(b, 12);
      }
    }
  });

  it('POST6: trafficDecision fills and returns one reused out object across every branch', () => {
    const self = { distance: 0, lateral: 0, speed: 30 };
    const blocker = { distance: 10, lateral: 0, speed: 20 };
    const farSlower = { distance: 40, lateral: 0, speed: 5 };
    const beside = { distance: 2, lateral: 1, speed: 30 };
    const besideLeft = { distance: 2, lateral: -1, speed: 30 };
    const wideBlocker = { distance: 10, lateral: 9, speed: 20 };
    const scenarios: Array<{
      name: string;
      others: Array<{ distance: number; lateral: number; speed: number }>;
      lapLength: number;
      halfWidth: number;
      lineOffsetAhead: number;
      curvatureAhead: number;
    }> = [
      { name: 'none', others: [], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 0, curvatureAhead: 0 },
      { name: 'preferred pass', others: [blocker], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 0, curvatureAhead: 0.1 },
      { name: 'alternative pass', others: [blocker], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 0, curvatureAhead: -0.1 },
      { name: 'no gap, speed cap', others: [wideBlocker], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 9, curvatureAhead: 0.1 },
      { name: 'alongside right', others: [farSlower, beside], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 0, curvatureAhead: 0 },
      { name: 'alongside left', others: [farSlower, besideLeft], lapLength: 1000, halfWidth: 6, lineOffsetAhead: 0, curvatureAhead: 0 },
    ];
    const out: TrafficDecision = { offset: 0, speedCap: null };
    for (const sc of scenarios) {
      const got = trafficDecision(self, sc.others, sc.lapLength, sc.halfWidth, sc.lineOffsetAhead, sc.curvatureAhead, out);
      expect(got, `${sc.name} reuses out`).toBe(out);
      const fresh = trafficDecision(self, sc.others, sc.lapLength, sc.halfWidth, sc.lineOffsetAhead, sc.curvatureAhead);
      expect(got.offset, `${sc.name} offset`).toBeCloseTo(fresh.offset, 12);
      expect(got.speedCap, `${sc.name} speedCap`).toBe(fresh.speedCap);
    }
    expect(out.offset, 'last scenario left in place').toBeCloseTo(1, 12);
    expect(out.speedCap).toBeNull();
  });

  it(
    'POST7: RaceGame.create pins solver iterations to 4 and the tick never changes them',
    async () => {
      const track = loadTrack();
      const spec = loadSpec();
      const single = await RaceGame.create(track, spec, raceConfig(0));
      try {
        expect(
          (single as unknown as { world: World }).world.integrationParameters.numSolverIterations,
          'single-car world',
        ).toBe(4);
      } finally {
        single.dispose();
      }
      const many = await RaceGame.create(track, spec, raceConfig(3));
      try {
        const world = (many as unknown as { world: World }).world;
        expect(world.integrationParameters.numSolverIterations, 'multi-car world').toBe(4);
        for (let i = 0; i < 60; i++) many.step(IDLE);
        expect(world.integrationParameters.numSolverIterations, 'after 60 ticks').toBe(4);
      } finally {
        many.dispose();
      }
    },
    180000,
  );
});
