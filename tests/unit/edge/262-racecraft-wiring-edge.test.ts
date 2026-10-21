import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanOutput } from '../../../src/ai/lanePlanner';
import type { Intent } from '../../../src/ai/racecraft';
import { computeRacingLine } from '../../../src/ai/racingLine';
import {
  buildCorridor,
  corridorAt,
  type CarView,
  type CorridorSample,
  type Neighbour,
  type PlanBias,
  type TrackCorridor,
} from '../../../src/ai/raceView';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt } from '../../../src/track/surfaces';
import { TrackProgress } from '../../../src/track/trackProgress';

type ViewSnap = { s: number; d: number; v: number; stopped: boolean; offTrack: boolean };
type PlanRecord = {
  tick: number;
  planner: object;
  self: ViewSnap;
  others: Array<{ gap: number; car: ViewSnap }>;
};

const rec = vi.hoisted(() => ({
  tick: { n: 0 },
  plans: [] as PlanRecord[],
  craftMade: [] as number[],
  craftUpdates: [] as Array<{ tick: number; dt: number }>,
  trafficCalls: { n: 0 },
}));

function snapView(v: CarView): ViewSnap {
  return { s: v.s, d: v.d, v: v.v, stopped: v.stopped, offTrack: v.offTrack };
}

vi.mock('../../../src/ai/traffic', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/ai/traffic')>();
  return {
    ...orig,
    trafficDecision: (...args: Parameters<typeof orig.trafficDecision>) => {
      rec.trafficCalls.n += 1;
      return orig.trafficDecision(...args);
    },
  };
});

vi.mock('../../../src/ai/lanePlanner', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/ai/lanePlanner')>();
  class RecordingPlanner extends orig.LanePlanner {
    plan(
      self: CarView,
      neighbours: readonly Neighbour[],
      bias: PlanBias,
      out: PlanOutput,
      count?: number,
    ): PlanOutput {
      const n = count === undefined ? neighbours.length : count;
      const others: PlanRecord['others'] = [];
      for (let i = 0; i < n; i++) {
        others.push({ gap: neighbours[i].gap, car: snapView(neighbours[i].car) });
      }
      rec.plans.push({ tick: rec.tick.n, planner: this, self: snapView(self), others });
      return super.plan(self, neighbours, bias, out, count);
    }
  }
  return { ...orig, LanePlanner: RecordingPlanner };
});

vi.mock('../../../src/ai/racecraft', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/ai/racecraft')>();
  class RecordingRacecraft extends orig.Racecraft {
    constructor(corridor: TrackCorridor, aggression: number) {
      super(corridor, aggression);
      rec.craftMade.push(aggression);
    }
    update(
      self: CarView,
      neighbours: readonly Neighbour[],
      dt: number,
      out: PlanBias,
      count?: number,
    ): Intent {
      rec.craftUpdates.push({ tick: rec.tick.n, dt });
      return super.update(self, neighbours, dt, out, count);
    }
  }
  return { ...orig, Racecraft: RecordingRacecraft };
});

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

type WiredConfig = RaceConfig & { classicTraffic?: boolean };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function buffers(carCount: number): VehicleState[] {
  return Array.from({ length: carCount }, () => createVehicleState(4));
}

// raceGame's LINE_MARGIN_M, so corridor lineD matches the AI line.
const LINE_MARGIN = 2.2;

function corridorSample(): CorridorSample {
  return { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
}

function trackCorridor(track: TrackDataV2): TrackCorridor {
  const n = track.centerline.length;
  const halfLeft = new Array<number>(n);
  const halfRight = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    halfLeft[i] = halfWidthAt(track, 'left', i);
    halfRight[i] = halfWidthAt(track, 'right', i);
  }
  const line = computeRacingLine(
    track.centerline,
    track.widthMeters / 2,
    LINE_MARGIN,
    undefined,
    halfLeft,
    halfRight,
  );
  return buildCorridor(track, line, new Float64Array(n));
}

function lineDAt(c: TrackCorridor, s: number): number {
  return corridorAt(c, s, corridorSample()).lineD;
}

function halfLeftAt(c: TrackCorridor, s: number): number {
  return corridorAt(c, s, corridorSample()).halfLeft;
}

function raceConfig(aiCount: number): WiredConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function resetRec(): void {
  rec.tick.n = 0;
  rec.plans.length = 0;
  rec.craftMade.length = 0;
  rec.craftUpdates.length = 0;
  rec.trafficCalls.n = 0;
}

function runSteps(game: RaceGame, seconds: number): void {
  for (let i = 0; i < steps(seconds); i++) {
    rec.tick.n = i;
    game.step(IDLE);
  }
}

beforeEach(resetRec);

