import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import {
  buildTrackSurfaces,
  halfWidthAt,
  INNER_CURVE_CLAMP,
  innerCornerRadii,
  KERB_MIN_WIDTH,
} from '../../../src/track/surfaces';
import { KERB_WIDTH } from '../../../src/core/constants';
import { barrierRuns } from '../../../src/track/barrierPath';

const ROOT = join(__dirname, '..', '..', '..');

function loadV2Tracks(): Array<{ id: string; track: TrackDataV2 }> {
  const dir = join(ROOT, 'public', 'tracks');
  const out: Array<{ id: string; track: TrackDataV2 }> = [];
  for (const name of readdirSync(dir)) {
    if (
      !name.endsWith('.json') ||
      name === 'index.json' ||
      name.endsWith('-env.json') ||
      name.endsWith('.style.json')
    )
      continue;
    const track = JSON.parse(readFileSync(join(dir, name), 'utf8')) as TrackDataV2;
    if (track.version === 2) out.push({ id: track.id, track });
  }
  return out;
}

/** Grid over the centerline; answers "does any i satisfy within(i)" within maxR of (x, z)". */
function makePointIndex(
  pts: [number, number][],
  maxR: number,
): (x: number, z: number, within: (i: number) => boolean) => boolean {
  const cell = Math.max(maxR, 1);
  const g = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = g.get(k);
    if (list) list.push(i);
    else g.set(k, [i]);
  });
  return (x, z, within) => {
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const i of g.get(`${gx + a},${gz + b}`) ?? []) {
          if (within(i)) return true;
        }
      }
    }
    return false;
  };
}

const hwMin = (track: TrackDataV2, i: number): number =>
  Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i));

function radiusIndex(track: TrackDataV2, margin: number) {
  const pts = track.centerline;
  const radii = pts.map((_, i) => hwMin(track, i) - margin);
  let maxR = 0;
  for (const r of radii) if (r > maxR) maxR = r;
  return { radii, near: makePointIndex(pts, maxR) };
}

// AT1: runoff/grass/gravel triangle centroids within min half-width - 1 m of a centerline point.
function at1Violations(track: TrackDataV2, strips: SurfaceStrip[]): number {
  const pts = track.centerline;
  const { radii, near } = radiusIndex(track, 1);
  let bad = 0;
  for (const s of strips) {
    if (s.surface === 'asphalt' || s.surface === 'kerb') continue;
    const p = s.positions;
    const ind = s.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const x = (p[a] + p[b] + p[c]) / 3;
      const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      if (near(x, z, (i) => Math.hypot(pts[i][0] - x, pts[i][1] - z) < radii[i])) bad++;
    }
  }
  return bad;
}

// AT2: barrier vertices/midpoints within min half-width - 0.3 m of a centerline point; median walls exempt.
function at2Violations(track: TrackDataV2): number {
  const pts = track.centerline;
  const n = pts.length;
  const { radii, near } = radiusIndex(track, 0.3);
  let bad = 0;
  const check = (x: number, z: number): void => {
    if (near(x, z, (i) => Math.hypot(pts[i][0] - x, pts[i][1] - z) < radii[i])) bad++;
  };
  for (const side of ['left', 'right'] as const) {
    for (const run of barrierRuns(track, side)) {
      const median = run.map(
        (v) => v.type === 'wall' && halfWidthAt(track, side, v.index) < track.widthMeters / 2 - 1e-9,
      );
      run.forEach((v, j) => {
        if (median[j]) return;
        check(v.x, v.z);
        if (run.length < 2) return;
        if (j + 1 >= run.length && run.length !== n) return;
        if (median[(j + 1) % run.length]) return;
        const w = run[(j + 1) % run.length];
        check((v.x + w.x) / 2, (v.z + w.z) / 2);
      });
    }
  }
  return bad;
}

// AT3: every lateral sample across the asphalt is covered by an asphalt or kerb triangle in XZ.
/** Centerline indices whose kerb rows the Reff rule drops (see surfaces.ts). */
function reffDroppedKerbIndices(track: TrackDataV2): Set<number> {
  const cx = track.centerline;
  const n = cx.length;
  const reff = innerCornerRadii(cx);
  const dropped = new Set<number>();
  for (const seg of track.kerbs) {
    const start = ((seg.start % n) + n) % n;
    const end = ((seg.end % n) + n) % n;
    const k = ((end - start + n) % n) + 1;
    const ext = k + 2 <= n ? 1 : 0;
    const first = (((start - ext) % n) + n) % n;
    for (let j = 0; j < k + 2 * ext; j++) {
      const idx = (first + j) % n;
      const half = halfWidthAt(track, seg.side, idx);
      const near = seg.side === 'left' ? reff.left[idx] : reff.right[idx];
      const outer = Number.isFinite(near) ? Math.min(half + KERB_WIDTH, INNER_CURVE_CLAMP * near) : half + KERB_WIDTH;
      if (outer - half < KERB_MIN_WIDTH) dropped.add(idx);
    }
  }
  return dropped;
}

