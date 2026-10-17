import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { unprojectXZ, type LonLat } from '../../../src/track/geo';
import { qaReport } from '../../../tools/track-qa/report';

const ROOT = join(__dirname, '..', '..', '..');
const ORIGIN: LonLat = [9, 45];
const RUN_TIMEOUT = 180_000;

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

function standAt(z: number, yaw = 0): Omit<TrackDataV2, 'terrain'> {
  return {
    ...STRAIGHT,
    grandstands: [{ x: 100, z, yaw, lengthMeters: 20, rows: 10, roof: false }],
  };
}

function waysOf(zOffset: number): { ways: { coords: [number, number][] }[] } {
  return {
    ways: [{ coords: STRAIGHT.centerline.map(([x, z]) => unprojectXZ([x, z + zOffset], ORIGIN)) }],
  };
}

// Plateau terrain: flat 0 through x=92, flat 3 from x=96 (col-major heights, all rows equal).
function plateau(): TrackDataV2 {
  return {
    ...standAt(40),
    terrain: {
      originX: 100,
      originZ: 45,
      sizeX: 40,
      sizeZ: 100,
      cols: 10,
      rows: 10,
      heights: Array.from({ length: 11 * 11 }, (_, k) => (Math.floor(k / 11) <= 3 ? 0 : 3)),
    },
  } as TrackDataV2;
}

describe('237 track qa report gaps', () => {
  it('a stand clearance of exactly 2 m is ok while 1.5 m fails (strict < 2)', () => {
    const exact = qaReport({ ...standAt(8) } as TrackDataV2, null, ORIGIN);
    expect(exact.stands[0].clearance).toBe(2);
    expect(exact.checks.find((c) => c.name === 'stand 0')?.level).toBe('ok');

    const under = qaReport({ ...standAt(7.5) } as TrackDataV2, null, ORIGIN);
    expect(under.stands[0].clearance).toBeCloseTo(1.5, 9);
    expect(under.checks.find((c) => c.name === 'stand 0')?.level).toBe('fail');
  });

  it('a stand relief of exactly 3 m is ok (strict > 3)', () => {
    const report = qaReport(plateau(), null, ORIGIN);
    expect(report.stands[0].relief).toBeCloseTo(3, 9);
    expect(report.checks.find((c) => c.name === 'stand 0')?.level).toBe('ok');
  });

  it('clearance fail wins over relief warn for a stand on a ramp over the road', () => {
    const track = {
      ...standAt(3),
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
    expect(report.stands[0].clearance).toBeCloseTo(0, 9);
    expect(report.stands[0].relief).toBeGreaterThan(3);
    expect(report.checks.find((c) => c.name === 'stand 0')?.level).toBe('fail');
  });

  it('layout rms just under 5 m is ok and just over 15 m fails', () => {
    const ok = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(-4.9), ORIGIN);
    expect(ok.layout?.rmsMeters).toBeCloseTo(4.9, 1);
    expect(ok.checks.find((c) => c.name === 'layout')?.level).toBe('ok');

    const fail = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(-15.1), ORIGIN);
    expect(fail.layout?.rmsMeters).toBeCloseTo(15.1, 1);
    expect(fail.checks.find((c) => c.name === 'layout')?.level).toBe('fail');
  });

  it('one named check per grandstand, following config order', () => {
    const track = {
      ...STRAIGHT,
      grandstands: [
        { x: 100, z: 40, yaw: 0, lengthMeters: 20, rows: 10, roof: false },
        { x: 200, z: 3, yaw: 0, lengthMeters: 20, rows: 10, roof: false },
      ],
    } as TrackDataV2;
    const report = qaReport(track, null, ORIGIN);
    expect(report.stands.map((s) => s.index)).toEqual([0, 1]);
    expect(report.checks.find((c) => c.name === 'stand 0')?.level).toBe('ok');
    expect(report.checks.find((c) => c.name === 'stand 1')?.level).toBe('fail');
  });

  it('one pit check per pit piece', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, null, ORIGIN);
    const pitChecks = report.checks.filter((c) => /^pit \d+$/.test(c.name));
    expect(pitChecks).toHaveLength(report.pit.length);
  });

  it('a rotated stand still measures clearance from the road edge', () => {
    const report = qaReport({ ...standAt(40, Math.PI / 2) } as TrackDataV2, null, ORIGIN);
    expect(report.stands[0].clearance).toBeCloseTo(24, 1);
    expect(report.checks.find((c) => c.name === 'stand 0')?.level).toBe('ok');
  });

  it('missing OSM ways yield an ok layout check and no barriers yield gap 0 with an ok barrier check', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, null, ORIGIN);
    expect(report.layout).toBeNull();
    expect(report.checks.find((c) => c.name === 'layout')?.level).toBe('ok');
    expect(report.barrierMaxGap).toBe(0);
    expect(report.checks.find((c) => c.name === 'barrier')?.level).toBe('ok');
  });

  it('a degenerate single-point way does not spoil layout when another way covers the track', () => {
    const ways = waysOf(0);
    ways.ways.push({ coords: [unprojectXZ([500, 0], ORIGIN)] });
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, ways, ORIGIN);
    expect(report.layout?.rmsMeters).toBeLessThan(0.01);
    expect(report.checks.find((c) => c.name === 'layout')?.level).toBe('ok');
  });

  it('CLI exits 1 on an unknown track id', () => {
    const run = spawnSync('npm', ['run', '-s', 'track:qa', '--', 'no-such-track'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: RUN_TIMEOUT,
    });
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toMatch(/unknown track id/);
  }, RUN_TIMEOUT);

  it('CLI writes layout null for a track without an OSM source file', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'simgame-237-'));
    try {
      const run = spawnSync(
        'npm',
        ['run', '-s', 'track:qa', '--', 'fontana-roval', '--out', outDir],
        { cwd: ROOT, encoding: 'utf8', timeout: RUN_TIMEOUT },
      );
      const file = join(outDir, 'fontana-roval.json');
      expect(existsSync(file)).toBe(true);
      const report = JSON.parse(readFileSync(file, 'utf8')) as { id: string; layout: unknown };
      expect(report.id).toBe('fontana-roval');
      expect(report.layout).toBeNull();
      expect(run.stdout.split('\n').some((line) => line.startsWith('fontana-roval '))).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, RUN_TIMEOUT);
});
