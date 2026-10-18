import { describe, expect, it } from 'vitest';
import { KERB_WIDTH } from '../../../src/core/constants';
import type { TrackDataV2 } from '../../../src/core/types';
import { qaReport, type QaReport } from '../../../tools/track-qa/report';
import { fixture } from '../acceptance/022-fixture-trackdatav2';

const ORIGIN: [number, number] = [9, 45];
const HALF = 6;
const BAND = HALF + KERB_WIDTH + 0.5; // barrier-fold clearance threshold (7.7)
const SAUSAGE_LIMIT = HALF + KERB_WIDTH + 0.1; // sausage clearance threshold (7.3)

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

function checkOf(report: QaReport, name: string) {
  const c = report.checks.find((k) => k.name === name);
  expect(c, name).toBeDefined();
  return c!;
}

describe('249 qa clearance checks edge cases', () => {
  it('EDGE1: no kerbs, barriers, sausages or pit pieces give null metrics, zeroed pitClear and ok checks', () => {
    const report = qaReport(stadium(30), null, ORIGIN);
    expect(report.clearance.kerb).toBeNull();
    expect(report.clearance.barrierFold).toBeNull();
    expect(report.clearance.sausage).toBeNull();
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 0, barrierVertices: 0, atMeters: null });
    for (const name of ['kerb', 'barrier-fold', 'sausage', 'pit-clear']) {
      expect(checkOf(report, name).level, name).toBe('ok');
    }
  });

  it('EDGE2: kerbs facing the opposite stadium leg fail with clearance below halfNear - 0.3', () => {
    const track = stadium(6);
    const n = track.centerline.length;
    const report = qaReport(
      {
        ...track,
        kerbs: [
          { start: 0, end: n - 1, side: 'left' },
          { start: 0, end: n - 1, side: 'right' },
        ],
      },
      null,
      ORIGIN,
    );
    const kerb = report.clearance.kerb;
    expect(kerb).not.toBeNull();
    // Worst centroid: lateral 6.8 toward the other leg, 2/3 m off the nearest opposite sample.
    expect(kerb!.worst).toBeCloseTo(Math.hypot(2 / 3, 5.2) - (HALF - 0.3), 4);
    expect(checkOf(report, 'kerb').level).toBe('fail');
    expect(report.clearance.barrierFold).toBeNull();
    expect(report.clearance.sausage).toBeNull();
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 0, barrierVertices: 0, atMeters: null });
    expect(checkOf(report, 'barrier-fold').level).toBe('ok');
    expect(checkOf(report, 'sausage').level).toBe('ok');
    expect(checkOf(report, 'pit-clear').level).toBe('ok');
  });

  it('EDGE3: barrier-fold fails just inside the clearance band and is ok exactly on it', () => {
    const inside = qaReport(
      straight({
        barriers: [
          { start: 0, end: 99, side: 'left', type: 'armco', offsetMeters: BAND - 0.01 },
          { start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: BAND - 0.01 },
        ],
      }),
      null,
      ORIGIN,
    );
    expect(inside.clearance.barrierFold!.worst).toBeCloseTo(-0.01, 6);
    expect(checkOf(inside, 'barrier-fold').level).toBe('fail');

    const onBand = qaReport(
      straight({
        barriers: [
          { start: 0, end: 99, side: 'left', type: 'armco', offsetMeters: BAND },
          { start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: BAND },
        ],
      }),
      null,
      ORIGIN,
    );
    expect(onBand.clearance.barrierFold!.worst).toBe(0);
    expect(checkOf(onBand, 'barrier-fold').level).toBe('ok');
  });

  it('EDGE4: a barrier violation smaller than 1e-6 m stays ok', () => {
    const report = qaReport(
      straight({
        barriers: [{ start: 0, end: 99, side: 'right', type: 'armco', offsetMeters: BAND - 1e-9 }],
      }),
      null,
      ORIGIN,
    );
    const m = report.clearance.barrierFold!;
    expect(m.worst).toBeLessThan(0);
    expect(m.worst).toBeGreaterThan(-1e-6);
    expect(checkOf(report, 'barrier-fold').level).toBe('ok');
  });

  it('EDGE5: barrier-fold atMeters is the arc length of the worst vertex index', () => {
    const n = 100;
    const halfWidthLeft = new Array<number>(n).fill(HALF);
    const halfWidthRight = new Array<number>(n).fill(HALF);
    halfWidthLeft[22] = HALF + 0.5;
    halfWidthRight[22] = HALF + 0.5;
    const report = qaReport(
      straight({
        halfWidthLeft,
        halfWidthRight,
        barriers: [{ start: 20, end: 25, side: 'right', type: 'armco', offsetMeters: BAND - 0.01 }],
      }),
      null,
      ORIGIN,
    );
    const m = report.clearance.barrierFold!;
    expect(m.worst).toBeCloseTo(-0.01 - 0.5, 6);
    expect(m.atMeters).toBe(220);
    expect(checkOf(report, 'barrier-fold').level).toBe('fail');
  });

  it('EDGE6: sausage fails just under the clearance threshold and is ok exactly on it', () => {
    const inside = qaReport(
      straight({ sausages: [{ index: 50, side: 'right', offset: SAUSAGE_LIMIT + 0.24, length: 4 }] }),
      null,
      ORIGIN,
    );
    const m = inside.clearance.sausage!;
    expect(m.worst).toBeCloseTo(-0.01, 6);
    expect(m.atMeters).toBe(500);
    expect(checkOf(inside, 'sausage').level).toBe('fail');

    const onLimit = qaReport(
      straight({ sausages: [{ index: 50, side: 'right', offset: SAUSAGE_LIMIT - 0.25, length: 4 }] }),
      null,
      ORIGIN,
    );
    expect(onLimit.clearance.sausage!.worst).toBeCloseTo(0, 9);
    expect(checkOf(onLimit, 'sausage').level).toBe('ok');
  });

  it('EDGE7: pit-clear counts every footprint sample over a partial runoff and reports the first offender', () => {
    const report = qaReport(
      straight({
        runoffs: [{ start: 15, end: 40, side: 'right', surface: 'gravel', widthMeters: 25 }],
      }),
      null,
      ORIGIN,
    );
    // Pit rect x 100..300 step 2, z 16..24 step 2; the runoff rows reach x 140..410.
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 405, barrierVertices: 0, atMeters: 140 });
    expect(checkOf(report, 'pit-clear').level).toBe('fail');
  });

  it('EDGE8: an empty pit range stays ok even with a full-width runoff beside it', () => {
    const report = qaReport(
      straight({
        pit: { start: 0, end: 0, side: 'right' },
        runoffs: [{ start: 0, end: 99, side: 'right', surface: 'gravel', widthMeters: 25 }],
      }),
      null,
      ORIGIN,
    );
    expect(report.clearance.pitClear).toEqual({ overlapSamples: 0, barrierVertices: 0, atMeters: null });
    expect(checkOf(report, 'pit-clear').level).toBe('ok');
  });

  it('EDGE9: qaReport does not mutate its track input', () => {
    const n = stadium(30).centerline.length;
    const track: TrackDataV2 = {
      ...stadium(30),
      kerbs: [
        { start: 0, end: n - 1, side: 'left' },
        { start: 0, end: n - 1, side: 'right' },
      ],
      barriers: [
        { start: 0, end: n - 1, side: 'left', type: 'armco', offsetMeters: 12 },
        { start: 0, end: n - 1, side: 'right', type: 'armco', offsetMeters: 12 },
      ],
      sausages: [{ index: 120, side: 'left', offset: 9, length: 6 }],
      pit: { start: 50, end: 80, side: 'right' },
    };
    const before = JSON.stringify(track);
    qaReport(track, null, ORIGIN);
    expect(JSON.stringify(track)).toBe(before);
  });
});
