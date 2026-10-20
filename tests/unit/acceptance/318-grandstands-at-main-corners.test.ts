import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Grandstand, Side, TrackDataV2 } from '../../../src/core/types';
import {
  clearGrandstand,
  cornerGrandstands,
  extraGrandstands,
  placedGrandstands,
  standClearance,
} from '../../../src/track/placement';
import { cornerCurvature } from '../../../src/track/surfaces';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';

const ROOT = join(__dirname, '..', '..', '..');
const TRACKS_DIR = join(ROOT, 'public', 'tracks');
const MIN_FRACTION = 0.12;
const CORNER_RADIUS_M = 120;
const APEX_SEPARATION_M = 150;

interface ShippedTrack { id: string; track: TrackDataV2; style: ResolvedTrackStyle }

function loadShipped(): ShippedTrack[] {
  const files = readdirSync(TRACKS_DIR).filter(
    (f) => f.endsWith('.json') && !f.endsWith('.style.json') && !f.endsWith('-env.json') && f !== 'index.json',
  );
  return files.map((file) => {
    const track = JSON.parse(readFileSync(join(TRACKS_DIR, file), 'utf8')) as TrackDataV2;
    const stylePath = join(TRACKS_DIR, file.replace(/\.json$/, '.style.json'));
    const style = existsSync(stylePath)
      ? parseTrackStyle(JSON.parse(readFileSync(stylePath, 'utf8')), track.centerline.length).style
      : DEFAULT_TRACK_STYLE;
    return { id: file, track, style };
  });
}

const SHIPPED = loadShipped();

interface Ring { s: number[]; total: number }

function ringOf(track: TrackDataV2): Ring {
  const cl = track.centerline;
  const s: number[] = [0];
  for (let i = 1; i < cl.length; i++) {
    s.push(s[i - 1] + Math.hypot(cl[i][0] - cl[i - 1][0], cl[i][1] - cl[i - 1][1]));
  }
  const last = cl[cl.length - 1];
  const total = s[cl.length - 1] + Math.hypot(cl[0][0] - last[0], cl[0][1] - last[1]);
  return { s, total };
}

function gap(ring: Ring, i: number, j: number): number {
  const d = Math.abs(ring.s[i] - ring.s[j]);
  return Math.min(d, ring.total - d);
}

