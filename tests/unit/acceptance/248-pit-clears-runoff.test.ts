import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Point2 } from '../../../src/track/geo';
import type { BarrierSegment, PitLane, RunoffSegment, TrackDataV2 } from '../../../src/core/types';
import { barrierRuns } from '../../../src/track/barrierPath';
import { pitBuildingPieces, type PitPiece } from '../../../src/track/placement';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { layoutBarriers } from '../../../tools/track-builder/barriers';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

// Variable specifier keeps typecheck green until task 248 adds the export (the 159 pattern).
const PIT_RANGE_MODULE = '../../../tools/track-builder/pitRange';

type ClipRunoffsFn = (
  runoffs: RunoffSegment[],
  centerline: Point2[],
  pit: PitLane,
  marginMeters: number,
) => RunoffSegment[];

async function loadClipRunoffs(): Promise<ClipRunoffsFn> {
  const mod = (await import(PIT_RANGE_MODULE)) as unknown as { clipRunoffsOutOfPit: ClipRunoffsFn };
  return mod.clipRunoffsOutOfPit;
}

const STRAIGHT: TrackDataV2 = {
  ...fixture,
  id: 'straight',
  name: 'Straight',
  centerline: Array.from({ length: 100 }, (_, i): [number, number] => [i * 10, 0]),
  elevation: Array.from({ length: 100 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 10, end: 30, side: 'right' },
};

const RIGHT_GRAVEL: RunoffSegment = {
  start: 0,
  end: 99,
  side: 'right',
  surface: 'gravel',
  widthMeters: 25,
};

function withBarrier(offsetMeters: number): TrackDataV2 {
  return {
    ...STRAIGHT,
    barriers: [{ start: 0, end: 99, side: 'right', type: 'armco', offsetMeters }],
  };
}

function covers(seg: { start: number; end: number }, i: number): boolean {
  return seg.end >= seg.start ? i >= seg.start && i <= seg.end : i >= seg.start || i <= seg.end;
}

// Every index covered by the segments (wrapping), ascending.
function coveredIndices(segments: RunoffSegment[], n: number): number[] {
  const set = new Set<number>();
  for (const s of segments) {
    let i = ((s.start % n) + n) % n;
    const end = ((s.end % n) + n) % n;
    for (;;) {
      set.add(i);
      if (i === end) break;
      i = (i + 1) % n;
    }
  }
  return [...set].sort((a, b) => a - b);
}

function distToCenterline(track: TrackDataV2, x: number, z: number): number {
  const n = track.centerline.length;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const a = track.centerline[i];
    const b = track.centerline[(i + 1) % n];
    const abx = b[0] - a[0];
    const abz = b[1] - a[1];
    const len2 = abx * abx + abz * abz;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    best = Math.min(best, Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t)));
  }
  return best;
}

let trackCache: Array<{ id: string; track: TrackDataV2 }> | null = null;

function builtTracks(): Array<{ id: string; track: TrackDataV2 }> {
  if (trackCache) return trackCache;
  const index = JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
  ) as Array<{ id: string }>;
  trackCache = index.map(({ id }) => ({
    id,
    track: JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
    ) as TrackDataV2,
  }));
  return trackCache;
}

// Local-frame footprint of a piece (the footprintGround map) on a grid of step <= 2 m.
function footprintSamples(p: PitPiece): Array<{ x: number; z: number }> {
  const ix = Math.max(1, Math.ceil(p.length / 2));
  const iz = Math.max(1, Math.ceil(p.depth / 2));
  const cos = Math.cos(p.yaw);
  const sin = Math.sin(p.yaw);
  const out: Array<{ x: number; z: number }> = [];
  for (let a = 0; a <= ix; a++) {
    const lx = -p.length / 2 + (p.length * a) / ix;
    for (let b = 0; b <= iz; b++) {
      const lz = -p.depth / 2 + (p.depth * b) / iz;
      out.push({ x: p.x + lx * cos + lz * sin, z: p.z - lx * sin + lz * cos });
    }
  }
  return out;
}

// Flat [ax, az, bx, bz, cx, cz] per non-grass triangle; zero-area triangles carry no area.
function nonGrassTriangles(track: TrackDataV2): number[] {
  const out: number[] = [];
  for (const strip of buildTrackSurfaces(track)) {
    if (strip.surface === 'grass') continue;
    const { positions: p, indices: ind } = strip;
    for (let t = 0; t + 2 < ind.length; t += 3) {
      const a = 3 * ind[t];
      const b = 3 * ind[t + 1];
      const c = 3 * ind[t + 2];
      const ax = p[a];
      const az = p[a + 2];
      const bx = p[b];
      const bz = p[b + 2];
      const cx = p[c];
      const cz = p[c + 2];
      if ((bx - ax) * (cz - az) === (bz - az) * (cx - ax)) continue;
      out.push(ax, az, bx, bz, cx, cz);
    }
  }
  return out;
}

