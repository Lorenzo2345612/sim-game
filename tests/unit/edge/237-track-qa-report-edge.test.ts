import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { unprojectXZ, type LonLat } from '../../../src/track/geo';
import { qaReport } from '../../../tools/track-qa/report';

const ORIGIN: LonLat = [9, 45];

const STRAIGHT: Omit<TrackDataV2, 'terrain'> = {
  version: 2,
  id: 'straight',
  name: 'Straight',
  widthMeters: 12,
  lengthMeters: 990,
  officialLengthMeters: 990,
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  sectors: [0, 33, 66],
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
};

function waysOf(zOffset: number, indices?: number[]): { ways: { coords: [number, number][] }[] } {
  const pts = (indices ?? STRAIGHT.centerline.map((_, i) => i)).map(
    (i) => STRAIGHT.centerline[i],
  );
  return {
    ways: [{ coords: pts.map(([x, z]) => unprojectXZ([x, z + zOffset], ORIGIN)) }],
  };
}

describe('237 track qa report edge', () => {
  it('EDGE1: a way whose only vertices are the segment ends still measures distance to the segment', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(0, [0, 99]), ORIGIN);
    expect(report.layout).not.toBeNull();
    expect(report.layout!.rmsMeters).toBeLessThan(0.01);
    expect(report.layout!.maxMeters).toBeLessThan(0.01);
  });

  it('EDGE2: a layout rms above 15 m produces a fail layout check', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(-20), ORIGIN);
    expect(Math.abs((report.layout?.rmsMeters ?? 0) - 20)).toBeLessThanOrEqual(0.1);
    expect(Math.abs((report.layout?.maxMeters ?? 0) - 20)).toBeLessThanOrEqual(0.1);
    expect(report.checks.some((c) => c.name === 'layout' && c.level === 'fail')).toBe(true);
  });

  it('EDGE3: an empty ways list leaves layout null', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, { ways: [] }, ORIGIN);
    expect(report.layout).toBeNull();
  });

  it('EDGE4: a pit piece 10 m clear of the asphalt reports clearance 10 and an ok pit check', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, null, ORIGIN);
    expect(report.pit.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(report.pit[0].clearance - 10)).toBeLessThanOrEqual(0.5);
    expect(report.pit[0].relief).toBeLessThanOrEqual(3);
    expect(report.checks.some((c) => c.name === 'pit 0' && c.level === 'ok')).toBe(true);
  });

  it('EDGE5: a pit piece over a runoff reports clearance 0 and a fail pit check', () => {
    const track = {
      ...STRAIGHT,
      runoffs: [{ start: 10, end: 30, side: 'right', surface: 'runoff', widthMeters: 20 }],
    } as TrackDataV2;
    const report = qaReport(track, null, ORIGIN);
    expect(report.pit[0].clearance).toBeCloseTo(0, 9);
    expect(report.checks.some((c) => c.name === 'pit 0' && c.level === 'fail')).toBe(true);
  });

  it('EDGE6: a stand over a 0.2 m/m ramp reports relief 4 m and a warn stand check', () => {
    const track = {
      ...STRAIGHT,
      grandstands: [{ x: 100, z: 40, yaw: 0, lengthMeters: 20, rows: 10, roof: false }],
      terrain: {
        originX: 495,
        originZ: 0,
        sizeX: 1100,
        sizeZ: 200,
        cols: 20,
        rows: 10,
        heights: Array.from({ length: 21 * 11 }, (_, k) => 11 * (Math.floor(k / 11) - 1)),
      },
    } as TrackDataV2;
    const report = qaReport(track, null, ORIGIN);
    expect(Math.abs(report.stands[0].relief - 4)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(report.stands[0].clearance - 34)).toBeLessThanOrEqual(0.5);
    expect(report.checks.some((c) => c.name === 'stand 0' && c.level === 'warn')).toBe(true);
    expect(report.checks.some((c) => c.name === 'stand 0' && c.level === 'fail')).toBe(false);
  });

  it('EDGE7: barrierMaxGap is the max |y - ground| over both barrier sides and a barrier check exists', () => {
    const track = {
      ...STRAIGHT,
      barriers: [
        { start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8 },
        { start: 0, end: 99, side: 'left', type: 'wall', offsetMeters: 8 },
      ],
      terrain: {
        originX: 495,
        originZ: 0,
        sizeX: 1100,
        sizeZ: 200,
        cols: 20,
        rows: 10,
        heights: Array.from({ length: 21 * 11 }, (_, k) => k % 11),
      },
    } as TrackDataV2;
    const report = qaReport(track, null, ORIGIN);
    expect(Math.abs(report.barrierMaxGap - 5.4)).toBeLessThanOrEqual(1e-6);
    expect(report.checks.some((c) => c.name === 'barrier')).toBe(true);
  });

  it('EDGE8: an empty centerline throws RangeError', () => {
    expect(() => qaReport({ ...STRAIGHT, centerline: [] as [number, number][] } as TrackDataV2, null, ORIGIN)).toThrow(
      RangeError,
    );
  });

  it('EDGE9: qaReport does not mutate the track or the ways', () => {
    const track = { ...STRAIGHT, grandstands: [{ x: 100, z: 40, yaw: 0, lengthMeters: 20, rows: 10, roof: false }] } as TrackDataV2;
    const ways = waysOf(0);
    const trackBefore = structuredClone(track);
    const waysBefore = structuredClone(ways);
    qaReport(track, ways, ORIGIN);
    expect(track).toEqual(trackBefore);
    expect(ways).toEqual(waysBefore);
  });

  it('EDGE10: a stand sample exactly on the asphalt edge counts as inside (clearance 0, fail)', () => {
    const track = {
      ...STRAIGHT,
      grandstands: [{ x: 100, z: 6, yaw: 0, lengthMeters: 20, rows: 10, roof: false }],
    } as TrackDataV2;
    const report = qaReport(track, null, ORIGIN);
    expect(report.stands[0].clearance).toBeCloseTo(0, 9);
    expect(report.checks.some((c) => c.name === 'stand 0' && c.level === 'fail')).toBe(true);
  });
});
