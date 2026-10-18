import { describe, expect, it } from 'vitest';
import { buildSausages } from '../../../tools/track-builder/sausages';
import { detectCorners, radii, type CornerRun } from '../../../tools/track-builder/corners';
import type { Point2 } from '../../../src/track/geo';
import type { Side } from '../../../src/core/types';

const WIDTH = 12;

// Mirrors task 149's Sausage so this test-first file type-checks until types.ts is updated.
interface Sausage149 {
  index: number;
  side: Side;
  offset: number;
  length: number;
}

// Fixtures copied from 140-paved-runoffs.test.ts (not exported there).
// Rounded square: 4 straights of 600 m + 4 quarter-circle arcs of radius R, ~2 m spacing.
function roundedSquare(R: number): Point2[] {
  const L = 600 + 2 * R;
  const pts: Point2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    const k = Math.round(((Math.PI / 2) * R) / 2);
    for (let j = 1; j <= k; j++) {
      const a = ((a0 + (90 * j) / k) * Math.PI) / 180;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  };
  for (let i = 1; i <= 300; i++) pts.push([R + 2 * i, 0]);
  arc(L - R, R, -90);
  for (let i = 1; i <= 300; i++) pts.push([L, R + 2 * i]);
  arc(L - R, L - R, 0);
  for (let i = 1; i <= 300; i++) pts.push([L - R - 2 * i, L]);
  arc(R, L - R, 90);
  for (let i = 1; i <= 300; i++) pts.push([0, L - R - 2 * i]);
  arc(R, R, 180);
  return pts;
}

// AT3 fixture: 500 m straight along -Z, left arc R 40 (60 deg), 50 m straight,
// right arc R 40 (60 deg), 500 m straight, closed by a loop of R 300 quarter arcs.
function chicaneFixture(): Point2[] {
  const pts: Point2[] = [[0, 0]];
  let px = 0;
  let pz = 0;
  let phi = -Math.PI / 2;
  const straight = (m: number): void => {
    let d = m;
    while (d > 1e-9) {
      const s = Math.min(2, d);
      d -= s;
      px += s * Math.cos(phi);
      pz += s * Math.sin(phi);
      pts.push([px, pz]);
    }
  };
  const arc = (R: number, deg: number, s: number): void => {
    const span = (deg * Math.PI) / 180;
    const k = Math.max(1, Math.ceil((R * span) / 2));
    const cx = px + s * R * -Math.sin(phi);
    const cz = pz + s * R * Math.cos(phi);
    const vx = px - cx;
    const vz = pz - cz;
    for (let j = 1; j <= k; j++) {
      const th = (s * span * j) / k;
      px = cx + vx * Math.cos(th) - vz * Math.sin(th);
      pz = cz + vx * Math.sin(th) + vz * Math.cos(th);
      pts.push([px, pz]);
    }
    phi += s * span;
  };
  straight(500);
  arc(40, 60, -1);
  straight(50);
  arc(40, 60, 1);
  straight(500);
  const phi0 = phi;
  const dx = -px;
  const dz = -pz;
  const along = (a: number) => dx * Math.cos(a) + dz * Math.sin(a);
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + Math.PI), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + (3 * Math.PI) / 2), 0));
  arc(300, 90, 1);
  straight(Math.max(along(phi0 + 2 * Math.PI), 0));
  if (Math.hypot(px, pz) < 1e-6) pts.pop(); // closing point already at the start
  return pts;
}

// Index of the minimum radius inside the run, first index on ties.
function apexIndex(pts: Point2[], run: CornerRun | undefined): number {
  if (!run) throw new Error('corner run not found');
  const rs = radii(pts);
  const n = pts.length;
  const span = ((run.end - run.start) % n + n) % n;
  let best = run.start;
  let bestR = Infinity;
  for (let k = 0; k <= span; k++) {
    const i = (run.start + k) % n;
    if (rs[i] < bestR) {
      bestR = rs[i];
      best = i;
    }
  }
  return best;
}

// Index nearest to an arc length on the closed polyline (wrapping).
function nearestIndexAt(pts: Point2[], atMeters: number): number {
  const n = pts.length;
  const cum = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  const per = cum[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
  const target = ((atMeters % per) + per) % per;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(cum[i] - target);
    const dist = Math.min(d, per - d);
    if (dist < bestD) {
      bestD = dist;
      best = i;
    }
  }
  return best;
}

// Forward polyline length along the closed lap from index `from` to `to`.
const wrap = (v: number, n: number): number => ((v % n) + n) % n;

function arcLength(pts: Point2[], from: number, to: number): number {
  const n = pts.length;
  let len = 0;
  let i = wrap(from, n);
  const target = wrap(to, n);
  while (i !== target) {
    const j = (i + 1) % n;
    len += Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    i = j;
  }
  return len;
}

describe('149 sausage placement acceptance', () => {
  it('AT1: chicane fixture with width 12 gives two sausages at the arc apexes, left on the left, right on the right, offset 7.8, length half the corner run clamped to 6..20', () => {
    const pts = chicaneFixture();
    const runs = detectCorners(pts);
    const sausages: Sausage149[] = buildSausages(pts, WIDTH);
    expect(sausages).toHaveLength(2);
    for (const side of ['left', 'right'] as const) {
      const atSide = sausages.filter((s) => s.side === side);
      expect(atSide, `${side} sausages`).toHaveLength(1);
      const run = runs.find((r) => r.side === side && r.minRadius < 80);
      expect(atSide[0].index, `${side} apex index`).toBe(apexIndex(pts, run));
      expect(atSide[0].offset, `${side} offset`).toBeCloseTo(7.8, 9);
      const expected = Math.min(20, Math.max(6, 0.5 * arcLength(pts, run!.start, run!.end)));
      expect(atSide[0].length, `${side} length`).toBeCloseTo(expected, 6);
    }
  });

  it('AT2: rounded square R 30 with no chicane gives no sausages', () => {
    expect(buildSausages(roundedSquare(30), WIDTH)).toEqual([]);
  });

  it('AT3: override at 1000 m left on the rounded square gives one sausage at the index nearest 1000 m, offset 7.8, length 6', () => {
    const pts = roundedSquare(30);
    const sausages: Sausage149[] = buildSausages(pts, WIDTH, [{ atMeters: 1000, side: 'left' }]);
    expect(sausages).toHaveLength(1);
    expect(sausages[0].side).toBe('left');
    expect(sausages[0].index).toBe(nearestIndexAt(pts, 1000));
    expect(sausages[0].offset).toBeCloseTo(7.8, 9);
    expect(sausages[0].length).toBeCloseTo(6, 9);
  });
});
