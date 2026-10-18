import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunoffSegment, TrackDataV2 } from '../../../src/core/types';
import type { LonLat } from '../../../src/track/geo';
import { qaReport, type QaCheck, type QaReport } from '../../../tools/track-qa/report';

const ROOT = join(__dirname, '..', '..', '..');
const ORIGIN: LonLat = [9, 45];
const RUN_TIMEOUT = 600_000;
const CLEARANCE_CHECKS = ['kerb', 'barrier-fold', 'sausage', 'pit-clear'] as const;

// Local mirrors of the task-249 report additions; the cast keeps typecheck green until they exist.
interface ClearanceMetric { worst: number; atMeters: number }
interface ClearanceBlock {
  kerb: ClearanceMetric | null;
  barrierFold: ClearanceMetric | null;
  sausage: ClearanceMetric | null;
  pitClear: { overlapSamples: number; barrierVertices: number; atMeters: number | null };
}
type Report249 = QaReport & { clearance: ClearanceBlock };

// Closed loop: straight A every 2 m (endpoint excluded), left semicircle centred (200,-R),
// straight B every 2 m (endpoint excluded), left semicircle centred (0,-R) back to (0,0).
function stadium(R: number): Omit<TrackDataV2, 'terrain'> {
  const m = Math.max(12, Math.ceil(Math.PI * R));
  const centerline: [number, number][] = [];
  for (let i = 0; i < 100; i++) centerline.push([2 * i, 0]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    centerline.push([200 + R * Math.sin(t), -R + R * Math.cos(t)]);
  }
  for (let i = 0; i < 100; i++) centerline.push([200 - 2 * i, -2 * R]);
  for (let j = 0; j < m; j++) {
    const t = (Math.PI * j) / m;
    centerline.push([-R * Math.sin(t), -R - R * Math.cos(t)]);
  }
  const n = centerline.length;
  return {
    version: 2,
    id: `stadium-${R}`,
    name: `Stadium ${R}`,
    widthMeters: 12,
    lengthMeters: 1000,
    officialLengthMeters: 1000,
    centerline,
    sectors: [0, Math.floor(n / 3), Math.floor((2 * n) / 3)],
    elevation: centerline.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'right' },
    source: { dataset: 'test', license: 'MIT', url: 'https://example.com/track', dem: 'test.tif' },
  };
}

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

function withKerbs(track: Omit<TrackDataV2, 'terrain'>): Omit<TrackDataV2, 'terrain'> {
  const last = track.centerline.length - 1;
  return {
    ...track,
    kerbs: [
      { start: 0, end: last, side: 'left' },
      { start: 0, end: last, side: 'right' },
    ],
  };
}

function withArmco12(track: Omit<TrackDataV2, 'terrain'>): Omit<TrackDataV2, 'terrain'> {
  const last = track.centerline.length - 1;
  return {
    ...track,
    barriers: (['left', 'right'] as const).map((side) => ({
      start: 0,
      end: last,
      side,
      type: 'armco' as const,
      offsetMeters: 12,
    })),
  };
}

function reportOf(track: Omit<TrackDataV2, 'terrain'>): Report249 {
  return qaReport(track as TrackDataV2, null, ORIGIN) as unknown as Report249;
}

function levelOf(report: QaReport, name: string): QaCheck['level'] | undefined {
  return report.checks.find((c) => c.name === name)?.level;
}

describe('249 qa clearance checks acceptance', () => {
  it('AT1: an asphalt sausage on STADIUM(30) fails sausage and an unclipped pit-side gravel on STRAIGHT fails pit-clear', () => {
    const sausage = reportOf({
      ...withKerbs(stadium(30)),
      sausages: [{ index: 0, side: 'left', offset: 3, length: 6 }],
    });
    expect(levelOf(sausage, 'sausage')).toBe('fail');
    const gravel: RunoffSegment = {
      start: 0,
      end: 99,
      side: 'right',
      surface: 'gravel',
      widthMeters: 25,
    };
    const pitCase = reportOf({ ...STRAIGHT, runoffs: [gravel] });
    expect(levelOf(pitCase, 'pit-clear')).toBe('fail');
  });

  it('AT2: STADIUM(30) with kerbs and armco 12 passes all four clearance checks', () => {
    const report = reportOf(withArmco12(withKerbs(stadium(30))));
    for (const name of CLEARANCE_CHECKS) {
      expect(levelOf(report, name), name).toBe('ok');
    }
  });

  it('AT3: the CLI over all tracks emits each clearance check once and never at fail', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'simgame-249-'));
    try {
      spawnSync('npm', ['run', '-s', 'track:qa', '--', 'all', '--out', outDir], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: RUN_TIMEOUT,
      });
      const files = readdirSync(outDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const report = JSON.parse(readFileSync(join(outDir, file), 'utf8')) as QaReport;
        for (const name of CLEARANCE_CHECKS) {
          const named = report.checks.filter((c) => c.name === name);
          expect(named, `${file} ${name}`).toHaveLength(1);
          expect(named[0].level, `${file} ${name}`).not.toBe('fail');
        }
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }, RUN_TIMEOUT);
});
