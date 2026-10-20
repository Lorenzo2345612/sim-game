import type { Grandstand, Side, TrackDataV2 } from '../core/types';
import { footprintGround } from './ground';
import { cornerCurvature, halfWidthAt } from './surfaces';
import { DEFAULT_TRACK_STYLE, type ResolvedTrackStyle } from './trackStyle';

export const GRANDSTAND_ROW_DEPTH = 0.9;
export const EDGE_OFFSET = 10;

const PIT_MAX_TURN = (8 * Math.PI) / 180;
const MIN_PIECE_LENGTH = 6;

export interface Footprint { xMin: number; xMax: number; zMin: number; zMax: number }

export interface PitPiece {
  x: number; z: number; yaw: number; length: number; depth: number; baseY: number; plinthBottom: number;
}

/** Local-frame footprint of a stand: length along X, rows × row depth along +Z. */
export function grandstandFootprint(g: Grandstand): Footprint {
  return {
    xMin: -g.lengthMeters / 2,
    xMax: g.lengthMeters / 2,
    zMin: 0,
    zMax: g.rows * GRANDSTAND_ROW_DEPTH,
  };
}

/** Ground the object on the highest ground under its footprint; the plinth bottoms below the lowest. */
export function groundedBase(
  track: TrackDataV2, x: number, z: number, yaw: number, fp: Footprint,
): { baseY: number; plinthBottom: number } {
  const { min, max } = footprintGround(track, x, z, yaw, fp.xMin, fp.xMax, fp.zMin, fp.zMax);
  return { baseY: max, plinthBottom: min - 0.05 };
}

export const STAND_MIN_CLEAR_M = 5, STAND_MAX_PUSH_M = 80;

/** Worst distance from the footprint to the track edge, sampled on a 21×5 grid over the stand. */
export function standClearance(track: TrackDataV2, g: Grandstand): number {
  const fp = grandstandFootprint(g);
  const cl = track.centerline;
  const cos = Math.cos(g.yaw);
  const sin = Math.sin(g.yaw);
  let worst = Infinity;
  for (let i = 0; i <= 20; i++) {
    const lx = fp.xMin + ((fp.xMax - fp.xMin) * i) / 20;
    for (let j = 0; j <= 4; j++) {
      const lz = fp.zMin + ((fp.zMax - fp.zMin) * j) / 4;
      const x = g.x + lx * cos + lz * sin;
      const z = g.z - lx * sin + lz * cos;
      let nearest = -1;
      let best = Infinity;
      for (let k = 0; k < cl.length; k++) {
        const dx = x - cl[k][0];
        const dz = z - cl[k][1];
        const d = dx * dx + dz * dz;
        if (d < best) {
          best = d;
          nearest = k;
        }
      }
      const clear = Math.sqrt(best)
        - Math.max(halfWidthAt(track, 'left', nearest), halfWidthAt(track, 'right', nearest));
      if (clear < worst) worst = clear;
    }
  }
  return worst;
}

/** Unit tangent at index i from the neighbouring points; one-sided when the central difference vanishes. */
function tangentAt(track: TrackDataV2, i: number): [number, number] {
  const n = track.centerline.length;
  const prev = track.centerline[(i - 1 + n) % n];
  const next = track.centerline[(i + 1) % n];
  let tx = next[0] - prev[0];
  let tz = next[1] - prev[1];
  if (tx === 0 && tz === 0) {
    const a = track.centerline[i];
    const b = track.centerline[(i + 1) % n];
    tx = b[0] - a[0];
    tz = b[1] - a[1];
  }
  const len = Math.hypot(tx, tz) || 1;
  return [tx / len, tz / len];
}

