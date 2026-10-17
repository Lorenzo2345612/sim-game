import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BarrierSegment, Board, Terrain, TrackDataV2 } from '../../../src/core/types';
import { unprojectXZ, type LonLat } from '../../../src/track/geo';
import { qaReport, type QaCheck } from '../../../tools/track-qa/report';

const ROOT = join(__dirname, '..', '..', '..');
const ORIGIN: LonLat = [9, 45];
const RUN_TIMEOUT = 180_000;

// Terrain omitted like task 235; cast at qaReport call sites.
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

function flat(h: number): Terrain {
  return {
    originX: 495,
    originZ: 0,
    sizeX: 1100,
    sizeZ: 200,
    cols: 20,
    rows: 10,
    heights: Array.from({ length: 21 * 11 }, () => h),
  };
}

const WALL: BarrierSegment = { start: 0, end: 99, side: 'right', type: 'wall', offsetMeters: 8 };
const BOARD_100: Board = { index: 50, side: 'right', offset: 8, label: 100 };

function walled(h: number): TrackDataV2 {
  return { ...STRAIGHT, barriers: [WALL], boards: [BOARD_100], terrain: flat(h) };
}

function withStand(z: number): Omit<TrackDataV2, 'terrain'> {
  return {
    ...STRAIGHT,
    grandstands: [{ x: 100, z, yaw: 0, lengthMeters: 20, rows: 10, roof: false }],
  };
}

function waysOf(zOffset: number): { ways: { coords: [number, number][] }[] } {
  return {
    ways: [
      { coords: STRAIGHT.centerline.map(([x, z]) => unprojectXZ([x, z + zOffset], ORIGIN)) },
    ],
  };
}

describe('237 track qa report acceptance', () => {
  it('AT1: a stand 34 m off the road gets clearance 34, no fail check and no layout', () => {
    const report = qaReport({ ...withStand(40) } as TrackDataV2, null, ORIGIN);
    expect(Math.abs(report.stands[0].clearance - 34)).toBeLessThanOrEqual(0.5);
    expect(report.checks.some((c: QaCheck) => c.name.includes('stand') && c.level === 'fail')).toBe(false);
    expect(report.layout).toBeNull();
  });

  it('AT2: a stand over the road gets clearance 0 and a fail stand check', () => {
    const report = qaReport({ ...withStand(3) } as TrackDataV2, null, ORIGIN);
    expect(report.stands[0].clearance).toBeCloseTo(0, 9);
    expect(report.checks.some((c: QaCheck) => c.name.includes('stand') && c.level === 'fail')).toBe(true);
  });

  it('AT3: ways equal to the centerline give rms below 0.01 m', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(0), ORIGIN);
    expect(report.layout).not.toBeNull();
    expect(report.layout?.rmsMeters).toBeLessThan(0.01);
  });

  it('AT4: ways shifted 10 m give rms 10 with a warn and no fail layout check', () => {
    const report = qaReport({ ...STRAIGHT } as TrackDataV2, waysOf(-10), ORIGIN);
    expect(report.layout).not.toBeNull();
    expect(Math.abs((report.layout?.rmsMeters ?? 0) - 10)).toBeLessThanOrEqual(0.1);
    expect(report.checks.some((c: QaCheck) => c.name.includes('layout') && c.level === 'warn')).toBe(true);
    expect(report.checks.some((c: QaCheck) => c.name.includes('layout') && c.level === 'fail')).toBe(false);
  });

  it('AT5: WALLed(-3) reports a barrier max gap of 3 m', () => {
    const report = qaReport(walled(-3), null, ORIGIN);
    expect(Math.abs(report.barrierMaxGap - 3)).toBeLessThanOrEqual(1e-6);
  });

  it('AT6: the CLI writes monza.json and prints a monza line', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'simgame-237-'));
    try {
      const run = spawnSync('npm', ['run', '-s', 'track:qa', '--', 'monza', '--out', outDir], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: RUN_TIMEOUT,
      });
      const file = join(outDir, 'monza.json');
      expect(existsSync(file)).toBe(true);
      const report = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const key of ['id', 'stands', 'pit', 'layout', 'barrierMaxGap', 'checks']) {
        expect(Object.keys(report), key).toContain(key);
      }
      expect(run.stdout.split('\n').some((line) => line.startsWith('monza '))).toBe(true);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, RUN_TIMEOUT);

  it('AT7: report.ts imports nothing from three', () => {
    const source = readFileSync(join(ROOT, 'tools', 'track-qa', 'report.ts'), 'utf8');
    expect(source).not.toMatch(/from ['"]three['"]/);
  });
});
