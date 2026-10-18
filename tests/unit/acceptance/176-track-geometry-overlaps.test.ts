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

const stripCache = new Map<string, SurfaceStrip[]>();
function stripsFor(track: TrackDataV2): SurfaceStrip[] {
  let strips = stripCache.get(track.id);
  if (!strips) {
    strips = buildTrackSurfaces(track);
    stripCache.set(track.id, strips);
  }
  return strips;
}

const hwMin = (track: TrackDataV2, i: number): number =>
  Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i));

/** Grid over points; answers "does any i satisfy within(i)" within maxR of (x, z)". */
function makePointIndex(pts: [number, number][], maxR: number): (x: number, z: number, within: (i: number) => boolean) => boolean {
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

function radiusIndex(track: TrackDataV2, margin: number): {
  radii: number[];
  near: (x: number, z: number, within: (i: number) => boolean) => boolean;
} {
  const pts = track.centerline;
  const radii = pts.map((_, i) => hwMin(track, i) - margin);
  let maxR = 0;
  for (const r of radii) if (r > maxR) maxR = r;
  return { radii, near: makePointIndex(pts, maxR) };
}

// AT1: runoff/grass/gravel triangle centroids within min half-width - 1 m of a centerline point.
function at1Violations(track: TrackDataV2, strips: SurfaceStrip[]): string[] {
  const pts = track.centerline;
  const { radii, near } = radiusIndex(track, 1);
  const bad: string[] = [];
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
      const hit = near(x, z, (i) => Math.hypot(pts[i][0] - x, pts[i][1] - z) < radii[i]);
      if (hit) {
        bad.push(`${s.surface} centroid (${x.toFixed(1)}, ${z.toFixed(1)})`);
        if (bad.length >= 20) return bad;
      }
    }
  }
  return bad;
}

// AT2: barrier vertices/midpoints within min half-width - 0.3 m of a centerline point; median walls exempt.
function at2Violations(track: TrackDataV2): string[] {
  const pts = track.centerline;
  const n = pts.length;
  const { radii, near } = radiusIndex(track, 0.3);
  const bad: string[] = [];
  const check = (x: number, z: number, label: string): void => {
    if (near(x, z, (i) => Math.hypot(pts[i][0] - x, pts[i][1] - z) < radii[i])) bad.push(label);
  };
  for (const side of ['left', 'right'] as const) {
    for (const run of barrierRuns(track, side)) {
      const median = run.map(
        (v) => v.type === 'wall' && halfWidthAt(track, side, v.index) < track.widthMeters / 2 - 1e-9,
      );
      run.forEach((v, j) => {
        if (median[j]) return;
        check(v.x, v.z, `${side} vertex at index ${v.index}`);
        if (run.length < 2) return;
        const w = run[(j + 1) % run.length];
        if (j + 1 >= run.length && run.length !== n) return;
        if (median[(j + 1) % run.length]) return;
        check((v.x + w.x) / 2, (v.z + w.z) / 2, `${side} midpoint ${v.index}-${w.index}`);
      });
    }
  }
  return bad;
}

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
    const first = ((start - ext) % n + n) % n;
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

// AT3: every lateral sample on the asphalt covered by an asphalt or kerb triangle in XZ.
function at3Holes(track: TrackDataV2, strips: SurfaceStrip[]): string[] {
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
  const holes: string[] = [];
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
      if (!inside(pts[i][0] + nx * d, pts[i][1] + nz * d)) holes.push(`index ${i} d=${d}`);
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
    const signs: number[] = [];
    let pos = 0;
    let neg = 0;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const area2 = (p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2]);
      const sg = area2 > 0 ? 1 : area2 < 0 ? -1 : 0;
      signs.push(sg);
      if (sg > 0) pos++;
      else if (sg < 0) neg++;
    }
    const majority = pos >= neg ? 1 : -1;
    for (const sg of signs) if (sg !== 0 && sg !== majority) flipped++;
  }
  return flipped;
}

// AT6 synthetic: 200 m straight, R8 hairpin (10-degree angled approach so the straights stay
// 20 m apart), 200 m return straight; half-width 6, 18 m runoff both sides all around.
const HAIRPIN_A = (10 * Math.PI) / 180;
const HAIRPIN_R = 8;
const SEP = 20;
const CONN_LEN = (SEP - 2 * HAIRPIN_R * Math.cos(HAIRPIN_A)) / Math.sin(HAIRPIN_A);
const STEP = 2;

