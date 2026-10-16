import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { initPhysics, createPhysicsWorld, RAPIER } from '../../../src/physics/physicsWorld';
import { surfaceOf } from '../../../src/physics/trackColliders';
import { Game } from '../../../src/game/game';
import type { Quat, TrackDataV2 } from '../../../src/core/types';

const DEG = Math.PI / 180;
const TAN = Math.tan(10 * DEG);

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

function track(bank?: number[]): TrackDataV2 {
  return {
    version: 2,
    id: 'bank-physics-probe',
    name: 'Bank Physics Probe',
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
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank ? { bank } : {}),
  };
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

function groundYAt(world: ReturnType<typeof createPhysicsWorld>, x: number, z: number): number {
  const hit = world.castRay(
    new RAPIER.Ray({ x, y: 5, z }, { x: 0, y: -1, z: 0 }),
    60,
    true,
    undefined,
    undefined,
    undefined,
    undefined,
    (c) => surfaceOf(c) === 'asphalt',
  );
  expect(hit, `no asphalt under (${x}, ${z})`).not.toBeNull();
  return 5 - hit!.timeOfImpact;
}

describe('174 banked colliders and teleport wrap post-coder gaps', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  let game: Game | null = null;
  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('the banked trimesh ground is d*tan(bank) higher on the right edge than on the left', () => {
    const bank = new Array<number>(N).fill(10 * DEG);
    const world = createPhysicsWorld(track(bank));
    world.step();
    const yRight = groundYAt(world, 52.5, 5);
    const yLeft = groundYAt(world, 52.5, -5);
    expect(yRight - yLeft).toBeCloseTo(10 * TAN, 2);
    expect(yRight).toBeGreaterThan(0);
    expect(yLeft).toBeLessThan(0);
    world.free();
  }, 30000);

  it('teleportToIndex wraps a negative index and takes the roll of that index', async () => {
    const bank = new Array<number>(N).fill(0);
    bank[N - 5] = 0.35;
    game = await Game.create(track(bank));
    game.teleportToIndex(-5);
    game.step({ throttle: 0, brake: 0, steer: 0, reset: false });
    const up = applyQ(game.getCurrentState().rotation, 0, 1, 0);
    // Bank +0.35 tilts the up vector 0.35 rad toward the left of the driving direction.
    expect(up[1]).toBeCloseTo(Math.cos(0.35), 1);
    expect(game.getCurrentState().position.x).toBeCloseTo(POINTS[N - 5][0], 1);
    expect(game.getCurrentState().position.z).toBeCloseTo(POINTS[N - 5][1], 1);
  }, 30000);
});