function triContains(
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
  px: number, pz: number,
): boolean {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (az - cz) - (ax - cx) * (pz - cz);
  const d3 = (px - ax) * (bz - az) - (bx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

describe('248 pit clears runoff acceptance', () => {
  it('AT1: clip of the STRAIGHT right gravel runoff leaves right runoffs covering exactly indices 0..4 and 36..99', async () => {
    const clip = await loadClipRunoffs();
    const out = clip([RIGHT_GRAVEL], STRAIGHT.centerline, STRAIGHT.pit, 50);
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const s of out) {
      expect(s.side, 'side').toBe('right');
      expect(s.surface, 'surface').toBe('gravel');
      expect(s.widthMeters, 'width').toBe(25);
    }
    const expected = [
      ...Array.from({ length: 5 }, (_, i) => i),
      ...Array.from({ length: 64 }, (_, i) => 36 + i),
    ];
    expect(coveredIndices(out, STRAIGHT.centerline.length)).toEqual(expected);
  });

  it('AT2: layoutBarriers over the AT1 output puts type wall at offset 11 on the right side over indices 10..30', async () => {
    const clip = await loadClipRunoffs();
    const runoffs = clip([RIGHT_GRAVEL], STRAIGHT.centerline, STRAIGHT.pit, 50);
    const barriers: BarrierSegment[] = layoutBarriers(
      STRAIGHT.centerline,
      STRAIGHT.widthMeters,
      [],
      runoffs,
      STRAIGHT.pit,
    );
    const covering = barriers.filter(
      (b) => b.side === 'right' && covers(b, 10) && covers(b, 20) && covers(b, 30),
    );
    expect(covering).toHaveLength(1);
    expect(covering[0]).toMatchObject({ type: 'wall', offsetMeters: 11 });
  });

  it('AT3: STRAIGHT with a right barrier at offset 18 keeps every piece near face at distance >= 19 - 1e-6 from the centerline', () => {
    const pieces = pitBuildingPieces(withBarrier(18));
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const p of pieces) {
      const nearX = p.x - (p.depth / 2) * Math.sin(p.yaw);
      const nearZ = p.z - (p.depth / 2) * Math.cos(p.yaw);
      for (const s of [-1, 0, 1]) {
        const sx = nearX + ((s * p.length) / 2) * Math.cos(p.yaw);
        const sz = nearZ - ((s * p.length) / 2) * Math.sin(p.yaw);
        expect(distToCenterline(STRAIGHT, sx, sz)).toBeGreaterThanOrEqual(19 - 1e-6);
      }
    }
  });

  it('AT4: STRAIGHT with a right barrier at offset 8 yields the pre-change single box', () => {
    const pieces = pitBuildingPieces(withBarrier(8));
    expect(pieces).toHaveLength(1);
    const p = pieces[0];
    expect(p.x).toBeCloseTo(200, 9);
    expect(p.z).toBeCloseTo(20, 9);
    expect(p.yaw).toBeCloseTo(0, 9);
    expect(p.length).toBeCloseTo(200, 9);
    expect(p.depth).toBeCloseTo(8, 9);
    expect(p.baseY).toBeCloseTo(0, 9);
    expect(p.plinthBottom).toBeCloseTo(-0.05, 9);
  });

  it('AT5: every built track has no pit footprint sample (<= 2 m grid) inside a non-grass buildTrackSurfaces triangle and no barrierRuns vertex inside a footprint', () => {
    const failures: string[] = [];
    for (const { id, track } of builtTracks()) {
      const pieces = pitBuildingPieces(track);
      const tris = nonGrassTriangles(track);
      const vertices = [...barrierRuns(track, 'left'), ...barrierRuns(track, 'right')].flat();
      pieces.forEach((p, pi) => {
        const where = `${id} piece ${pi}`;
        const samples = footprintSamples(p);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const s of samples) {
          if (s.x < minX) minX = s.x;
          if (s.x > maxX) maxX = s.x;
          if (s.z < minZ) minZ = s.z;
          if (s.z > maxZ) maxZ = s.z;
        }
        for (const s of samples) {
          let hit = false;
          for (let t = 0; t < tris.length && !hit; t += 6) {
            const ax = tris[t];
            const az = tris[t + 1];
            const bx = tris[t + 2];
            const bz = tris[t + 3];
            const cx = tris[t + 4];
            const cz = tris[t + 5];
            if (Math.min(ax, bx, cx) > maxX || Math.max(ax, bx, cx) < minX) continue;
            if (Math.min(az, bz, cz) > maxZ || Math.max(az, bz, cz) < minZ) continue;
            hit = triContains(ax, az, bx, bz, cx, cz, s.x, s.z);
          }
          if (hit) {
            failures.push(`${where}: sample (${s.x.toFixed(2)}, ${s.z.toFixed(2)}) inside a non-grass triangle`);
          }
        }
        const cos = Math.cos(p.yaw);
        const sin = Math.sin(p.yaw);
        for (const v of vertices) {
          const dx = v.x - p.x;
          const dz = v.z - p.z;
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          if (Math.abs(lx) <= p.length / 2 && Math.abs(lz) <= p.depth / 2) {
            failures.push(`${where}: barrierRuns vertex ${v.index} inside the footprint`);
          }
        }
      });
    }
    expect(failures.length, failures.slice(0, 12).join('; ')).toBe(0);
  }, 300000);

  it('AT6: rebuilt track JSONs differ from the pre-task JSON only in runoffs, barriers and the fields derived from them', () => {
    const baseRev = execFileSync('git', ['merge-base', 'master', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const allowed = ['runoffs', 'barriers', 'boards', 'trees', 'terrain', 'escapeRoads'];
    const pin = (t: TrackDataV2): Record<string, unknown> => {
      const copy: Record<string, unknown> = { ...t };
      for (const key of allowed) delete copy[key];
      return copy;
    };
    for (const { id, track } of builtTracks()) {
      const prev = JSON.parse(
        execFileSync('git', ['show', `${baseRev}:public/tracks/${id}.json`], {
          cwd: ROOT,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        }),
      ) as TrackDataV2;
      expect(pin(track), `${id}: fields outside runoffs/barriers/derived changed`).toEqual(pin(prev));
    }
  }, 120000);
});
