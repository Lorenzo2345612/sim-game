import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BarrierSegment, Grandstand, PitLane, Side, TrackDataV2 } from '../../src/core/types';
import { bboxCenter, projectLonLat, type LonLat } from '../../src/track/geo';
import { buildVillageEnv, villageSeed } from './villageBuildings';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const STREET_KEEP_M = 700;
const STREET_STEP_M = 5;
const STREET_TRACK_DROP_M = 10;
const PIT_DEPTH_M = 15;
const GRANDSTAND_PAD_M = 6;
const GRANDSTAND_ROW_M = 0.9;
const SETBACK_AFTER_BARRIER_M = 1.0;

type P = [number, number];

interface TrackConfig {
  id: string;
  geojson: string;
}

interface GeoJsonLineCollection {
  features: { geometry: { coordinates: LonLat[] } }[];
}

interface StreetsFile {
  ways: { id: number; highway: string; coords: LonLat[] }[];
}

interface VillageFile {
  polygons: LonLat[][];
}

interface AreasFile {
  features: { kind: string; tags: Record<string, string>; ring: LonLat[] }[];
}

function trackConfig(id: string): TrackConfig {
  const configs = JSON.parse(
    readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
  ) as TrackConfig[];
  const config = configs.find((c) => c.id === id);
  if (!config) throw new Error(`track ${id} not found in tools/track-builder/tracks.json`);
  return config;
}

/** The track JSON's local frame origin is bboxCenter of its source geojson (buildTrackData). */
function trackOrigin(id: string): LonLat {
  const config = trackConfig(id);
  const fc = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'tracks', `${config.geojson}.geojson`), 'utf8'),
  ) as GeoJsonLineCollection;
  return bboxCenter(fc.features[0].geometry.coordinates);
}

function pointSegDist(p: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}

function segsDist(p: P, segs: [P, P][]): number {
  let min = Infinity;
  for (const [a, b] of segs) min = Math.min(min, pointSegDist(p, a, b));
  return min;
}

function densify(pts: P[], step: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.ceil(len / step - 1e-9);
      for (let j = 1; j < k; j++) {
        const t = j / k;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    out.push([pts[i][0], pts[i][1]]);
  }
  return out;
}

function splitRuns(pts: P[], keep: (p: P) => boolean, minLength: number): P[][] {
  const out: P[][] = [];
  let cur: P[] = [];
  for (const p of pts) {
    if (keep(p)) cur.push(p);
    else {
      if (cur.length >= minLength) out.push(cur);
      cur = [];
    }
  }
  if (cur.length >= minLength) out.push(cur);
  return out;
}

function covers(start: number, end: number, i: number): boolean {
  return start <= end ? i >= start && i <= end : i >= start || i <= end;
}

function barrierOffsetAt(barriers: BarrierSegment[], side: Side, i: number): number {
  const seg = barriers.find((b) => b.side === side && covers(b.start, b.end, i));
  return seg ? seg.offsetMeters : 0;
}

function rightNormals(pts: P[], closed: boolean): P[] {
  const n = pts.length;
  const out: P[] = [];
  let last: P = [0, 1];
  for (let i = 0; i < n; i++) {
    const prev = closed ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
    const next = closed ? pts[(i + 1) % n] : pts[Math.min(i + 1, n - 1)];
    let dx = next[0] - prev[0];
    let dz = next[1] - prev[1];
    const len = Math.hypot(dx, dz);
    if (len > 0) {
      dx /= len;
      dz /= len;
      last = [-dz, dx];
    }
    out.push([last[0], last[1]]);
  }
  return out;
}

function pitExclusions(track: TrackDataV2, pit: PitLane): P[][] {
  const n = track.centerline.length;
  const normals = rightNormals(track.centerline, true);
  const half = (side: Side, i: number): number => {
    const arr = side === 'left' ? track.halfWidthLeft : track.halfWidthRight;
    const v = arr?.[i];
    return v === undefined ? track.widthMeters / 2 : v;
  };
  const sign = pit.side === 'right' ? 1 : -1;
  const edge = (i: number, extra: number): P => {
    const t = half(pit.side, i) + extra;
    return [
      track.centerline[i][0] + normals[i][0] * sign * t,
      track.centerline[i][1] + normals[i][1] * sign * t,
    ];
  };
  const out: P[][] = [];
  for (let i = 0; i < n; i++) {
    if (!covers(pit.start, pit.end, i)) continue;
    const j = (i + 1) % n;
    if (!covers(pit.start, pit.end, j)) continue;
    out.push([edge(i, 0), edge(j, 0), edge(j, PIT_DEPTH_M), edge(i, PIT_DEPTH_M)]);
  }
  return out;
}