function angleDelta(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function coversWrap(start: number, end: number, i: number): boolean {
  return end >= start ? i >= start && i <= end : i >= start || i <= end;
}

/** Largest pit-side barrier offset covering index i; null when none does. */
function maxBarrierOffsetAt(track: TrackDataV2, side: Side, i: number): number | null {
  let max: number | null = null;
  for (const b of track.barriers) {
    if (b.side === side && coversWrap(b.start, b.end, i) && (max === null || b.offsetMeters > max)) {
      max = b.offsetMeters;
    }
  }
  return max;
}

interface OffsetRun {
  pa: { x: number; z: number };
  pb: { x: number; z: number };
  len: number;
  yaw: number;
  nx: number;
  nz: number;
}

/** Chord pieces of the offset polyline of walk: turn ≤ PIT_MAX_TURN, ≥ MIN_PIECE_LENGTH, uniform offset per piece. */
function offsetRunPieces(
  track: TrackDataV2, side: Side, walk: number[], offsets: number[],
): OffsetRun[] {
  const pointAt = (wi: number, off: number): { x: number; z: number } => {
    const [tx, tz] = tangentAt(track, walk[wi]);
    const [nx, nz] = side === 'left' ? [tz, -tx] : [-tz, tx];
    const [cx, cz] = track.centerline[walk[wi]];
    return { x: cx + nx * off, z: cz + nz * off };
  };
  const verts = walk.map((k, wi) => {
    const [tx, tz] = tangentAt(track, k);
    const off = offsets[wi];
    const { x, z } = pointAt(wi, off);
    return { x, z, heading: Math.atan2(-tz, tx) };
  });
  const chord = (a: number, b: number): number => Math.hypot(verts[b].x - verts[a].x, verts[b].z - verts[a].z);
  const runs: Array<[number, number]> = [];
  let s = 0;
  while (s < verts.length - 1) {
    let e = s + 1;
    while (e + 1 < verts.length && angleDelta(verts[e + 1].heading, verts[s].heading) <= PIT_MAX_TURN) e++;
    runs.push([s, e]);
    s = e;
  }
  const merged: Array<[number, number]> = [];
  for (const run of runs) {
    if (chord(run[0], run[1]) < MIN_PIECE_LENGTH && merged.length > 0) merged[merged.length - 1][1] = run[1];
    else merged.push([run[0], run[1]]);
  }
  // A short head piece has no previous piece: fold it into the next one.
  while (merged.length > 1 && chord(merged[0][0], merged[0][1]) < MIN_PIECE_LENGTH) {
    merged[1][0] = merged[0][0];
    merged.shift();
  }
  const out: OffsetRun[] = [];
  for (const [a, b] of merged) {
    // Uniform near face per piece: the max required offset over its vertices.
    let off = offsets[a];
    for (let wi = a + 1; wi <= b; wi++) off = Math.max(off, offsets[wi]);
    const pa = pointAt(a, off);
    const pb = pointAt(b, off);
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const dx = len === 0 ? 1 : (pb.x - pa.x) / len;
    const dz = len === 0 ? 0 : (pb.z - pa.z) / len;
    let yaw = Math.atan2(-dz, dx);
    if (side === 'left') yaw += Math.PI;
    const [tx, tz] = tangentAt(track, walk[a]);
    const [nx, nz] = side === 'left' ? [tz, -tx] : [-tz, tx];
    out.push({ pa, pb, len, yaw, nx, nz });
  }
  return out;
}

/** Move the stand away from the track until clear; null when STAND_MAX_PUSH_M does not suffice. */
export function clearGrandstand(track: TrackDataV2, g: Grandstand): Grandstand | null {
  if (standClearance(track, g) >= STAND_MIN_CLEAR_M) return g;
  const sin = Math.sin(g.yaw);
  const cos = Math.cos(g.yaw);
  for (let step = 1; step <= STAND_MAX_PUSH_M; step++) {
    const moved: Grandstand = { ...g, x: g.x + sin * step, z: g.z + cos * step };
    if (standClearance(track, moved) >= STAND_MIN_CLEAR_M) return moved;
  }
  return null;
}

/** Builder and style stands that clear the track, pushed outward where needed. */
export function placedGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[] {
  const out: Grandstand[] = [];
  for (const g of track.grandstands.concat(extraGrandstands(track, style)).concat(cornerGrandstands(track, style))) {
    const clear = clearGrandstand(track, g);
    if (clear !== null) out.push(clear);
  }
  return out;
}

/** Index walk from start to end along the centreline, both included, wrapping. */
function indexWalk(track: TrackDataV2, start: number, end: number): number[] {
  const n = track.centerline.length;
  const walk: number[] = [];
  let i = ((start % n) + n) % n;
  const last = ((end % n) + n) % n;
  for (;;) {
    walk.push(i);
    if (i === last) break;
    i = (i + 1) % n;
  }
  return walk;
}

/** One stand per chord piece along each style entry's offset polyline. */
export function extraGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[] {
  const out: Grandstand[] = [];
  for (const e of style.extraGrandstands) {
    const walk = indexWalk(track, e.start, e.end);
    const offsets = walk.map((k) => halfWidthAt(track, e.side, k) + e.offsetMeters);
    for (const { pa, pb, len, yaw, nx, nz } of offsetRunPieces(track, e.side, walk, offsets)) {
      // Rows go outward on the entry's side, so the front faces the track even when a chord backtracks.
      const faces = Math.sin(yaw) * nx + Math.cos(yaw) * nz > 0;
      out.push({
        x: (pa.x + pb.x) / 2,
        z: (pa.z + pb.z) / 2,
        yaw: faces ? yaw : yaw + Math.PI,
        lengthMeters: len,
        rows: e.rows,
        roof: e.roof,
      });
    }
  }
  return out;
}

const CORNER_RADIUS_M = 120;
const CORNER_SECTION_M = 40;
const CORNER_MIN_FRACTION = 0.12;
const CORNER_MAX_COUNT = 4;
const CORNER_BARRIER_EXTRA_M = 3;
const CORNER_ROWS = 10;
const CORNER_APEX_SEPARATION_M = 150;
const CORNER_PIECE_SEPARATION_M = 20;

interface Ring { s: number[]; total: number }

/** Cumulative centreline arc lengths and the full lap length. */
function arcRing(track: TrackDataV2): Ring {
  const cl = track.centerline;
  const s: number[] = [0];
  for (let i = 1; i < cl.length; i++) {
    s.push(s[i - 1] + Math.hypot(cl[i][0] - cl[i - 1][0], cl[i][1] - cl[i - 1][1]));
  }
  const last = cl[cl.length - 1];
  const total = s[cl.length - 1] + Math.hypot(cl[0][0] - last[0], cl[0][1] - last[1]);
  return { s, total };
}

function ringGap(ring: Ring, i: number, j: number): number {
  const d = Math.abs(ring.s[i] - ring.s[j]);
  return Math.min(d, ring.total - d);
}

/** Arc distance from i to the pit range: 0 inside, else the nearer endpoint. */
function pitGap(ring: Ring, pit: { start: number; end: number }, i: number): number {
  const span = (((ring.s[pit.end] - ring.s[pit.start]) % ring.total) + ring.total) % ring.total;
  const fwd = (((ring.s[i] - ring.s[pit.start]) % ring.total) + ring.total) % ring.total;
  if (fwd <= span) return 0;
  return Math.min(ringGap(ring, i, pit.start), ringGap(ring, i, pit.end));
}

/** One apex per circular run of radius < 120 m (the run's minimum), ranked and spread greedily, max 4. */
function cornerApexes(track: TrackDataV2, ring: Ring): number[] {
  const cx = track.centerline;
  const n = cx.length;
  const radii: number[] = [];
  const tight: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const c = cornerCurvature(cx, i);
    radii.push(c === null ? Infinity : c.radius);
    tight.push(c !== null && c.radius < CORNER_RADIUS_M);
  }
  const ranked: number[] = [];
  const pushRun = (run: number[]): void => {
    if (run.length === 0) return;
    let best = run[0];
    for (const i of run) if (radii[i] < radii[best]) best = i;
    ranked.push(best);
  };
  if (tight.every((f) => f)) pushRun(cx.map((_, i) => i));
  else {
    const start = tight.findIndex((f) => !f);
    let run: number[] = [];
    for (let step = 1; step <= n; step++) {
      const i = (start + step) % n;
      if (tight[i]) run.push(i);
      else {
        pushRun(run);
        run = [];
      }
    }
  }
  ranked.sort((a, b) => radii[a] - radii[b] || a - b);
  const min = CORNER_MIN_FRACTION * ring.total;
  const out: number[] = [];
  for (const i of ranked) {
    if (out.length === CORNER_MAX_COUNT) break;
    if (ringGap(ring, i, 0) < min) continue;
    if (out.some((a) => ringGap(ring, i, a) < min)) continue;
    if (pitGap(ring, track.pit, i) < min) continue;
    if (
      out.some(
        (a) =>
          Math.hypot(cx[i][0] - cx[a][0], cx[i][1] - cx[a][1]) < CORNER_APEX_SEPARATION_M,
      )
    )
      continue;
    out.push(i);
  }
  return out;
}

