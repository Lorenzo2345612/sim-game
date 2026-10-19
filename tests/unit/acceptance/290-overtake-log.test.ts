import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { FIXED_DT } from '../../../src/core/constants';
import type { DriverInput, TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec, type CarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { OvertakeLog, type OvertakeCar } from '../../../src/race/overtakeLog';

const ROOT = join(__dirname, '..', '..', '..');
const IDLE: DriverInput = { throttle: 0, brake: 0, steer: 0, reset: false };

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

function loadTrack(): TrackDataV2 {
  return parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
}

function loadSpec(): CarSpec {
  return parseCarSpec(readJson('public/cars/f4.json'));
}

function raceConfig(): RaceConfig {
  return { trackId: 'monza', carId: 'f4', laps: 3, aiCount: 3, difficulty: 'medium', seed: 1 };
}

function steps(seconds: number): number {
  return Math.round(seconds / FIXED_DT);
}

/** Step until the start lights clear (go); returns the sim time of the go tick. */
function stepToGo(game: RaceGame): number {
  let sawLights = false;
  for (let i = 0; i < steps(20); i++) {
    game.step(IDLE);
    const lights = game.startLights();
    if (lights > 0) sawLights = true;
    else if (sawLights) return game.simTime;
  }
  throw new Error('start lights never cleared');
}

// Base: 2 cars stepped at t = k·0.1 s (k = 0…60). Car 0 ahead from t = 2.1.
function car(dist: number, speed: number, position: number, over: Partial<OvertakeCar> = {}): OvertakeCar {
  return { dist, lapDist: dist, lap: 1, speed, running: true, position, lastContact: -1e9, ...over };
}

function basePair(t: number): OvertakeCar[] {
  const d0 = 100 + 30 * t;
  const d1 = 110 + 25 * t;
  return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
}

function stepBase(log: OvertakeLog, pair: (t: number) => OvertakeCar[]): void {
  for (let k = 0; k <= 60; k++) log.step(k / 10, pair(k / 10));
}

describe('290 overtake log acceptance', () => {
  it("AT1: car 0 overtakes car 1 — one clean event at t = 3.1, lapDistance 193", () => {
    const log = new OvertakeLog(2);
    stepBase(log, basePair);
    expect(log.events.length).toBe(1);
    const e = log.events[0];
    expect(e.passer).toBe(0);
    expect(e.passed).toBe(1);
    expect(e.kind).toBe('clean');
    expect(e.position).toBe(1);
    expect(e.lap).toBe(1);
    expect(e.t).toBeCloseTo(3.1, 6);
    expect(e.lapDistance).toBeCloseTo(193, 6);
  });

  it('AT2: the order reverts at t = 2.6 before the hold completes — no events', () => {
    const log = new OvertakeLog(2);
    stepBase(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = t >= 2.6 ? d0 + 1 : 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
    });
    expect(log.events.length).toBe(0);
  });

  it("AT3: the passed car's last contact (1.5) is inside the window at flip — kind 'contact'", () => {
    const log = new OvertakeLog(2);
    stepBase(log, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, lastContact: 1.5 }];
    });
    expect(log.events.length).toBe(1);
    expect(log.events[0].kind).toBe('contact');
  });

  it("AT4: the passed car's last contact (−1) is outside the 3 s window — kind 'clean'", () => {
    const log = new OvertakeLog(2);
    stepBase(log, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, lastContact: -1 }];
    });
    expect(log.events.length).toBe(1);
    expect(log.events[0].kind).toBe('clean');
  });

  it("AT5: the passed car slow (< 0.8×), not running, or crawling (< 2 m/s) — kind 'gift'", () => {
    const gift = new OvertakeLog(2);
    stepBase(gift, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, speed: 20 }];
    });
    expect(gift.events.length).toBe(1);
    expect(gift.events[0].kind).toBe('gift');

    const stopped = new OvertakeLog(2);
    stepBase(stopped, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, running: false }];
    });
    expect(stopped.events.length).toBe(1);
    expect(stopped.events[0].kind).toBe('gift');

    const crawl = new OvertakeLog(2);
    stepBase(crawl, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, speed: 1.5 }];
    });
    expect(crawl.events.length).toBe(1);
    expect(crawl.events[0].kind).toBe('gift');
  });

  it('AT6: summary counts passes by kind for the passer and lost for the passed', () => {
    const log = new OvertakeLog(2);
    stepBase(log, basePair);
    expect(log.summary(0)).toEqual({ clean: 1, contact: 0, gift: 0, lost: 0 });
    expect(log.summary(1)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 1 });
  });

  it('AT7: the pass jumps 30 m ahead (gap > 20 m) — silent re-order, no events', () => {
    const log = new OvertakeLog(2);
    stepBase(log, (t) => {
      const d0 = t >= 1 ? 140 + 25 * t : 100 + 30 * t;
      const d1 = 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
    });
    expect(log.events.length).toBe(0);
  });

  it(
    'AT8: Monza race — grid 4/1/2/3; stopping car 1 yields gift passes by cars 2 and 3 only',
    async () => {
      const game = await RaceGame.create(loadTrack(), loadSpec(), raceConfig());
      try {
        expect(game.gridPosition(0)).toBe(4);
        expect(game.gridPosition(1)).toBe(1);
        expect(game.gridPosition(2)).toBe(2);
        expect(game.gridPosition(3)).toBe(3);
        const goTime = stepToGo(game);
        while (game.simTime < goTime + 5) game.step(IDLE);
        game.debugStopCar(1);
        while (game.simTime < goTime + 60) game.step(IDLE);
        const events = game.overtakes.events;
        const past = events.filter((e) => e.passed === 1);
        expect(past.length, 'events with passed 1').toBeGreaterThanOrEqual(2);
        for (const e of past) {
          expect(e.kind).toBe('gift');
          expect([2, 3]).toContain(e.passer);
        }
        for (const other of [2, 3]) {
          const pair = events.filter(
            (e) => (e.passer === other && e.passed === 1) || (e.passer === 1 && e.passed === other),
          );
          expect(pair.length, `events between car ${other} and car 1`).toBeGreaterThan(0);
          expect(pair[pair.length - 1].passed, `last pair event for car ${other}`).toBe(1);
        }
        for (let i = 1; i < events.length; i++) {
          expect(events[i].t).toBeGreaterThanOrEqual(events[i - 1].t);
        }
      } finally {
        game.dispose();
      }
    },
    300000,
  );
});
