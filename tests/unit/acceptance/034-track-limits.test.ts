import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Game } from '../../../src/game/game';
import type { LapInfo } from '../../../src/game/game';
import { Vehicle } from '../../../src/physics/vehicle';
import { TrackProgress } from '../../../src/track/trackProgress';
import { initPhysics } from '../../../src/physics/physicsWorld';
import type { DriverInput, LapEvent, Surface } from '../../../src/core/types';
import { circleTrack } from '../../fixtures/circleTrack';

const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

// Scripted track distances: the LapTimer wrap window is 50 m and the circleTrack
// sector boundaries fall at cumulative 0, ~209.3 and ~418.6.
const BEFORE_LINE = 580;
const AFTER_LINE = 10;
const PAST_LINE = 15;
const SECTOR2 = 300;
const SECTOR3 = 500;

type InvalidatedEvent = { type: 'lapInvalidated'; lap: number };
type CompletedEvent = Extract<LapEvent, { type: 'lapCompleted' }>;
type LapEventWithInvalidated = LapEvent | InvalidatedEvent;
// Task 034 target signatures; the intersections keep this file typechecking before they exist.
type LapInfoWithValid = LapInfo & { valid: boolean };

const ASPHALT: Surface[] = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
const ALL_GRASS: Surface[] = ['grass', 'grass', 'grass', 'grass'];
const THREE_GRASS_ONE_KERB: Surface[] = ['grass', 'grass', 'grass', 'kerb'];

let surfaces: Surface[];
let dist = 0;
let game: Game | null = null;

beforeAll(async () => {
  await initPhysics();
});

beforeEach(() => {
  surfaces = ASPHALT;
  dist = 0;
  vi.spyOn(Vehicle.prototype, 'getWheelSurfaces').mockImplementation(() => surfaces);
  vi.spyOn(TrackProgress.prototype, 'update').mockImplementation(() => ({
    index: 0,
    distance: dist,
    lateral: 0,
  }));
});

afterEach(() => {
  game?.dispose();
  game = null;
  vi.restoreAllMocks();
});

async function createGame(): Promise<Game> {
  const g = await Game.create(circleTrack);
  game = g;
  return g;
}

function stepAt(distance: number): LapEventWithInvalidated[] {
  const g = game as Game;
  dist = distance;
  g.step(IDLE);
  return g.drainEvents() as LapEventWithInvalidated[];
}

// The first update only seeds prevDistance; the wrap on the second starts lap 1.
function startLap(): LapEventWithInvalidated[] {
  stepAt(BEFORE_LINE);
  return stepAt(AFTER_LINE);
}

function completeLap(): LapEventWithInvalidated[] {
  stepAt(SECTOR2);
  stepAt(SECTOR3);
  stepAt(BEFORE_LINE);
  return stepAt(AFTER_LINE);
}

describe('task 034: invalidate laps when all wheels leave the track', () => {
  it('AT1: all four wheels on grass for one step marks the running lap invalid and emits lapInvalidated once', async () => {
    const g = await createGame();
    const started = startLap();
    expect(started.some((e) => e.type === 'lapStarted' && e.lap === 1)).toBe(true);
    surfaces = ALL_GRASS;
    const events = stepAt(PAST_LINE);
    const invalidated = events.filter((e): e is InvalidatedEvent => e.type === 'lapInvalidated');
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]?.lap).toBe(1);
    expect((g.getLapInfo() as LapInfoWithValid).valid).toBe(false);
  }, 20000);

  it('AT2: three wheels on grass and one on kerb leaves the running lap valid', async () => {
    const g = await createGame();
    const started = startLap();
    expect(started.some((e) => e.type === 'lapStarted' && e.lap === 1)).toBe(true);
    surfaces = THREE_GRASS_ONE_KERB;
    const events = stepAt(PAST_LINE);
    expect(events.filter((e) => e.type === 'lapInvalidated')).toHaveLength(0);
    expect((g.getLapInfo() as LapInfoWithValid).valid).toBe(true);
  }, 20000);

  it('AT3: an invalid lap completing emits no lapCompleted and leaves best lap unchanged', async () => {
    const g = await createGame();
    startLap();
    completeLap();
    const afterFirst = g.getLapInfo();
    expect(afterFirst.bestLapTime).not.toBeNull();
    surfaces = ALL_GRASS;
    stepAt(PAST_LINE);
    surfaces = ASPHALT;
    expect((g.getLapInfo() as LapInfoWithValid).valid).toBe(false);
    stepAt(SECTOR2);
    stepAt(SECTOR3);
    stepAt(BEFORE_LINE);
    const events = stepAt(AFTER_LINE);
    expect(events.filter((e): e is CompletedEvent => e.type === 'lapCompleted')).toHaveLength(0);
    const info = g.getLapInfo();
    expect(info.bestLapTime).toBeCloseTo(afterFirst.bestLapTime as number, 12);
    expect(info.lastLapTime).toBeCloseTo(afterFirst.lastLapTime as number, 12);
  }, 20000);

  it('AT4: the lap following an invalid one, driven clean, is counted normally on completion', async () => {
    const g = await createGame();
    startLap();
    surfaces = ALL_GRASS;
    stepAt(PAST_LINE);
    surfaces = ASPHALT;
    completeLap();
    expect(g.getLapInfo().lap).toBe(2);
    expect((g.getLapInfo() as LapInfoWithValid).valid).toBe(true);
    const events = completeLap();
    const completed = events.filter((e): e is CompletedEvent => e.type === 'lapCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.lap).toBe(2);
    const info = g.getLapInfo();
    expect(info.lastLapTime).not.toBeNull();
    expect(info.bestLapTime).toBeCloseTo(info.lastLapTime as number, 12);
  }, 20000);
});
