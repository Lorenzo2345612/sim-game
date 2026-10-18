import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KERB_WIDTH } from '../../src/core/constants';
import type { Side, SurfaceStrip, TrackDataV2 } from '../../src/core/types';
import { barrierRuns, rightNormalAt, type BarrierVertex } from '../../src/track/barrierPath';
import { footprintGround } from '../../src/track/ground';
import { projectLonLat, type LonLat } from '../../src/track/geo';
import { parseTrackData } from '../../src/track/parseTrackData';
import { grandstandFootprint, pitBuildingPieces, type PitPiece } from '../../src/track/placement';
import { sausagePieces } from '../../src/track/sausages';
import { buildTrackSurfaces, halfWidthAt } from '../../src/track/surfaces';
import { trackOrigin } from '../track-style/locate';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAMPLE_STEP = 2;

export interface QaCheck { name: string; level: 'ok' | 'warn' | 'fail'; detail: string }
export interface ClearanceMetric { worst: number; atMeters: number }
export interface QaReport {
  stands: { index: number; clearance: number; relief: number }[];
  pit: { clearance: number; relief: number }[];
  layout: { rmsMeters: number; maxMeters: number } | null;
  barrierMaxGap: number;
  clearance: {
    kerb: ClearanceMetric | null;
    barrierFold: ClearanceMetric | null;
    sausage: ClearanceMetric | null;
    pitClear: { overlapSamples: number; barrierVertices: number; atMeters: number | null };
  };
  checks: QaCheck[];
}
export interface OsmWays { ways: { coords: LonLat[] }[] }

interface Tri {
  ax: number; az: number; bx: number; bz: number; cx: number; cz: number;
  minX: number; maxX: number; minZ: number; maxZ: number;
}

/** Non-grass strip geometry: triangles and flat XZ vertices of every non-grass strip. */
function roadGeometry(strips: SurfaceStrip[]): { tris: Tri[]; vertices: number[] } {
  const tris: Tri[] = [];
  const vertices: number[] = [];
  for (const strip of strips) {
    if (strip.surface === 'grass') continue;
    const p = strip.positions;
    for (let i = 0; i < p.length; i += 3) vertices.push(p[i], p[i + 2]);
    const ind = strip.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const ax = p[a];
      const az = p[a + 2];
      const bx = p[b];
      const bz = p[b + 2];
      const cx = p[c];
      const cz = p[c + 2];
      tris.push({
        ax, az, bx, bz, cx, cz,
        minX: Math.min(ax, bx, cx), maxX: Math.max(ax, bx, cx),
        minZ: Math.min(az, bz, cz), maxZ: Math.max(az, bz, cz),
      });
    }
  }
  return { tris, vertices };
}

