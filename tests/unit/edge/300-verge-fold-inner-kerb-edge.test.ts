import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { Side, SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { INNER_ARC_WINDOW, buildTrackSurfaces, halfWidthAt } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');
const BAND_MARGIN = 0.3;
const EPS = 1e-9;
const ACCEPTANCE_IDS = ['mexico', 'monza', 'cleveland'] as const;

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

function arcOf(cx: [number, number][]): { s: number[]; total: number } {
  const n = cx.length;
  const s = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    s[i] = s[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
  }
  const total = s[n - 1] + Math.hypot(cx[0][0] - cx[n - 1][0], cx[0][1] - cx[n - 1][1]);
  return { s, total };
}

function arcDist(s: number[], total: number, i: number, j: number): number {
  const d = Math.abs(s[i] - s[j]);
  return Math.min(d, total - d);
}

interface RowGrid {
  cell: number;
  cells: Map<string, number[]>;
}

function buildRowGrid(cx: [number, number][], maxBand: number): RowGrid {
  const cell = Math.max(maxBand, 1);
  const cells = new Map<string, number[]>();
  cx.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = cells.get(k);
    if (list) list.push(i);
    else cells.set(k, [i]);
  });
  return { cell, cells };
}

function maxBandOf(track: TrackDataV2): number {
  let max = 0;
  for (let j = 0; j < track.centerline.length; j++) {
    max = Math.max(max, halfWidthAt(track, 'left', j), halfWidthAt(track, 'right', j));
  }
  return max + KERB_WIDTH + BAND_MARGIN;
}

/** Point sits inside the kerb band of row j: dist < halfWidthAt(its side, j) + KERB_WIDTH + 0.3. */
function inBandOf(track: TrackDataV2, p: [number, number], j: number): boolean {
  const [jx, jz] = track.centerline[j];
  const dx = p[0] - jx;
  const dz = p[1] - jz;
  if (Math.hypot(dx, dz) >= halfWidthAt(track, 'left', j) + KERB_WIDTH + BAND_MARGIN + EPS &&
      Math.hypot(dx, dz) >= halfWidthAt(track, 'right', j) + KERB_WIDTH + BAND_MARGIN + EPS) {
    return false;
  }
  const [rx, rz] = rightNormalAt(track.centerline, j);
  const side: Side = dx * rx + dz * rz >= 0 ? 'right' : 'left';
  return Math.hypot(dx, dz) < halfWidthAt(track, side, j) + KERB_WIDTH + BAND_MARGIN + EPS;
}

/** Rows j whose band contains the point and which are more than INNER_ARC_WINDOW arc-metres from every own row. */
function foreignBandRows(
  track: TrackDataV2,
  grid: RowGrid,
  sArc: number[],
  total: number,
  ownRows: number[],
  p: [number, number],
): number[] {
  const out: number[] = [];
  const gx = Math.floor(p[0] / grid.cell);
  const gz = Math.floor(p[1] / grid.cell);
  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      for (const j of grid.cells.get(`${gx + a},${gz + b}`) ?? []) {
        if (ownRows.some((o) => arcDist(sArc, total, j, o) <= INNER_ARC_WINDOW)) continue;
        if (inBandOf(track, p, j)) out.push(j);
      }
    }
  }
  return out;
}

function normIndex(i: number, n: number): number {
  return ((i % n) + n) % n;
}

function segmentLength(start: number, end: number, n: number): number {
  return ((end - start + n) % n) + 1;
}

interface Tri {
  surf: string;
  ownRows: number[];
  pts: Array<[number, number]>;
}

/** Verge and runoff triangles with their generating rows; escape strips (runoff without segment) excluded. */
function candidateTris(track: TrackDataV2, strips: SurfaceStrip[]): Tri[] {
  const cx = track.centerline;
  const n = cx.length;
  const out: Tri[] = [];
  for (const s of strips) {
    if (s.surface === 'asphalt' || s.surface === 'kerb') continue;
    if (s.surface !== 'grass' && !s.segment) continue; // escape strips appended verbatim (141)
    const w = s.surface === 'grass' && !s.segment ? 3 : 2;
    let rowBase = 0;
    if (s.segment?.kind === 'runoff') {
      const seg = track.runoffs[s.segment.index];
      const start = normIndex(seg.start, n);
      const end = normIndex(seg.end, n);
      const k = segmentLength(start, end, n);
      const ext = k + 2 <= n ? 1 : 0;
      rowBase = start - ext;
    }
    const p = s.positions;
    const ind = s.indices;
    for (let t = 0; t + 2 < ind.length; t += 3) {
      const rows = new Set<number>();
      const pts: Array<[number, number]> = [];
      for (let u = 0; u < 3; u++) {
        const vi = ind[3 * t + u];
        rows.add(w === 3 ? Math.floor(vi / w) % n : normIndex(rowBase + Math.floor(vi / w), n));
        pts.push([p[3 * vi], p[3 * vi + 2]]);
      }
      pts.push([
        (pts[0][0] + pts[1][0] + pts[2][0]) / 3,
        (pts[0][1] + pts[1][1] + pts[2][1]) / 3,
      ]);
      out.push({ surf: s.surface, ownRows: Array.from(rows), pts });
    }
  }
  return out;
}

function foreignBandOffenders(track: TrackDataV2, strips: SurfaceStrip[]): string[] {
  const cx = track.centerline;
  const { s: sArc, total } = arcOf(cx);
  const grid = buildRowGrid(cx, maxBandOf(track));
  const bad: string[] = [];
  for (const tri of candidateTris(track, strips)) {
    for (const pt of tri.pts) {
      const hits = foreignBandRows(track, grid, sArc, total, tri.ownRows, pt);
      if (hits.length > 0) {
        bad.push(`${tri.surf} rows ${tri.ownRows.join('/')} point (${pt[0].toFixed(1)},${pt[1].toFixed(1)}) in band of rows ${hits.slice(0, 3).join(',')}`);
        break;
      }
    }
  }
  return bad;
}

