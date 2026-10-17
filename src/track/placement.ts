import type { Grandstand, TrackDataV2 } from '../core/types';
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

/** Grounded chord boxes along the pit-side offset polyline of the pit range. */
export function pitBuildingPieces(track: TrackDataV2, style?: ResolvedTrackStyle): PitPiece[] {
  const depth = (style ?? DEFAULT_TRACK_STYLE).pitBuilding.depthMeters;
  const { centerline, pit } = track;
  const n = centerline.length;
  if (pit.start === pit.end) return [];
  const walk: number[] = [];
  let i = pit.start;
  for (;;) {
    walk.push(i);
    if (i === pit.end) break;
    i = (i + 1) % n;
  }
  const verts = walk.map((k) => {
    const [tx, tz] = tangentAt(track, k);
    const [nx, nz] = pit.side === 'left' ? [tz, -tx] : [-tz, tx];
    const off = halfWidthAt(track, pit.side, k) + EDGE_OFFSET;
    const [cx, cz] = centerline[k];
    return { x: cx + nx * off, z: cz + nz * off, heading: Math.atan2(-tz, tx) };
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
    else merged.push(run);
  }
  // A short head piece has no previous piece: fold it into the next one.
  while (merged.length > 1 && chord(merged[0][0], merged[0][1]) < MIN_PIECE_LENGTH) {
    merged[1][0] = merged[0][0];
    merged.shift();
  }
  const pieces: PitPiece[] = [];
  for (const [a, b] of merged) {
    const len = chord(a, b);
    const dx = len === 0 ? 1 : (verts[b].x - verts[a].x) / len;
    const dz = len === 0 ? 0 : (verts[b].z - verts[a].z) / len;
    let yaw = Math.atan2(-dz, dx);
    if (pit.side === 'left') yaw += Math.PI;
    const x = (verts[a].x + verts[b].x) / 2 + (Math.sin(yaw) * depth) / 2;
    const z = (verts[a].z + verts[b].z) / 2 + (Math.cos(yaw) * depth) / 2;
    const { baseY, plinthBottom } = groundedBase(track, x, z, yaw, {
      xMin: -len / 2, xMax: len / 2, zMin: -depth / 2, zMax: depth / 2,
    });
    pieces.push({ x, z, yaw, length: len, depth, baseY, plinthBottom });
  }
  return pieces;
}