/** Point in triangle (XZ); a point exactly on an edge or vertex counts as inside. */
function insideTri(t: Tri, x: number, z: number): boolean {
  if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) return false;
  const d1 = (x - t.bx) * (t.az - t.bz) - (t.ax - t.bx) * (z - t.bz);
  const d2 = (x - t.cx) * (t.bz - t.cz) - (t.bx - t.cx) * (z - t.cz);
  const d3 = (x - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (z - t.az);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** World-space footprint samples on the same grid footprintGround walks (spacing <= 2 m, edges and corners included). */
function footprintSamples(
  x: number, z: number, yaw: number,
  xMin: number, xMax: number, zMin: number, zMax: number,
): number[] {
  const ix = Math.max(1, Math.ceil((xMax - xMin) / SAMPLE_STEP));
  const iz = Math.max(1, Math.ceil((zMax - zMin) / SAMPLE_STEP));
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const pts: number[] = [];
  for (let a = 0; a <= ix; a++) {
    const lx = xMin + ((xMax - xMin) * a) / ix;
    for (let b = 0; b <= iz; b++) {
      const lz = zMin + ((zMax - zMin) * b) / iz;
      pts.push(x + lx * cos + lz * sin, z - lx * sin + lz * cos);
    }
  }
  return pts;
}

/** 0 when a sample lies in a non-grass triangle, else the min sample-to-vertex distance. */
function clearanceOf(
  geom: { tris: Tri[]; vertices: number[] }, samples: number[],
): number {
  for (let s = 0; s < samples.length; s += 2) {
    for (const t of geom.tris) {
      if (insideTri(t, samples[s], samples[s + 1])) return 0;
    }
  }
  let best = Infinity;
  for (let s = 0; s < samples.length; s += 2) {
    for (let v = 0; v < geom.vertices.length; v += 2) {
      const dx = geom.vertices[v] - samples[s];
      const dz = geom.vertices[v + 1] - samples[s + 1];
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const ex = bx - ax;
  const ez = bz - az;
  const l2 = ex * ex + ez * ez;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
  return Math.hypot(x - (ax + t * ex), z - (az + t * ez));
}

/** RMS and max distance from every centerline point to the nearest projected OSM way segment. */
function layoutOf(
  track: TrackDataV2, osmWays: OsmWays | null, origin: LonLat,
): { rmsMeters: number; maxMeters: number } | null {
  if (osmWays === null || osmWays.ways.length === 0) return null;
  const segs: number[] = [];
  for (const way of osmWays.ways) {
    const pts = projectLonLat(way.coords, origin);
    for (let i = 1; i < pts.length; i++) {
      segs.push(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    }
  }
  let sum2 = 0;
  let max = 0;
  const n = track.centerline.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = track.centerline[i];
    let best = Infinity;
    for (let s = 0; s < segs.length; s += 4) {
      const d = segDist(x, z, segs[s], segs[s + 1], segs[s + 2], segs[s + 3]);
      if (d < best) best = d;
    }
    sum2 += best * best;
    if (best > max) max = best;
  }
  return { rmsMeters: Math.sqrt(sum2 / n), maxMeters: max };
}

function nearestCenterline(cx: [number, number][], x: number, z: number): { index: number; dist: number } {
  let best = Infinity;
  let index = 0;
  for (let j = 0; j < cx.length; j++) {
    const d = Math.hypot(cx[j][0] - x, cx[j][1] - z);
    if (d < best) {
      best = d;
      index = j;
    }
  }
  return { index, dist: best };
}

function lapMeters(cx: [number, number][]): number[] {
  const cum = new Array<number>(cx.length);
  cum[0] = 0;
  for (let i = 1; i < cx.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]);
  }
  return cum;
}

function halfNearAt(track: TrackDataV2, i: number): number {
  return Math.min(halfWidthAt(track, 'left', i), halfWidthAt(track, 'right', i));
}

/** Same rule as task 246: a wall inside its own side's nominal half-width is a median wall. */
function isMedianVertex(track: TrackDataV2, side: Side, v: BarrierVertex): boolean {
  if (v.type !== 'wall') return false;
  const hw = halfWidthAt(track, side, v.index);
  if (hw < track.widthMeters / 2 - 1e-9) return true;
  const [rx, rz] = rightNormalAt(track.centerline, v.index);
  const offset = Math.abs(
    (v.x - track.centerline[v.index][0]) * rx + (v.z - track.centerline[v.index][1]) * rz,
  );
  return offset < hw;
}

/** Min over kerb triangle centroids of clearance − (halfNear − 0.3); null with no kerb triangles. */
function kerbClearance(track: TrackDataV2, strips: SurfaceStrip[]): ClearanceMetric | null {
  const cx = track.centerline;
  const cum = lapMeters(cx);
  let worst = Infinity;
  let atMeters = 0;
  for (const strip of strips) {
    if (strip.surface !== 'kerb') continue;
    const p = strip.positions;
    const ind = strip.indices;
    for (let k = 0; k + 2 < ind.length; k += 3) {
      const a = 3 * ind[k];
      const b = 3 * ind[k + 1];
      const c = 3 * ind[k + 2];
      const x = (p[a] + p[b] + p[c]) / 3;
      const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
      const { index, dist } = nearestCenterline(cx, x, z);
      const value = dist - (halfNearAt(track, index) - 0.3);
      if (value < worst) {
        worst = value;
        atMeters = cum[index];
      }
    }
  }
  return Number.isFinite(worst) ? { worst, atMeters } : null;
}

/** Min over non-median barrier vertices (both sides) of clearance − (halfNear + KERB_WIDTH + 0.5). */
function barrierFoldClearance(track: TrackDataV2): ClearanceMetric | null {
  const cx = track.centerline;
  const cum = lapMeters(cx);
  let worst = Infinity;
  let atMeters = 0;
  for (const side of ['left', 'right'] as const) {
    for (const v of barrierRuns(track, side)) {
      for (const vertex of v) {
        if (isMedianVertex(track, side, vertex)) continue;
        const { index, dist } = nearestCenterline(cx, vertex.x, vertex.z);
        const value = dist - (halfNearAt(track, index) + KERB_WIDTH + 0.5);
        if (value < worst) {
          worst = value;
          atMeters = cum[index];
        }
      }
    }
  }
  return Number.isFinite(worst) ? { worst, atMeters } : null;
}

/** Min over sausage footprint samples (5 along each piece × 3 across the base) of clearance − (halfNear + KERB_WIDTH + 0.1). */
function sausageClearance(track: TrackDataV2): ClearanceMetric | null {
  const cx = track.centerline;
  const cum = lapMeters(cx);
  let worst = Infinity;
  let atMeters = 0;
  for (const s of track.sausages ?? []) {
    for (const piece of sausagePieces(track, s)) {
      const ux = Math.sin(piece.yaw);
      const uz = Math.cos(piece.yaw);
      const nx = -uz;
      const nz = ux;
      for (let j = 0; j < 5; j++) {
        const t = -piece.length / 2 + (piece.length * j) / 4;
        for (const l of [-0.25, 0, 0.25]) {
          const x = piece.position.x + t * ux + l * nx;
          const z = piece.position.z + t * uz + l * nz;
          const { index, dist } = nearestCenterline(cx, x, z);
          const value = dist - (halfNearAt(track, index) + KERB_WIDTH + 0.1);
          if (value < worst) {
            worst = value;
            atMeters = cum[index];
          }
        }
      }
    }
  }
  return Number.isFinite(worst) ? { worst, atMeters } : null;
}

function insidePitPiece(piece: PitPiece, x: number, z: number): boolean {
  const cos = Math.cos(piece.yaw);
  const sin = Math.sin(piece.yaw);
  const dx = x - piece.x;
  const dz = z - piece.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const eps = 1e-9;
  return (
    lx >= -piece.length / 2 - eps &&
    lx <= piece.length / 2 + eps &&
    lz >= -piece.depth / 2 - eps &&
    lz <= piece.depth / 2 + eps
  );
}

/** Pit building overlaps: footprint samples on non-grass strips plus barrier vertices inside footprints. */
function pitClearMetric(
  track: TrackDataV2, pieces: PitPiece[], geom: { tris: Tri[]; vertices: number[] },
): { overlapSamples: number; barrierVertices: number; atMeters: number | null } {
  const cx = track.centerline;
  const cum = lapMeters(cx);
  let overlapSamples = 0;
  let barrierVertices = 0;
  let atMeters: number | null = null;
  const offender = (x: number, z: number): void => {
    const { index } = nearestCenterline(cx, x, z);
    if (atMeters === null) atMeters = cum[index];
  };
  for (const piece of pieces) {
    const samples = footprintSamples(
      piece.x, piece.z, piece.yaw,
      -piece.length / 2, piece.length / 2, -piece.depth / 2, piece.depth / 2,
    );
    for (let s = 0; s < samples.length; s += 2) {
      let inside = false;
      for (const t of geom.tris) {
        if (insideTri(t, samples[s], samples[s + 1])) {
          inside = true;
          break;
        }
      }
      if (inside) {
        overlapSamples++;
        offender(samples[s], samples[s + 1]);
      }
    }
  }
  for (const side of ['left', 'right'] as const) {
    for (const run of barrierRuns(track, side)) {
      for (const v of run) {
        if (!pieces.some((piece) => insidePitPiece(piece, v.x, v.z))) continue;
        barrierVertices++;
        offender(v.x, v.z);
      }
    }
  }
  return { overlapSamples, barrierVertices, atMeters };
}

function clearanceCheck(name: string, metric: ClearanceMetric | null): QaCheck {
  if (metric === null) return { name, level: 'ok', detail: 'no items' };
  const detail = `worst ${metric.worst} m at ${metric.atMeters} m`;
  return { name, level: metric.worst < -1e-6 ? 'fail' : 'ok', detail };
}

function objectCheck(name: string, clearance: number, relief: number): QaCheck {
  const detail = `clearance ${clearance} m, relief ${relief} m`;
  if (clearance < 2) return { name, level: 'fail', detail };
  if (relief > 3) return { name, level: 'warn', detail };
  return { name, level: 'ok', detail };
}

export function qaReport(track: TrackDataV2, osmWays: OsmWays | null, origin: LonLat): QaReport {
  if (track.centerline.length === 0) throw new RangeError('qaReport: empty centerline');
  const strips = buildTrackSurfaces(track);
  const geom = roadGeometry(strips);
  const stands = track.grandstands.map((g, index) => {
    const fp = grandstandFootprint(g);
    const samples = footprintSamples(g.x, g.z, g.yaw, fp.xMin, fp.xMax, fp.zMin, fp.zMax);
    const { min, max } = footprintGround(track, g.x, g.z, g.yaw, fp.xMin, fp.xMax, fp.zMin, fp.zMax);
    return { index, clearance: clearanceOf(geom, samples), relief: max - min };
  });
  const pitPieces = pitBuildingPieces(track);
  const pit = pitPieces.map((piece) => {
    const xMin = -piece.length / 2;
    const xMax = piece.length / 2;
    const zMin = -piece.depth / 2;
    const zMax = piece.depth / 2;
    const samples = footprintSamples(piece.x, piece.z, piece.yaw, xMin, xMax, zMin, zMax);
    const { min, max } = footprintGround(track, piece.x, piece.z, piece.yaw, xMin, xMax, zMin, zMax);
    return { clearance: clearanceOf(geom, samples), relief: max - min };
  });
  const layout = layoutOf(track, osmWays, origin);
  let barrierMaxGap = 0;
  for (const side of ['left', 'right'] as const) {
    for (const run of barrierRuns(track, side)) {
      for (const v of run) {
        const gap = Math.abs(v.y - v.ground);
        if (gap > barrierMaxGap) barrierMaxGap = gap;
      }
    }
  }
  const checks: QaCheck[] = stands.map((s) => objectCheck(`stand ${s.index}`, s.clearance, s.relief));
  for (let k = 0; k < pit.length; k++) checks.push(objectCheck(`pit ${k}`, pit[k].clearance, pit[k].relief));
  checks.push(
    layout === null
      ? { name: 'layout', level: 'ok', detail: 'no OSM ways' }
      : {
          name: 'layout',
          level: layout.rmsMeters > 15 ? 'fail' : layout.rmsMeters > 5 ? 'warn' : 'ok',
          detail: `rms ${layout.rmsMeters} m, max ${layout.maxMeters} m`,
        },
  );
  checks.push({ name: 'barrier', level: 'ok', detail: `max gap ${barrierMaxGap} m` });
  const clearance = {
    kerb: kerbClearance(track, strips),
    barrierFold: barrierFoldClearance(track),
    sausage: sausageClearance(track),
    pitClear: pitClearMetric(track, pitPieces, geom),
  };
  checks.push(
    clearanceCheck('kerb', clearance.kerb),
    clearanceCheck('barrier-fold', clearance.barrierFold),
    clearanceCheck('sausage', clearance.sausage),
    {
      name: 'pit-clear',
      level: clearance.pitClear.overlapSamples + clearance.pitClear.barrierVertices > 0 ? 'fail' : 'ok',
      detail:
        `overlap ${clearance.pitClear.overlapSamples} samples, ` +
        `${clearance.pitClear.barrierVertices} barrier vertices, ` +
        `at ${clearance.pitClear.atMeters} m`,
    },
  );
  return { stands, pit, layout, barrierMaxGap, clearance, checks };
}

function run(): void {
  const args = process.argv.slice(2);
  const idArg = args[0];
  if (idArg === undefined) throw new Error('usage: track:qa <id|all> [--out dir]');
  let outArg: string | undefined;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1] !== undefined) {
      outArg = args[i + 1];
      i++;
    } else {
      throw new Error(`bad args: ${args.join(' ')}; usage: track:qa <id|all> [--out dir]`);
    }
  }
  const config = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
  ) as { id: string }[];
  const ids = idArg === 'all' ? config.map((t) => t.id) : [idArg];
  if (idArg !== 'all' && !config.some((t) => t.id === idArg)) throw new Error(`unknown track id: ${idArg}`);
  const outDir = outArg ?? join(ROOT, '.ai', 'qa');
  mkdirSync(outDir, { recursive: true });
  let failed = false;
  for (const id of ids) {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'));
      const parsed = parseTrackData(raw);
      if (!('version' in parsed) || parsed.version !== 2) throw new Error(`not a v2 track: ${id}`);
      const osmPath = join(ROOT, 'assets', 'source', 'osm', `${id}.json`);
      const osmWays = existsSync(osmPath)
        ? (JSON.parse(readFileSync(osmPath, 'utf8')) as OsmWays)
        : null;
      const report = qaReport(parsed, osmWays, trackOrigin(id));
      writeFileSync(join(outDir, `${id}.json`), `${JSON.stringify({ id, ...report }, null, 2)}\n`);
      const fails = report.checks.filter((c) => c.level === 'fail').length;
      const worst = fails > 0 ? 'fail' : report.checks.some((c) => c.level === 'warn') ? 'warn' : 'ok';
      console.log(`${id} ${worst} ${fails}`);
      if (worst === 'fail') failed = true;
    } catch (err) {
      console.error(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

function main(): void {
  try {
    run();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main();
}
