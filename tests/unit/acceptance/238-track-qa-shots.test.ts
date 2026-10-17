import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { qaViews, type QaView } from '../../../src/track/qaViews';

const ROOT = join(__dirname, '..', '..', '..');

function makeTrack(id: string, centerline: [number, number][]): TrackDataV2 {
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
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
  return t as TrackDataV2;
}

const ARC = makeTrack(
  'arc',
  Array.from({ length: 200 }, (_, i): [number, number] => [
    200 * Math.cos((2 * Math.PI * i) / 200),
    -200 * Math.sin((2 * Math.PI * i) / 200),
  ]),
);

// 50 pts along +x, radius-30 quarter arc (centre (490, 30)), 50 pts along +z,
// closed by a 14-vertex far loop on the circle centre (0, 520) radius 520 (270 deg).
function cornerCenterline(): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 50; i++) pts.push([i * 10, 0]);
  for (let k = 1; k <= 24; k++) {
    const th = (Math.PI / 2) * (k / 24);
    pts.push([490 + 30 * Math.sin(th), 30 - 30 * Math.cos(th)]);
  }
  for (let j = 1; j < 50; j++) pts.push([520, 30 + j * 10]);
  for (let m = 1; m <= 13; m++) {
    const ph = ((3 * Math.PI) / 2) * (m / 14);
    pts.push([520 * Math.cos(ph), 520 + 520 * Math.sin(ph)]);
  }
  return pts;
}

const CORNER = makeTrack('corner', cornerCenterline());
const ARC_MID: [number, number] = [490 + 30 * Math.SQRT1_2, 30 - 30 * Math.SQRT1_2];

function cumulative(centerline: [number, number][]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < centerline.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(centerline[i][0] - centerline[i - 1][0], centerline[i][1] - centerline[i - 1][1]));
  }
  const last = centerline.length - 1;
  const total = cum[last] + Math.hypot(centerline[0][0] - centerline[last][0], centerline[0][1] - centerline[last][1]);
  return { cum, total };
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

describe('238 track QA shots acceptance', () => {
  it('AT1: qaViews(ARC, 0) returns exactly the start view, eye 30 m along -tangent at y 6', () => {
    const views = qaViews(ARC, 0);
    expect(views.length).toBe(1);
    expect(views[0].name).toBe('start');
    const c0 = ARC.centerline[0];
    const c1 = ARC.centerline[1];
    const tx = c1[0] - c0[0];
    const tz = c1[1] - c0[1];
    const len = Math.hypot(tx, tz);
    const eye = views[0].eye;
    expect(Math.hypot(eye[0] - c0[0], eye[2] - c0[1])).toBeCloseTo(30, 0);
    expect(eye[0]).toBeCloseTo(c0[0] - (30 * tx) / len, 0);
    expect(eye[2]).toBeCloseTo(c0[1] - (30 * tz) / len, 0);
    expect(eye[1]).toBeCloseTo(6, 6);
  });

  it('AT2: qaViews(CORNER, 1) targets the 90-degree corner within 5 m of the arc midpoint', () => {
    const corners = qaViews(CORNER, 1).filter((v: QaView) => v.name !== 'start');
    expect(corners.length).toBe(1);
    const target = corners[0].target;
    expect(Math.hypot(target[0] - ARC_MID[0], target[2] - ARC_MID[1])).toBeLessThanOrEqual(5);
  });

  it('AT3: qaViews(CORNER, 6) returns at most 7 views with corner apexes at least 150 m apart along the lap', () => {
    const views = qaViews(CORNER, 6);
    expect(views.length).toBeLessThanOrEqual(7);
    const corners = views.filter((v: QaView) => v.name !== 'start');
    const { cum, total } = cumulative(CORNER.centerline);
    const idx = corners.map((v: QaView) => nearestIndex([v.target[0], v.target[2]], CORNER.centerline));
    for (let a = 0; a < idx.length; a++) {
      for (let b = a + 1; b < idx.length; b++) {
        const d = Math.abs(cum[idx[a]] - cum[idx[b]]);
        expect(Math.min(d, total - d)).toBeGreaterThanOrEqual(150);
      }
    }
  });

  it('AT6: qaViews.ts imports nothing from three', () => {
    const src = readFileSync(join(ROOT, 'src', 'track', 'qaViews.ts'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]three['"]/);
  });
});