describe('262 racecraft wiring edge', () => {
  it('EDGE1: the default path plans with racecraft and never calls trafficDecision', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 100, d: 0, v: 40 },
        ],
        frozen: [0],
      },
    });
    try {
      runSteps(game, 1);
      expect(rec.plans.length, 'racecraft plans').toBeGreaterThan(0);
      expect(rec.craftUpdates.length, 'racecraft updates').toBeGreaterThan(0);
      expect(rec.trafficCalls.n, 'trafficDecision calls').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE2: classicTraffic keeps the old path and never builds or runs racecraft', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const config: WiredConfig = {
      ...raceConfig(2),
      classicTraffic: true,
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 100, d: 0, v: 40 },
          { s: 130, d: 0, v: 40 },
        ],
        frozen: [0],
      },
    };
    const game = await RaceGame.create(track, spec, config);
    try {
      runSteps(game, 1);
      expect(rec.trafficCalls.n, 'trafficDecision calls').toBeGreaterThan(0);
      expect(rec.craftMade.length, 'Racecraft built').toBe(0);
      expect(rec.craftUpdates.length, 'Racecraft updates').toBe(0);
      expect(rec.plans.length, 'lane plans').toBe(0);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE3: one Racecraft per AI, built with the difficulty aggression', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const scenario = {
      starts: [
        { s: 0, d: -30, v: 0 },
        { s: 100, d: 0, v: 40 },
        { s: 130, d: 0, v: 40 },
      ],
      frozen: [0],
    };
    const easy = await RaceGame.create(track, spec, {
      ...raceConfig(2),
      difficulty: 'easy',
      scenario,
    });
    try {
      runSteps(easy, 0.1);
      expect(rec.craftMade, 'easy aggression per AI').toEqual([0.2, 0.2]);
    } finally {
      easy.dispose();
    }
    resetRec();
    const expert = await RaceGame.create(track, spec, {
      ...raceConfig(2),
      difficulty: 'expert',
      scenario,
    });
    try {
      runSteps(expert, 0.1);
      expect(rec.craftMade, 'expert aggression per AI').toEqual([0.9, 0.9]);
    } finally {
      expert.dispose();
    }
  }, 60000);

  it('EDGE4: Racecraft.update runs once per replan with dt 0.1', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(1),
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 100, d: 0, v: 40 },
        ],
        frozen: [0],
      },
    });
    try {
      runSteps(game, 0.2);
      expect(rec.craftUpdates.length, 'updates in 0.2 s').toBeGreaterThanOrEqual(2);
      expect(rec.craftUpdates.length, 'updates vs plans').toBe(rec.plans.length);
      for (const u of rec.craftUpdates) expect(u.dt, 'update dt').toBeCloseTo(0.1, 9);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE5: each AI replans every 12 ticks, staggered by AI index', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(3),
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 100, d: 0, v: 40 },
          { s: 130, d: 0, v: 40 },
          { s: 160, d: 0, v: 40 },
        ],
        frozen: [0],
      },
    });
    try {
      runSteps(game, 40 / 120);
      const byPlanner = new Map<object, number[]>();
      for (const p of rec.plans) {
        const list = byPlanner.get(p.planner);
        if (list === undefined) byPlanner.set(p.planner, [p.tick]);
        else list.push(p.tick);
      }
      expect(byPlanner.size, 'LanePlanner instances').toBe(3);
      const residues: number[] = [];
      for (const ticks of byPlanner.values()) {
        ticks.sort((a, b) => a - b);
        expect(ticks.length, 'plans per AI in 40 ticks').toBeGreaterThanOrEqual(3);
        const residue = ticks[0] % 12;
        for (const t of ticks) expect(t % 12, 'plan tick residue').toBe(residue);
        for (let i = 1; i < ticks.length; i++) {
          expect(ticks[i] - ticks[i - 1], 'ticks between replans').toBe(12);
        }
        residues.push(residue);
      }
      expect(new Set(residues).size, 'distinct stagger residues').toBe(3);
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE6: neighbours use the default ranges (120 m ahead, 60 m behind)', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(5),
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 500, d: 0, v: 40 },
          { s: 615, d: 0, v: 0 },
          { s: 445, d: 0, v: 0 },
          { s: 625, d: 0, v: 0 },
          { s: 435, d: 0, v: 0 },
        ],
        frozen: [0, 2, 3, 4, 5],
      },
    });
    try {
      runSteps(game, 0.2);
      const seen = rec.plans.filter((p) => p.tick >= 1);
      expect(seen.length, 'plans after tick 0').toBeGreaterThan(0);
      for (const p of seen) {
        const gaps = p.others.map((o) => o.gap);
        for (const spawn of [615, 445]) {
          const expectGap = spawn - p.self.s;
          expect(
            gaps.some((g) => Math.abs(g - expectGap) < 2),
            `car at s ${spawn} (gap ${expectGap.toFixed(1)}) in range`,
          ).toBe(true);
        }
        for (const spawn of [625, 435]) {
          const expectGap = spawn - p.self.s;
          expect(
            gaps.some((g) => Math.abs(g - expectGap) < 2),
            `car at s ${spawn} (gap ${expectGap.toFixed(1)}) out of range`,
          ).toBe(false);
        }
      }
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE7: a frozen player on the racing line is passed like any other car', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(3),
      scenario: {
        starts: [
          { s: 600, d: lineDAt(c, 600), v: 0 },
          { s: 200, d: lineDAt(c, 200), v: 40 },
          { s: 230, d: lineDAt(c, 230), v: 40 },
          { s: 260, d: lineDAt(c, 260), v: 40 },
        ],
        frozen: [0],
      },
    });
    try {
      runSteps(game, 40);
      const buf = buffers(4);
      game.getStates(buf);
      for (const car of [1, 2, 3]) {
        const prog = new TrackProgress(track.centerline);
        const s = prog.update(buf[car].position.x, buf[car].position.z).distance;
        expect(s, `car ${car} lap distance`).toBeGreaterThanOrEqual(650);
      }
      expect(game.contactCount, 'contactCount').toBe(0);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('EDGE8: nothing is planned before the lights go out', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const game = await RaceGame.create(track, spec, raceConfig(1));
    try {
      let i = 0;
      while (game.raceElapsed < 0 && i < steps(20)) {
        rec.tick.n = i;
        game.step(IDLE);
        i++;
      }
      expect(game.raceElapsed, 'lights out reached').toBeGreaterThanOrEqual(0);
      expect(rec.plans.length, 'plans before go').toBe(0);
      expect(rec.craftUpdates.length, 'updates before go').toBe(0);
      for (let k = 0; k < 24; k++) {
        rec.tick.n = i;
        game.step(IDLE);
        i++;
      }
      expect(rec.plans.length, 'plans after go').toBeGreaterThan(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('EDGE9: CarView offTrack comes from isOffTrack and stopped from a 1 s StopTracker', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(2),
      scenario: {
        starts: [
          { s: 0, d: -30, v: 0 },
          { s: 500, d: -(halfLeftAt(c, 500) + 0.5), v: 0 },
          { s: 530, d: lineDAt(c, 530), v: 0 },
        ],
        frozen: [0, 2],
      },
    });
    try {
      runSteps(game, 1.5);
      const offPlans = rec.plans.filter((p) => p.tick >= 12 && p.tick <= 48);
      expect(offPlans.length, 'plans while off track').toBeGreaterThan(0);
      for (const p of offPlans) expect(p.self.offTrack, 'off-track self view').toBe(true);
      const early = rec.plans.filter((p) => p.tick <= 48);
      const late = rec.plans.filter((p) => p.tick >= 132);
      expect(early.length, 'early plans').toBeGreaterThan(0);
      expect(late.length, 'late plans').toBeGreaterThan(0);
      for (const p of early) {
        const ahead = p.others.filter((o) => o.gap > 0);
        expect(ahead.length, 'ahead neighbour').toBe(1);
        expect(ahead[0].car.stopped, 'stopped before 1 s').toBe(false);
        expect(ahead[0].car.offTrack, 'on-track neighbour').toBe(false);
      }
      for (const p of late) {
        const ahead = p.others.filter((o) => o.gap > 0);
        expect(ahead.length, 'ahead neighbour').toBe(1);
        expect(ahead[0].car.stopped, 'stopped after 1 s').toBe(true);
      }
    } finally {
      game.dispose();
    }
  }, 60000);

  it('EDGE10: two runs with the same seed are identical (no randomness added)', async () => {
    const a = await snapshotRun();
    const b = await snapshotRun();
    expect(b.contacts, 'contactCount').toBe(a.contacts);
    expect(b.states, 'car states').toEqual(a.states);
  }, 120000);
});

async function snapshotRun(): Promise<{ contacts: number; states: number[][] }> {
  const track = loadTrack();
  const spec = loadSpec();
  const game = await RaceGame.create(track, spec, {
    ...raceConfig(2),
    scenario: {
      starts: [
        { s: 0, d: -30, v: 0 },
        { s: 100, d: 0, v: 40 },
        { s: 130, d: 0, v: 40 },
      ],
      frozen: [0],
    },
  });
  try {
    runSteps(game, 6);
    const buf = buffers(3);
    game.getStates(buf);
    return {
      contacts: game.contactCount,
      states: buf.map((s) =>
        [s.position.x, s.position.y, s.position.z].map((v) => Math.round(v * 1e6) / 1e6),
      ),
    };
  } finally {
    game.dispose();
  }
}
