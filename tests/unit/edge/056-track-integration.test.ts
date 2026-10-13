import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { Hud, type HudData } from '../../../src/ui/hud';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Surface, Terrain, TrackDataV2 } from '../../../src/core/types';

// Task 056 target signatures; the intersections keep this file typechecking before they exist.
type GameWithSurfaces = Game & { getWheelSurfaces(): Surface[] };
type HudDataWithValid = HudData & { valid: boolean };

// Closed rectangular loop, 2 m spacing, 180 points, heading -Z on the first straight.
const N = 180;
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 75; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -150]);
for (let i = 1; i <= 75; i++) CENTERLINE.push([30, -150 + 2 * i]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([30 - 2 * i, 0]);

// 6 m plateau around the start/spawn (indices >= 150 and <= 20), 0 m on the far
// straight, cosine ramps between; closes the loop continuously at 6 m.
function elevationAt(i: number): number {
  if (i >= 150 || i <= 20) return 6;
  if (i <= 50) return 3 + 3 * Math.cos((Math.PI * (i - 20)) / 30);
  if (i <= 120) return 0;
  return 3 - 3 * Math.cos((Math.PI * (i - 120)) / 30);
}
const ELEVATION = CENTERLINE.map((_, i) => elevationAt(i));

const CELLS = 40;
const terrain: Terrain = {
  originX: 15,
  originZ: -75,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  heights: [],
};
// Builder rule near the track: terrain height = nearest centerline elevation - 0.15 m.
// Rapier column-major layout: heights[j * (rows + 1) + i], row i <-> z, col j <-> x.
for (let j = 0; j <= CELLS; j++) {
  const x = terrain.originX - terrain.sizeX / 2 + (j * terrain.sizeX) / CELLS;
  for (let i = 0; i <= CELLS; i++) {
    const z = terrain.originZ - terrain.sizeZ / 2 + (i * terrain.sizeZ) / CELLS;
    let best = Infinity;
    let bestE = 0;
    for (let k = 0; k < N; k++) {
      const d = (CENTERLINE[k][0] - x) ** 2 + (CENTERLINE[k][1] - z) ** 2;
      if (d < best) {
        best = d;
        bestE = ELEVATION[k];
      }
    }
    terrain.heights[j * (CELLS + 1) + i] = bestE - 0.15;
  }
}

const v2Track: TrackDataV2 = {
  version: 2,
  id: 'edge-056',
  name: 'Edge 056',
  widthMeters: 12,
  lengthMeters: 360,
  officialLengthMeters: 360,
  centerline: CENTERLINE,
  sectors: [0, 60, 120],
  elevation: ELEVATION,
  kerbs: [],
  runoffs: [],
  barriers: [],
  terrain,
  treeSpecies: [],
  trees: [],
  grandstands: [],
  pit: { start: 0, end: 0, side: 'right' },
  source: { dataset: 'fixture', license: 'CC0', url: 'https://example.invalid/edge', dem: 'none' },
};

const SPAWN = CENTERLINE[N - 5]; // [10, 0]
const SPAWN_Y = ELEVATION[N - 5] + 0.6; // 6.6

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const FULL_LEFT: DriverInput = { throttle: 1, brake: 0, steer: -1, reset: false };
const RESET: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: true };