function grandstandExclusion(g: Grandstand): P[] {
  const length = g.lengthMeters + 2 * GRANDSTAND_PAD_M;
  const depth = g.rows * GRANDSTAND_ROW_M + 2 * GRANDSTAND_PAD_M;
  const cos = Math.cos(g.yaw);
  const sin = Math.sin(g.yaw);
  const corner = (u: number, v: number): P => [g.x + u * cos + v * sin, g.z - u * sin + v * cos];
  return [
    corner(-length / 2, -depth / 2),
    corner(length / 2, -depth / 2),
    corner(length / 2, depth / 2),
    corner(-length / 2, depth / 2),
  ];
}

function waterExclusions(id: string, origin: LonLat): P[][] {
  const areas = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'osm', `${id}-areas.json`), 'utf8'),
  ) as AreasFile;
  const out: P[][] = [];
  for (const feature of areas.features) {
    if (feature.kind !== 'water' || feature.ring.length < 2) continue;
    const width = Number.parseFloat(feature.tags.est_width_m ?? '');
    if (!(width > 0)) continue;
    const half = width / 2 + 3;
    const line = projectLonLat(feature.ring, origin);
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i];
      const b = line[i + 1];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len === 0) continue;
      const nx = (-dz / len) * half;
      const nz = (dx / len) * half;
      out.push([
        [a[0] + nx, a[1] + nz],
        [b[0] + nx, b[1] + nz],
        [b[0] - nx, b[1] - nz],
        [a[0] - nx, a[1] - nz],
      ]);
    }
  }
  return out;
}

function bake(id: string): void {
  const track = JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
  const origin = trackOrigin(id);
  const trackSegs: [P, P][] = track.centerline.map((p, i) => {
    const q = track.centerline[(i + 1) % track.centerline.length];
    return [p, q];
  });
  const streetsFile = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'osm', 'ermita-streets.json'), 'utf8'),
  ) as StreetsFile;
  const streets: P[][] = [];
  for (const way of streetsFile.ways) {
    const proj = projectLonLat(way.coords, origin);
    for (const run of splitRuns(proj, (p) => segsDist(p, trackSegs) <= STREET_KEEP_M, 2)) {
      const dense = densify(run, STREET_STEP_M);
      streets.push(...splitRuns(dense, (p) => segsDist(p, trackSegs) >= STREET_TRACK_DROP_M, 2));
    }
  }
  const village = JSON.parse(
    readFileSync(join(ROOT, 'assets', 'source', 'osm', 'ermita-village.json'), 'utf8'),
  ) as VillageFile;
  const mask = village.polygons.map((poly) => projectLonLat(poly, origin));
  const halfWidthLeft = track.halfWidthLeft ?? track.centerline.map(() => track.widthMeters / 2);
  const halfWidthRight = track.halfWidthRight ?? track.centerline.map(() => track.widthMeters / 2);
  const trackSetback = track.centerline.map((_, i) => barrierOffsetAt(track.barriers, 'left', i) + SETBACK_AFTER_BARRIER_M);
  const trackSetbackRight = track.centerline.map((_, i) => barrierOffsetAt(track.barriers, 'right', i) + SETBACK_AFTER_BARRIER_M);
  const exclusions: P[][] = [
    ...pitExclusions(track, track.pit),
    ...track.grandstands.map(grandstandExclusion),
    ...waterExclusions(id, origin),
  ];
  const env = buildVillageEnv({
    centerline: track.centerline,
    halfWidthLeft,
    halfWidthRight,
    streets,
    mask,
    exclusions,
    seed: villageSeed(id),
    trackSetback,
    trackSetbackRight,
  });
  writeFileSync(join(ROOT, 'public', 'tracks', `${id}-env.json`), JSON.stringify(env));
  console.log(
    `${id}: ${env.buildings.length} buildings, ${env.walls.length} walls, ${streets.length} street pieces, ${exclusions.length} exclusions`,
  );
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('usage: tsx tools/env/bakeVillage.ts <id>...');
  process.exit(1);
}
for (const id of ids) bake(id);
