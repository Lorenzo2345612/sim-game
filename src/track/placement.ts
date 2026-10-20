import type { Grandstand, Side, TrackDataV2 } from '../core/types';
import { footprintGround } from './ground';
import { halfWidthAt } from './surfaces';
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
  for (const g of track.grandstands.concat(extraGrandstands(track, style))) {
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