function at3Holes(track: TrackDataV2, strips: SurfaceStrip[]): number {
  const skip = reffDroppedKerbIndices(track);
  const tris: number[][] = [];
  for (const s of strips) {
    if (s.surface !== 'asphalt' && s.surface !== 'kerb') continue;
    const p = s.positions;
    const ind = s.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      tris.push([p[a], p[a + 2], p[b], p[b + 2], p[c], p[c + 2]]);
    }
  }
  const cell = 20;
  const grid = new Map<string, number[]>();
  tris.forEach((t, ti) => {
    const xs = [t[0], t[2], t[4]];
    const zs = [t[1], t[3], t[5]];
    for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++) {
      for (let gz = Math.floor(Math.min(...zs) / cell); gz <= Math.floor(Math.max(...zs) / cell); gz++) {
        const k = `${gx},${gz}`;
        const list = grid.get(k);
        if (list) list.push(ti);
        else grid.set(k, [ti]);
      }
    }
  });
  const inside = (x: number, z: number): boolean =>
    (grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []).some((ti) => {
      const q = tris[ti];
      const d1 = (x - q[2]) * (q[1] - q[3]) - (q[0] - q[2]) * (z - q[3]);
      const d2 = (x - q[4]) * (q[3] - q[5]) - (q[2] - q[4]) * (z - q[5]);
      const d3 = (x - q[0]) * (q[5] - q[1]) - (q[4] - q[0]) * (z - q[1]);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    });
  const pts = track.centerline;
  const n = pts.length;
  let holes = 0;
  for (let i = 0; i < n; i++) {
    if (skip.has(i)) continue;
    const j = (i + 1) % n;
    const dx = pts[j][0] - pts[i][0];
    const dz = pts[j][1] - pts[i][1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    const hl = halfWidthAt(track, 'left', i);
    const hr = halfWidthAt(track, 'right', i);
    for (const d of [-hl + 0.5, -hl / 2, 0, hr / 2, hr - 0.5]) {
      if (!inside(pts[i][0] + nx * d, pts[i][1] + nz * d)) holes++;
    }
  }
  return holes;
}

// AT4: bilinear terrain at every triangle centroid and edge midpoint never exceeds strip height + 0.005 m.
function at4Pokes(track: TrackDataV2, strips: SurfaceStrip[]): number {
  const t = track.terrain;
  if (!t) return 0;
  const x0 = t.originX - t.sizeX / 2;
  const z0 = t.originZ - t.sizeZ / 2;
  const sx = t.sizeX / t.cols;
  const sz = t.sizeZ / t.rows;
  const st = t.rows + 1;
  const th = (x: number, z: number): number => {
    const fx = (x - x0) / sx;
    const fz = (z - z0) / sz;
    const j = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
    const i = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
    const u = fx - j;
    const v = fz - i;
    const h = t.heights;
    return (
      h[j * st + i] * (1 - u) * (1 - v) +
      h[(j + 1) * st + i] * u * (1 - v) +
      h[j * st + i + 1] * (1 - u) * v +
      h[(j + 1) * st + i + 1] * u * v
    );
  };
  const samples: Array<[number, number, number]> = [
    [1 / 3, 1 / 3, 1 / 3],
    [0.5, 0.5, 0],
    [0, 0.5, 0.5],
    [0.5, 0, 0.5],
  ];
  let poke = 0;
  for (const s of strips) {
    const p = s.positions;
    const ind = s.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      for (const [w1, w2, w3] of samples) {
        const x = w1 * p[a] + w2 * p[b] + w3 * p[c];
        const y = w1 * p[a + 1] + w2 * p[b + 1] + w3 * p[c + 1];
        const z = w1 * p[a + 2] + w2 * p[b + 2] + w3 * p[c + 2];
        if (th(x, z) - y > 0.005) poke++;
      }
    }
  }
  return poke;
}

// AT5: every non-degenerate triangle has the signed XZ area sign of its strip's majority.
function at5Flipped(strips: SurfaceStrip[]): number {
  let flipped = 0;
  for (const s of strips) {
    const p = s.positions;
    const ind = s.indices;
    let pos = 0;
    let neg = 0;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const area2 = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
      if (area2 > 0) pos++;
      else if (area2 < 0) neg++;
    }
    const majority = pos >= neg ? 1 : -1;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const area2 = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
      const sg = area2 > 0 ? 1 : area2 < 0 ? -1 : 0;
      if (sg !== 0 && sg !== majority) flipped++;
    }
  }
  return flipped;
}

describe('176 track geometry audit (every v2 track)', () => {
  const tracks = loadV2Tracks();
  const stripCache = new Map<string, SurfaceStrip[]>();
  const stripsFor = (track: TrackDataV2): SurfaceStrip[] => {
    let strips = stripCache.get(track.id);
    if (!strips) {
      strips = buildTrackSurfaces(track);
      stripCache.set(track.id, strips);
    }
    return strips;
  };

  it('AT1: no runoff/grass/gravel triangle centroid within min half-width - 1 m of any centerline point', () => {
    for (const { id, track } of tracks) {
      expect(at1Violations(track, stripsFor(track)), id).toBe(0);
    }
  }, 120000);

  it('AT2: no barrier vertex or segment midpoint within min half-width - 0.3 m of any centerline point', () => {
    for (const { id, track } of tracks) {
      expect(at2Violations(track), id).toBe(0);
    }
  }, 60000);

  it('AT3: every lateral asphalt sample is covered by an asphalt or kerb triangle', () => {
    for (const { id, track } of tracks) {
      expect(at3Holes(track, stripsFor(track)), id).toBe(0);
    }
  }, 120000);

  it('AT4: terrain at triangle centroids and edge midpoints stays within strip height + 0.005 m', () => {
    for (const { id, track } of tracks) {
      expect(at4Pokes(track, stripsFor(track)), id).toBe(0);
    }
  }, 120000);

  it('AT5: every non-degenerate triangle matches its strip majority winding', () => {
    for (const { id, track } of tracks) {
      expect(at5Flipped(stripsFor(track)), id).toBe(0);
    }
  }, 120000);
});
