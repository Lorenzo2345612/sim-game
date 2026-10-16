import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import { buildTerrain } from '../../../tools/track-builder/terrain';
import type { DemGrid } from '../../../tools/dem/fetchDem';
import { EARTH_RADIUS_M, polylineLength, type LonLat, type Point2 } from '../../../src/track/geo';
import type { Quat, TrackDataV2 } from '../../../src/core/types';
import { buildTrackSurfaces, bankTanAt } from '../../../src/track/surfaces';
import { createDistanceBoards } from '../../../src/render/distanceBoards';
import { createStartGantry } from '../../../src/render/pitAndStart';
import { Game } from '../../../src/game/game';
import { Vehicle } from '../../../src/physics/vehicle';
import { initPhysics, createPhysicsWorld } from '../../../src/physics/physicsWorld';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const TAN = Math.tan(10 * DEG);

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

function loadF4(): CarSpec {
  return parseCarSpec(
    JSON.parse(readFileSync(join(ROOT, 'public', 'cars', 'f4.json'), 'utf8')) as unknown,
  );
}

// Closed rectangle 200 x 100, 5 m spacing; rotated so index 0 sits on the west
// straight with tangent -Z (yaw pi/2), right normal +X.
function rectPoints(): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 200; x += 5) pts.push([x, 0]);
  for (let z = 5; z <= 100; z += 5) pts.push([200, z]);
  for (let x = 195; x >= 5; x -= 5) pts.push([x, 100]);
  for (let z = 95; z >= 5; z -= 5) pts.push([0, z]);
  const start = pts.findIndex(([x, z]) => x === 0 && z === 20);
  return [...pts.slice(start), ...pts.slice(0, start)];
}

const POINTS = rectPoints();

function flatTerrain(): TrackDataV2['terrain'] {
  const rows = 2;
  const cols = 2;
  return { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows, cols, heights: new Array((rows + 1) * (cols + 1)).fill(0) };
}

