import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { qaViews } from '../../../src/track/qaViews';

const ROOT = join(__dirname, '..', '..', '..');

function makeTrack(id: string, centerline: [number, number][], elevation?: number[]): TrackDataV2 {
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
  return t as TrackDataV2;
}

const ARC = Array.from({ length: 200 }, (_, i): [number, number] => [
  200 * Math.cos((2 * Math.PI * i) / 200),
  -200 * Math.sin((2 * Math.PI * i) / 200),
]);

// Four identical 90° corners from small integer coordinates: bitwise-equal curvature
// at every corner (bottom +x, right +z, top -x, left -z, 45° diagonals between straights).
function tieCenterline(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 180; x += 10) pts.push([x, 0]);
  pts.push([190, 10]);
  for (let z = 20; z <= 180; z += 10) pts.push([190, z]);
  pts.push([180, 190]);
  for (let x = 170; x >= -110; x -= 10) pts.push([x, 190]);
  pts.push([-120, 180]);
  for (let z = 170; z >= 10; z -= 10) pts.push([-120, z]);
  pts.push([-110, 0]);
  for (let x = -100; x <= -10; x += 10) pts.push([x, 0]);
  return pts;
}
const TIE = makeTrack('tie', tieCenterline());
const TIE_MIDS: [number, number][] = [
  [185, 5],
  [185, 185],
  [-115, 185],
  [-115, 5],
];

describe('238 track QA shots post-code gaps', () => {
  it('POST1: non-finite count floors to zero corners', () => {
    for (const c of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const views = qaViews(TIE, c);
      expect(views.length).toBe(1);
      expect(views[0].name).toBe('start');
    }
  });

  it('POST2: an empty centerline yields no views', () => {
    expect(qaViews(makeTrack('empty', []), 6)).toEqual([]);
  });

  it('POST3: a degenerate track returns only a finite start view at the point itself', () => {
    const single = qaViews(makeTrack('dot', [[5, 7]], [3]), 6);
    expect(single.length).toBe(1);
    expect(single[0].eye).toEqual([5, 9, 7]);
    expect(single[0].target).toEqual([5, 3, 7]);
    const repeated = qaViews(
      makeTrack('dot5', [
        [5, 7],
        [5, 7],
        [5, 7],
      ]),
      6,
    );
    expect(repeated.length).toBe(1);
    expect(repeated[0].eye.every(Number.isFinite)).toBe(true);
    expect(repeated[0].eye[1]).toBe(6);
  });

  it('POST4: missing elevation entries default to 0 for start and corner views', () => {
    const views = qaViews(makeTrack('arc-noelev', ARC, []), 1);
    expect(views.length).toBe(2);
    expect(views[0].eye[1]).toBeCloseTo(6, 6);
    expect(views[0].target[1]).toBe(0);
    const corner = views[1];
    expect(corner.target[1]).toBe(0);
    expect(corner.eye[1]).toBeCloseTo(8, 6);
  });

  it('POST5: equal-curvature corners keep the lowest index', () => {
    const corner = qaViews(TIE, 1).find((v) => v.name !== 'start')!;
    const dists = TIE_MIDS.map((m) => Math.hypot(corner.target[0] - m[0], corner.target[2] - m[1]));
    expect(Math.min(...dists)).toBeLessThanOrEqual(10);
    expect(Math.min(...dists)).toBeCloseTo(dists[0], 6);
    for (const d of dists.slice(1)) expect(d).toBeGreaterThan(100);
  });

  it('POST6: a count far above the corner count stops on low curvature', () => {
    expect(qaViews(TIE, 100).map((v) => v.name)).toEqual([
      'start',
      'corner1',
      'corner2',
      'corner3',
      'corner4',
    ]);
  });

  it('POST7: qaViews does not mutate the track input', () => {
    const track = makeTrack(
      'frozen',
      tieCenterline(),
      tieCenterline().map((p) => p[0] * 0.01),
    );
    for (const p of track.centerline) Object.freeze(p);
    Object.freeze(track.centerline);
    Object.freeze(track.elevation);
    Object.freeze(track);
    expect(() => qaViews(track, 6)).not.toThrow();
    expect(track.centerline[17]).toEqual([170, 0]);
  });

  it('POST8: track:shots exits 1 on a missing or unknown track id', () => {
    const tsx = join(ROOT, 'node_modules', '.bin', 'tsx');
    const cli = join(ROOT, 'tools', 'track-qa', 'shots.ts');
    for (const args of [[cli], [cli, '__no_such_track__']]) {
      const r = spawnSync(tsx, args, { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Unknown track id');
    }
  }, 150_000);
});
