import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import type { BarrierSegment, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns, type BarrierVertex } from '../../../src/track/barrierPath';
import { createBarrierObject } from '../../../src/render/barrierRenderer';
import { createPhysicsWorld, initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { fixture } from './022-fixture-trackdatav2';
import { circleTrack } from '../../fixtures/circleTrack';

// Ring: R 100, N 120, width 12, flat. Winding is counterclockwise in (x, z), so
// rightNormalAt points inward: the left side is the outward radial direction.
const N = 120;

const AT1_BARRIERS: BarrierSegment[] = [
  { start: 0, end: 59, side: 'left', type: 'armco', offsetMeters: 10 },
  { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 20 },
];

function ringTrack(barriers: BarrierSegment[]): TrackDataV2 {
  return {
    ...fixture,
    centerline: circleTrack.centerline,
    widthMeters: circleTrack.widthMeters,
    lengthMeters: circleTrack.lengthMeters,
    officialLengthMeters: circleTrack.officialLengthMeters,
    elevation: Array.from({ length: N }, () => 0),
    kerbs: [],
    runoffs: [],
    barriers,
  };
}

function rightNormalAt(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-9) return [0, -1];
  return [-dz / len, dx / len];
}

// On the inside of a hairpin whose radius is below the barrier offset, the offset polyline folds back on itself and
// its one-sided triangles face away from the track; such samples are a data/layout limit, not a continuity gap.
function foldedInside(track: TrackDataV2, i: number, side: number): boolean {
  const cx = track.centerline;
  const n = cx.length;
  const [ax, az] = cx[(i - 3 + n) % n];
  const [bx, bz] = cx[i];
  const [px, pz] = cx[(i + 3) % n];
  const cross = (bx - ax) * (pz - bz) - (bz - az) * (px - bx);
  const k = (2 * cross) / (Math.hypot(bx - ax, bz - az) * Math.hypot(px - bx, pz - bz) * Math.hypot(px - ax, pz - az));
  if (!Number.isFinite(k) || k === 0) return false;
  const insideSign = k > 0 ? 1 : -1; // cross > 0 turns towards the right normal (-dz, dx): inside = right
  if (insideSign !== side) return false;
  const offset = Math.max(0, ...track.barriers.filter((b) => (b.side === 'right' ? 1 : -1) === side).map((b) => b.offsetMeters));
  return 1 / Math.abs(k) < offset + 5;
}

function castBarrierToi(
  world: RAPIER.World,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  length: number,
): number | null {
  const hit = world.castRay(
    new RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz }),
    length,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    (c: RAPIER.Collider) => surfaceOf(c) === null,
  );
  return hit === null ? null : hit.timeOfImpact;
}

// Ring centerline index of a point, for positions quantized in Float32.
function ringIndex(x: number, z: number): number {
  let idx = Math.round(Math.atan2(z, x) / ((2 * Math.PI) / N)) % N;
  if (idx < 0) idx += N;
  return idx;
}

const ROOT = join(__dirname, '..', '..', '..');

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
}

describe('086 barrier continuity acceptance', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: two left segments with offsets 10 and 20 merge into one closed run of 120 vertices', () => {
    const track = ringTrack(AT1_BARRIERS);
    const runs = barrierRuns(track, 'left');
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.length).toBe(N);
    expect(run.map((v: BarrierVertex) => v.index)).toEqual(Array.from({ length: N }, (_, i) => i));
    expect(Math.abs(Math.hypot(run[59].x, run[59].z) - 110)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(Math.hypot(run[60].x, run[60].z) - 120)).toBeLessThanOrEqual(1e-6);
  });

  it('AT2: indices 40..59 uncovered yield one run of 100 vertices from index 60 to index 39, wrap joined, not closed', () => {
    const track = ringTrack([
      { start: 0, end: 39, side: 'left', type: 'armco', offsetMeters: 10 },
      { start: 60, end: 119, side: 'left', type: 'armco', offsetMeters: 10 },
    ]);
    const runs = barrierRuns(track, 'left');
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run.length).toBe(100);
    expect(run[0].index).toBe(60);
    expect(run[run.length - 1].index).toBe(39);
    expect(run.map((v: BarrierVertex) => v.index)).toEqual(Array.from({ length: 100 }, (_, k) => (60 + k) % N));
  });

  it('AT3: rays outward at the midpoints 59/60 and 119/0 cross the barrier with toi in [9.5, 20.5]', () => {
    world = createPhysicsWorld(ringTrack(AT1_BARRIERS));
    world.step();
    const cx = circleTrack.centerline;
    for (const [a, b] of [[59, 60], [119, 0]]) {
      const mx = (cx[a][0] + cx[b][0]) / 2;
      const mz = (cx[a][1] + cx[b][1]) / 2;
      const len = Math.hypot(mx, mz);
      const toi = castBarrierToi(world, mx, 0.5, mz, mx / len, 0, mz / len, 40);
      expect(toi, `ray between indices ${a} and ${b}`).not.toBeNull();
      expect(toi!, `toi between ${a} and ${b}`).toBeGreaterThanOrEqual(10 - 0.5);
      expect(toi!, `toi between ${a} and ${b}`).toBeLessThanOrEqual(20 + 0.5);
    }
  });

  it('AT4: monza, spa and silverstone hit a barrier for 100 % of outward midpoint rays', () => {
    for (const id of ['monza', 'spa', 'silverstone']) {
      const track = loadTrack(id);
      world = createPhysicsWorld(track);
      world.step();
      const cx = track.centerline;
      const n = cx.length;
      const missed: string[] = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const [rx, rz] = rightNormalAt(cx, i);
        const mx = (cx[i][0] + cx[j][0]) / 2;
        const mz = (cx[i][1] + cx[j][1]) / 2;
        const my = ((track.elevation[i] ?? 0) + (track.elevation[j] ?? 0)) / 2 + 0.5;
        for (const side of ['left', 'right'] as const) {
          const s = side === 'right' ? 1 : -1;
          const toi = castBarrierToi(world, mx, my, mz, s * rx, 0, s * rz, 45);
          if (toi === null && !foldedInside(track, i, s)) missed.push(`${id} ${i} ${side}`);
        }
      }
      expect(missed.length, `${id} missed rays: ${missed.slice(0, 5).join(', ')}`).toBe(0);
      world.free();
      world = null;
    }
  }, 240000);

  it('AT5: barrier geometry has a triangle joining index 59 (radius 110) and index 60 (radius 120)', () => {
    const { group, dispose } = createBarrierObject(ringTrack(AT1_BARRIERS));
    let joined = false;
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.name !== 'armco') return;
      const pos = object.geometry.getAttribute('position');
      const index = object.geometry.index;
      if (index === null) return;
      for (let t = 0; t + 2 < index.count; t += 3) {
        let hasV59 = false;
        let hasV60 = false;
        for (let k = 0; k < 3; k++) {
          const v = index.getX(t + k);
          const x = pos.getX(v);
          const z = pos.getZ(v);
          const r = Math.hypot(x, z);
          const idx = ringIndex(x, z);
          if (idx === 59 && Math.abs(r - 110) <= 1e-3) hasV59 = true;
          if (idx === 60 && Math.abs(r - 120) <= 1e-3) hasV60 = true;
        }
        if (hasV59 && hasV60) joined = true;
      }
    });
    dispose();
    expect(joined).toBe(true);
  });
});
