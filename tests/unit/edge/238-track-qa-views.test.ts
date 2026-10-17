import { describe, expect, it } from 'vitest';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { qaViews, type QaView } from '../../../src/track/qaViews';

function makeTrack(
  id: string,
  centerline: [number, number][],
  elevation?: number[],
  terrain?: Terrain,
): TrackDataV2 {
  let lengthMeters = 0;
  for (let i = 0; i < centerline.length; i++) {
    const j = (i + 1) % centerline.length;
    lengthMeters += Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
  }
  const t: Omit<TrackDataV2, 'terrain'> = {
    version: 2,
    id,
    name: id,
    widthMeters: 12,
    lengthMeters,
    officialLengthMeters: lengthMeters,
    centerline,
    sectors: [0, Math.floor(lengthMeters / 3), Math.floor((2 * lengthMeters) / 3)],
    elevation: elevation ?? centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
  if (terrain) return { ...t, terrain } as TrackDataV2;
  return t as TrackDataV2;
}

const ARC = makeTrack(
  'arc',
  Array.from({ length: 200 }, (_, i): [number, number] => [
    200 * Math.cos((2 * Math.PI * i) / 200),
    -200 * Math.sin((2 * Math.PI * i) / 200),
  ]),
);

const ARC_E12 = makeTrack('arc12', ARC.centerline, ARC.centerline.map(() => 12));

// Rounded rectangle: +x bottom, +z right, -x top, -z left; index 0 = end of the BL arc (seam is smooth).
function roundedRect(rBR: number, rTR: number, rTL: number, rBL: number, W: number, H: number) {
  const pts: [number, number][] = [];
  const straight = (from: [number, number], to: [number, number]): void => {
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.max(1, Math.round(d / 10));
    for (let i = 1; i <= n; i++) {
      pts.push([from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n]);
    }
  };
  const arc = (c: [number, number], start: [number, number], r: number): void => {
    const a0 = Math.atan2(start[1] - c[1], start[0] - c[0]);
    const n = Math.max(4, Math.ceil((r * Math.PI) / 4));
    for (let i = 1; i <= n; i++) {
      const a = a0 + (Math.PI / 2) * (i / n);
      pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
  };
  const radii = [rBR, rTR, rTL, rBL];
  const a0s = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
  const centres: [number, number][] = [
    [W - rBR, rBR],
    [W - rTR, H - rTR],
    [rTL, H - rTL],
    [rBL, rBL],
  ];
  const mids: [number, number][] = centres.map((c, k) => {
    const a = a0s[k] + Math.PI / 4;
    return [c[0] + radii[k] * Math.cos(a), c[1] + radii[k] * Math.sin(a)];
  });
  pts.push([rBL, 0]);
  straight([rBL, 0], [W - rBR, 0]);
  arc(centres[0], [W - rBR, 0], rBR);
  straight([W, rBR], [W, H - rTR]);
  arc(centres[1], [W, H - rTR], rTR);
  straight([W - rTR, H], [rTL, H]);
  arc(centres[2], [rTL, H], rTL);
  straight([0, H - rTL], [0, rBL]);
  arc(centres[3], [0, rBL], rBL);
  return { centerline: pts, mids, centres };
}

function arclengths(centerline: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < centerline.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(centerline[i][0] - centerline[i - 1][0], centerline[i][1] - centerline[i - 1][1]));
  }
  return cum;
}

function pointAt(centerline: [number, number][], s: number): [number, number] {
  const n = centerline.length;
  const cum = arclengths(centerline);
  const last = centerline[n - 1];
  const total = cum[n - 1] + Math.hypot(centerline[0][0] - last[0], centerline[0][1] - last[1]);
  let u = ((s % total) + total) % total;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = Math.hypot(centerline[j][0] - centerline[i][0], centerline[j][1] - centerline[i][1]);
    if (u <= d || i === n - 1) {
      const f = d > 0 ? u / d : 0;
      return [
        centerline[i][0] + (centerline[j][0] - centerline[i][0]) * f,
        centerline[i][1] + (centerline[j][1] - centerline[i][1]) * f,
      ];
    }
    u -= d;
  }
  return centerline[0];
}