function track(bank?: number[], boards?: TrackDataV2['boards']): TrackDataV2 {
  return {
    version: 2,
    id: 'bank-game-limits',
    name: 'Bank Game Limits',
    widthMeters: 12,
    lengthMeters: 600,
    officialLengthMeters: 600,
    centerline: POINTS.map((p) => [p[0], p[1]] as [number, number]),
    sectors: [0, 40, 80],
    elevation: POINTS.map(() => 0),
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: flatTerrain(),
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    boards: boards ?? [],
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

function instPositions(group: THREE.Group): THREE.Vector3[] {
  group.updateWorldMatrix(true, true);
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  group.traverse((o) => {
    if (!(o instanceof THREE.InstancedMesh)) return;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      m.premultiply(o.matrixWorld);
      m.decompose(p, q, s);
      out.push(p.clone());
    }
  });
  return out;
}

describe('174 bank game spawn, registry wiring and numeric limits', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  let game: Game | null = null;
  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('teleportToIndex puts the car up vector on the banked surface normal and wraps the index', async () => {
    const bank = POINTS.map(() => 0);
    bank[5] = 0.4;
    bank[0] = -0.25;
    game = await Game.create(track(bank));
    const idle: Parameters<Game['step']>[0] = { throttle: 0, brake: 0, steer: 0, reset: false };
    for (const i of [5, 0, POINTS.length + 5]) {
      game.teleportToIndex(i);
      const idx = ((Math.floor(i) % POINTS.length) + POINTS.length) % POINTS.length;
      const b = bank[idx];
      game.step(idle);
      const up = applyQ(game.getCurrentState().rotation, 0, 1, 0);
      const [rx, rz] = rightNormal(track(), idx);
      // Normal tilts toward the lower (left) side: up = cos(b)*Y - sin(b)*right.
      expect(up[0]).toBeCloseTo(-Math.sin(b) * rx, 1);
      expect(up[1]).toBeCloseTo(Math.cos(b), 1);
      expect(up[2]).toBeCloseTo(-Math.sin(b) * rz, 1);
    }
  }, 30000);

  it('teleportToIndex with an absent or zero bank keeps the body level', async () => {
    game = await Game.create(track(undefined));
    game.teleportToIndex(7);
    game.step({ throttle: 0, brake: 0, steer: 0, reset: false });
    const up = applyQ(game.getCurrentState().rotation, 0, 1, 0);
    expect(up[1]).toBeCloseTo(1, 1);
    expect(Math.hypot(up[0], up[2])).toBeLessThan(0.1);
  }, 30000);

  it('spawn roll composes yaw then local roll, not a world-frame tilt', () => {
    const world = createPhysicsWorld();
    const vehicle = new Vehicle(world, loadF4(), { position: { x: 0, y: 0.6, z: 0 }, yaw: 0, roll: 0 });
    for (const [yaw, roll] of [[1.2, 0.4], [-0.7, -0.3], [2.5, 0.1]] as const) {
      vehicle.reset({ position: { x: 0, y: 0.6, z: 0 }, yaw, roll });
      const up = applyQ(vehicle.getState().rotation, 0, 1, 0);
      // Local up after roll is (-sin r, cos r, 0); yaw rotates it about Y.
      const lx = -Math.sin(roll);
      const ly = Math.cos(roll);
      expect(up[0]).toBeCloseTo(lx * Math.cos(yaw), 2);
      expect(up[1]).toBeCloseTo(ly, 2);
      expect(up[2]).toBeCloseTo(-lx * Math.sin(yaw), 2);
    }
    world.free();
  });

  it('bankProfile with a range shorter than the ramp peaks below full and negative ramp is a hard step', () => {
    const cum = Array.from({ length: 600 }, (_, i) => i);
    const ranges: BankRange[] = [{ fromMeters: 100, toMeters: 130, degrees: 31, raisedSide: 'right' }];
    const full = 31 * DEG;
    const tent = bankProfile(cum, 600, ranges, 60);
    expect(tent[115]).toBeCloseTo(0.75 * full, 6);
    expect(tent[100]).toBeCloseTo(full / 2, 6);
    expect(tent[130]).toBeCloseTo(full / 2, 6);
    expect(tent[40]).toBeCloseTo(0, 12);
    expect(tent[190]).toBeCloseTo(0, 12);
    expect(bankProfile(cum, 600, ranges, -60)).toEqual(bankProfile(cum, 600, ranges, 0));
  });

  it('a bank array shorter than the centerline leaves the tail indices flat', () => {
    const base = track(undefined);
    const bank = new Array<number>(base.centerline.length).fill(0);
    bank[0] = 10 * DEG;
    bank[1] = 10 * DEG;
    const short: TrackDataV2 & { bank: number[] } = { ...base, bank: bank.slice(0, 2) };
    const stripsB = buildTrackSurfaces(short);
    const stripsF = buildTrackSurfaces(track(new Array(base.centerline.length).fill(0)));
    const ab = stripsB.find((s) => s.surface === 'asphalt')!;
    const af = stripsF.find((s) => s.surface === 'asphalt')!;
    expect(bankTanAt(short, 5)).toBe(0);
    for (const i of [0, 1, 5]) {
      for (const c of [0, 1]) {
        const p = (i * 2 + c) * 3;
        const [rx, rz] = rightNormal(base, i);
        const d = (ab.positions[p] - base.centerline[i][0]) * rx + (ab.positions[p + 2] - base.centerline[i][1]) * rz;
        const lift = ab.positions[p + 1] - af.positions[p + 1];
        const expected = i < 2 ? d * TAN : 0;
        expect(Math.abs(lift - expected)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('asymmetric half widths lift each edge by its own signed lateral offset', () => {
    const n = POINTS.length;
    const base = track(new Array(n).fill(10 * DEG));
    base.halfWidthLeft = new Array(n).fill(3);
    base.halfWidthRight = new Array(n).fill(9);
    const flat = track(new Array(n).fill(0));
    flat.halfWidthLeft = new Array(n).fill(3);
    flat.halfWidthRight = new Array(n).fill(9);
    const ab = buildTrackSurfaces(base).find((s) => s.surface === 'asphalt')!;
    const af = buildTrackSurfaces(flat).find((s) => s.surface === 'asphalt')!;
    for (const i of [5, 30, 60]) {
      for (const c of [0, 1]) {
        const p = (i * 2 + c) * 3;
        const d = c === 0 ? -3 : 9;
        expect(Math.abs((ab.positions[p + 1] - af.positions[p + 1]) - d * TAN)).toBeLessThanOrEqual(1e-4);
      }
    }
  });

  it('daytona bank is exactly bankProfile of the registry ranges over the built centerline', () => {
    const daytona = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'daytona.json'), 'utf8'),
    ) as TrackDataV2 & { bank: number[] };
    expect(daytona.lengthMeters).toBeCloseTo(5763.3, 1);
    const registry = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
    ) as Array<{ id: string; banking?: BankRange[] }>;
    const cfg = registry.find((t) => t.id === 'daytona');
    expect(cfg?.banking).toHaveLength(4);
    const cx = daytona.centerline;
    const cum = [0];
    for (let i = 1; i < cx.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]));
    }
    const lapLength = polylineLength(cx, true);
    const expected = bankProfile(cum, lapLength, cfg!.banking!);
    expect(daytona.bank).toHaveLength(cx.length);
    for (let i = 0; i < expected.length; i++) {
      expect(Math.abs(daytona.bank[i] - expected[i]), `index ${i}`).toBeLessThanOrEqual(1e-12);
    }
  });

  it('buildTerrain blends the banked corridor back to the natural DEM height over 30 m', () => {
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
    const sloped = straight.map(() => 10 * DEG);
    const t = buildTerrain(dem, straight, elev, ORIGIN, 12, 3, sloped);
    const node = (x: number, z: number): number => {
      const j = Math.round((x - (t.originX - t.sizeX / 2)) / (t.sizeX / t.cols));
      const i = Math.round((z - (t.originZ - t.sizeZ / 2)) / (t.sizeZ / t.rows));
      return t.heights[j * (t.rows + 1) + i];
    };
    // corridor = 6 + 3 + 5 = 14 m; BLEND = 30 m. DEM is level, so natural h = 0.
    const flat24 = -0.15 + 24 * TAN;
    expect(node(4, 24)).toBeCloseTo(flat24 * (1 - 10 / 30), 1);
    expect(node(4, 40)).toBeCloseTo((-0.15 + 40 * TAN) * (1 - 26 / 30), 1);
    expect(node(4, 48)).toBeCloseTo(0, 2);
    expect(node(4, -24)).toBeCloseTo((-0.15 - 24 * TAN) * (1 - 10 / 30), 1);
  });

  it('start gantry pillars sit on the banked ground in world space and stay vertical', () => {
    const t = track(new Array(POINTS.length).fill(10 * DEG));
    const group = createStartGantry(t);
    group.updateWorldMatrix(true, true);
    const [rx, rz] = rightNormal(t, 0);
    const pillars: THREE.Mesh[] = [];
    group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name === 'gantry' && Math.abs(o.position.z) > 0) pillars.push(o);
    });
    expect(pillars).toHaveLength(2);
    const signs = pillars.map((m) => {
      m.updateWorldMatrix(true, false);
      const w = new THREE.Vector3().setFromMatrixPosition(m.matrixWorld);
      const d = (w.x - t.centerline[0][0]) * rx + (w.z - t.centerline[0][1]) * rz;
      expect(Math.abs(w.y - d * TAN)).toBeLessThanOrEqual(1e-4);
      expect(m.rotation.x).toBe(0);
      expect(m.rotation.z).toBe(0);
      return Math.sign(d);
    });
    expect(signs.sort()).toEqual([-1, 1]);
  });

  it('distance board bases lift by their own signed side offset', () => {
    const boards: TrackDataV2['boards'] = [
      { index: 10, side: 'right', offset: 9, label: 100 },
      { index: 10, side: 'left', offset: 9, label: 150 },
    ];
    const atlas = (): THREE.Texture => new THREE.Texture();
    const a = instPositions(createDistanceBoards(track(new Array(POINTS.length).fill(10 * DEG), boards), atlas).group);
    const b = instPositions(createDistanceBoards(track(new Array(POINTS.length).fill(0), boards), atlas).group);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBe(b.length);
    const lifts = a.map((p, i) => p.y - b[i].y).sort((x, y) => x - y);
    expect(lifts[0]).toBeCloseTo(-9 * TAN, 4);
    expect(lifts[lifts.length - 1]).toBeCloseTo(9 * TAN, 4);
    expect(lifts.filter((v) => Math.abs(v + 9 * TAN) < 1e-4).length).toBe(lifts.length / 2);
    expect(lifts.filter((v) => Math.abs(v - 9 * TAN) < 1e-4).length).toBe(lifts.length / 2);
  });
});
