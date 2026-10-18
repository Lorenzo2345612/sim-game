import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { sausagePieces, sausagePose } from '../../../src/track/sausages';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { buildTrackSurfaces } from '../../../src/track/surfaces';
import { bankProfile } from '../../../tools/track-builder/banking';
import type { Sausage, TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function rectPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 5) pts.push([x, 0]);
  for (let z = 5; z <= 100; z += 5) pts.push([200, z]);
  for (let x = 195; x >= 5; x -= 5) pts.push([x, 100]);
  for (let z = 95; z >= 5; z -= 5) pts.push([0, z]);
  return pts;
}

const POINTS = rectPoints();
const N = POINTS.length;

function loopTrack(bank?: number[], sausages: Sausage[] = []): TrackDataV2 {
  return {
    version: 2,
    id: 'sausage-collider-bank',
    name: 'Sausage Collider Bank',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
    sectors: [0, 40, 80],
    elevation: POINTS.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 100, originZ: 50, sizeX: 1, sizeZ: 1, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    sausages,
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
}

function straightTrack(bank: number[], elevation: number[]): TrackDataV2 {
  const centerline: [number, number][] = Array.from({ length: 60 }, (_, i) => [0, -2 * i]);
  return {
    version: 2,
    id: 'sausage-straight',
    name: 'Sausage Straight',
    widthMeters: 12,
    lengthMeters: 236,
    officialLengthMeters: 236,
    centerline,
    sectors: [0, 20, 40],
    elevation,
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: -58, sizeX: 40, sizeZ: 130, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    sausages: [],
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    bank,
  };
}

function colliderAt(
  world: RAPIER.World,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number; surface: string | null } | null {
  let found: { x: number; y: number; z: number; surface: string | null } | null = null;
  world.forEachCollider((c) => {
    const t = c.translation();
    if (Math.abs(t.x - x) < 1e-6 && Math.abs(t.y - y) < 1e-6 && Math.abs(t.z - z) < 1e-6) {
      found = { x: t.x, y: t.y, z: t.z, surface: surfaceOf(c) };
    }
  });
  return found;
}

describe('174 banked sausage colliders, index edges and ring-wrapped ranges', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it('the first sausage-piece hull sits on the banked base of its index', () => {
    const bank = new Array<number>(N).fill(10 * DEG);
    const s: Sausage = { index: 15, side: 'right', offset: 7.8, length: 6 };
    const first = sausagePieces(loopTrack(bank), s)[0];
    const world = createPhysicsWorld(loopTrack(bank, [s]));
    world.step();
    const hit = colliderAt(world, first.position.x, first.position.y, first.position.z);
    expect(hit, 'no collider at the banked sausage base').not.toBeNull();
    expect(hit!.surface).toBe('kerb');
    expect(hit!.y).toBeCloseTo(7.8 * Math.tan(10 * DEG), 6);
    world.free();
  }, 30000);

  it('without bank the sausage-piece hull base stays at the plain elevation', () => {
    const s: Sausage = { index: 15, side: 'right', offset: 7.8, length: 6 };
    const first = sausagePieces(loopTrack(), s)[0];
    const world = createPhysicsWorld(loopTrack(undefined, [s]));
    world.step();
    const hit = colliderAt(world, first.position.x, 0, first.position.z);
    expect(hit, 'no collider at the flat sausage base').not.toBeNull();
    expect(hit!.y).toBeCloseTo(0, 12);
    world.free();
  }, 30000);

  it('a negative offset flips the sign of the bank lift', () => {
    const track = straightTrack(
      Array.from({ length: 60 }, () => 10 * DEG),
      Array.from({ length: 60 }, () => 3),
    );
    const tan = Math.tan(10 * DEG);
    const right = sausagePose(track, { index: 15, side: 'right', offset: -4, length: 6 });
    const left = sausagePose(track, { index: 15, side: 'left', offset: -4, length: 6 });
    expect(right.position.y).toBeCloseTo(3 - 4 * tan, 9);
    expect(left.position.y).toBeCloseTo(3 + 4 * tan, 9);
    expect(right.position.x).toBeCloseTo(-4, 6);
    expect(left.position.x).toBeCloseTo(4, 6);
  });

  it('a negative sausage index wraps and takes the bank of the wrapped index', () => {
    const bank = new Array<number>(60).fill(0);
    bank[59] = 0.2;
    const track = straightTrack(bank, Array.from({ length: 60 }, () => 1));
    const pose = sausagePose(track, { index: -1, side: 'right', offset: 4, length: 6 });
    expect(pose.position.y).toBeCloseTo(1 + 4 * Math.tan(0.2), 9);
  });

  it('a degenerate centerline tangent still lifts the base by the bank of its index', () => {
    const centerline: [number, number][] = Array.from({ length: 10 }, () => [0, 0] as [number, number]);
    const bank = new Array<number>(10).fill(0);
    bank[3] = 15 * DEG;
    const track: TrackDataV2 = {
      version: 2,
      id: 'sausage-degenerate',
      name: 'Sausage Degenerate',
      widthMeters: 12,
      lengthMeters: 2,
      officialLengthMeters: 2,
      centerline,
      sectors: [0, 1, 2],
      elevation: Array.from({ length: 10 }, () => 2),
      kerbs: [],
      runoffs: [],
      barriers: [],
      terrain: { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
      treeSpecies: [],
      trees: [],
      grandstands: [],
      pit: { start: 0, end: 0, side: 'left' },
      sausages: [],
      source: { dataset: 'test', license: 'test', url: '', dem: '' },
      bank,
    };
    const pose = sausagePose(track, { index: 3, side: 'right', offset: 4, length: 6 });
    expect(pose.position.y).toBeCloseTo(2 + 4 * Math.tan(15 * DEG), 9);
    expect(pose.position.x).toBeCloseTo(4, 9);
    expect(pose.position.z).toBeCloseTo(0, 9);
  });

  it('bankProfile wraps range bounds outside [0, lengthMeters) onto the ring', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const shifted = bankProfile(cum, 1000, [
      { fromMeters: 1200, toMeters: 1300, degrees: 31, raisedSide: 'right' },
    ], 60);
    const base = bankProfile(cum, 1000, [
      { fromMeters: 200, toMeters: 300, degrees: 31, raisedSide: 'right' },
    ], 60);
    expect(shifted).toEqual(base);
    const negFrom = bankProfile(cum, 1000, [
      { fromMeters: -100, toMeters: 50, degrees: 18, raisedSide: 'left' },
    ], 60);
    const wrapFrom = bankProfile(cum, 1000, [
      { fromMeters: 900, toMeters: 50, degrees: 18, raisedSide: 'left' },
    ], 60);
    expect(negFrom).toEqual(wrapFrom);
  });

  it('the rebuilt baku, lasvegas and singapore JSONs keep a well-formed zero bank and finite geometry', () => {
    for (const id of ['baku', 'lasvegas', 'singapore']) {
      const raw = JSON.parse(readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'));
      const parsed = parseTrackData(raw) as TrackDataV2 & { bank?: number[] };
      expect(parsed.bank, id).toHaveLength(parsed.centerline.length);
      for (const b of parsed.bank ?? []) {
        expect(Number.isFinite(b), id).toBe(true);
        expect(Math.abs(b), id).toBeLessThanOrEqual(1e-12);
      }
      for (const e of parsed.elevation) expect(Number.isFinite(e), id).toBe(true);
      for (const strip of buildTrackSurfaces(parsed)) {
        for (const y of strip.positions) expect(Number.isFinite(y), `${id} ${strip.surface}`).toBe(true);
      }
    }
  }, 120000);
});
