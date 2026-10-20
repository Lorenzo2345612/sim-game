import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { yellowCap, YELLOW_GAP_M, YELLOW_FOLLOW_MIN_MS } from '../../../src/race/yellowCap';
import { FlagState, type FlagCar } from '../../../src/race/flags';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

interface RaceInternals {
  yellow: Uint8Array;
  ruleCap: Float64Array;
  traffic: { distance: number; lateral: number; speed: number }[];
  stopped: Uint8Array;
  finished: Uint8Array;
  speeds: Float64Array;
  indices: Int32Array;
  lapLength: number;
  line: { offsets: number[] };
  aheadIdx: number;
  ais: { driver: { reqOffset: number } }[];
}

function flagCar(speed: number): FlagCar {
  return { distance: 100, lapDistance: 100, speed, offTrack: false, retired: false };
}

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(aiCount: number): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

function stepToGo(game: RaceGame): number {
  let sawLights = false;
  for (let i = 0; i < steps(20); i++) {
    game.step(IDLE);
    if (game.startLights() > 0) sawLights = true;
    else if (sawLights) return game.simTime;
  }
  throw new Error('start lights never cleared');
}

function internals(game: RaceGame): RaceInternals {
  return game as unknown as RaceInternals;
}

function oracle(g: RaceInternals, i: number): number {
  const lapDist: number[] = [];
  const speed: number[] = [];
  const out: number[] = [];
  for (let j = 0; j < g.traffic.length; j++) {
    lapDist.push(g.traffic[j].distance);
    speed.push(g.traffic[j].speed);
    out.push(g.stopped[j] === 1 || g.finished[j] === 1 ? 1 : 0);
  }
  return yellowCap(i, lapDist, speed, out, g.lapLength);
}

function wrapGap(raw: number, lapLength: number): number {
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

describe('289 yellow cap edge', () => {
  it('EDGE1: the exported gap and follow-min constants match the flag cause speed boundary', () => {
    expect(YELLOW_GAP_M).toBe(30);
    expect(YELLOW_FOLLOW_MIN_MS).toBe(5);
    const bounds: [number, number, number] = [0, 500, 1000];
    const atMin = new FlagState(bounds, 1000);
    atMin.update([flagCar(YELLOW_FOLLOW_MIN_MS)], 0);
    atMin.update([flagCar(YELLOW_FOLLOW_MIN_MS)], 1.5);
    expect(atMin.sectorFlag(1), 'a car at exactly the follow min raises no cause').toBe('green');
    const belowMin = new FlagState(bounds, 1000);
    belowMin.update([flagCar(YELLOW_FOLLOW_MIN_MS - 0.1)], 0);
    belowMin.update([flagCar(YELLOW_FOLLOW_MIN_MS - 0.1)], 1.5);
    expect(belowMin.sectorFlag(1), 'just below the min the yellow cause fires').toBe('yellow');
  });

  it('EDGE2: the cap is the nearest eligible car speed, not the minimum speed ahead', () => {
    const cap = yellowCap(0, [100, 110, 125], [30, 15, 8], [0, 0, 0], 1000);
    expect(cap, 'nearest eligible is car 1 at 10 m with 15 m/s').toBe(15);
  });

  it('EDGE3: a car behind within 10 m never caps even though it is close', () => {
    const cap = yellowCap(0, [100, 90], [30, 20], [0, 0], 1000);
    expect(Number.isNaN(cap)).toBe(true);
  });

  it('EDGE4: inputs are not mutated and repeated calls return the same cap', () => {
    const lapDist = [100, 110];
    const speed = [30, 7];
    const out = [0, 0];
    const first = yellowCap(0, lapDist, speed, out, 1000);
    const second = yellowCap(0, lapDist, speed, out, 1000);
    expect(first).toBe(7);
    expect(second).toBe(first);
    expect(lapDist).toEqual([100, 110]);
    expect(speed).toEqual([30, 7]);
    expect(out).toEqual([0, 0]);
  });

  it('EDGE5: self and a car at the same lap distance (gap 0) never cap', () => {
    expect(Number.isNaN(yellowCap(0, [100], [30], [0], 1000)), 'lone car').toBe(true);
    expect(Number.isNaN(yellowCap(0, [100, 100], [30, 20], [0, 0], 1000)), 'coincident').toBe(
      true,
    );
  });

  it(
    'EDGE6: under yellow the lateral offset is forced to 0 only while yellowCap returns a number',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(3));
      try {
        stepToGo(game);
        for (let i = 0; i < steps(8.5); i++) game.step(IDLE);
        game.debugStopCar(1);
        const g = internals(game);
        let numberTicks = 0;
        let nanSeen = false;
        for (let t = 0; t < steps(60); t++) {
          const y3 = g.yellow[3];
          const cap3 = oracle(g, 3);
          const y2 = g.yellow[2];
          const cap2 = oracle(g, 2);
          const gap12 = wrapGap(g.traffic[1].distance - g.traffic[2].distance, g.lapLength);
          const ahead2 = (g.indices[2] + g.aheadIdx) % g.line.offsets.length;
          const lineOff2 = g.line.offsets[ahead2];
          const blocker =
            gap12 > 0 &&
            gap12 < 25 &&
            g.traffic[1].speed < 1 &&
            g.traffic[2].speed > 0.5 &&
            Math.abs(g.traffic[1].lateral - lineOff2) < 2.5;
          game.step(IDLE);
          const off2 = g.ais[1].driver.reqOffset;
          const off3 = g.ais[2].driver.reqOffset;
          if (y3 === 1 && Number.isFinite(cap3)) {
            expect(off3, 'numeric yellow cap forces lateral offset 0').toBe(0);
            numberTicks++;
          }
          if (y2 === 1 && Number.isNaN(cap2) && blocker) {
            expect(off2, 'NaN yellow cap keeps the traffic offset (steer around)').not.toBe(0);
            nanSeen = true;
          }
        }
        expect(numberTicks, 'ticks with a numeric yellow cap').toBeGreaterThan(0);
        expect(nanSeen, 'a blocked tick under yellow with NaN cap was seen').toBe(true);
      } finally {
        game.dispose();
      }
    },
    240000,
  );

  it(
    'EDGE7: under an active VSC the yellow cap joins the 0.6 pace cap as a minimum, NaN keeps it',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig(3));
      try {
        stepToGo(game);
        for (let i = 0; i < steps(5.5); i++) game.step(IDLE);
        game.debugStopCar(1);
        const g = internals(game);
        let numericTicks = 0;
        let keptVscTicks = 0;
        for (let t = 0; t < steps(60); t++) {
          game.step(IDLE);
          if (game.vsc.phase === 'off') continue;
          for (let i = 0; i < g.traffic.length; i++) {
            if (g.yellow[i] !== 1) continue;
            const yCap = oracle(g, i);
            const vscCap = 0.6 * g.speeds[g.indices[i]];
            const expected = Number.isFinite(yCap) ? Math.min(vscCap, yCap) : vscCap;
            expect(g.ruleCap[i], `ruleCap of car ${i}`).toBeCloseTo(expected, 6);
            if (Number.isFinite(yCap)) numericTicks++;
            else keptVscTicks++;
          }
        }
        expect(numericTicks, 'ticks where the yellow cap joined the VSC min').toBeGreaterThan(0);
        expect(keptVscTicks, 'ticks where a NaN yellow cap kept the VSC cap').toBeGreaterThan(0);
      } finally {
        game.dispose();
      }
    },
    240000,
  );
});
