import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { unprojectXZ, type LonLat, type Point2 } from '../../../src/track/geo';

const ROOT = join(__dirname, '..', '..', '..');
const CLI_TIMEOUT = 60_000;

// Task 181 lands tools/track-style/locate.ts; the variable specifier keeps
// typecheck green until the module exists (the 162/179 pattern).
const LOCATE_MODULE = '../../../tools/track-style/locate';

interface LocateResult {
  index: number;
  side: 'left' | 'right';
  distanceMeters: number;
}
interface LocateModule {
  trackOrigin: (id: string) => LonLat;
  locateIndex: (track: { centerline: Point2[] }, x: number, z: number) => LocateResult;
}

async function loadLocate(): Promise<LocateModule> {
  return (await import(LOCATE_MODULE)) as LocateModule;
}

const STRAIGHT: TrackDataV2 = {
  version: 2,
  id: 'straight',
  name: 'Straight',
  widthMeters: 12,
  lengthMeters: 990,
  officialLengthMeters: 990,
  centerline: Array.from({ length: 100 }, (_, i): Point2 => [i * 10, 0]),
  sectors: [0, 33, 66],
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain: { originX: 0, originZ: 0, sizeX: 1000, sizeZ: 100, rows: 2, cols: 2, heights: [0, 0, 0, 0] },
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 10, end: 30, side: 'right' },
  source: { dataset: 'test', license: 'MIT', url: 'https://example.com/straight', dem: 'test.tif' },
};

const TEN_POINT_TRACK = JSON.stringify({
  centerline: Array.from({ length: 10 }, (_, i): Point2 => [i, 0]),
});

const styleDirs: string[] = [];

afterAll(() => {
  for (const dir of styleDirs) rmSync(dir, { recursive: true, force: true });
});

function styleDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'check-styles-'));
  styleDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function runNpmRun(args: string[]) {
  return spawnSync('npm', args, { cwd: ROOT, encoding: 'utf8', timeout: CLI_TIMEOUT });
}

function runCheckStyles(dir: string) {
  return spawnSync('npx', ['tsx', 'tools/track-style/checkStyles.ts', dir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: CLI_TIMEOUT,
  });
}

describe('181 track style tools acceptance', () => {
  it('AT1: locateIndex(STRAIGHT, 152, -30) is index 15, side left, distance 30.07 +/- 0.01 m', async () => {
    const { locateIndex } = await loadLocate();
    const r = locateIndex(STRAIGHT, 152, -30);
    expect(r.index).toBe(15);
    expect(r.side).toBe('left');
    expect(Math.abs(r.distanceMeters - 30.07)).toBeLessThanOrEqual(0.01);
  });

  it('AT2: locateIndex(STRAIGHT, 152, 30) is index 15, side right', async () => {
    const { locateIndex } = await loadLocate();
    const r = locateIndex(STRAIGHT, 152, 30);
    expect(r.side).toBe('right');
    expect(r.index).toBe(15);
  });

  it("AT3: trackOrigin('monza') is within 0.05 deg of [9.28, 45.62]", async () => {
    const { trackOrigin } = await loadLocate();
    const [lon, lat] = trackOrigin('monza');
    expect(lon).toBeCloseTo(9.28, 1);
    expect(lat).toBeCloseTo(45.62, 1);
  });

  it('AT4: track:locate monza at unprojected centerline[100] exits 0 with index 100 +/- 1 and distance < 1 m', { timeout: CLI_TIMEOUT }, async () => {
    const { trackOrigin } = await loadLocate();
    const track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8'),
    ) as { centerline: Point2[] };
    const [lon, lat] = unprojectXZ(track.centerline[100], trackOrigin('monza'));
    const res = runNpmRun(['run', '-s', 'track:locate', '--', 'monza', String(lat), String(lon)]);
    expect(res.status, `track:locate exited ${res.status}: ${res.stderr}`).toBe(0);
    const lines = res.stdout.trim().split('\n');
    const last = JSON.parse(lines[lines.length - 1]) as LocateResult;
    expect(last.index).toBeGreaterThanOrEqual(99);
    expect(last.index).toBeLessThanOrEqual(101);
    expect(last.distanceMeters).toBeLessThan(1);
  });

  it('AT5: track:locate with unknown id exits non-zero with the id on stderr', { timeout: CLI_TIMEOUT }, () => {
    const res = runNpmRun(['run', '-s', 'track:locate', '--', 'nope', '45.6', '9.2']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('nope');
  });

  it('AT6: checkStyles on a valid t.style.json exits 0', { timeout: CLI_TIMEOUT }, () => {
    const dir = styleDir({ 't.json': TEN_POINT_TRACK, 't.style.json': '{"version":1}' });
    const res = runCheckStyles(dir);
    expect(res.status, `checkStyles exited ${res.status}: ${res.stderr}`).toBe(0);
  });

  it('AT7: unknown key foo exits 1 with output containing t and foo', { timeout: CLI_TIMEOUT }, () => {
    const dir = styleDir({ 't.json': TEN_POINT_TRACK, 't.style.json': '{"version":1,"foo":1}' });
    const res = runCheckStyles(dir);
    expect(res.status, `checkStyles exited ${res.status}: ${res.stderr}`).toBe(1);
    expect(res.stdout).toContain('t');
    expect(res.stdout).toContain('foo');
  });

  it('AT8: barrier range end 10 on a 10-point track exits 1 with barriers.ranges[0]', { timeout: CLI_TIMEOUT }, () => {
    const dir = styleDir({
      't.json': TEN_POINT_TRACK,
      't.style.json': '{"version":1,"barriers":{"ranges":[{"start":0,"end":10}]}}',
    });
    const res = runCheckStyles(dir);
    expect(res.status, `checkStyles exited ${res.status}: ${res.stderr}`).toBe(1);
    expect(res.stdout).toContain('barriers.ranges[0]');
  });

  it('AT9: u.style.json without u.json exits 1 with output containing u', { timeout: CLI_TIMEOUT }, () => {
    const dir = styleDir({ 'u.style.json': '{"version":1}' });
    const res = runCheckStyles(dir);
    expect(res.status, `checkStyles exited ${res.status}: ${res.stderr}`).toBe(1);
    expect(res.stdout).toContain('u');
  });

  it('AT10: npm run check:styles on the repo as-is exits 0', { timeout: CLI_TIMEOUT }, () => {
    const res = runNpmRun(['run', '-s', 'check:styles']);
    expect(res.status, `check:styles exited ${res.status}: ${res.stderr}`).toBe(0);
  });
});
