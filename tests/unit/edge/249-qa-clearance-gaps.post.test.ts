import { describe, expect, it } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { TrackDataV2 } from '../../../src/core/types';
import { qaReport, type QaReport } from '../../../tools/track-qa/report';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ORIGIN: [number, number] = [9, 45];
const HALF = 6;
const BAND = HALF + KERB_WIDTH + 0.5;

function straight(extras: Partial<TrackDataV2> = {}): TrackDataV2 {
  const n = 100;
  return {
    ...fixture,
    id: 'straight',
    name: 'Straight',
    centerline: Array.from({ length: n }, (_, i): [number, number] => [i * 10, 0]),
    sectors: [0, 30, 60],
    lengthMeters: 990,
    officialLengthMeters: 990,
    elevation: new Array<number>(n).fill(0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    grandstands: [],
    pit: { start: 10, end: 30, side: 'right' },
    ...extras,
  };
}

// R=30: straight A i 0..99 at x=2i (z=0), semicircle m=95, straight B i 0..99 at z=-60.
function stadium(R: number): TrackDataV2 {
  const m = Math.max(12, Math.ceil(Math.PI * R));
  const centerline: [number, number][] = [];
  for (let i = 0; i < 100; i++) centerline.push([2 * i, 0]);
  for (let j = 0; j < m; j++) {
    const phi = Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([200 + R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  for (let i = 0; i < 100; i++) centerline.push([200 - 2 * i, -2 * R]);
  for (let j = 0; j < m; j++) {
    const phi = -Math.PI / 2 - (Math.PI * j) / m;
    centerline.push([R * Math.cos(phi), -R + R * Math.sin(phi)]);
  }
  const n = centerline.length;
  const lengthMeters = Math.round(400 + Math.PI * R);
  return {
    ...fixture,
    id: `stadium-r${R}`,
    name: `Stadium R${R}`,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    lengthMeters,
    officialLengthMeters: lengthMeters,
    elevation: new Array<number>(n).fill(0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' },
  };
}

function checkOf(report: QaReport, name: string) {
  const c = report.checks.find((k) => k.name === name);
  expect(c, name).toBeDefined();
  return c!;
}

describe('249 qa clearance checks post-code gaps', () => {
  it('GAP1: a sub-half-width median wall is excluded while an armco beyond it still counts', () => {
    const report = qaReport(
      straight({
        barriers: [
          { start: 0, end: 49, side: 'right', type: 'wall', offsetMeters: 3 },
          { start: 50, end: 99, side: 'right', type: 'armco', offsetMeters: 12 },
        ],
      }),
      null,
      ORIGIN,
    );
    const m = report.clearance.barrierFold!;
    expect(m).not.toBeNull();
    expect(m.worst).toBeCloseTo(12 - BAND, 9);
    expect(checkOf(report, 'barrier-fold').level).toBe('ok');
  });

  it('GAP2: a wall on a narrowed half-width is a median wall even beyond that half-width', () => {
    const halfWidthRight = new Array<number>(100).fill(HALF);
    for (let i = 40; i <= 60; i++) halfWidthRight[i] = 3;
    const report = qaReport(
      straight({
        halfWidthRight,
        barriers: [{ start: 40, end: 60, side: 'right', type: 'wall', offsetMeters: 5 }],
      }),
      null,
      ORIGIN,
    );
    expect(report.clearance.barrierFold).toBeNull();
    expect(checkOf(report, 'barrier-fold').level).toBe('ok');
  });

  it('GAP3: a non-median wall inside the band fails barrier-fold like any other barrier', () => {
    const report = qaReport(
      straight({
        barriers: [{ start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 7.5 }],
      }),
      null,
      ORIGIN,
    );
    const m = report.clearance.barrierFold!;
    expect(m.worst).toBeCloseTo(7.5 - BAND, 9);
    expect(checkOf(report, 'barrier-fold').level).toBe('fail');
  });

  it('GAP4: halfNear is the min of both half-widths, not the barrier side own width', () => {
    const halfWidthRight = new Array<number>(100).fill(HALF);
    halfWidthRight[22] = HALF + 0.5;
    const report = qaReport(
      straight({
        halfWidthRight,
        barriers: [{ start: 20, end: 25, side: 'right', type: 'armco', offsetMeters: BAND - 0.01 }],
      }),
      null,
      ORIGIN,
    );
    const m = report.clearance.barrierFold!;
    expect(m.worst).toBeCloseTo(-0.01, 6);
    const check = checkOf(report, 'barrier-fold');
    expect(check.level).toBe('fail');
    expect(check.detail).toMatch(/worst .* m at 200 m/); // all six vertices tie at min=6, first wins
  });

  it('GAP5: real pit pieces with nothing overlapping keep pit-clear ok and atMeters null', () => {
    const report = qaReport(straight(), null, ORIGIN);
    expect(report.pit.length).toBeGreaterThan(0);
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 0, barrierVertices: 0, atMeters: null });
    expect(checkOf(report, 'pit-clear').level).toBe('ok');
  });

  it('GAP6: barrier vertices from the opposite track section inside the pit box fail pit-clear', () => {
    // Left armco on straight B (z=-60) at offset 40 lands at z=-20: inside the
    // left pit box of straight A (z in [-24,-16]) over x in [100,160].
    const track = stadium(30);
    const report = qaReport(
      {
        ...track,
        pit: { start: 50, end: 80, side: 'left' },
        barriers: [{ start: 215, end: 245, side: 'left', type: 'armco', offsetMeters: 40 }],
      },
      null,
      ORIGIN,
    );
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 0, barrierVertices: 31, atMeters: 160 });
    const check = checkOf(report, 'pit-clear');
    expect(check.level).toBe('fail');
    expect(check.detail).toContain('31 barrier vertices');
    expect(checkOf(report, 'barrier-fold').level).toBe('ok');
  });

  it('GAP7: a localized kerb reports its own arc position as kerb atMeters', () => {
    const report = qaReport(straight({ kerbs: [{ start: 40, end: 45, side: 'right' }] }), null, ORIGIN);
    const m = report.clearance.kerb!;
    expect(m).not.toBeNull();
    expect(m.worst).toBeGreaterThan(0);
    expect(m.atMeters).toBeGreaterThanOrEqual(350);
    expect(m.atMeters).toBeLessThanOrEqual(520);
    expect(checkOf(report, 'kerb').level).toBe('ok');
  });
});