/** Ring-ordered indices within CORNER_SECTION_M of the apex in either direction. */
function sectionWalk(track: TrackDataV2, ring: Ring, apex: number): number[] {
  const n = track.centerline.length;
  const back = (i: number): number => (((ring.s[apex] - ring.s[i]) % ring.total) + ring.total) % ring.total;
  const fwd = (i: number): number => (((ring.s[i] - ring.s[apex]) % ring.total) + ring.total) % ring.total;
  const inside = (i: number): boolean => back(i) <= CORNER_SECTION_M || fwd(i) <= CORNER_SECTION_M;
  let start = apex;
  let startBack = -1;
  for (let i = 0; i < n; i++) {
    const b = back(i);
    if (b <= CORNER_SECTION_M && b > startBack) {
      startBack = b;
      start = i;
    }
  }
  const walk: number[] = [];
  let i = start;
  for (;;) {
    walk.push(i);
    const next = (i + 1) % n;
    if (next === start || !inside(next)) break;
    i = next;
  }
  return walk;
}

/** Stand pieces on the outside of up to 4 tightest corners, one section per apex. */
export function cornerGrandstands(track: TrackDataV2, style: ResolvedTrackStyle): Grandstand[] {
  if (style.cornerGrandstands === false) return [];
  const ring = arcRing(track);
  if (ring.total <= 0) return [];
  const out: Grandstand[] = [];
  for (const apex of cornerApexes(track, ring)) {
    const corner = cornerCurvature(track.centerline, apex);
    if (corner === null) continue;
    const side: Side = corner.side === 'left' ? 'right' : 'left';
    const walk = sectionWalk(track, ring, apex);
    let barrierMax: number | null = null;
    for (const k of walk) {
      const b = maxBarrierOffsetAt(track, side, k);
      if (b !== null && (barrierMax === null || b > barrierMax)) barrierMax = b;
    }
    const offsets = walk.map((k) => {
      const base = halfWidthAt(track, side, k) + EDGE_OFFSET;
      return barrierMax === null ? base : Math.max(base, barrierMax + CORNER_BARRIER_EXTRA_M);
    });
    const pieces: Grandstand[] = [];
    for (const { pa, pb, len, yaw, nx, nz } of offsetRunPieces(track, side, walk, offsets)) {
      // Rows go outward on the corner's outside so the front faces the track.
      const faces = Math.sin(yaw) * nx + Math.cos(yaw) * nz > 0;
      pieces.push({
        x: (pa.x + pb.x) / 2,
        z: (pa.z + pb.z) / 2,
        yaw: faces ? yaw : yaw + Math.PI,
        lengthMeters: len,
        rows: CORNER_ROWS,
        roof: false,
      });
    }
    const prior = out.slice();
    for (const p of pieces) {
      if (prior.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < CORNER_PIECE_SEPARATION_M)) continue;
      out.push(p);
    }
  }
  return out;
}