function syntheticTrack(): TrackDataV2 {
  const pts: [number, number][] = [];
  const pushLeg = (from: [number, number], heading: number, len: number): void => {
    const steps = Math.max(1, Math.round(len / STEP));
    for (let k = 1; k <= steps; k++) {
      const s = (len * k) / steps;
      pts.push([from[0] + s * Math.cos(heading), from[1] + s * Math.sin(heading)]);
    }
  };
  const pushArc = (from: [number, number], heading: number, steps: number): void => {
    const cx = from[0] - HAIRPIN_R * Math.sin(heading);
    const cz = from[1] + HAIRPIN_R * Math.cos(heading);
    const dPhi = Math.PI / steps;
    for (let k = 1; k <= steps; k++) {
      const t = heading + k * dPhi;
      pts.push([cx + HAIRPIN_R * Math.sin(t), cz - HAIRPIN_R * Math.cos(t)]);
    }
  };
  pts.push([0, 0]);
  pushLeg([0, 0], 0, 200);
  pushLeg([200, 0], HAIRPIN_A, CONN_LEN);
  const arc1Start: [number, number] = [
    200 + CONN_LEN * Math.cos(HAIRPIN_A),
    CONN_LEN * Math.sin(HAIRPIN_A),
  ];
  pushArc(arc1Start, HAIRPIN_A, 13);
  const kink: [number, number] = [
    arc1Start[0] - 2 * HAIRPIN_R * Math.sin(HAIRPIN_A),
    arc1Start[1] + 2 * HAIRPIN_R * Math.cos(HAIRPIN_A),
  ];
  pushLeg(kink, Math.PI, 200);
  const conn2Start: [number, number] = [kink[0] - 200, kink[1]];
  pushLeg(conn2Start, Math.PI + HAIRPIN_A, CONN_LEN);
  const arc2Start: [number, number] = [
    conn2Start[0] + CONN_LEN * Math.cos(Math.PI + HAIRPIN_A),
    conn2Start[1] + CONN_LEN * Math.sin(Math.PI + HAIRPIN_A),
  ];
  pushArc(arc2Start, Math.PI + HAIRPIN_A, 12); // 12/13 of the arc; the loop closes at index 0
  const n = pts.length;
  let length = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    length += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
  }
  return {
    version: 2,
    id: 'synthetic-hairpin',
    name: 'Synthetic Hairpin',
    widthMeters: 12,
    lengthMeters: length,
    officialLengthMeters: length,
    centerline: pts,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    elevation: pts.map(() => 0),
    kerbs: [],
    runoffs: [
      { start: 0, end: n - 1, side: 'left', surface: 'runoff', widthMeters: 18 },
      { start: 0, end: n - 1, side: 'right', surface: 'runoff', widthMeters: 18 },
    ],
    barriers: [],
    terrain: {
      originX: 110,
      originZ: 10,
      sizeX: 280,
      sizeZ: 120,
      rows: 1,
      cols: 1,
      heights: [0, 0, 0, 0],
    },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'synthetic', license: 'CC0', url: '', dem: '' },
  };
}

describe('176 track geometry overlaps acceptance', () => {
  const tracks = loadV2Tracks();

  it('AT1: no runoff/grass/gravel triangle centroid within min half-width - 1 m of any centerline point', () => {
    for (const { id, track } of tracks) {
      const bad = at1Violations(track, stripsFor(track));
      expect(bad, `${id}: ${bad.slice(0, 5).join('; ')}`).toHaveLength(0);
    }
  }, 120000);

  it('AT2: no barrier vertex or segment midpoint within min half-width - 0.3 m of any centerline point', () => {
    for (const { id, track } of tracks) {
      const bad = at2Violations(track);
      expect(bad, `${id}: ${bad.slice(0, 5).join('; ')}`).toHaveLength(0);
    }
  }, 60000);

  it('AT3: every lateral asphalt sample is covered by an asphalt or kerb triangle', () => {
    for (const { id, track } of tracks) {
      const holes = at3Holes(track, stripsFor(track));
      expect(holes, `${id}: ${holes.slice(0, 5).join('; ')}`).toHaveLength(0);
    }
  }, 120000);

  it('AT4: bilinear terrain at triangle centroids and edge midpoints stays within strip height + 0.005 m', () => {
    for (const { id, track } of tracks) {
      const poke = at4Pokes(track, stripsFor(track));
      expect(poke, id).toBe(0);
    }
  }, 120000);

  it('AT5: every non-degenerate triangle matches its strip majority winding', () => {
    for (const { id, track } of tracks) {
      const flipped = at5Flipped(stripsFor(track));
      expect(flipped, id).toBe(0);
    }
  }, 120000);

  it('AT6: synthetic R8 hairpin track holds AT1, AT5 and asphalt sample coverage', () => {
    const track = syntheticTrack();
    const strips = buildTrackSurfaces(track);
    const bad = at1Violations(track, strips);
    expect(bad, bad.slice(0, 5).join('; ')).toHaveLength(0);
    expect(at5Flipped(strips)).toBe(0);
    const holes = at3Holes(track, strips);
    expect(holes, holes.slice(0, 5).join('; ')).toHaveLength(0);
  }, 60000);
});