function nearestIndex(p: [number, number], centerline: [number, number][]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < centerline.length; i++) {
    const d = Math.hypot(centerline[i][0] - p[0], centerline[i][1] - p[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function distTo(v: QaView, m: [number, number]): number {
  return Math.hypot(v.target[0] - m[0], v.target[2] - m[1]);
}

describe('238 track QA views edge', () => {
  it('EDGE1: start view target is centerline[0] at its elevation', () => {
    const start = qaViews(ARC_E12, 0)[0];
    expect(start.target[0]).toBeCloseTo(200, 5);
    expect(start.target[1]).toBeCloseTo(12, 5);
    expect(start.target[2]).toBeCloseTo(0, 5);
  });

  it('EDGE2: start view eye y is elevation[0] + 6', () => {
    expect(qaViews(ARC_E12, 0)[0].eye[1]).toBeCloseTo(18, 5);
  });

  it('EDGE3: non-integer count floors', () => {
    const r = roundedRect(15, 80, 80, 80, 400, 300);
    const t = makeTrack('r1', r.centerline);
    const half = qaViews(t, 0.5);
    expect(half.length).toBe(1);
    expect(half[0].name).toBe('start');
    const oneCorner = qaViews(t, 1);
    const almost = qaViews(t, 1.9);
    expect(almost.length).toBe(2);
    expect(almost[1].name).toBe('corner1');
    for (let k = 0; k < 3; k++) {
      expect(almost[1].target[k]).toBeCloseTo(oneCorner[1].target[k], 6);
    }
  });

  it('EDGE4: negative count clamps to zero corners', () => {
    const r = roundedRect(15, 80, 80, 80, 400, 300);
    const views = qaViews(makeTrack('r1n', r.centerline), -3);
    expect(views.length).toBe(1);
    expect(views[0].name).toBe('start');
  });

  it('EDGE5: track with max curvature below 1e-4 /m yields only the start view', () => {
    const N = 25133;
    const R = 20000;
    const gentle = makeTrack(
      'gentle',
      Array.from({ length: N }, (_, i): [number, number] => [
        R * Math.cos((2 * Math.PI * i) / N),
        -R * Math.sin((2 * Math.PI * i) / N),
      ]),
    );
    const views = qaViews(gentle, 6);
    expect(views.length).toBe(1);
    expect(views[0].name).toBe('start');
  });

  it('EDGE6: a corner within 150 m along the lap of a chosen apex is skipped', () => {
    // BR r15 (curv 1/15), TR r40 ~103 m ahead (skipped), TL r25 ~105 m from BL (skipped), BL r20 kept.
    const r = roundedRect(15, 40, 25, 20, 400, 115);
    const corners = qaViews(makeTrack('r2', r.centerline), 6).filter((v) => v.name !== 'start');
    expect(corners.length).toBe(2);
    expect(Math.min(...corners.map((c) => distTo(c, r.mids[0])))).toBeLessThanOrEqual(5);
    expect(Math.min(...corners.map((c) => distTo(c, r.mids[3])))).toBeLessThanOrEqual(5);
    for (const c of corners) {
      expect(distTo(c, r.mids[1])).toBeGreaterThan(10);
      expect(distTo(c, r.mids[2])).toBeGreaterThan(10);
    }
  });

  it('EDGE7: corner views are named corner1.. in lap order', () => {
    // Selection order by curvature is TL, BR, BL, TR; lap order is BR, TR, TL, BL.
    const r = roundedRect(25, 50, 15, 45, 400, 200);
    const views = qaViews(makeTrack('r3', r.centerline), 6);
    expect(views.map((v) => v.name)).toEqual(['start', 'corner1', 'corner2', 'corner3', 'corner4']);
    for (let k = 0; k < 4; k++) {
      expect(distTo(views[k + 1], r.mids[k])).toBeLessThanOrEqual(5);
    }
  });

  it('EDGE8: corner eye is 8 m above the ground and 15 m outside the turn', () => {
    const r = roundedRect(15, 80, 80, 80, 400, 300);
    const t = makeTrack('r1e', r.centerline, r.centerline.map(() => 4));
    const corner = qaViews(t, 1).find((v) => v.name !== 'start')!;
    expect(corner.eye[1]).toBeCloseTo(12, 5);
    const cum = arclengths(r.centerline);
    const apexIdx = nearestIndex(r.mids[0], r.centerline);
    const back = pointAt(r.centerline, cum[apexIdx] - 40);
    const ex = corner.eye[0];
    const ez = corner.eye[2];
    expect(Math.hypot(ex - back[0], ez - back[1])).toBeCloseTo(15, 0);
    const c = r.centres[0];
    expect(Math.hypot(ex - c[0], ez - c[1])).toBeGreaterThan(Math.hypot(back[0] - c[0], back[1] - c[1]) + 5);
  });

  it('EDGE9: with terrain, corner eye y is terrain height + 8 while start eye y is elevation + 6', () => {
    const r = roundedRect(15, 80, 80, 80, 400, 300);
    const terrain: Terrain = {
      originX: 200,
      originZ: 150,
      sizeX: 2000,
      sizeZ: 2000,
      rows: 1,
      cols: 1,
      heights: [2, 2, 2, 2],
    };
    const t = makeTrack('r1t', r.centerline, r.centerline.map(() => 5), terrain);
    const views = qaViews(t, 1);
    expect(views[0].eye[1]).toBeCloseTo(11, 5);
    const corner = views.find((v) => v.name !== 'start')!;
    expect(corner.eye[1]).toBeCloseTo(10, 5);
  });

  it('EDGE10: a corner straddling the centerline seam is found with its apex at the arc midpoint', () => {
    const r = roundedRect(15, 80, 80, 80, 400, 300);
    const k = nearestIndex(r.mids[0], r.centerline);
    const rotated = [...r.centerline.slice(k), ...r.centerline.slice(0, k)];
    const corners = qaViews(makeTrack('r1s', rotated), 1).filter((v) => v.name !== 'start');
    expect(corners.length).toBe(1);
    expect(distTo(corners[0], r.mids[0])).toBeLessThanOrEqual(5);
    for (let m = 1; m < 4; m++) {
      expect(distTo(corners[0], r.mids[m])).toBeGreaterThan(10);
    }
  });
});
