import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCorridor,
  corridorAt,
  isOffTrack,
  type CorridorSample,
  type TrackCorridor,
} from '../../../src/ai/raceView';
import { computeRacingLine } from '../../../src/ai/racingLine';
import { FIXED_DT } from '../../../src/core/constants';
import { createVehicleState } from '../../../src/core/interpolation';
import type { DriverInput, TrackDataV2, VehicleState } from '../../../src/core/types';
import { RaceGame, RACECRAFT_AGGRESSION, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { halfWidthAt } from '../../../src/track/surfaces';
import { TrackProgress } from '../../../src/track/trackProgress';

const trafficCalls = vi.hoisted(() => ({ n: 0 }));

vi.mock('../../../src/ai/traffic', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../src/ai/traffic')>();
  return {
    ...orig,
    trafficDecision: (...args: Parameters<typeof orig.trafficDecision>) => {
      trafficCalls.n += 1;
      return orig.trafficDecision(...args);
    },
  };
});

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };
// RaceGame's racing-line margin (LINE_MARGIN_M), so corridor lineD matches the AI line.
const LINE_MARGIN = 2.4;

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

function corridorSample(): CorridorSample {
  return { halfLeft: 0, halfRight: 0, lineD: 0, profileV: 0, curv: 0 };
}

// Corridor on the same racing line RaceGame builds; lineD and half widths match the sim.
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

// Table default: player frozen well off track at s 0.
function frozenPlayerStart(c: TrackCorridor): { s: number; d: number; v: number } {
  return { s: 0, d: -(halfLeftAt(c, 0) + 8), v: 0 };
}