/** Grounded chord boxes along the pit-side offset polyline of the pit range. */
export function pitBuildingPieces(track: TrackDataV2, style?: ResolvedTrackStyle): PitPiece[] {
  const depth = (style ?? DEFAULT_TRACK_STYLE).pitBuilding.depthMeters;
  const { pit } = track;
  if (pit.start === pit.end) return [];
  const walk = indexWalk(track, pit.start, pit.end);
  // Near face clears the pit-side barriers by 1 m where they sit beyond the verge.
  const offsets = walk.map((k) => {
    const base = halfWidthAt(track, pit.side, k) + EDGE_OFFSET;
    const barrier = maxBarrierOffsetAt(track, pit.side, k);
    return barrier === null ? base : Math.max(base, barrier + 1);
  });
  const pieces: PitPiece[] = [];
  for (const { pa, pb, len, yaw } of offsetRunPieces(track, pit.side, walk, offsets)) {
    const x = (pa.x + pb.x) / 2 + (Math.sin(yaw) * depth) / 2;
    const z = (pa.z + pb.z) / 2 + (Math.cos(yaw) * depth) / 2;
    const { baseY, plinthBottom } = groundedBase(track, x, z, yaw, {
      xMin: -len / 2, xMax: len / 2, zMin: -depth / 2, zMax: depth / 2,
    });
    pieces.push({ x, z, yaw, length: len, depth, baseY, plinthBottom });
  }
  return pieces;
}