function stepsFor(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

class FakeEl {
  className = '';
  children: FakeEl[] = [];
  text: string | null = null;

  constructor(public ownerDocument: FakeDoc) {}

  get textContent(): string | null {
    return this.text;
  }
  set textContent(value: string | null) {
    this.text = value;
  }

  appendChild(child: FakeEl): FakeEl {
    this.children.push(child);
    return child;
  }
}

class FakeDoc {
  created: string[] = [];
  createElement(tag: string): FakeEl {
    this.created.push(tag);
    return new FakeEl(this);
  }
}

function setupHud(): { hud: Hud; container: FakeEl } {
  const doc = new FakeDoc();
  const container = new FakeEl(doc);
  const hud = new Hud(container as unknown as HTMLElement);
  return { hud, container };
}

function findByClass(el: FakeEl, cls: string): FakeEl | null {
  if (el.className === cls) return el;
  for (const child of el.children) {
    const found = findByClass(child, cls);
    if (found) return found;
  }
  return null;
}

function hudData(valid: boolean): HudDataWithValid {
  return {
    speedKmh: 100,
    lap: 2,
    currentLapTime: null,
    lastLapTime: null,
    bestLapTime: null,
    valid,
  };
}

describe('056 track integration edges', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('EDGE1: spawnFromTrack on a v2 track spawns at elevation[N-5] + 0.6', () => {
    const pose = spawnFromTrack(v2Track);
    expect(pose.position.y).toBeCloseTo(SPAWN_Y, 6);
    expect(pose.position.x).toBeCloseTo(SPAWN[0], 6);
    expect(pose.position.z).toBeCloseTo(SPAWN[1], 6);
  });

  it('EDGE2: Game.create on a v2 track places the car at the elevated spawn before any step', async () => {
    game = await Game.create(v2Track);
    const p = game.getCurrentState().position;
    expect(p.y).toBeCloseTo(SPAWN_Y, 6);
    expect(p.x).toBeCloseTo(SPAWN[0], 6);
    expect(p.z).toBeCloseTo(SPAWN[1], 6);
  }, 20000);

  it('EDGE3: Game.create on a v2 track builds track physics so the car rests on the elevated asphalt', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(1); i++) game.step(IDLE);
    const p = game.getCurrentState().position;
    expect(Math.abs(p.y - SPAWN_Y)).toBeLessThan(0.5);
    expect(Math.hypot(p.x - SPAWN[0], p.z - SPAWN[1])).toBeLessThan(1);
  }, 20000);

  it('EDGE4: Game.getWheelSurfaces reports asphalt on all four wheels at the v2 spawn', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(0.5); i++) game.step(IDLE);
    const surfaces = [...(game as GameWithSurfaces).getWheelSurfaces()];
    expect(surfaces).toEqual(['asphalt', 'asphalt', 'asphalt', 'asphalt']);
  }, 20000);

  it('EDGE5: driving off the asphalt onto grass on a v2 track invalidates the running lap', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(3); i++) game.step(FULL);
    expect(game.getLapInfo().lap).toBe(1);
    for (let i = 0; i < stepsFor(3) && game.getLapInfo().valid; i++) game.step(FULL_LEFT);
    expect(game.getLapInfo().valid).toBe(false);
  }, 60000);

  it('EDGE6: reset on a v2 track returns the car to the elevated spawn pose', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(1); i++) game.step(FULL);
    game.step(RESET);
    const p = game.getCurrentState().position;
    expect(Math.abs(p.y - SPAWN_Y)).toBeLessThanOrEqual(0.05);
    expect(Math.abs(p.x - SPAWN[0])).toBeLessThanOrEqual(0.05);
    expect(Math.abs(p.z - SPAWN[1])).toBeLessThanOrEqual(0.05);
  }, 20000);

  it('EDGE7: the HUD lap row shows "Lap invalid" when the lap is invalidated', () => {
    const { hud, container } = setupHud();
    hud.update(hudData(false));
    const lapRow = findByClass(container, 'hud-lap');
    expect(lapRow?.textContent ?? '').toContain('Lap invalid');
  });

  it('EDGE8: the HUD lap row returns to "Lap n" once the lap is valid again', () => {
    const { hud, container } = setupHud();
    hud.update(hudData(false));
    const lapRow = findByClass(container, 'hud-lap');
    expect(lapRow?.textContent ?? '').toContain('Lap invalid');
    const valid = hudData(true);
    hud.update(valid);
    expect(lapRow?.textContent).toBe('Lap 2');
  });
});
