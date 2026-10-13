import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Game, spawnFromTrack } from '../../../src/game/game';
import { Hud } from '../../../src/ui/hud';
import { initPhysics } from '../../../src/physics/physicsWorld';
import { TrackProgress } from '../../../src/track/trackProgress';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, Terrain, TrackDataV2 } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

// Closed rectangular loop, 2 m spacing, 180 points (n > 2*WINDOW+1 so TrackProgress
// uses the windowed search), heading -Z on the first straight. Same geometry as the
// 056 edge fixture, but with a uniform 6 m plateau so ground heights are exact.
const N = 180;
const CENTERLINE: [number, number][] = [];
for (let i = 0; i <= 75; i++) CENTERLINE.push([0, -2 * i]);
for (let i = 1; i <= 15; i++) CENTERLINE.push([2 * i, -150]);
for (let i = 1; i <= 75; i++) CENTERLINE.push([30, -150 + 2 * i]);
for (let i = 1; i <= 14; i++) CENTERLINE.push([30 - 2 * i, 0]);

const ELEVATION = CENTERLINE.map(() => 6);

const CELLS = 40;
const terrain: Terrain = {
  originX: 15,
  originZ: -75,
  sizeX: 400,
  sizeZ: 400,
  rows: CELLS,
  cols: CELLS,
  // Builder rule near the track: terrain = centerline elevation - 0.15 m.
  heights: new Array<number>((CELLS + 1) * (CELLS + 1)).fill(5.85),
};

const v2Track: TrackDataV2 = {
  version: 2,
  id: 'post-056',
  name: 'Post 056',
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
  source: { dataset: 'fixture', license: 'CC0', url: 'https://example.invalid/post', dem: 'none' },
};

const SPAWN = CENTERLINE[N - 5];   // [10, 0]
const SPAWN_GROUND = 6;            // elevation[N - 5]
const TERRAIN_Y = 5.85;            // terrain plateau under the escape zone

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
const FULL: DriverInput = { throttle: 1, brake: 0, steer: 0, reset: false };
const FULL_LEFT: DriverInput = { throttle: 1, brake: 0, steer: -1, reset: false };

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

describe('056 track integration gaps', () => {
  let game: Game | null = null;

  beforeAll(async () => {
    await initPhysics();
  });

  afterEach(() => {
    game?.dispose();
    game = null;
  });

  it('POST1: on a v1 track surfaceUnderCar falls back to asphalt and trackHeightUnderCar is NaN', async () => {
    game = await Game.create(circleTrack);
    for (let i = 0; i < stepsFor(0.5); i++) game.step(IDLE);
    expect(game.surfaceUnderCar()).toBe('asphalt');
    expect(Number.isNaN(game.trackHeightUnderCar())).toBe(true);
  }, 20000);

  it('POST2: at the v2 spawn the ground raycast under the chassis reports asphalt', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(0.5); i++) game.step(IDLE);
    expect(game.surfaceUnderCar()).toBe('asphalt');
  }, 20000);

  it('POST3: at the v2 spawn trackHeightUnderCar returns the track elevation, not the terrain below', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(0.5); i++) game.step(IDLE);
    expect(game.trackHeightUnderCar()).toBeCloseTo(SPAWN_GROUND, 1);
  }, 20000);

  it('POST4: off track on a v2 track the ground ray hits the grass terrain at terrain height', async () => {
    game = await Game.create(v2Track);
    for (let i = 0; i < stepsFor(3); i++) game.step(FULL);
    expect(game.getLapInfo().lap).toBe(1);
    for (let i = 0; i < stepsFor(4) && game.getLapInfo().valid; i++) game.step(FULL_LEFT);
    expect(game.getLapInfo().valid).toBe(false);
    expect(game.surfaceUnderCar()).toBe('grass');
    expect(game.trackHeightUnderCar()).toBeCloseTo(TERRAIN_Y, 1);
    expect([...game.getWheelSurfaces()]).toEqual(['grass', 'grass', 'grass', 'grass']);
  }, 60000);

  it('POST5: TrackProgress wraps to distance 0 at the ring seam instead of sticking at the length', () => {
    const tp = new TrackProgress(CENTERLINE);
    // Move the local search window onto the closing segment (indices 166..179).
    tp.update(CENTERLINE[175][0], CENTERLINE[175][1]);
    tp.update(CENTERLINE[177][0], CENTERLINE[177][1]);
    const before = tp.update(CENTERLINE[179][0], CENTERLINE[179][1]);
    expect(before.distance).toBeCloseTo(tp.length - 2, 6);
    const seam = tp.update(CENTERLINE[0][0], CENTERLINE[0][1]);
    expect(seam.distance).toBeCloseTo(0, 6);
    expect(seam.index).toBe(0);
  });

  it('POST6: the HUD treats a missing valid flag as valid (Phase 0 callers)', () => {
    const { hud, container } = setupHud();
    hud.update({ speedKmh: 50, lap: 3, currentLapTime: null, lastLapTime: null, bestLapTime: null });
    const lapRow = findByClass(container, 'hud-lap');
    expect(lapRow?.textContent).toBe('Lap 3');
    hud.update({ speedKmh: 0, lap: 0, currentLapTime: null, lastLapTime: null, bestLapTime: null });
    expect(lapRow?.textContent).toBe('Lap -');
  });

  it('POST7: spawnFromTrack falls back to ground 0 when the v2 elevation array is sparse', () => {
    const sparse: TrackDataV2 = { ...v2Track, elevation: ELEVATION.slice(0, N - 10) };
    const pose = spawnFromTrack(sparse);
    expect(pose.position.y).toBeCloseTo(0.6, 9);
    expect(pose.position.x).toBeCloseTo(SPAWN[0], 9);
    expect(pose.position.z).toBeCloseTo(SPAWN[1], 9);
  });

  it('POST8: the HUD shows "Lap invalid" even when no lap has started yet', () => {
    const { hud, container } = setupHud();
    hud.update({ speedKmh: 0, lap: 0, currentLapTime: null, lastLapTime: null, bestLapTime: null, valid: false });
    const lapRow = findByClass(container, 'hud-lap');
    expect(lapRow?.textContent).toBe('Lap invalid');
  });
});