describe('300 verge fold over inner kerb edge cases', () => {
  it('EDGE1: no verge or runoff triangle point lies inside the kerb band of a foreign row on mexico, monza and cleveland', () => {
    for (const id of ACCEPTANCE_IDS) {
      const track = loadTrack(id);
      const bad = foreignBandOffenders(track, buildTrackSurfaces(track));
      expect(bad, `${id}: ${bad.length} offenders, e.g. ${bad[0] ?? ''}`).toEqual([]);
    }
  }, 120000);

  it('EDGE2: the foreign-band rule also holds on tracks outside the acceptance set (sepang, bahrain, spa)', () => {
    for (const id of ['sepang', 'bahrain', 'spa']) {
      const track = loadTrack(id);
      const bad = foreignBandOffenders(track, buildTrackSurfaces(track));
      expect(bad, `${id}: ${bad.length} offenders, e.g. ${bad[0] ?? ''}`).toEqual([]);
    }
  }, 120000);
});

function fixture(extra?: Partial<TrackDataV2>): TrackDataV2 {
  const straight = 200;
  const r = 7;
  const m = Math.max(12, Math.ceil(Math.PI * r));
  const centerline: [number, number][] = [];
  for (let i = 0; i <= straight; i++) centerline.push([i, 0]);
  for (let j = 1; j <= m; j++) {
    const phi = Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([straight + r * Math.cos(phi), -r + r * Math.sin(phi)]);
  }
  for (let i = 1; i <= straight; i++) centerline.push([straight - i, -2 * r]);
  for (let j = 1; j <= m; j++) {
    const phi = -Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([r * Math.cos(phi), -r + r * Math.sin(phi)]);
  }
  const n = centerline.length;
  return {
    version: 2,
    id: 'edge-300-fold',
    name: 'Edge 300 Fold',
    widthMeters: 6,
    lengthMeters: 2 * straight + 2 * Math.PI * r,
    officialLengthMeters: 2 * straight + 2 * Math.PI * r,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    elevation: centerline.map(() => 0),
    kerbs: [
      { start: 0, end: n - 1, side: 'left' },
      { start: 0, end: n - 1, side: 'right' },
    ],
    runoffs: [],
    barriers: [],
    terrain: { originX: -20, originZ: -40, sizeX: 260, sizeZ: 80, rows: 2, cols: 2, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'CC0', url: '', dem: '' },
    ...extra,
  } as TrackDataV2;
}

describe('300 synthetic out-and-back fold', () => {
  it('EDGE3: the outbound left verge is dropped where it lies over the return leg kerb band, and its own inner verge survives', () => {
    const track = fixture();
    const strips = buildTrackSurfaces(track);
    expect(foreignBandOffenders(track, strips)).toEqual([]);
    const vergeLeft = strips.find((s) => s.surface === 'grass' && !s.segment);
    expect(vergeLeft).toBeDefined();
    const p = vergeLeft!.positions;
    let ownInnerKept = 0;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] > 50 && p[i] < 150 && p[i + 2] < -4 && p[i + 2] > -5) ownInnerKept++;
    }
    expect(ownInnerKept).toBeGreaterThan(0);
  });
});

describe('300 window exemption and lap seam', () => {
  it('EDGE4: mexico verge keeps triangles whose points sit inside the band of rows within INNER_ARC_WINDOW of their own', () => {
    const track = loadTrack('mexico');
    const cx = track.centerline;
    const n = cx.length;
    const { s: sArc, total } = arcOf(cx);
    const grid = buildRowGrid(cx, maxBandOf(track));
    const vergeStrips = buildTrackSurfaces(track).filter((s) => s.surface === 'grass' && !s.segment);
    expect(vergeStrips.length).toBeGreaterThan(0);
    let kept = 0;
    for (const tri of candidateTris(track, vergeStrips)) {
      for (const pt of tri.pts) {
        const gx = Math.floor(pt[0] / grid.cell);
        const gz = Math.floor(pt[1] / grid.cell);
        for (let a = -1; a <= 1 && kept === 0; a++) {
          for (let b = -1; b <= 1 && kept === 0; b++) {
            for (const j of grid.cells.get(`${gx + a},${gz + b}`) ?? []) {
              if (tri.ownRows.includes(j % n)) continue;
              const near = tri.ownRows.some((o) => arcDist(sArc, total, j, o) <= INNER_ARC_WINDOW);
              if (near && inBandOf(track, pt, j)) kept++;
            }
          }
        }
      }
    }
    expect(kept).toBeGreaterThan(0);
  }, 120000);

  it('EDGE5: the closed verge strip keeps its seam quads across index 0 on mexico, monza and cleveland', () => {
    for (const id of ACCEPTANCE_IDS) {
      const track = loadTrack(id);
      const n = track.centerline.length;
      const vergeStrips = buildTrackSurfaces(track).filter((s) => s.surface === 'grass' && !s.segment);
      expect(vergeStrips.length).toBeGreaterThanOrEqual(2);
      for (const s of vergeStrips) {
        const ind = s.indices;
        let seamQuads = 0;
        for (let t = 0; t + 2 < ind.length; t += 3) {
          const rows = new Set(
            [ind[3 * t], ind[3 * t + 1], ind[3 * t + 2]].map((vi) => Math.floor(vi / 3) % n),
          );
          if (rows.has(0) && rows.has(n - 1)) seamQuads++;
        }
        expect(seamQuads, `${id} verge seam quads`).toBeGreaterThan(0);
      }
    }
  }, 120000);
});
