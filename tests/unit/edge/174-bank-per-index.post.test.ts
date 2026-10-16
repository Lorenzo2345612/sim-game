import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';
import type { EscapeRoad, SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces, escapeRoadStrips } from '../../../src/track/surfaces';
import { buildTrackMarkings } from '../../../src/track/markings';
import { barrierRuns } from '../../../src/track/barrierPath';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function rectPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 5) pts.push([x, 0]);
  for (let z = 5; z <= 100; z += 5) pts.push([200, z]);
  for (let x = 195; x >= 5; x -= 5) pts.push([x, 100]);
  for (let z = 95; z >= 5; z -= 5) pts.push([0, z]);
  return pts;
}

const POINTS = rectPoints();
const N = POINTS.length;

// Distinct per-row cross-slopes so a build that reuses one index's tan cannot pass.
const BANK = POINTS.map((_, i) => (((i * 7) % 17) - 8) * 0.01);

function track(bank?: number[], escapeRoads: EscapeRoad[] = []): TrackDataV2 {
  return {
    version: 2,
    id: 'bank-per-index',
    name: 'Bank Per Index',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
    sectors: [0, 40, 80],
    elevation: POINTS.map((_, i) => 3 + i * 0.01),
    kerbs: [{ start: 4, end: 12, side: 'right' }],
    runoffs: [{ start: 4, end: 12, side: 'left', surface: 'gravel', widthMeters: 5 }],
    barriers: [
      { start: 0, end: N - 1, side: 'right', type: 'armco', offsetMeters: 8 },
      { start: 20, end: 40, side: 'left', type: 'tyres', offsetMeters: 10 },
    ],
    terrain: { originX: 100, originZ: 50, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads,
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
}

function rightNormalOf(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

function rightNormal(i: number): [number, number] {
  return rightNormalOf(POINTS, i);
}

function lateral(i: number, x: number, z: number): number {
  const [rx, rz] = rightNormal(i);
  return (x - POINTS[i][0]) * rx + (z - POINTS[i][1]) * rz;
}

function nearestIndex(x: number, z: number): number {
  let best = 0;
  let bestD2 = Infinity;
  for (let i = 0; i < N; i++) {
    const d2 = (POINTS[i][0] - x) ** 2 + (POINTS[i][1] - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

function findStrip(strips: SurfaceStrip[], surface: string): SurfaceStrip {
  const s = strips.find((x) => x.surface === surface);
  if (!s) throw new Error(`no ${surface} strip`);
  return s;
}

function cumulativeOf(track: TrackDataV2): { cum: number[]; total: number } {
  const cx = track.centerline;
  const cum = [0];
  for (let i = 1; i < cx.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]));
  }
  const total =
    cum[cum.length - 1] + Math.hypot(cx[0][0] - cx[cx.length - 1][0], cx[0][1] - cx[cx.length - 1][1]);
  return { cum, total };
}

function wrapMargin(m: number, from: number, to: number, total: number): number {
  if (from <= to) return Math.min(m - from, to - m);
  const fwd = (((m - from) % total) + total) % total;
  const span = (((to - from) % total) + total) % total;
  return Math.min(fwd, span - fwd);
}

describe('174 bank per-index geometry and bankProfile wrap gaps', () => {
  it('every strip, marking and barrier vertex lifts by d*tan(bank) of its own row index', () => {
    const banked = track(BANK);
    const flat = track(new Array<number>(N).fill(0));
    const stripsB = buildTrackSurfaces(banked);
    const stripsF = buildTrackSurfaces(flat);

    const asphaltB = findStrip(stripsB, 'asphalt');
    const asphaltF = findStrip(stripsF, 'asphalt');
    for (let i = 0; i < N; i++) {
      for (let c = 0; c < 2; c++) {
        const p = (i * 2 + c) * 3;
        const d = lateral(i, asphaltB.positions[p], asphaltB.positions[p + 2]);
        expect(
          Math.abs(asphaltB.positions[p + 1] - asphaltF.positions[p + 1] - d * Math.tan(BANK[i])),
          `asphalt row ${i} col ${c}`,
        ).toBeLessThanOrEqual(1e-4);
      }
    }

    // Kerb 4..12 and run-off 4..12 both emit rows at indices 3..13 (one pre/post row).
    const rowsOf = (b: SurfaceStrip, f: SurfaceStrip, label: string): void => {
      for (let r = 0; r < 11; r++) {
        const idx = 3 + r;
        for (let c = 0; c < 2; c++) {
          const p = (r * 2 + c) * 3;
          const d = lateral(idx, b.positions[p], b.positions[p + 2]);
          expect(
            Math.abs(b.positions[p + 1] - f.positions[p + 1] - d * Math.tan(BANK[idx])),
            `${label} row ${r} (index ${idx})`,
          ).toBeLessThanOrEqual(1e-4);
        }
      }
    };
    rowsOf(findStrip(stripsB, 'kerb'), findStrip(stripsF, 'kerb'), 'kerb');
    rowsOf(findStrip(stripsB, 'gravel'), findStrip(stripsF, 'gravel'), 'runoff');

    const marksB = buildTrackMarkings(banked);
    const marksF = buildTrackMarkings(flat);
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < N; i++) {
        for (let c = 0; c < 2; c++) {
          const p = (i * 2 + c) * 3;
          const d = lateral(i, marksB[k].positions[p], marksB[k].positions[p + 2]);
          expect(
            Math.abs(marksB[k].positions[p + 1] - marksF[k].positions[p + 1] - d * Math.tan(BANK[i])),
            `mark ${k} row ${i}`,
          ).toBeLessThanOrEqual(1e-4);
        }
      }
    }

    let barrierChecked = 0;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'right' ? 1 : -1;
      const off = side === 'right' ? 8 : 10;
      for (const run of barrierRuns(banked, side)) {
        for (const v of run) {
          const d = sign * off;
          expect(
            Math.abs(v.y - ((3 + v.index * 0.01) + d * Math.tan(BANK[v.index]))),
            `barrier ${side} index ${v.index}`,
          ).toBeLessThanOrEqual(1e-4);
          barrierChecked++;
        }
      }
    }
    expect(barrierChecked).toBeGreaterThan(0);
  });

  it('each escape-road row takes the bank of its own nearest centerline index', () => {
    const roads: EscapeRoad[] = [{ points: [[20, 12], [40, 12], [60, 12]], width: 4 }];
    const bank = new Array<number>(N).fill(0);
    bank[4] = 0.1;
    bank[8] = -0.15;
    bank[12] = 0.25;
    const sb = escapeRoadStrips(track(bank, roads))[0];
    const sf = escapeRoadStrips(track(new Array<number>(N).fill(0), roads))[0];
    expect(sb.positions).toHaveLength(3 * 2 * 3);
    for (let r = 0; r < 3; r++) {
      const best = nearestIndex(roads[0].points[r][0], roads[0].points[r][1]);
      expect(best).toBe([4, 8, 12][r]);
      for (let c = 0; c < 2; c++) {
        const p = (r * 2 + c) * 3;
        const d = lateral(best, sb.positions[p], sb.positions[p + 2]);
        expect(
          Math.abs(sb.positions[p + 1] - sf.positions[p + 1] - d * Math.tan(bank[best])),
          `escape row ${r} (index ${best})`,
        ).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('bankProfile keeps the first of two overlapping equal-magnitude ranges, sign included', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const bank = bankProfile(
      cum,
      1000,
      [
        { fromMeters: 100, toMeters: 400, degrees: 15, raisedSide: 'right' },
        { fromMeters: 300, toMeters: 600, degrees: 15, raisedSide: 'left' },
      ],
      60,
    );
    expect(bank[350]).toBeCloseTo(15 * DEG, 6);
    expect(bank[200]).toBeCloseTo(15 * DEG, 6);
    expect(bank[550]).toBeCloseTo(-15 * DEG, 6);
  });

  it('bankProfile ramps a wrap range half at both boundaries and full across the start seam', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const ranges: BankRange[] = [{ fromMeters: 950, toMeters: 50, degrees: 31, raisedSide: 'right' }];
    const bank = bankProfile(cum, 1000, ranges, 60);
    const full = 31 * DEG;
    expect(bank[950]).toBeCloseTo(full / 2, 6);
    expect(bank[50]).toBeCloseTo(full / 2, 6);
    expect(bank[920]).toBeCloseTo(0, 12);
    expect(bank[80]).toBeCloseTo(0, 12);
    expect(bank[980]).toBeCloseTo(full, 6);
    expect(bank[20]).toBeCloseTo(full, 6);
    expect(bank[995]).toBeCloseTo(full, 6);
    expect(bank[5]).toBeCloseTo(full, 6);
    expect(bank[0]).toBeCloseTo(full, 6);
    for (let i = 920; i < 980; i++) {
      expect(bank[i + 1], `rise at ${i}`).toBeGreaterThanOrEqual(bank[i] - 1e-12);
    }
    for (let i = 20; i < 80; i++) {
      expect(bank[i + 1], `fall at ${i}`).toBeLessThanOrEqual(bank[i] + 1e-12);
    }
  });

  it('daytona banking is non-negative everywhere and reaches its full positive value inside the oval ranges', () => {
    const daytona = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'),
    ) as TrackDataV2 & { bank: number[] };
    for (const b of daytona.bank) expect(b).toBeGreaterThanOrEqual(-1e-12);
    const { cum, total } = cumulativeOf(daytona);
    const zones: Array<[number, number, number, number]> = [
      [2290, 3180, 30, 32],
      [4090, 5150, 30, 32],
      [5150, 160, 17, 19],
      [3180, 3680, 1.5, 2.5],
    ];
    for (const [from, to, lo, hi] of zones) {
      let checked = 0;
      for (let i = 0; i < cum.length; i++) {
        if (wrapMargin(cum[i], from, to, total) < 100) continue;
        const deg = daytona.bank[i] / DEG;
        expect(deg, `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeGreaterThan(0);
        expect(deg, `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeGreaterThanOrEqual(lo);
        expect(deg, `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeLessThanOrEqual(hi);
        checked++;
      }
      expect(checked, `no index 100 m inside ${from}..${to}`).toBeGreaterThan(0);
    }
  }, 120000);

  it('daytona asphalt rows slope from the per-index bank of the row they are built from', () => {
    const daytona = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'),
    ) as TrackDataV2 & { bank: number[] };
    const strips = buildTrackSurfaces(daytona);
    const asphalt = findStrip(strips, 'asphalt');
    const cx = daytona.centerline;
    const daytonaLateral = (i: number, x: number, z: number): number => {
      const [rx, rz] = rightNormalOf(cx, i);
      return (x - cx[i][0]) * rx + (z - cx[i][1]) * rz;
    };
    const { cum, total } = cumulativeOf(daytona);
    let checked = 0;
    for (let i = 0; i < cx.length; i++) {
      if (wrapMargin(cum[i], 4300, 4900, total) < 50) continue;
      const p0 = i * 2 * 3;
      const p1 = p0 + 3;
      const yL = asphalt.positions[p0 + 1];
      const yR = asphalt.positions[p1 + 1];
      const dR = daytonaLateral(i, asphalt.positions[p1], asphalt.positions[p1 + 2]);
      const dL = daytonaLateral(i, asphalt.positions[p0], asphalt.positions[p0 + 2]);
      expect(Math.abs(yR - yL - (dR - dL) * Math.tan(daytona.bank[i])), `row ${i}`).toBeLessThanOrEqual(1e-3);
      expect(yR, `row ${i} right edge higher`).toBeGreaterThan(yL);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);

  it('buildTerrain leaves tail indices flat when the bank array is shorter than the centerline', () => {
    const ORIGIN: LonLat = [0, 0];
    const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;
    const dem: DemGrid = {
      lon0: -615 / DEG_M,
      lat0: 615 / DEG_M,
      dLon: 30 / DEG_M,
      dLat: 30 / DEG_M,
      rows: 42,
      cols: 42,
      heights: new Array<number>(42 * 42).fill(100),
    };
    const straight: Point2[] = Array.from({ length: 41 }, (_, k) => [-100 + 5 * k, 0] as Point2);
    const elev = straight.map(() => 0);
    // Covers indices 0..24 only (x = -100..20); the tail falls back to flat.
    const t = buildTerrain(dem, straight, elev, ORIGIN, 12, 3, new Array<number>(25).fill(10 * DEG));
    const node = (x: number, z: number): number => {
      const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
      const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
      return t.heights[j * (t.rows + 1) + i];
    };
    // Node (4, 8) sits nearest index 21, inside the short bank array.
    expect(node(4, 8)).toBeCloseTo(-0.15 + 8 * Math.tan(10 * DEG), 2);
    expect(node(4, -8)).toBeCloseTo(-0.15 - 8 * Math.tan(10 * DEG), 2);
    // Node (44, 8) sits nearest index 29, past the end of the array.
    expect(node(44, 8)).toBeCloseTo(-0.15, 2);
    expect(node(44, -8)).toBeCloseTo(-0.15, 2);
  });

  it('parseTrackData defaults bank to an empty array when v2 has no centerline', () => {
    const parsed = parseTrackData({ version: 2 }) as TrackDataV2 & { bank?: number[] };
    expect(parsed.bank).toEqual([]);
  });

  it('the daytona registry banking table matches the four oval ranges of the spec', () => {
    const registry = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
    ) as Array<{ id: string; banking?: BankRange[] }>;
    const cfg = registry.find((t) => t.id === 'daytona');
    expect(cfg?.banking).toEqual([
      { fromMeters: 2290, toMeters: 3180, degrees: 31, raisedSide: 'right' },
      { fromMeters: 3180, toMeters: 3680, degrees: 2, raisedSide: 'right' },
      { fromMeters: 4090, toMeters: 5150, degrees: 31, raisedSide: 'right' },
      { fromMeters: 5150, toMeters: 160, degrees: 18, raisedSide: 'right' },
    ]);
  });
});
