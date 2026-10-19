import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { RaceGame, type RaceConfig } from '../../../src/game/raceGame';
import { parseCarSpec } from '../../../src/physics/carSpec';
import { parseTrackData } from '../../../src/track/parseTrackData';
import { OvertakeLog, type OvertakeCar } from '../../../src/race/overtakeLog';

const ROOT = join(__dirname, '..', '..', '..');

function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
}

const FLIP_T = 21 / 10;

function car(
  dist: number,
  speed: number,
  position: number,
  over: Partial<OvertakeCar> = {},
): OvertakeCar {
  return { dist, lapDist: dist, lap: 1, speed, running: true, position, lastContact: -1e9, ...over };
}

function basePair(t: number): OvertakeCar[] {
  const d0 = 100 + 30 * t;
  const d1 = 110 + 25 * t;
  return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
}

function stepAll(log: OvertakeLog, pair: (t: number) => OvertakeCar[]): void {
  for (let k = 0; k <= 60; k++) log.step(k / 10, pair(k / 10));
}

describe('290 overtake log edge', () => {
  it('EDGE1: a flip with a gap of exactly PASS_GAP_M commits; a gap of 20.1 m re-orders silently', () => {
    const exact = new OvertakeLog(2);
    stepAll(exact, (t) => {
      const d0 = 100 + 10 * t;
      const d1 = t >= 2 ? d0 - 20 : 200;
      return [car(d0, 10, d0 >= d1 ? 1 : 2), car(d1, 10, d1 >= d0 ? 1 : 2)];
    });
    expect(exact.events.length).toBe(1);
    expect(exact.events[0].passer).toBe(0);
    expect(exact.events[0].passed).toBe(1);
    expect(exact.events[0].kind).toBe('clean');
    expect(exact.events[0].t).toBeCloseTo(3, 6);
    expect(exact.events[0].lapDistance).toBeCloseTo(130, 6);

    const over = new OvertakeLog(2);
    stepAll(over, (t) => {
      const d0 = 100 + 10 * t;
      const d1 = t >= 2 ? d0 - 20.1 : 200;
      return [car(d0, 10, d0 >= d1 ? 1 : 2), car(d1, 10, d1 >= d0 ? 1 : 2)];
    });
    expect(over.events.length).toBe(0);
  });

  it("EDGE2: a recent contact does not override the gift classification", () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, speed: 20, lastContact: 1.5 }];
    });
    expect(log.events.length).toBe(1);
    expect(log.events[0].kind).toBe('gift');
  });

  it('EDGE3: a passed car at exactly PASS_REL_V x passer speed is clean; just below is a gift', () => {
    const atRel = new OvertakeLog(2);
    const rel = 0.8 * 30;
    stepAll(atRel, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, speed: rel }];
    });
    expect(atRel.events.length).toBe(1);
    expect(atRel.events[0].kind).toBe('clean');

    const belowRel = new OvertakeLog(2);
    stepAll(belowRel, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, speed: 0.8 * 30 - 0.01 }];
    });
    expect(belowRel.events.length).toBe(1);
    expect(belowRel.events[0].kind).toBe('gift');
  });

  it('EDGE4: a passed car at exactly PASS_MIN_V_MS with a slow passer is clean; below it is a gift', () => {
    const atMin = new OvertakeLog(2);
    stepAll(atMin, (t) => {
      const [a, b] = basePair(t);
      return [{ ...a, speed: 2 }, { ...b, speed: 2 }];
    });
    expect(atMin.events.length).toBe(1);
    expect(atMin.events[0].kind).toBe('clean');

    const belowMin = new OvertakeLog(2);
    stepAll(belowMin, (t) => {
      const [a, b] = basePair(t);
      return [{ ...a, speed: 2 }, { ...b, speed: 1.9 }];
    });
    expect(belowMin.events.length).toBe(1);
    expect(belowMin.events[0].kind).toBe('gift');
  });

  it('EDGE5: lastContact exactly at flipT minus CONTACT_WINDOW_S is contact; older is clean', () => {
    const atEdge = new OvertakeLog(2);
    stepAll(atEdge, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, lastContact: FLIP_T - 3 }];
    });
    expect(atEdge.events.length).toBe(1);
    expect(atEdge.events[0].kind).toBe('contact');

    const older = new OvertakeLog(2);
    stepAll(older, (t) => {
      const [a, b] = basePair(t);
      return [a, { ...b, lastContact: FLIP_T - 3 - 0.01 }];
    });
    expect(older.events.length).toBe(1);
    expect(older.events[0].kind).toBe('clean');
  });

  it("EDGE6: the passer's own recent contact also classifies the pass as contact", () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const [a, b] = basePair(t);
      return [{ ...a, lastContact: 1.5 }, b];
    });
    expect(log.events.length).toBe(1);
    expect(log.events[0].kind).toBe('contact');
  });

  it('EDGE7: an already-crossed order at the first step initialises silently and never fires', () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 95 + 25 * t;
      return [car(d0, 30, 1), car(d1, 25, 2)];
    });
    expect(log.events.length).toBe(0);
    expect(log.summary(0)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
    expect(log.summary(1)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
  });

  it('EDGE8: two cars at the same distance never flip (strict >)', () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const d = 100 + 25 * t;
      return [car(d, 25, 1), car(d, 25, 2)];
    });
    expect(log.events.length).toBe(0);
    expect(log.summary(1)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
  });

  it('EDGE9: a pending pass dropped by a reversion does not fire; the later pass commits once', () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = t >= 3 ? d0 - 1 : t >= 2.4 ? d0 + 1 : 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
    });
    expect(log.events.length).toBe(1);
    const e = log.events[0];
    expect(e.passer).toBe(0);
    expect(e.passed).toBe(1);
    expect(e.kind).toBe('clean');
    expect(e.t).toBeCloseTo(4, 6);
    expect(e.lapDistance).toBeCloseTo(220, 6);
    expect(log.summary(0)).toEqual({ clean: 1, contact: 0, gift: 0, lost: 0 });
    expect(log.summary(1)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 1 });
  });

  it(
    'EDGE10: gridPosition accepts 0..count-1 and throws RangeError outside',
    async () => {
      const track = parseTrackData(readJson('public/tracks/monza.json')) as TrackDataV2;
      const spec = parseCarSpec(readJson('public/cars/f4.json'));
      const config: RaceConfig = {
        trackId: 'monza',
        carId: 'f4',
        laps: 3,
        aiCount: 3,
        difficulty: 'medium',
        seed: 1,
      };
      const game = await RaceGame.create(track, spec, config);
      try {
        for (let i = 0; i <= 3; i++) {
          expect(game.gridPosition(i)).toBeGreaterThanOrEqual(1);
          expect(game.gridPosition(i)).toBeLessThanOrEqual(4);
        }
        expect(() => game.gridPosition(-1)).toThrow(RangeError);
        expect(() => game.gridPosition(4)).toThrow(RangeError);
      } finally {
        game.dispose();
      }
    },
    120000,
  );
});
