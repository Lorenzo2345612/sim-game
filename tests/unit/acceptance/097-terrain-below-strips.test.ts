import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { Side, SurfaceStrip, Terrain, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { clampTerrainBelowStrips } from '../../../tools/track-builder/terrain';
import { addTrackColliders, surfaceOf } from '../../../src/physics/trackColliders';
import { initPhysics, RAPIER } from '../../../src/physics/physicsWorld';
import { GRAVITY, KERB_WIDTH } from '../../../src/core/constants';

const IDS = ['monza', 'spa', 'silverstone'];
const ROOT = join(__dirname, '..', '..', '..');
// verge outer extent <= runoff/kerb outer + VERGE_FLAT(6) + VERGE_SLOPE(3) from surfaces.ts
const VERGE_REACH = 9;

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8')) as TrackDataV2;
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

/** Largest lateral outer extent of kerbs/runoffs of one side at centerline index idx (surfaces.ts rule). */
function outerExtentAt(track: TrackDataV2, side: Side, idx: number): number {
  const n = track.centerline.length;
  const half = track.widthMeters / 2;
  const covers = (seg: { start: number; end: number }): boolean => {
    const start = ((seg.start % n) + n) % n;
    const end = ((seg.end % n) + n) % n;
    const len = ((end - start + n) % n) + 1;
    return ((idx - start + n) % n) < len;
  };
  const kerb = track.kerbs.some((k) => k.side === side && covers(k));
  let ext = half + (kerb ? KERB_WIDTH : 0);
  for (const seg of track.runoffs) {
    if (seg.side !== side || !covers(seg)) continue;
    ext = Math.max(ext, half + (kerb ? KERB_WIDTH : 0) + seg.widthMeters);
  }
  return ext;
}

function inGrid(t: Terrain, x: number, z: number): boolean {
  const e = 1e-6;
  return (
    x >= t.originX - t.sizeX / 2 - e && x <= t.originX + t.sizeX / 2 + e &&
    z >= t.originZ - t.sizeZ / 2 - e && z <= t.originZ + t.sizeZ / 2 + e
  );
}

// Rapier heightfield layout of trackColliders.ts: heights[j * (rows + 1) + i],
// j = x index across sizeX, i = z index across sizeZ, origin = centre.
function sampleTerrain(t: Terrain, x: number, z: number): number {
  const fx = ((x - (t.originX - t.sizeX / 2)) / t.sizeX) * t.cols;
  const fz = ((z - (t.originZ - t.sizeZ / 2)) / t.sizeZ) * t.rows;
  const j0 = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
  const i0 = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
  const tx = Math.min(1, Math.max(0, fx - j0));
  const tz = Math.min(1, Math.max(0, fz - i0));
  const w = t.rows + 1;
  return (
    (1 - tx) * (1 - tz) * t.heights[j0 * w + i0] +
    tx * (1 - tz) * t.heights[(j0 + 1) * w + i0] +
    (1 - tx) * tz * t.heights[j0 * w + i0 + 1] +
    tx * tz * t.heights[(j0 + 1) * w + i0 + 1]
  );
}

function castDown(
  world: RAPIER.World,
  x: number,
  z: number,
  fromY: number,
  length: number,
): { collider: RAPIER.Collider; y: number } | null {
  const hit = world.castRay(new RAPIER.Ray({ x, y: fromY, z }, { x: 0, y: -1, z: 0 }), length, true);
  return hit === null ? null : { collider: hit.collider, y: fromY - hit.timeOfImpact };
}

function trackWorld(track: TrackDataV2): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  addTrackColliders(world, track);
  world.step();
  return world;
}

