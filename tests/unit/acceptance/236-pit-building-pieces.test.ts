import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Terrain, TrackDataV2 } from '../../../src/core/types';
import { footprintGround } from '../../../src/track/ground';
import { pitBuildingPieces } from '../../../src/track/placement';
import { createPitBuilding } from '../../../src/render/pitAndStart';
import { fixture } from './022-fixture-trackdatav2';

const ROOT = join(__dirname, '..', '..', '..');

const RAMP: Terrain = {
  originX: 0,
  originZ: 0,
  sizeX: 200,
  sizeZ: 100,
  cols: 20,
  rows: 10,
  heights: Array.from({ length: 21 * 11 }, (_, k) => 0.1 * (-100 + 10 * Math.floor(k / 11))),
};

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

const ARC: TrackDataV2 = {
  ...fixture,
  id: 'arc',
  name: 'Arc',
  centerline: Array.from({ length: 200 }, (_, i): [number, number] => [
    200 * Math.cos((2 * Math.PI * i) / 200),
    -200 * Math.sin((2 * Math.PI * i) / 200),
  ]),
  elevation: Array.from({ length: 200 }, () => 0),
  kerbs: [],
  runoffs: [],
  barriers: [],
  pit: { start: 0, end: 50, side: 'right' },
};

const LINE: TrackDataV2 = {
  ...fixture,
  id: 'line',
  name: 'Line',
  centerline: Array.from({ length: 91 }, (_, i): [number, number] => [-90 + 2 * i, 0]),
  elevation: Array.from({ length: 91 }, (_, i) => 0.1 * (-90 + 2 * i)),
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain: RAMP,
  pit: { start: 20, end: 70, side: 'right' },
};

// Offset polyline radius on ARC: centerline radius + widthMeters/2 + EDGE_OFFSET.
const ARC_OFFSET_RADIUS = 200 + 6 + 10;

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

describe('236 pit building pieces acceptance', () => {
  it('AT1: STRAIGHT pit pieces are one 200 m box centred at x 200, z 20 with depth 8', () => {
    const pieces = pitBuildingPieces(STRAIGHT);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBeCloseTo(200, 6);
    expect(pieces[0].depth).toBe(8);
    expect(pieces[0].x).toBeCloseTo(200, 6);
    expect(pieces[0].z).toBeCloseTo(20, 6);
  });

  it('AT2: ARC pieces turn at most 8 deg each and keep their near edge off the track', () => {
    const pieces = pitBuildingPieces(ARC);
    expect(pieces.length).toBeGreaterThanOrEqual(11);
    const maxTurn = (8 * Math.PI) / 180 + 1e-6;
    for (const p of pieces) {
      expect(2 * Math.asin(p.length / (2 * ARC_OFFSET_RADIUS))).toBeLessThanOrEqual(maxTurn);
      const nearX = p.x - (p.depth / 2) * Math.sin(p.yaw);
      const nearZ = p.z - (p.depth / 2) * Math.cos(p.yaw);
      expect(distToCenterline(ARC, nearX, nearZ)).toBeGreaterThanOrEqual(6 + 9.4);
    }
  });

  it('AT3: ARC piece lengths sum within 2% of the offset arc length', () => {
    const pieces = pitBuildingPieces(ARC);
    const arcLength = ARC_OFFSET_RADIUS * (50 * ((2 * Math.PI) / 200));
    let sum = 0;
    for (const p of pieces) sum += p.length;
    expect(Math.abs(sum - arcLength) / arcLength).toBeLessThanOrEqual(0.02);
  });

  it('AT4: LINE pieces ground baseY on the footprint max and plinthBottom 0.05 below the min', () => {
    const pieces = pitBuildingPieces(LINE);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const p of pieces) {
      const { min, max } = footprintGround(
        LINE, p.x, p.z, p.yaw,
        -p.length / 2, p.length / 2, -p.depth / 2, p.depth / 2,
      );
      expect(p.baseY).toBeCloseTo(max, 9);
      expect(p.plinthBottom).toBeCloseTo(min - 0.05, 9);
    }
  });

  it('AT5: createPitBuilding on STRAIGHT adds one facade per piece and no 0.3 m sink', () => {
    const group = createPitBuilding(STRAIGHT);
    const facades: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'pit') facades.push(o);
    });
    expect(facades).toHaveLength(pitBuildingPieces(STRAIGHT).length);
    const box = new THREE.Box3().setFromObject(group);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.06);
  });

  it('AT6: every public track yields at least one piece and pieces are at least 6 m when several', () => {
    const dir = join(ROOT, 'public', 'tracks');
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.json') && !f.endsWith('.style.json') && !f.endsWith('-env.json') && f !== 'index.json',
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const track = JSON.parse(readFileSync(join(dir, file), 'utf8')) as TrackDataV2;
      const pieces = pitBuildingPieces(track);
      expect(pieces.length, file).toBeGreaterThanOrEqual(1);
      if (pieces.length > 1) {
        for (const p of pieces) expect(p.length, file).toBeGreaterThanOrEqual(6);
      }
    }
  });
});