function wrapDelta(raw: number, lapLength: number): number {
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

// Running race distance (start s plus wrapped travel), the table's "laps x L + s".
function raceDistance(
  initialS: number,
  lapLength: number,
): { push: (s: number) => void; total: () => number } {
  let total = initialS;
  let prev = initialS;
  return {
    push(s: number): void {
      total += wrapDelta(s - prev, lapLength);
      prev = s;
    },
    total: () => total,
  };
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

describe('262 racecraft wiring acceptance', () => {
  it('AT1: faster AI behind ends at least 10 m ahead with no contact', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(2),
      scenario: {
        starts: [
          frozenPlayerStart(c),
          { s: 200, d: lineDAt(c, 200), v: 40 },
          { s: 230, d: lineDAt(c, 230), v: 40 },
        ],
        speedScales: [1, 1, 0.85],
        frozen: [0],
      },
    });
    try {
      const buf = buffers(3);
      const prog = [new TrackProgress(track.centerline), new TrackProgress(track.centerline)];
      const rd = [raceDistance(200, c.lapLength), raceDistance(230, c.lapLength)];
      for (let i = 0; i < steps(120); i++) {
        game.step(IDLE);
        game.getStates(buf);
        for (let k = 0; k < 2; k++) {
          const s = prog[k].update(buf[k + 1].position.x, buf[k + 1].position.z).distance;
          rd[k].push(s);
        }
      }
      expect(rd[0].total() - rd[1].total(), 'A race distance minus B').toBeGreaterThanOrEqual(10);
      expect(game.contactCount, 'contactCount').toBe(0);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('AT2: frozen car on the line is passed and all movers clear s 650', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(4),
      scenario: {
        starts: [
          frozenPlayerStart(c),
          { s: 200, d: lineDAt(c, 200), v: 40 },
          { s: 230, d: lineDAt(c, 230), v: 40 },
          { s: 600, d: lineDAt(c, 600), v: 0 },
          { s: 260, d: lineDAt(c, 260), v: 40 },
        ],
        frozen: [0, 3],
      },
    });
    try {
      const buf = buffers(5);
      for (let i = 0; i < steps(40); i++) game.step(IDLE);
      game.getStates(buf);
      const prog = new TrackProgress(track.centerline);
      for (const car of [1, 2, 4]) {
        const s = prog.update(buf[car].position.x, buf[car].position.z).distance;
        expect(s, `car ${car} lap distance`).toBeGreaterThanOrEqual(650);
      }
      expect(game.contactCount, 'contactCount').toBe(0);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT3: side-by-side pair races 40 s contact-free with at most 1 s off track', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const game = await RaceGame.create(track, spec, {
      ...raceConfig(2),
      scenario: {
        starts: [
          frozenPlayerStart(c),
          { s: 300, d: -2.5, v: 50 },
          { s: 300, d: 2.5, v: 50 },
        ],
        speedScales: [1, 1, 1],
        frozen: [0],
      },
    });
    try {
      const buf = buffers(3);
      const prog = [new TrackProgress(track.centerline), new TrackProgress(track.centerline)];
      const offS = [0, 0];
      for (let i = 0; i < steps(40); i++) {
        game.step(IDLE);
        game.getStates(buf);
        for (let k = 0; k < 2; k++) {
          const p = prog[k].update(buf[k + 1].position.x, buf[k + 1].position.z);
          if (isOffTrack(c, p.distance, p.lateral)) offS[k] += FIXED_DT;
        }
      }
      expect(game.contactCount, 'contactCount').toBe(0);
      expect(offS[0], 'car 1 off-track seconds').toBeLessThanOrEqual(1);
      expect(offS[1], 'car 2 off-track seconds').toBeLessThanOrEqual(1);
    } finally {
      game.dispose();
    }
  }, 120000);

  it('AT4: mixed-pace two-column field trades places and finishes within 1.3x', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const nAI = 7;
    const starts: { s: number; d: number; v: number }[] = [frozenPlayerStart(c)];
    const speedScales = [1];
    for (let k = 0; k < nAI; k++) {
      starts.push({ s: 100 - 8 * k, d: k % 2 === 0 ? -2 : 2, v: 0 });
      speedScales.push(0.9 + (k * 0.1) / (nAI - 1));
    }
    const gridConfig: WiredConfig = {
      ...raceConfig(nAI),
      difficulty: 'expert',
      scenario: { starts, speedScales, frozen: [0] },
    };
    const game = await RaceGame.create(track, spec, gridConfig);
    let ticks = 0;
    try {
      const buf = buffers(nAI + 1);
      const prog = Array.from({ length: nAI }, () => new TrackProgress(track.centerline));
      const rd = Array.from({ length: nAI }, (_, k) =>
        raceDistance(starts[k + 1].s, c.lapLength),
      );
      const rank = new Array<number>(nAI).fill(0);
      const prevRank = new Array<number>(nAI).fill(0);
      const order = Array.from({ length: nAI }, (_, k) => k);
      let changes = 0;
      let sampled = false;
      const sampleEvery = steps(0.5);
      const maxTicks = steps(700);
      let finishedTimes: (number | null)[] = new Array<number | null>(nAI).fill(null);
      for (let i = 0; i < maxTicks; i++) {
        game.step(IDLE);
        ticks = i + 1;
        game.getStates(buf);
        for (let k = 0; k < nAI; k++) {
          const st = buf[k + 1];
          rd[k].push(prog[k].update(st.position.x, st.position.z).distance);
        }
        if ((i + 1) % sampleEvery !== 0) continue;
        order.sort((a, b) => rd[b].total() - rd[a].total());
        for (let r = 0; r < nAI; r++) rank[order[r]] = r;
        if (sampled) {
          for (let a = 0; a < nAI; a++) {
            for (let b = a + 1; b < nAI; b++) {
              if ((prevRank[a] < prevRank[b]) !== (rank[a] < rank[b])) changes++;
            }
          }
        }
        for (let a = 0; a < nAI; a++) prevRank[a] = rank[a];
        sampled = true;
        finishedTimes = aiFinishTimes(game, nAI);
        if (finishedTimes.every((t) => t !== null)) break;
      }
      const classic = await RaceGame.create(track, spec, { ...gridConfig, classicTraffic: true } as WiredConfig);
      let classicContacts = 0;
      try {
        for (let i = 0; i < ticks; i++) classic.step(IDLE);
        classicContacts = classic.contactCount;
      } finally {
        classic.dispose();
      }
      console.log(`AT4 contacts racecraft=${game.contactCount} classic=${classicContacts}`);
      expect(game.contactCount, 'contactCount vs classic').toBeLessThanOrEqual(classicContacts);
      expect(changes, 'position changes among AIs').toBeGreaterThanOrEqual(4);
      for (let k = 0; k < nAI; k++) {
        expect(finishedTimes[k], `AI ${k + 1} finish time`).not.toBeNull();
      }
      const winnerTime = Math.min(...(finishedTimes as number[]));
      for (let k = 0; k < nAI; k++) {
        expect(finishedTimes[k] as number, `AI ${k + 1} vs winner`).toBeLessThanOrEqual(
          1.3 * winnerTime,
        );
      }
    } finally {
      game.dispose();
    }
  }, 600000);

  it('AT5: classicTraffic keeps the trafficDecision path running', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    trafficCalls.n = 0;
    const config: WiredConfig = {
      ...raceConfig(2),
      classicTraffic: true,
      scenario: {
        starts: [
          frozenPlayerStart(c),
          { s: 200, d: lineDAt(c, 200), v: 40 },
          { s: 230, d: lineDAt(c, 230), v: 40 },
        ],
        speedScales: [1, 1, 0.85],
        frozen: [0],
      },
    };
    const game = await RaceGame.create(track, spec, config);
    try {
      for (let i = 0; i < steps(120); i++) game.step(IDLE);
      expect(trafficCalls.n, 'trafficDecision calls').toBeGreaterThan(0);
      expect(game.simTime, 'sim time after the AT1 run').toBeCloseTo(steps(120) * FIXED_DT, 6);
    } finally {
      game.dispose();
    }
  }, 180000);

  it('AT6: 16-car racecraft stepping costs at most 1.5x classic', async () => {
    const track = loadTrack();
    const spec = loadSpec();
    const c = trackCorridor(track);
    const starts: { s: number; d: number; v: number }[] = [frozenPlayerStart(c)];
    for (let k = 0; k < 15; k++) starts.push({ s: 150 - 8 * k, d: k % 2 === 0 ? -2 : 2, v: 0 });
    const base: WiredConfig = { ...raceConfig(15), scenario: { starts, frozen: [0] } };
    const classicMs = await stepRun(track, spec, { ...base, classicTraffic: true });
    const racecraftMs = await stepRun(track, spec, base);
    expect(racecraftMs, 'racecraft wall time vs classic').toBeLessThanOrEqual(1.5 * classicMs);
  }, 300000);

  it('AT7: RACECRAFT_AGGRESSION is 0.2/0.4/0.7/0.9 by difficulty', () => {
    expect(RACECRAFT_AGGRESSION.easy, 'easy').toBeCloseTo(0.2, 9);
    expect(RACECRAFT_AGGRESSION.medium, 'medium').toBeCloseTo(0.4, 9);
    expect(RACECRAFT_AGGRESSION.hard, 'hard').toBeCloseTo(0.7, 9);
    expect(RACECRAFT_AGGRESSION.expert, 'expert').toBeCloseTo(0.9, 9);
  });
});

function aiFinishTimes(game: RaceGame, nAI: number): (number | null)[] {
  const times = new Array<number | null>(nAI).fill(null);
  for (const row of game.standings()) {
    if (row.car >= 1 && row.car <= nAI) times[row.car - 1] = row.finished ? row.totalTime : null;
  }
  return times;
}

// Wall time of 30 s of stepping only: the per-tick cost AT6 compares.
async function stepRun(track: TrackDataV2, spec: CarSpec, config: WiredConfig): Promise<number> {
  const game = await RaceGame.create(track, spec, config);
  try {
    const t0 = performance.now();
    for (let i = 0; i < steps(30); i++) game.step(IDLE);
    return performance.now() - t0;
  } finally {
    game.dispose();
  }
}
