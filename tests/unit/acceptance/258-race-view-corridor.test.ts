import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  brakingPoint,
  buildCorridor,
  collectNeighbours,
  corridorAt,
  isOffTrack,
  StopTracker,
  type CarView,
  type CorridorSample,
  type Neighbour,
  type TrackCorridor,
} from '../../../src/ai/raceView';
import type { RacingLine } from '../../../src/ai/racingLine';
import type { TrackDataV2 } from '../../../src/core/types';
import { cumulativeLengths } from '../../../src/track/centerline';
import { halfWidthAt } from '../../../src/track/surfaces';

const ROOT = join(__dirname, '..', '..', '..');
const TOL = 1e-9;

function car(s: number): CarView {
  return { s, d: 0, v: 30, halfLen: 2, halfWid: 1, stopped: false, offTrack: false };
}

function sample(): CorridorSample {
  return { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
}

function fixtureC(): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  const halfLeft = new Float64Array(n).fill(6);
  const halfRight = new Float64Array(n).fill(6);
  const lineD = new Float64Array(n);
  const curv = new Float64Array(n);
  const profileV = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    if (s >= 580 && s <= 620) curv[k] = 0.02;
    if (s <= 500) profileV[k] = 60;
    else if (s < 600) profileV[k] = 60 + ((20 - 60) * (s - 500)) / 100;
    else if (s < 700) profileV[k] = 20 + ((60 - 20) * (s - 600)) / 100;
    else profileV[k] = 60;
  }
  return { lapLength, ds, halfLeft, halfRight, lineD, profileV, curv };
}

// Square loop: 200 centerline points, exact 2 m spacing, closed length 400 m.
function squarePoint(s: number): [number, number] {
  const p = ((s % 400) + 400) % 400;
  if (p < 100) return [p, 0];
  if (p < 200) return [100, p - 100];
  if (p < 300) return [300 - p, 100];
  return [0, 400 - p];
}

function squareTrack(): { track: TrackDataV2; line: RacingLine; speeds: Float64Array; L: number } {
  const centerline: [number, number][] = [];
  for (let i = 0; i < 200; i++) centerline.push(squarePoint(i * 2));
  const halfWidthLeft = Array.from({ length: 200 }, (_, i) => 5 + (i % 5) * 0.25);
  const halfWidthRight = Array.from({ length: 200 }, (_, i) => 4 + (i % 7) * 0.2);
  const track: TrackDataV2 = {
    id: 'sq',
    name: 'Square',
    widthMeters: 9,
    lengthMeters: 400,
    officialLengthMeters: 400,
    centerline,
    sectors: [0, 66, 133],
    version: 2,
    elevation: new Array(200).fill(0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    halfWidthLeft,
    halfWidthRight,
    source: { dataset: 'fixture', license: 'CC0', url: 'https://example.invalid/sq', dem: 'none' },
  };
  const points = new Float64Array(400);
  for (let i = 0; i < 200; i++) {
    points[2 * i] = centerline[i][0];
    points[2 * i + 1] = centerline[i][1];
  }
  const line: RacingLine = {
    offsets: new Float64Array(200),
    points,
    dist: Float64Array.from({ length: 200 }, (_, i) => i * 2),
    length: 400,
  };
  const speeds = new Float64Array(200).fill(40);
  const L = cumulativeLengths(centerline, true)[centerline.length];
  return { track, line, speeds, L };
}

describe('258 Frenet race view and track corridor acceptance', () => {
  it('AT1: keeps only gaps inside (behind, ahead] and wraps over the lap', () => {
    const out: Neighbour[] = [];
    const count = collectNeighbours(car(990), [car(10), car(900), car(500)], 1000, out);
    expect(count).toBe(1);
    expect(Math.abs(out[0].gap - 20)).toBeLessThanOrEqual(TOL);
  });

  it('AT2: orders neighbours by absolute gap with ties in input order', () => {
    const out: Neighbour[] = [];
    const count = collectNeighbours(car(0), [car(30), car(990), car(10), car(950)], 1000, out);
    expect(count).toBe(4);
    const expected = [-10, 10, 30, -50];
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(out[i].gap - expected[i])).toBeLessThanOrEqual(TOL);
    }
  });

  it('AT3: corridor half widths match halfWidthAt per centerline index', () => {
    const { track, line, speeds, L } = squareTrack();
    const c = buildCorridor(track, line, speeds);
    expect(c.halfLeft.length).toBe(Math.ceil(L / 2));
    expect(c.halfRight.length).toBe(Math.ceil(L / c.ds));
    for (let k = 0; k < c.halfLeft.length; k++) {
      expect(Math.abs(c.halfLeft[k] - halfWidthAt(track, 'left', k)), `left ${k}`)
        .toBeLessThanOrEqual(TOL);
      expect(Math.abs(c.halfRight[k] - halfWidthAt(track, 'right', k)), `right ${k}`)
        .toBeLessThanOrEqual(TOL);
    }
  });

  it('AT4: corridorAt wraps s, interpolates linearly and blends the last sample into sample 0', () => {
    const C = fixtureC();
    const a = corridorAt(C, 3, sample());
    const b = corridorAt(C, 2003, sample());
    expect(Math.abs(a.halfLeft - b.halfLeft)).toBeLessThanOrEqual(TOL);
    const mid = corridorAt(C, 550, sample());
    expect(Math.abs(mid.profileV - 40)).toBeLessThanOrEqual(TOL);
    const seam = corridorAt(C, 1999, sample());
    const last = C.profileV[C.profileV.length - 1];
    const blend = last + (C.profileV[0] - last) * 0.5;
    expect(Math.abs(seam.profileV - blend)).toBeLessThanOrEqual(TOL);
  });

  it('AT5: StopTracker arms after 1 s below 3 m/s post-go and resets on speed or pre-go', () => {
    const t = new StopTracker();
    let r = true;
    for (let i = 0; i < 99; i++) r = t.update(2, 0.01, true);
    expect(r).toBe(false);
    r = t.update(2, 0.02, true);
    expect(r).toBe(true);
    r = t.update(4, 0.01, true);
    expect(r).toBe(false);
    for (let i = 0; i < 500; i++) r = t.update(2, 0.01, false);
    expect(r).toBe(false);
  });

  it('AT6: isOffTrack is strict beyond the 0.3 m margin', () => {
    const C = fixtureC();
    expect(isOffTrack(C, 100, 6.31)).toBe(true);
    expect(isOffTrack(C, 100, 6.29)).toBe(false);
    expect(isOffTrack(C, 100, -6.31)).toBe(true);
  });

  it('AT7: brakingPoint finds the drop before the corner and null beyond 400 m', () => {
    const C = fixtureC();
    const bp = brakingPoint(C, 300);
    expect(bp).not.toBeNull();
    if (!bp) return;
    expect(Math.abs(bp.distance - 214)).toBeLessThanOrEqual(2);
    expect(bp.cornerSign).toBe(1);
    expect(brakingPoint(C, 100)).toBeNull();
  });

  it('AT8: raceView source imports nothing from three', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'raceView.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"]three['"]/);
  });
});