function nearestIndex(track: TrackDataV2, x: number, z: number): number {
  const cl = track.centerline;
  let best = 0;
  let bestD = Infinity;
  for (let k = 0; k < cl.length; k++) {
    const d = Math.hypot(x - cl[k][0], z - cl[k][1]);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Side of the track (its centreline) that the point sits on: same convention as cornerCurvature. */
function sideOf(track: TrackDataV2, x: number, z: number): Side {
  const n = track.centerline.length;
  const i = nearestIndex(track, x, z);
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
  const dx = x - track.centerline[i][0];
  const dz = z - track.centerline[i][1];
  return (dx * (tz / len) - dz * (tx / len)) > 0 ? 'left' : 'right';
}

interface Apex { i: number; radius: number }

/** One apex per circular run of indices with cornerCurvature radius < 120 m: the minimum radius of the run. */
function qualifyingApexes(track: TrackDataV2): Apex[] {
  const cx = track.centerline;
  const n = cx.length;
  const flags: boolean[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = cornerCurvature(cx, i);
    radii.push(c === null ? Infinity : c.radius);
    flags.push(c !== null && c.radius < CORNER_RADIUS_M);
  }
  const pick = (run: number[]): number =>
    run.reduce((best, i) => (radii[i] < radii[best] ? i : best), run[0]);
  const push = (run: number[], out: Apex[]): void => {
    if (run.length > 0) {
      const i = pick(run);
      out.push({ i, radius: radii[i] });
    }
  };
  const out: Apex[] = [];
  if (flags.every((f) => f)) {
    push(Array.from({ length: n }, (_, i) => i), out);
    return out;
  }
  const start = flags.findIndex((f) => !f);
  let run: number[] = [];
  for (let step = 1; step <= n; step++) {
    const i = (start + step) % n;
    if (flags[i]) run.push(i);
    else {
      push(run, out);
      run = [];
    }
  }
  return out;
}

function pitGap(ring: Ring, pit: { start: number; end: number }, i: number): number {
  const span = ((ring.s[pit.end] - ring.s[pit.start]) % ring.total + ring.total) % ring.total;
  const fwd = ((ring.s[i] - ring.s[pit.start]) % ring.total + ring.total) % ring.total;
  if (fwd <= span) return 0;
  return Math.min(gap(ring, i, pit.start), gap(ring, i, pit.end));
}

/** Spec steps 2-3: rank apexes by radius, greedily keep those ≥ 12 % of the lap from 0, each other and the pit range. */
function acceptedApexes(track: TrackDataV2): number[] {
  const ring = ringOf(track);
  const ranked = [...qualifyingApexes(track)].sort((a, b) => a.radius - b.radius || a.i - b.i);
  const out: number[] = [];
  for (const { i } of ranked) {
    if (out.length === 4) break;
    if (gap(ring, i, 0) < MIN_FRACTION * ring.total) continue;
    if (out.some((a) => gap(ring, i, a) < MIN_FRACTION * ring.total)) continue;
    if (pitGap(ring, track.pit, i) < MIN_FRACTION * ring.total) continue;
    const p = track.centerline[i];
    if (out.some((a) => Math.hypot(p[0] - track.centerline[a][0], p[1] - track.centerline[a][1]) < APEX_SEPARATION_M)) continue;
    out.push(i);
  }
  return out;
}

/** Nearest accepted apex to a piece's nearest centreline index; -1 when no apex was accepted. */
function apexOf(track: TrackDataV2, ring: Ring, accepted: number[], g: Grandstand): number {
  const gi = nearestIndex(track, g.x, g.z);
  let best = -1;
  let bestGap = Infinity;
  for (const a of accepted) {
    const d = gap(ring, gi, a);
    if (d < bestGap) {
      bestGap = d;
      best = a;
    }
  }
  return best;
}

/** Accepted apex nearest to a piece's centre in XZ; -1 when none. */
function apexByXZ(track: TrackDataV2, accepted: number[], g: Grandstand): number {
  let best = -1;
  let bestD = Infinity;
  for (const a of accepted) {
    const d = Math.hypot(g.x - track.centerline[a][0], g.z - track.centerline[a][1]);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/** Unit normal pointing to `side` at centreline index i (same convention as sideOf). */
function sideNormal(track: TrackDataV2, i: number, side: Side): [number, number] {
  const n = track.centerline.length;
  const prev = track.centerline[(i - 1 + n) % n];
  const next = track.centerline[(i + 1) % n];
  const tx = next[0] - prev[0];
  const tz = next[1] - prev[1];
  const len = Math.hypot(tx, tz) || 1;
  const sign = side === 'left' ? 1 : -1;
  return [(sign * tz) / len, (-sign * tx) / len];
}

describe('318 grandstands at the main corners', () => {
  it('AT1: every shipped track with its style places ≥ 2 stands ≥ 12 % of the lap from index 0', () => {
    expect(SHIPPED.length).toBeGreaterThan(0);
    for (const { id, track, style } of SHIPPED) {
      const ring = ringOf(track);
      const far = placedGrandstands(track, style).filter((g) => {
        const i = nearestIndex(track, g.x, g.z);
        return Math.min(ring.s[i], ring.total - ring.s[i]) >= MIN_FRACTION * ring.total;
      });
      expect(far.length, id).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);

  it('AT2: cornerGrandstands gives at most 4 corners of pieces, each on the outside of its corner', () => {
    for (const { id, track, style } of SHIPPED) {
      const pieces = cornerGrandstands(track, style);
      const accepted = acceptedApexes(track);
      if (accepted.length === 0) {
        expect(pieces.length, id).toBe(0);
        continue;
      }
      const used = new Set<number>();
      for (const g of pieces) {
        const apex = apexByXZ(track, accepted, g);
        used.add(apex);
        const corner = cornerCurvature(track.centerline, apex);
        expect(corner, id).not.toBeNull();
        if (corner === null) continue;
        const outside: Side = corner.side === 'left' ? 'right' : 'left';
        const [nx, nz] = sideNormal(track, apex, outside);
        const p = track.centerline[apex];
        expect((g.x - p[0]) * nx + (g.z - p[1]) * nz, id).toBeGreaterThan(0);
        expect(Math.hypot(g.x - p[0], g.z - p[1]), id).toBeLessThanOrEqual(APEX_SEPARATION_M);
      }
      expect(used.size, id).toBeLessThanOrEqual(4);
    }
  }, 60_000);

  it('AT3: all placed stands clear 5 m and corner pieces from different corners stay 20 m apart', () => {
    for (const { id, track, style } of SHIPPED) {
      for (const g of placedGrandstands(track, style)) {
        expect(standClearance(track, g), id).toBeGreaterThanOrEqual(5 - 1e-6);
      }
      const ring = ringOf(track);
      const accepted = acceptedApexes(track);
      const cornerPieces = cornerGrandstands(track, style)
        .map((g: Grandstand) => clearGrandstand(track, g))
        .filter((g: Grandstand | null): g is Grandstand => g !== null);
      for (let a = 0; a < cornerPieces.length; a++) {
        for (let b = a + 1; b < cornerPieces.length; b++) {
          const apexA = apexOf(track, ring, accepted, cornerPieces[a]);
          const apexB = apexOf(track, ring, accepted, cornerPieces[b]);
          if (apexA === apexB) continue;
          const d = Math.hypot(
            cornerPieces[a].x - cornerPieces[b].x,
            cornerPieces[a].z - cornerPieces[b].z,
          );
          expect(d, id).toBeGreaterThanOrEqual(20 - 1e-6);
        }
      }
    }
  }, 60_000);

  it('AT4: mexico with cornerGrandstands false places the 316 builder + extras count', () => {
    const mexico = SHIPPED.find((s) => s.id === 'mexico.json');
    expect(mexico).toBeDefined();
    if (!mexico) return;
    const inputs = mexico.track.grandstands.concat(extraGrandstands(mexico.track, mexico.style));
    const count316 = inputs.filter((g) => clearGrandstand(mexico.track, g) !== null).length;
    const style = { ...mexico.style, cornerGrandstands: false } as ResolvedTrackStyle;
    expect(placedGrandstands(mexico.track, style).length).toBe(count316);
  }, 30_000);

  it('AT5: cornerGrandstands called twice on a shipped track is deep-equal', () => {
    for (const { id, track, style } of SHIPPED) {
      expect(cornerGrandstands(track, style), id).toEqual(cornerGrandstands(track, style));
    }
  }, 60_000);
});