describe('097 terrain below strips acceptance', () => {
  let world: RAPIER.World | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    world?.free();
    world = null;
  });

  it('AT1: a strip triangle clamps the 4 corners of the cell its bounding box overlaps to <= -1.15 and leaves every other vertex exactly unchanged', () => {
    // 8x8 m terrain, 2x2 cells of 4 m; heights[j * (rows + 1) + i], j = x index, i = z index.
    const terrain: Terrain = { originX: 0, originZ: 0, sizeX: 8, sizeZ: 8, rows: 2, cols: 2, heights: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
    // Single triangle at y = -1.0, bounding box strictly inside the cell spanning x,z in [-4, 0].
    const strip: SurfaceStrip = {
      surface: 'gravel',
      positions: new Float32Array([-3, -1, -3, -1.5, -1, -3, -2.25, -1, -1.5]),
      indices: new Uint32Array([0, 1, 2]),
      uvs: new Float32Array(6),
    };
    clampTerrainBelowStrips(terrain, [strip]);
    // Corners of that cell: (j,i) in {0,1} x {0,1} -> indices 0, 1, 3, 4.
    for (const k of [0, 1, 3, 4]) {
      expect(terrain.heights[k], `corner ${k} = ${terrain.heights[k]}`).toBeLessThanOrEqual(-1.15);
    }
    for (const k of [2, 5, 6, 7, 8]) {
      expect(terrain.heights[k], `vertex ${k}`).toBe(0);
    }
  });

  it('AT2: on monza, spa and silverstone the bilinear heightfield is at least 0.10 m below every strip vertex and every triangle centroid', () => {
    const failures: string[] = [];
    for (const id of IDS) {
      const track = loadTrack(id);
      for (const strip of buildTrackSurfaces(track)) {
        const p = strip.positions;
        const check = (x: number, y: number, z: number, where: string): void => {
          if (!inGrid(track.terrain, x, z)) {
            failures.push(`${id} ${strip.surface} ${where} (${x.toFixed(1)}, ${z.toFixed(1)}) outside heightfield`);
            return;
          }
          const h = sampleTerrain(track.terrain, x, z);
          if (h > y - 0.1) failures.push(`${id} ${strip.surface} ${where} (${x.toFixed(1)}, ${z.toFixed(1)}): terrain ${h.toFixed(3)} > strip ${y.toFixed(3)} - 0.10`);
        };
        for (let v = 0; v < p.length / 3; v++) {
          check(p[3 * v], p[3 * v + 1], p[3 * v + 2], 'vertex');
        }
        for (let t = 0; t < strip.indices.length; t += 3) {
          const a = 3 * strip.indices[t];
          const b = 3 * strip.indices[t + 1];
          const c = 3 * strip.indices[t + 2];
          check((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3, 'centroid');
        }
      }
    }
    expect(failures.length, failures.slice(0, 12).join('; ')).toBe(0);
  }, 120000);

  it('AT3: the regenerated tracks change only terrain.heights plus the fields tasks 098 and 142 own (run-offs, barriers, trees, kerbs); every other field matches the pre-task JSON', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    // 098 moved the run-off strips, so barriers/trees follow them and the strip clamp may
    // raise or lower terrain.heights; the 097 decrease-only invariant no longer applies.
    // 142 re-rules the kerbs, which also feeds run-offs/barriers.
    const pin = (t: TrackDataV2): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...t, terrain: { ...t.terrain, heights: [] } };
      delete copy.kerbs;
      delete copy.runoffs;
      delete copy.barriers;
      delete copy.trees;
      return copy;
    };
    for (const id of IDS) {
      const now = loadTrack(id);
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
      ) as TrackDataV2;
      expect(
        pin(now),
        `${id}: fields other than kerbs/run-offs/terrain.heights changed`,
      ).toEqual(pin(prev));
      expect(now.terrain.heights.length, `${id}: heights length`).toBe(prev.terrain.heights.length);
    }
  }, 120000);

  it('AT4: on monza, spa and silverstone no downward ray (every 4th chord midpoint, 0.5 m lateral steps across asphalt/kerb/run-off/verge) hits the terrain first where a strip collider is below', () => {
    for (const id of IDS) {
      const track = loadTrack(id);
      const cx = track.centerline;
      const n = cx.length;
      let hi = -Infinity;
      let lo = Infinity;
      for (const h of track.terrain.heights) {
        if (h > hi) hi = h;
        if (h < lo) lo = h;
      }
      for (const e of track.elevation) {
        if (e > hi) hi = e;
        if (e < lo) lo = e;
      }
      const fromY = hi + 30;
      world = trackWorld(track);
      const exposed: string[] = [];
      for (let i = 0; i < n; i += 4) {
        const j = (i + 1) % n;
        const [rx, rz] = rightNormalAt(cx, i);
        const mx = (cx[i][0] + cx[j][0]) / 2;
        const mz = (cx[i][1] + cx[j][1]) / 2;
        for (const side of [1, -1] as const) {
          const name: Side = side === 1 ? 'right' : 'left';
          const ext = Math.max(outerExtentAt(track, name, i), outerExtentAt(track, name, j)) + VERGE_REACH;
          for (let t = 0.5; t <= ext; t += 0.5) {
            const x = mx + rx * side * t;
            const z = mz + rz * side * t;
            const hit = castDown(world, x, z, fromY, fromY - lo + 30);
            if (hit === null || hit.collider.shape.type !== RAPIER.ShapeType.HeightField) continue;
            const under = world.castRay(
              new RAPIER.Ray({ x, y: hit.y - 1e-3, z }, { x: 0, y: -1, z: 0 }), hit.y - lo + 30, true,
              undefined, undefined, undefined, undefined,
              (c: RAPIER.Collider) => c.shape.type !== RAPIER.ShapeType.HeightField,
            );
            if (under !== null && surfaceOf(under.collider) !== null) {
              exposed.push(`${id} idx ${i} ${name} lat ${t.toFixed(1)}`);
            }
          }
        }
      }
      expect(exposed.length, `terrain first hit above a strip: ${exposed.slice(0, 10).join('; ')}`).toBe(0);
      world.free();
      world = null;
    }
  }, 240000);
});
