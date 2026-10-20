import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Grandstand, TrackDataV2 } from '../../../src/core/types';
import {
  clearGrandstand,
  extraGrandstands,
  pitBuildingPieces,
  placedGrandstands,
  standClearance,
} from '../../../src/track/placement';
import { DEFAULT_TRACK_STYLE, parseTrackStyle, type ResolvedTrackStyle } from '../../../src/track/trackStyle';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');
const TRACKS_DIR = join(ROOT, 'public', 'tracks');

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

function circleTrack(): TrackDataV2 {
  const centerline = Array.from({ length: 360 }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / 360;
    return [200 * Math.cos(a), 200 * Math.sin(a)];
  });
  return {
    ...fixture,
    widthMeters: 12,
    centerline,
    sectors: [0, 120, 240],
    elevation: centerline.map(() => 0),
  };
}

const CIRCLE_STYLE: ResolvedTrackStyle = {
  ...DEFAULT_TRACK_STYLE,
  extraGrandstands: [
    { start: 0, end: 30, side: 'left', offsetMeters: 10, rows: 8, roof: false },
    { start: 0, end: 30, side: 'right', offsetMeters: 10, rows: 8, roof: false },
  ],
};

function frontCorners(g: Grandstand): Array<[number, number]> {
  const half = g.lengthMeters / 2;
  return [
    [g.x + half * Math.cos(g.yaw), g.z - half * Math.sin(g.yaw)],
    [g.x - half * Math.cos(g.yaw), g.z + half * Math.sin(g.yaw)],
  ];
}

function frontGap(a: Grandstand, b: Grandstand): number {
  let min = Infinity;
  for (const [ax, az] of frontCorners(a)) {
    for (const [bx, bz] of frontCorners(b)) min = Math.min(min, Math.hypot(ax - bx, az - bz));
  }
  return min;
}

describe('316 grandstands clear of the track', () => {
  it('AT1: every placed stand on a shipped track keeps 5 m clearance', () => {
    expect(SHIPPED.length).toBeGreaterThan(0);
    let dropped = 0;
    for (const { id, track, style } of SHIPPED) {
      const inputs = track.grandstands.length + extraGrandstands(track, style).length;
      const stands = placedGrandstands(track, style);
      expect(stands.length, id).toBeGreaterThanOrEqual(inputs - 1);
      dropped += inputs - stands.length;
      for (const g of stands) expect(standClearance(track, g), id).toBeGreaterThanOrEqual(5 - 1e-6);
    }
    expect(dropped).toBeLessThanOrEqual(1);
  }, 30_000);

  it('AT2: clearGrandstand returns an already-clear builder stand unchanged', () => {
    for (const { id, track } of SHIPPED) {
      for (const g of track.grandstands) {
        if (standClearance(track, g) >= 5) expect(clearGrandstand(track, g), id).toBe(g);
      }
    }
  }, 30_000);

  it('AT3: mexico 560-640 left becomes contiguous pieces with 5 m clearance', () => {
    const mexico = SHIPPED.find((s) => s.id === 'mexico.json');
    expect(mexico).toBeDefined();
    if (!mexico) return;
    const entries = mexico.style.extraGrandstands.filter(
      (e) => e.start === 560 && e.end === 640 && e.side === 'left',
    );
    const pieces = extraGrandstands(mexico.track, { ...mexico.style, extraGrandstands: entries });
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const g of pieces) expect(standClearance(mexico.track, g)).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < pieces.length; i++) {
      expect(frontGap(pieces[i - 1], pieces[i])).toBeLessThanOrEqual(1.0);
    }
  });

  it('AT4: circle entries split into pieces whose front midpoints sit at r 216/184', () => {
    const stands = extraGrandstands(circleTrack(), CIRCLE_STYLE);
    const outer = stands.filter((g: Grandstand) => Math.hypot(g.x, g.z) > 200);
    const inner = stands.filter((g: Grandstand) => Math.hypot(g.x, g.z) < 200);
    expect(outer.length).toBeGreaterThanOrEqual(4);
    expect(inner.length).toBeGreaterThanOrEqual(4);
    for (const g of outer) expect(Math.abs(Math.hypot(g.x, g.z) - 216)).toBeLessThanOrEqual(0.6);
    for (const g of inner) expect(Math.abs(Math.hypot(g.x, g.z) - 184)).toBeLessThanOrEqual(0.6);
  });

  const SNAPSHOT: Record<string, { count: number; x: number; z: number; yaw: number; length: number }> = {
    'mexico.json': {
      count: 2,
      x: -604.1470891209433,
      z: -500.13043805272514,
      yaw: -0.039252659890343496,
      length: 15.802379967604935,
    },
    'monza.json': {
      count: 1,
      x: -575.2006062436583,
      z: 349.4995446331099,
      yaw: 1.4667808696019133,
      length: 386.2390131150702,
    },
  };

  it('AT5: pitBuildingPieces on every shipped track matches the master snapshot', () => {
    for (const { id, track } of SHIPPED) {
      const pieces = pitBuildingPieces(track);
      const snap = SNAPSHOT[id];
      if (!snap) continue;
      expect(pieces.length, id).toBe(snap.count);
      const first = pieces[0];
      expect(Math.abs(first.x - snap.x), id).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(first.z - snap.z), id).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(first.yaw - snap.yaw), id).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(first.length - snap.length), id).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT6: a stand covering the circle centre can never reach 5 m clearance', () => {
    const g: Grandstand = { x: 0, z: 0, yaw: 0, lengthMeters: 400, rows: 10, roof: false };
    expect(clearGrandstand(circleTrack(), g)).toBeNull();
  });
});
