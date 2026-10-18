import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import type { SurfaceStrip, TrackDataV2 } from '../../../src/core/types';
import { buildTrackMarkings } from '../../../src/track/markings';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { barrierRuns } from '../../../src/track/barrierPath';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function loadDaytona(): TrackDataV2 & { bank?: number[] } {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'),
  ) as TrackDataV2 & { bank?: number[] };
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

function wrapInside(m: number, from: number, to: number): boolean {
  if (from <= to) return m >= from && m <= to;
  return m >= from || m <= to;
}

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

function fixture(): TrackDataV2 {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 100; x += 5) pts.push([x, 0]);
  for (let x = 95; x > 0; x -= 5) pts.push([x, 4]);
  return {
    version: 2,
    id: 'synthetic-bank-edge',
    name: 'Synthetic Bank Edge',
    widthMeters: 12,
    lengthMeters: 208,
    officialLengthMeters: 208,
    centerline: pts,
    sectors: [0, 10, 20],
    elevation: pts.map(() => 3),
    kerbs: [{ start: 2, end: 8, side: 'right' }],
    runoffs: [{ start: 2, end: 8, side: 'left', surface: 'gravel', widthMeters: 5 }],
    barriers: [
      { start: 0, end: pts.length - 1, side: 'right', type: 'armco', offsetMeters: 8 },
      { start: 5, end: 15, side: 'left', type: 'tyres', offsetMeters: 10 },
    ],
    terrain: { originX: 50, originZ: 2, sizeX: 140, sizeZ: 40, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'synthetic', license: 'CC0', url: '', dem: '' },
  };
}

function findStrip(strips: SurfaceStrip[], surface: string): SurfaceStrip {
  const s = strips.find((x) => x.surface === surface);
  if (!s) throw new Error(`no ${surface} strip`);
  return s;
}

function lateralAt(track: TrackDataV2, i: number, x: number, z: number): number {
  const [rx, rz] = rightNormal(track.centerline, i);
  return (x - track.centerline[i][0]) * rx + (z - track.centerline[i][1]) * rz;
}

