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

function car(
  dist: number,
  speed: number,
  position: number,
  over: Partial<OvertakeCar> = {},
): OvertakeCar {
  return { dist, lapDist: dist, lap: 1, speed, running: true, position, lastContact: -1e9, ...over };
}

function stepRange(log: OvertakeLog, pair: (t: number) => OvertakeCar[], kMax: number): void {
  for (let k = 0; k <= kMax; k++) log.step(k / 10, pair(k / 10));
}

function stepAll(log: OvertakeLog, pair: (t: number) => OvertakeCar[]): void {
  stepRange(log, pair, 60);
}

describe('290 overtake log post-code gaps', () => {
  it('POST1: three cars — each pair commits its own pass and summaries split by car', () => {
    const log = new OvertakeLog(3);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 105 + 28 * t;
      const d2 = 110 + 25 * t;
      const ahead = [d0, d1, d2];
      const order = [0, 1, 2].sort((a, b) => ahead[b] - ahead[a]);
      const pos = [0, 0, 0];
      for (let k = 0; k < 3; k++) pos[order[k]] = k + 1;
      return [car(d0, 30, pos[0]), car(d1, 28, pos[1]), car(d2, 25, pos[2])];
    });
    expect(log.events.length).toBe(3);
    expect(log.events.map((e) => [e.passer, e.passed, e.kind])).toEqual([
      [1, 2, 'clean'],
      [0, 2, 'clean'],
      [0, 1, 'clean'],
    ]);
    expect(log.events[0].t).toBeCloseTo(2.7, 6);
    expect(log.events[1].t).toBeCloseTo(3.1, 6);
    expect(log.events[2].t).toBeCloseTo(3.6, 6);
    expect(log.summary(0)).toEqual({ clean: 2, contact: 0, gift: 0, lost: 0 });
    expect(log.summary(1)).toEqual({ clean: 1, contact: 0, gift: 0, lost: 1 });
    expect(log.summary(2)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 2 });
  });

  it('POST2: a silent mid-race re-order of one pair does not disturb another pair pass', () => {
    const log = new OvertakeLog(3);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 110 + 25 * t;
      const d2 = t >= 1 ? d1 + 30 : 95 + 25 * t;
      const ahead = [d0, d1, d2];
      const order = [0, 1, 2].sort((a, b) => ahead[b] - ahead[a]);
      const pos = [0, 0, 0];
      for (let k = 0; k < 3; k++) pos[order[k]] = k + 1;
      return [car(d0, 30, pos[0]), car(d1, 25, pos[1]), car(d2, 25, pos[2])];
    });
    expect(log.events.length).toBe(1);
    const e = log.events[0];
    expect(e.passer).toBe(0);
    expect(e.passed).toBe(1);
    expect(e.kind).toBe('clean');
    expect(e.t).toBeCloseTo(3.1, 6);
    expect(log.summary(2)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
  });

  it('POST3: summary throws RangeError off-range or non-integer; n = 0 and n = 1 stay silent', () => {
    const log = new OvertakeLog(2);
    expect(() => log.summary(-1)).toThrow(RangeError);
    expect(() => log.summary(2)).toThrow(RangeError);
    expect(() => log.summary(1.5)).toThrow(RangeError);

    const empty = new OvertakeLog(0);
    empty.step(0, []);
    expect(empty.events.length).toBe(0);
    expect(() => empty.summary(0)).toThrow(RangeError);

    const single = new OvertakeLog(1);
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      single.step(t, [car(100 + 30 * t, 30, 1)]);
    }
    expect(single.events.length).toBe(0);
    expect(single.summary(0)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
  });

  it('POST4: a passed car at zero or negative speed is a gift', () => {
    const stopped = new OvertakeLog(2);
    stepAll(stopped, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 0, d1 >= d0 ? 1 : 2)];
    });
    expect(stopped.events.length).toBe(1);
    expect(stopped.events[0].kind).toBe('gift');

    const reversing = new OvertakeLog(2);
    stepAll(reversing, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, -5, d1 >= d0 ? 1 : 2)];
    });
    expect(reversing.events.length).toBe(1);
    expect(reversing.events[0].kind).toBe('gift');
  });

  it('POST5: the event carries the passer lap, lapDistance and position at commit, not at flip', () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = 110 + 25 * t;
      const late = t >= 3.1;
      const a = car(d0, 30, d0 >= d1 ? 1 : 2, late ? { lap: 3, lapDist: 55 } : {});
      const b = car(d1, 25, d1 >= d0 ? 1 : 2, late ? { lap: 2, lapDist: 400 } : {});
      return [a, b];
    });
    expect(log.events.length).toBe(1);
    const e = log.events[0];
    expect(e.passer).toBe(0);
    expect(e.t).toBeCloseTo(3.1, 6);
    expect(e.lap).toBe(3);
    expect(e.lapDistance).toBeCloseTo(55, 6);
    expect(e.position).toBe(1);
  });

  it('POST6: the gap growing past PASS_GAP_M during the hold still commits', () => {
    const log = new OvertakeLog(2);
    stepAll(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = t >= 2.5 ? d0 - 40 : 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
    });
    expect(log.events.length).toBe(1);
    const e = log.events[0];
    expect(e.passer).toBe(0);
    expect(e.kind).toBe('clean');
    expect(e.t).toBeCloseTo(3.1, 6);
  });

  it('POST7: a re-pass back fires a second event and both cars count a loss', () => {
    const log = new OvertakeLog(2);
    stepRange(log, (t) => {
      const d0 = 100 + 30 * t;
      const d1 = t >= 4 ? 210 + 40 * (t - 4) : 110 + 25 * t;
      return [car(d0, 30, d0 >= d1 ? 1 : 2), car(d1, 25, d1 >= d0 ? 1 : 2)];
    }, 80);
    expect(log.events.length).toBe(2);
    expect(log.events[0].passer).toBe(0);
    expect(log.events[0].passed).toBe(1);
    expect(log.events[0].t).toBeCloseTo(3.1, 6);
    expect(log.events[1].passer).toBe(1);
    expect(log.events[1].passed).toBe(0);
    expect(log.events[1].t).toBeCloseTo(6, 6);
    expect(log.events[1].kind).toBe('clean');
    expect(log.summary(0)).toEqual({ clean: 1, contact: 0, gift: 0, lost: 1 });
    expect(log.summary(1)).toEqual({ clean: 1, contact: 0, gift: 0, lost: 1 });
  });

  it(
    'POST8: a custom gridOrder maps gridPosition to start slots; the log starts empty',
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
        gridOrder: [3, 2, 1, 0],
      };
      const game = await RaceGame.create(track, spec, config);
      try {
        expect(game.gridPosition(0)).toBe(4);
        expect(game.gridPosition(1)).toBe(3);
        expect(game.gridPosition(2)).toBe(2);
        expect(game.gridPosition(3)).toBe(1);
        expect(game.overtakes.events.length).toBe(0);
        for (let i = 0; i < 4; i++) {
          expect(game.overtakes.summary(i)).toEqual({ clean: 0, contact: 0, gift: 0, lost: 0 });
        }
      } finally {
        game.dispose();
      }
    },
    120000,
  );
});
