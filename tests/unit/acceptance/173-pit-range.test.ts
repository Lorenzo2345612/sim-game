import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackDataV2 } from '../../../src/core/types';
import { createPitBuilding } from '../../../src/render/pitAndStart';

// Task 173 lands tools/track-builder/pitRange.ts; the variable specifier keeps
// typecheck green until the module exists (the 162 pattern).
const PIT_RANGE_MODULE = '../../../tools/track-builder/pitRange';
type ClipPitRange = (
  centerline: Array<[number, number]>,
  startIndex: number,
  fromMeters: number,
  toMeters: number,
  maxChordDevM?: number,
) => { start: number; end: number };

async function loadClipPitRange(): Promise<ClipPitRange> {
  const mod = (await import(PIT_RANGE_MODULE)) as { clipPitRange: ClipPitRange };
  return mod.clipPitRange;
}

const ROOT = join(__dirname, '..', '..', '..');
// Same constants as src/render/pitAndStart.ts (not exported there).
const EDGE_OFFSET = 10;
const BUILDING_DEPTH = 8;

function tracksWithPit(): Array<{ id: string; track: TrackDataV2 }> {
  const dir = join(ROOT, 'public', 'tracks');
  const out: Array<{ id: string; track: TrackDataV2 }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const track = JSON.parse(readFileSync(join(dir, name), 'utf8')) as TrackDataV2;
    if (track.pit) out.push({ id: track.id, track });
  }
  return out;
}

const wrap = (v: number, n: number): number => ((v % n) + n) % n;

function rangeIndices(start: number, end: number, n: number): number[] {
  const out = [start];
  let i = start;
  while (i !== end) {
    i = wrap(i + 1, n);
    out.push(i);
  }
  return out;
}

function maxChordDeviation(pts: Array<[number, number]>, indices: number[]): number {
  const a = pts[indices[0]];
  const b = pts[indices[indices.length - 1]];
  const ax = b[0] - a[0];
  const az = b[1] - a[1];
  const len = Math.hypot(ax, az) || 1;
  let max = 0;
  for (const k of indices) {
    const p = pts[k];
    const d = Math.abs((p[0] - a[0]) * az - (p[1] - a[1]) * ax) / len;
    if (d > max) max = d;
  }
  return max;
}

