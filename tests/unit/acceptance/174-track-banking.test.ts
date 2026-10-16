import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { buildTrackSurfaces } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function loadDaytona(): TrackDataV2 & { bank?: number[] } {
  const json = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'));
  return json as TrackDataV2 & { bank?: number[] };
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

/** Inclusive wrap-aware containment of position m in [from, to] on a ring of length total. */
function wrapInside(m: number, from: number, to: number): boolean {
  if (from <= to) return m >= from && m <= to;
  return m >= from || m <= to;
}

/** Distance from m to the nearest boundary of the wrap-aware range, negative when outside. */
function wrapMargin(m: number, from: number, to: number, total: number): number {
  if (from <= to) return Math.min(m - from, to - m);
  const fwd = (((m - from) % total) + total) % total;
  const span = (((to - from) % total) + total) % total;
  return Math.min(fwd, span - fwd);
}

function rightNormal(cx: [number, number][], i: number): [number, number] {
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz);
  return len < 1e-9 ? [0, -1] : [-dz / len, dx / len];
}

function straightTrack(): TrackDataV2 {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 100; x += 5) pts.push([x, 0]);
  for (let x = 95; x > 0; x -= 5) pts.push([x, 4]);
  return {
    version: 2,
    id: 'synthetic-bank',
    name: 'Synthetic Bank',
    widthMeters: 12,
    lengthMeters: 208,
    officialLengthMeters: 208,
    centerline: pts,
    sectors: [0, 10, 20],
    elevation: pts.map(() => 3),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 50, originZ: 2, sizeX: 140, sizeZ: 40, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'synthetic', license: 'CC0', url: '', dem: '' },
  };
}

function asphaltStrip(strips: SurfaceStrip[]): SurfaceStrip {
  const s = strips.find((x) => x.surface === 'asphalt');
  if (!s) throw new Error('no asphalt strip');
  return s;
}

// Bilinear terrain height at (x, z) of a V2 terrain grid.
function terrainHeightAt(track: TrackDataV2): (x: number, z: number) => number {
  const t = track.terrain;
  const x0 = t.originX - t.sizeX / 2;
  const z0 = t.originZ - t.sizeZ / 2;
  const sx = t.sizeX / t.cols;
  const sz = t.sizeZ / t.rows;
  const st = t.rows + 1;
  const h = t.heights;
  return (x, z): number => {
    const fx = (x - x0) / sx;
    const fz = (z - z0) / sz;
    const j = Math.min(t.cols - 1, Math.max(0, Math.floor(fx)));
    const i = Math.min(t.rows - 1, Math.max(0, Math.floor(fz)));
    const u = fx - j;
    const v = fz - i;
    return (
      h[j * st + i] * (1 - u) * (1 - v) +
      h[(j + 1) * st + i] * u * (1 - v) +
      h[j * st + i + 1] * (1 - u) * v +
      h[(j + 1) * st + i + 1] * u * v
    );
  };
}

/** Nearest centerline index of (x, z) via a 60 m grid, brute-force fallback. */
function nearestIndex(track: TrackDataV2): (x: number, z: number) => number {
  const pts = track.centerline;
  const cell = 60;
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  return (x, z): number => {
    const gx = Math.floor(x / cell);
    const gz = Math.floor(z / cell);
    let best = -1;
    let bestD2 = Infinity;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const i of grid.get(`${gx + a},${gz + b}`) ?? []) {
          const d2 = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    if (best >= 0) return best;
    best = 0;
    bestD2 = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d2 = (pts[i][0] - x) ** 2 + (pts[i][1] - z) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    return best;
  };
}

