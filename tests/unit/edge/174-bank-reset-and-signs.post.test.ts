import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, type LonLat, type Point2 } from '../../../src/track/geo';
import type { Quat, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces, bankTanAt } from '../../../src/track/surfaces';
import { buildTrackMarkings as markings } from '../../../src/track/markings';
import { barrierRuns } from '../../../src/track/barrierPath';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { Vehicle } from '../../../src/physics/vehicle';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function loadF4(): CarSpec {
  return parseCarSpec(
    JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
  );
}

function applyQ(q: Quat, vx: number, vy: number, vz: number): [number, number, number] {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return [
    vx + q.w * tx + (q.y * tz - q.z * ty),
    vy + q.w * ty + (q.z * tx - q.x * tz),
    vz + q.w * tz + (q.x * ty - q.y * tx),
  ];
}

// yaw about Y, then local roll: up = (-sin r * cos yaw, cos r, sin r * sin yaw).
function expectedUp(yaw: number, roll: number): [number, number, number] {
  return [-Math.sin(roll) * Math.cos(yaw), Math.cos(roll), Math.sin(roll) * Math.sin(yaw)];
}

// Closed rectangle 200 x 100, 5 m spacing; bottom edge runs +X at z = 0 (right = +Z).
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

function track(bank?: number[], elevation = 2): TrackDataV2 {
  return {
    version: 2,
    id: 'bank-reset-signs',
    name: 'Bank Reset Signs',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
    sectors: [0, 40, 80],
    elevation: POINTS.map(() => elevation),
    kerbs: [],
    runoffs: [],
    barriers: [{ start: 0, end: N - 1, side: 'right', type: 'armco', offsetMeters: 8 }],
    terrain: { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows: 2, cols: 2, heights: new Array(9).fill(0) },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
}

function rightNormal(t: TrackDataV2, i: number): [number, number] {
  const cx = t.centerline;
  const n = cx.length;
  const prev = cx[(i - 1 + n) % n];
  const next = cx[(i + 1) % n];
  const dx = next[0] - prev[0];
  const dz = next[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  return [-dz / len, dx / len];
}

function yawAt(t: TrackDataV2, i: number): number {
  const n = t.centerline.length;
  const p = t.centerline[((i % n) + n) % n];
  const next = t.centerline[(((i % n) + n) % n + 1) % n];
  return Math.atan2(-(next[0] - p[0]), -(next[1] - p[1]));
}

describe('174 bank reset path, spawn heights and slope signs', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  let game: Game | null = null;
  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('input.reset restores the spawn roll from spawnFromTrack, not the teleported index bank', async () => {
    const bank = new Array<number>(N).fill(0);
    bank[N - 5] = 0.35;
    bank[5] = -0.2;
    game = await Game.create(track(bank));
    const idle = { throttle: 0, brake: 0, steer: 0, reset: false };
    game.teleportToIndex(5);
    game.step(idle);
    let up = applyQ(game.getCurrentState().rotation, 0, 1, 0);
    const mid = expectedUp(yawAt(track(), 5), -0.2);
    expect(up[0]).toBeCloseTo(mid[0], 1);
    expect(up[1]).toBeCloseTo(mid[1], 1);
    expect(up[2]).toBeCloseTo(mid[2], 1);
    game.step({ ...idle, reset: true });
    up = applyQ(game.getCurrentState().rotation, 0, 1, 0);
    const spawn = expectedUp(yawAt(track(), N - 5), 0.35);
    expect(up[0]).toBeCloseTo(spawn[0], 1);
    expect(up[1]).toBeCloseTo(spawn[1], 1);
    expect(up[2]).toBeCloseTo(spawn[2], 1);
  }, 30000);

  it('teleportToIndex keeps the spawn height at elevation + 0.6 m on a banked index', async () => {
    const bank = new Array<number>(N).fill(0);
    bank[5] = 0.3;
    game = await Game.create(track(bank, 2));
    game.teleportToIndex(5);
    game.step({ throttle: 0, brake: 0, steer: 0, reset: false });
    expect(game.getCurrentState().position.y).toBeCloseTo(2.6, 1);
  }, 30000);

  it('spawnFromTrack keeps height at elevation[n-5] + 0.6 and takes roll from that index', () => {
    const elevation = new Array<number>(N).fill(2);
    elevation[N - 5] = 7;
    const bank = new Array<number>(N).fill(0);
    bank[N - 5] = -0.25;
    const t = track(bank);
    t.elevation = elevation;
    const pose = spawnFromTrack(t);
    expect(pose.roll).toBe(-0.25);
    expect(pose.position.y).toBe(7.6);
    expect(pose.position.x).toBe(POINTS[N - 5][0]);
    expect(pose.position.z).toBe(POINTS[N - 5][1]);
    const flat = spawnFromTrack(track(undefined));
    expect(flat.roll).toBe(0);
    expect(flat.position.y).toBe(2.6);
  });

  it('a negative bank lowers the right edge of the asphalt and the right barrier base', () => {
    const t = track(new Array<number>(N).fill(-10 * DEG));
    const flat = track(new Array<number>(N).fill(0));
    const tan = Math.tan(-10 * DEG);
    const ab = buildTrackSurfaces(t).find((s) => s.surface === 'asphalt')!;
    const af = buildTrackSurfaces(flat).find((s) => s.surface === 'asphalt')!;
    for (const i of [10, 40]) {
      for (const c of [0, 1]) {
        const p = (i * 2 + c) * 3;
        const [rx, rz] = rightNormal(t, i);
        const d =
          (ab.positions[p] - t.centerline[i][0]) * rx + (ab.positions[p + 2] - t.centerline[i][1]) * rz;
        expect(Math.abs((ab.positions[p + 1] - af.positions[p + 1]) - d * tan)).toBeLessThanOrEqual(1e-4);
      }
    }
    for (const run of barrierRuns(t, 'right')) {
      for (const v of run) {
        expect(v.y - 2 - 8 * tan).toBeLessThanOrEqual(1e-4);
        expect(2 + 8 * tan - v.y).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('start-line rows use the index-0 bank even when bank[1] is different', () => {
    const bank = new Array<number>(N).fill(0);
    bank[0] = 10 * DEG;
    bank[1] = 0;
    const tan = Math.tan(10 * DEG);
    const marks = markings(track(bank, 2));
    const start = marks[2];
    expect(start.positions).toHaveLength(2 * 2 * 3);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 2; c++) {
        const p = (r * 2 + c) * 3;
        const [rx, rz] = rightNormal(track(), 0);
        const d =
          (start.positions[p] - POINTS[0][0]) * rx + (start.positions[p + 2] - POINTS[0][1]) * rz;
        expect(Math.abs(start.positions[p + 1] - (2 + 0.025) - d * tan)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('buildTerrain follows bank only where the array has entries; a short array leaves the tail flat', () => {
    const ORIGIN: LonLat = [0, 0];
    const DEG_M = (EARTH_RADIUS_M * Math.PI) / 180;
    const dem: DemGrid = {
      lon0: -615 / DEG_M,
      lat0: 615 / DEG_M,
      dLon: 30 / DEG_M,
      dLat: 30 / DEG_M,
      rows: 42,
      cols: 42,
      heights: new Array<number>(42 * 42).fill(100),
    };
    const straight: Point2[] = Array.from({ length: 41 }, (_, k) => [-100 + 5 * k, 0] as Point2);
    const elev = straight.map(() => 0);
    // Only indices 18..22 (x = -10..10) are banked.
    const sloped = straight.map((_, i) => (i >= 18 && i <= 22 ? 10 * DEG : 0));
    const t = buildTerrain(dem, straight, elev, ORIGIN, 12, 3, sloped);
    const node = (x: number, z: number): number => {
      const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
      const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
      return t.heights[j * (t.rows + 1) + i];
    };
    // Node (4, ±8) sits nearest index 21 (x = 5), inside the banked run.
    expect(node(4, 8)).toBeCloseTo(-0.15 + 8 * Math.tan(10 * DEG), 2);
    expect(node(4, -8)).toBeCloseTo(-0.15 - 8 * Math.tan(10 * DEG), 2);
    // Node (40, ±8) sits nearest index 28, outside the banked run.
    expect(node(40, 8)).toBeCloseTo(-0.15, 2);
    expect(node(40, -8)).toBeCloseTo(-0.15, 2);
    // A bank array shorter than the centerline leaves the tail indices flat.
    const short = track([10 * DEG, 10 * DEG]);
    expect(bankTanAt(short, 0)).toBeCloseTo(Math.tan(10 * DEG), 12);
    expect(bankTanAt(short, 5)).toBe(0);
  });

  it('reset with a non-zero roll still zeroes linear and angular velocity', () => {
    const world = createPhysicsWorld();
    const vehicle = new Vehicle(world, loadF4(), {
      position: { x: 0, y: 0.6, z: 0 },
      yaw: 0,
      roll: 0.2,
    });
    vehicle.body.setLinvel({ x: 12, y: -3, z: 4 }, true);
    vehicle.body.setAngvel({ x: 1, y: 2, z: -1 }, true);
    vehicle.reset({ position: { x: 0, y: 0.6, z: 0 }, yaw: 0, roll: 0.2 });
    const lin = vehicle.body.linvel();
    const ang = vehicle.body.angvel();
    expect(Math.hypot(lin.x, lin.y, lin.z)).toBeLessThan(1e-6);
    expect(Math.hypot(ang.x, ang.y, ang.z)).toBeLessThan(1e-6);
    world.free();
  });

  it('daytona.json stays version 2 with bank the length of the centerline', () => {
    const d = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'),
    ) as TrackDataV2 & { bank?: number[] };
    expect(d.version).toBe(2);
    expect(d.bank).toBeDefined();
    expect(d.bank).toHaveLength(d.centerline.length);
    expect(d.elevation).toHaveLength(d.centerline.length);
  });
});