function pathLength(pts: Array<[number, number]>, indices: number[]): number {
  let len = 0;
  for (let i = 0; i < indices.length - 1; i++) {
    const p = pts[indices[i]];
    const q = pts[indices[i + 1]];
    len += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return len;
}

function sideNormal(tx: number, tz: number, side: 'left' | 'right'): [number, number] {
  return side === 'left' ? [tz, -tx] : [-tz, tx];
}

// Building footprint: the chord rectangle offset to pit.side by width/2 + EDGE_OFFSET
// on the near face and BUILDING_DEPTH deep (as in pitAndStart.ts).
interface Footprint {
  a: [number, number];
  t: [number, number];
  n: [number, number];
  chordLen: number;
  near: number;
  far: number;
}

function footprintRect(track: TrackDataV2): Footprint {
  const [sx, sz] = track.centerline[track.pit.start];
  const [ex, ez] = track.centerline[track.pit.end];
  const chordLen = Math.hypot(ex - sx, ez - sz) || 1;
  const t: [number, number] = [(ex - sx) / chordLen, (ez - sz) / chordLen];
  const n = sideNormal(t[0], t[1], track.pit.side);
  const near = track.widthMeters / 2 + EDGE_OFFSET;
  return { a: [sx, sz], t, n, chordLen, near, far: near + BUILDING_DEPTH };
}

function distToFootprint(p: [number, number], fp: Footprint): number {
  const dx = p[0] - fp.a[0];
  const dz = p[1] - fp.a[1];
  const u = dx * fp.t[0] + dz * fp.t[1];
  const v = dx * fp.n[0] + dz * fp.n[1];
  const cu = Math.min(Math.max(u, 0), fp.chordLen);
  const cv = Math.min(Math.max(v, fp.near), fp.far);
  return Math.hypot(u - cu, v - cv);
}

function footprintCorners(track: TrackDataV2): Array<[number, number]> {
  const fp = footprintRect(track);
  const end: [number, number] = [fp.a[0] + fp.t[0] * fp.chordLen, fp.a[1] + fp.t[1] * fp.chordLen];
  const off = (p: [number, number], d: number): [number, number] => [p[0] + fp.n[0] * d, p[1] + fp.n[1] * d];
  return [off(fp.a, fp.near), off(fp.a, fp.far), off(end, fp.near), off(end, fp.far)];
}

// Bilinear sample of the terrain grid; same convention as src/main.ts makeTerrainY
// (heights column-major, col * (rows + 1) + row, origin = centre).
function terrainHeight(track: TrackDataV2, x: number, z: number): number {
  const t = track.terrain;
  const vertexRows = t.rows + 1;
  const minX = t.originX - t.sizeX / 2;
  const minZ = t.originZ - t.sizeZ / 2;
  const fx = Math.min(Math.max(((x - minX) / t.sizeX) * t.cols, 0), t.cols);
  const fz = Math.min(Math.max(((z - minZ) / t.sizeZ) * t.rows, 0), t.rows);
  const j = Math.min(Math.floor(fx), t.cols - 1);
  const i = Math.min(Math.floor(fz), t.rows - 1);
  const tx = fx - j;
  const tz = fz - i;
  const h00 = t.heights[j * vertexRows + i];
  const h10 = t.heights[(j + 1) * vertexRows + i];
  const h01 = t.heights[j * vertexRows + i + 1];
  const h11 = t.heights[(j + 1) * vertexRows + i + 1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

// Synthetic closed centerline: 4 straights of 400 m + 4 quarter arcs of radius 50 m,
// 1 m spacing; index 0 at (0, 0), index 300 at 300 m along the first straight.
function stadiumCenterline(): Array<[number, number]> {
  const R = 50;
  const na = Math.round((R * Math.PI) / 2);
  const pts: Array<[number, number]> = [];
  const arc = (cx: number, cz: number, th0: number): void => {
    for (let k = 1; k <= na; k++) {
      const th = th0 + (Math.PI / 2) * (k / na);
      pts.push([cx + R * Math.cos(th), cz + R * Math.sin(th)]);
    }
  };
  for (let i = 0; i <= 400; i++) pts.push([i, 0]);
  arc(400, 50, -Math.PI / 2);
  for (let i = 1; i <= 400; i++) pts.push([450, 50 + i]);
  arc(400, 450, 0);
  for (let i = 1; i <= 400; i++) pts.push([400 - i, 500]);
  arc(0, 450, Math.PI / 2);
  for (let i = 1; i <= 400; i++) pts.push([-50, 450 - i]);
  arc(0, 50, Math.PI);
  return pts;
}

describe('173 pit range acceptance', () => {
  it('AT1: clipPitRange stops the end before the arc (chord deviation ≤ 2 m) and start = index 10', async () => {
    const clipPitRange = await loadClipPitRange();
    const cl = stadiumCenterline();
    const { start, end } = clipPitRange(cl, 300, -290, 290);
    expect(start).toBe(10);
    const covered = rangeIndices(start, end, cl.length);
    expect(maxChordDeviation(cl, covered)).toBeLessThanOrEqual(2);
  });

  it('AT2: every track pit range has max chord deviation ≤ 2.0 m', () => {
    for (const { id, track } of tracksWithPit()) {
      const covered = rangeIndices(track.pit.start, track.pit.end, track.centerline.length);
      expect(maxChordDeviation(track.centerline, covered), id).toBeLessThanOrEqual(2.0);
    }
  });

  it('AT3: every track pit range is at least 120 m long along the centerline', () => {
    for (const { id, track } of tracksWithPit()) {
      const covered = rangeIndices(track.pit.start, track.pit.end, track.centerline.length);
      expect(pathLength(track.centerline, covered), id).toBeGreaterThanOrEqual(120);
    }
  });

  it('AT4: the building footprint stays ≥ width/2 + 1 m from every centerline point outside the pit range', () => {
    for (const { id, track } of tracksWithPit()) {
      const fp = footprintRect(track);
      const n = track.centerline.length;
      const span = wrap(track.pit.end - track.pit.start, n);
      for (let i = 0; i < n; i++) {
        if (wrap(i - track.pit.start, n) <= span) continue;
        expect(distToFootprint(track.centerline[i], fp), `${id} index ${i}`).toBeGreaterThanOrEqual(
          track.widthMeters / 2 + 1,
        );
      }
    }
  });

  it('AT6: the pit mesh base y ≤ min(elevation over the pit range, terrain height at the footprint corners) + 0.01', () => {
    for (const { id, track } of tracksWithPit()) {
      if (!track.terrain) continue;
      const group = createPitBuilding(track);
      group.updateMatrixWorld(true);
      const meshes: THREE.Mesh[] = [];
      group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name === 'pit') meshes.push(o);
      });
      expect(meshes, id).toHaveLength(1);
      const box = new THREE.Box3().setFromObject(meshes[0]);
      const covered = rangeIndices(track.pit.start, track.pit.end, track.centerline.length);
      let elevMin = Infinity;
      for (const k of covered) elevMin = Math.min(elevMin, track.elevation[k]);
      let terrMin = Infinity;
      for (const [cx, cz] of footprintCorners(track)) terrMin = Math.min(terrMin, terrainHeight(track, cx, cz));
      expect(box.min.y, id).toBeLessThanOrEqual(Math.min(elevMin, terrMin) + 0.01);
    }
  });
});