describe('174 track banking acceptance', () => {
  it('AT1: bankProfile full 31 deg inside 200..500, zero outside, half at the boundary, monotonic ramp', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const ranges: BankRange[] = [
      { fromMeters: 200, toMeters: 500, degrees: 31, raisedSide: 'right' },
    ];
    const bank = bankProfile(cum, 1000, ranges, 60);
    const full = 31 * DEG;
    expect(bank).toHaveLength(1000);
    expect(bank[350]).toBeCloseTo(full, 6);
    expect(bank[100]).toBeCloseTo(0, 12);
    expect(bank[600]).toBeCloseTo(0, 12);
    expect(Math.abs(bank[200] - full / 2) / DEG).toBeLessThanOrEqual(0.01);
    for (let i = 170; i < 230; i++) {
      expect(bank[i + 1]).toBeGreaterThanOrEqual(bank[i] - 1e-12);
    }
  });

  it('AT2: bankProfile left is negative and a range wrapping the start gives each index its own sign', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const ranges: BankRange[] = [
      { fromMeters: 200, toMeters: 500, degrees: 31, raisedSide: 'left' },
      { fromMeters: 950, toMeters: 50, degrees: 31, raisedSide: 'right' },
    ];
    const bank = bankProfile(cum, 1000, ranges, 60);
    const full = 31 * DEG;
    expect(bank[350]).toBeCloseTo(-full, 6);
    expect(bank[0]).toBeCloseTo(full, 6);
    expect(Math.abs(bank[970])).toBeGreaterThan(0);
    expect(Math.abs(bank[30])).toBeGreaterThan(0);
  });

  it('AT3: banked straight track-strip vertices sit at elev + d*tan(10 deg) over the flat strip within 1e-4', () => {
    const base = straightTrack();
    const n = base.centerline.length;
    const bankArr = base.centerline.map(() => 10 * DEG);
    const zeroArr = base.centerline.map(() => 0);
    const banked: TrackDataV2 & { bank: number[] } = { ...base, bank: bankArr };
    const flat: TrackDataV2 & { bank: number[] } = { ...base, bank: zeroArr };
    const aB = asphaltStrip(buildTrackSurfaces(banked));
    const aF = asphaltStrip(buildTrackSurfaces(flat));
    expect(aB.positions).toHaveLength(n * 2 * 3);
    // Strip lift over elevation (the flat strip's own height at d = 0).
    const elev = base.elevation[0];
    const flatOffset = (aF.positions[1] + aF.positions[4]) / 2 - elev;
    const tan = Math.tan(10 * DEG);
    for (let i = 0; i < n; i++) {
      const [rx, rz] = rightNormal(base.centerline, i);
      for (let c = 0; c < 2; c++) {
        const p = (i * 2 + c) * 3;
        const d =
          (aB.positions[p] - base.centerline[i][0]) * rx +
          (aB.positions[p + 2] - base.centerline[i][1]) * rz;
        expect(Math.abs(d)).toBeCloseTo(6, 4);
        const expected = elev + flatOffset + d * tan;
        expect(Math.abs(aB.positions[p + 1] - expected)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('AT4: monza without bank parses to all-zero bank and keeps every vertex height within 1e-9 of the bank-less build', () => {
    const raw = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8'),
    ) as TrackDataV2;
    const parsed = parseTrackData(JSON.parse(JSON.stringify(raw))) as TrackDataV2 & {
      bank?: number[];
    };
    const bank = parsed.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(parsed.centerline.length);
    for (const b of bank ?? []) expect(Math.abs(b)).toBeLessThanOrEqual(1e-12);
    const sParsed = buildTrackSurfaces(parsed);
    const sRaw = buildTrackSurfaces(raw);
    expect(sParsed).toHaveLength(sRaw.length);
    for (let k = 0; k < sParsed.length; k++) {
      expect(sParsed[k].positions).toHaveLength(sRaw[k].positions.length);
      for (let j = 1; j < sParsed[k].positions.length; j += 3) {
        expect(Math.abs(sParsed[k].positions[j] - sRaw[k].positions[j])).toBeLessThanOrEqual(1e-9);
      }
    }
  }, 120000);

  it('AT5: daytona bank holds 30..32 deg in the oval turns, 17..19 deg in the tri-oval and zero in the infield ranges', () => {
    const daytona = loadDaytona();
    const bank = daytona.bank;
    expect(bank).toBeDefined();
    expect(bank).toHaveLength(daytona.centerline.length);
    const { cum, total } = cumulativeOf(daytona);
    const oval: Array<[number, number, number, number]> = [
      [2290, 3180, 30, 32],
      [4090, 5150, 30, 32],
      [5150, 160, 17, 19],
    ];
    for (const [from, to, lo, hi] of oval) {
      let checked = 0;
      for (let i = 0; i < cum.length; i++) {
        if (wrapMargin(cum[i], from, to, total) < 60) continue;
        const deg = Math.abs((bank ?? [])[i] ?? 0) / DEG;
        expect(deg, `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeGreaterThanOrEqual(lo);
        expect(deg, `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeLessThanOrEqual(hi);
        checked++;
      }
      expect(checked, `no index at least 60 m inside ${from}..${to}`).toBeGreaterThan(0);
    }
    for (const [from, to] of [
      [210, 2250],
      [3720, 4055],
    ] as const) {
      for (let i = 0; i < cum.length; i++) {
        if (!wrapInside(cum[i], from, to)) continue;
        expect(Math.abs((bank ?? [])[i] ?? NaN), `index ${i} at ${cum[i].toFixed(1)} m in ${from}..${to}`).toBeLessThanOrEqual(1e-12);
      }
    }
  });

  it('AT6: daytona terrain stays at least 0.05 m below every surface vertex of the banked ranges', () => {
    const daytona = loadDaytona();
    const strips = buildTrackSurfaces(daytona);
    const { cum } = cumulativeOf(daytona);
    const nearest = nearestIndex(daytona);
    const th = terrainHeightAt(daytona);
    const ranges: Array<[number, number]> = [
      [2290, 3180],
      [3180, 3680],
      [4090, 5150],
      [5150, 160],
    ];
    let checked = 0;
    for (const s of strips) {
      const p = s.positions;
      for (let k = 0; k + 2 < p.length; k += 3) {
        const i = nearest(p[k], p[k + 2]);
        if (!ranges.some(([from, to]) => wrapInside(cum[i], from, to))) continue;
        expect(th(p[k], p[k + 2]), `${s.surface} vertex at index ${i}`).toBeLessThanOrEqual(p[k + 1] - 0.05);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);
});