function bitIdentical(a: Float32Array, b: Float32Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

describe('174 track banking edge cases', () => {
  it('EDGE1: overlapping bankProfile ranges take the value of the larger magnitude, sign included', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const ranges: BankRange[] = [
      { fromMeters: 100, toMeters: 400, degrees: 10, raisedSide: 'right' },
      { fromMeters: 250, toMeters: 600, degrees: 31, raisedSide: 'left' },
    ];
    const bank = bankProfile(cum, 1000, ranges, 60);
    expect(bank[175]).toBeCloseTo(10 * DEG, 6);
    expect(bank[325]).toBeCloseTo(-31 * DEG, 6);
    expect(bank[525]).toBeCloseTo(-31 * DEG, 6);
  });

  it('EDGE2: omitting rampMeters selects auto mode', () => {
    const cum = Array.from({ length: 400 }, (_, i) => i * 2.5);
    const ranges: BankRange[] = [
      { fromMeters: 50, toMeters: 300, degrees: 18, raisedSide: 'right' },
      { fromMeters: 700, toMeters: 200, degrees: 2, raisedSide: 'left' },
    ];
    expect(bankProfile(cum, 1000, ranges, 60)).not.toEqual(bankProfile(cum, 1000, ranges));
  });

  it('EDGE3: bankProfile does not mutate its cumulativeMeters or ranges inputs', () => {
    const cum = [0, 10, 20, 30, 40, 50];
    const ranges: BankRange[] = [
      { fromMeters: 10, toMeters: 40, degrees: 20, raisedSide: 'right' },
    ];
    const cumSnap = [...cum];
    const rangeSnap = ranges.map((r) => ({ ...r }));
    Object.freeze(cum);
    Object.freeze(ranges);
    Object.freeze(ranges[0]);
    const bank = bankProfile(cum, 55, ranges, 20);
    expect(bank).toHaveLength(cum.length);
    expect(cum).toEqual(cumSnap);
    expect(ranges).toEqual(rangeSnap);
  });

  it('EDGE4: empty ranges, degrees 0 and toMeters == fromMeters all produce a zero profile', () => {
    const cum = Array.from({ length: 200 }, (_, i) => i * 5);
    const zeros = (bank: number[]): void => {
      expect(bank).toHaveLength(200);
      for (const b of bank) expect(Math.abs(b)).toBeLessThanOrEqual(1e-15);
    };
    zeros(bankProfile(cum, 1000, [], 60));
    zeros(bankProfile(cum, 1000, [{ fromMeters: 100, toMeters: 800, degrees: 0, raisedSide: 'right' }], 60));
    zeros(bankProfile(cum, 1000, [{ fromMeters: 400, toMeters: 400, degrees: 31, raisedSide: 'left' }], 60));
  });

  it('EDGE5: bankProfile throws Error on non-finite numbers', () => {
    expect(() => bankProfile([0, NaN, 2], 3, [], 60)).toThrow(Error);
    expect(() => bankProfile([0, Infinity, 2], 3, [], 60)).toThrow(Error);
    expect(() => bankProfile([0, 1, 2], NaN, [], 60)).toThrow(Error);
    expect(() =>
      bankProfile([0, 1, 2], 3, [{ fromMeters: 0, toMeters: 2, degrees: Infinity, raisedSide: 'right' }], 60),
    ).toThrow(Error);
    expect(() => bankProfile([0, 1, 2], 3, [], NaN)).toThrow(Error);
  });

  it('EDGE6: parseTrackData keeps a provided bank array unchanged', () => {
    const raw = { ...fixture(), bank: [0.1, -0.05, 0, 0.2] };
    const parsed = parseTrackData(JSON.parse(JSON.stringify(raw))) as TrackDataV2 & { bank?: number[] };
    expect(parsed.bank).toEqual([0.1, -0.05, 0, 0.2]);
  });

  it('EDGE7: an all-zero bank produces bit-identical surfaces, markings and barrier bases', () => {
    const base = fixture();
    const n = base.centerline.length;
    const zero: TrackDataV2 & { bank: number[] } = { ...base, bank: new Array(n).fill(0) };
    const noBank = { ...base } as TrackDataV2 & { bank?: number[] };
    delete noBank.bank;
    const a = buildTrackSurfaces(zero);
    const b = buildTrackSurfaces(noBank);
    expect(a).toHaveLength(b.length);
    for (let k = 0; k < a.length; k++) {
      expect(a[k].surface).toBe(b[k].surface);
      expect(bitIdentical(a[k].positions, b[k].positions)).toBe(true);
      expect(bitIdentical(a[k].uvs, b[k].uvs)).toBe(true);
      expect(Array.from(a[k].indices)).toEqual(Array.from(b[k].indices));
    }
    const ma = buildTrackMarkings(zero);
    const mb = buildTrackMarkings(noBank);
    expect(ma).toHaveLength(mb.length);
    for (let k = 0; k < ma.length; k++) {
      expect(bitIdentical(ma[k].positions, mb[k].positions)).toBe(true);
    }
    for (const side of ['left', 'right'] as const) {
      const ra = barrierRuns(zero, side);
      const rb = barrierRuns(noBank, side);
      expect(ra.length).toBe(rb.length);
      for (let r = 0; r < ra.length; r++) {
        expect(ra[r].length).toBe(rb[r].length);
        for (let v = 0; v < ra[r].length; v++) {
          expect(Object.is(ra[r][v].y, rb[r][v].y)).toBe(true);
          expect(ra[r][v].x).toBe(rb[r][v].x);
          expect(ra[r][v].z).toBe(rb[r][v].z);
        }
      }
    }
  });

  it('EDGE8: kerbs, run-offs, markings and barrier bases all lift by d*tan(bank)', () => {
    const base = fixture();
    const n = base.centerline.length;
    const tan = Math.tan(10 * DEG);
    const banked: TrackDataV2 & { bank: number[] } = {
      ...base,
      bank: new Array(n).fill(10 * DEG),
    };
    const flat: TrackDataV2 & { bank: number[] } = { ...base, bank: new Array(n).fill(0) };
    const stripsB = buildTrackSurfaces(banked);
    const stripsF = buildTrackSurfaces(flat);
    const pairs: Array<[SurfaceStrip, SurfaceStrip, Array<[number, number]>]> = [
      [findStrip(stripsB, 'asphalt'), findStrip(stripsF, 'asphalt'), base.centerline.map((_, i) => [i, i])],
      [
        findStrip(stripsB, 'kerb'),
        findStrip(stripsF, 'kerb'),
        // Reff drops kerb rows 1-2 (10 m window of the R = 3.2 corner); kept rows 3..9.
        Array.from({ length: 7 }, (_, j) => [3 + j, 3 + j] as [number, number]),
      ],
      [
        findStrip(stripsB, 'gravel'),
        findStrip(stripsF, 'gravel'),
        Array.from({ length: 9 }, (_, j) => [1 + j, 1 + j] as [number, number]),
      ],
    ];
    for (const [sb, sf, rowIdx] of pairs) {
      const cols = sb.positions.length / 3 / rowIdx.length;
      expect(cols).toBe(2);
      for (let r = 0; r < rowIdx.length; r++) {
        const [idx] = rowIdx[r];
        for (let c = 0; c < cols; c++) {
          const p = (r * cols + c) * 3;
          const d = lateralAt(base, idx, sb.positions[p], sb.positions[p + 2]);
          expect(Math.abs(sb.positions[p + 1] - sf.positions[p + 1] - d * tan)).toBeLessThanOrEqual(1e-4);
        }
      }
    }
    const marksB = buildTrackMarkings(banked);
    const marksF = buildTrackMarkings(flat);
    const markRows = [n, n, 2];
    for (let k = 0; k < marksB.length; k++) {
      for (let r = 0; r < markRows[k]; r++) {
        const idx = k < 2 ? r : 0;
        for (let c = 0; c < 2; c++) {
          const p = (r * 2 + c) * 3;
          const d = lateralAt(base, idx, marksB[k].positions[p], marksB[k].positions[p + 2]);
          expect(
            Math.abs(marksB[k].positions[p + 1] - marksF[k].positions[p + 1] - d * tan),
          ).toBeLessThanOrEqual(1e-4);
        }
      }
    }
    let barrierChecked = 0;
    for (const side of ['left', 'right'] as const) {
      const sign = side === 'right' ? 1 : -1;
      for (const run of barrierRuns(banked, side)) {
        for (const v of run) {
          const d = sign * Math.hypot(v.x - base.centerline[v.index][0], v.z - base.centerline[v.index][1]);
          expect(Math.abs(v.y - (base.elevation[v.index] + d * tan))).toBeLessThanOrEqual(1e-4);
          barrierChecked++;
        }
      }
    }
    expect(barrierChecked).toBeGreaterThan(0);
  });

  it('EDGE9: daytona back straight holds a positive 2 deg bank at least 60 m inside 3180..3680', () => {
    const daytona = loadDaytona();
    const bank = daytona.bank;
    expect(bank).toBeDefined();
    const { cum, total } = cumulativeOf(daytona);
    let checked = 0;
    for (let i = 0; i < cum.length; i++) {
      if (wrapMargin(cum[i], 3180, 3680, total) < 60) continue;
      const deg = (bank ?? [])[i] / DEG;
      expect(bank?.[i], `index ${i} at ${cum[i].toFixed(1)} m`).toBeGreaterThan(0);
      expect(deg, `index ${i} at ${cum[i].toFixed(1)} m`).toBeGreaterThanOrEqual(1.9);
      expect(deg, `index ${i} at ${cum[i].toFixed(1)} m`).toBeLessThanOrEqual(2.1);
      checked++;
    }
    expect(checked, 'no index at least 60 m inside the back straight').toBeGreaterThan(0);
  }, 120000);

  it('EDGE10: every daytona surface vertex outside the banked ranges has bank exactly 0', () => {
    const daytona = loadDaytona();
    const bank = daytona.bank ?? [];
    const strips = buildTrackSurfaces(daytona);
    const { cum } = cumulativeOf(daytona);
    const nearest = nearestIndex(daytona);
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
        if (ranges.some(([from, to]) => wrapInside(cum[i], from, to))) continue;
        expect(bank[i] ?? 0, `${s.surface} vertex near index ${i}`).toBe(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 120000);
});
