import { describe, expect, it } from 'vitest';
import { qualiSessionResult, raceSessionResult } from '../../../src/career/sessionResult';
import type { Standing } from '../../../src/race/classification';
import type { QualiStanding } from '../../../src/race/qualifying';

function standing(p: Partial<Standing> & { car: number; position: number }): Standing {
  return {
    lap: 0,
    distance: 0,
    finished: false,
    totalTime: null,
    penalty: 0,
    gapToLeader: null,
    lastLap: null,
    bestLap: null,
    ...p,
  };
}

describe('279 session result adapters acceptance', () => {
  it('AT1: 3 standings (car 2 p1, car 0 p2 finished, car 1 lap 9 unfinished, laps 10) — order [2,0,1], classified [true,false,true], fastestLapCar 0', () => {
    const st: readonly Standing[] = [
      standing({ car: 0, position: 2, lap: 10, finished: true, bestLap: 60.5 }),
      standing({ car: 1, position: 3, lap: 9, finished: false, bestLap: 59 }),
      standing({ car: 2, position: 1, lap: 10, finished: true, bestLap: 61 }),
    ];
    const r = raceSessionResult(st, 10);
    expect(r.order).toEqual([2, 0, 1]);
    expect(r.classified).toEqual([true, false, true]);
    expect(r.fastestLapCar).toBe(0);
  });

  it('AT2: car 1 with lap 10 of 10 (9 completed) unfinished is classified', () => {
    const st: readonly Standing[] = [
      standing({ car: 0, position: 1, lap: 10, finished: true, bestLap: 60 }),
      standing({ car: 1, position: 2, lap: 10, finished: false, bestLap: 61 }),
    ];
    const r = raceSessionResult(st, 10);
    expect(r.classified[1]).toBe(true);
  });

  it('AT3: nobody classified — fastestLapCar null', () => {
    const st: readonly Standing[] = [
      standing({ car: 0, position: 1, lap: 5, finished: false, bestLap: 60 }),
      standing({ car: 1, position: 2, lap: 5, finished: false, bestLap: 59 }),
    ];
    const r = raceSessionResult(st, 10);
    expect(r.fastestLapCar).toBeNull();
  });

  it('AT4: quali standings car 1 p1 best 80, car 0 p2 null best — order [1,0], bestLaps [null,80], classified [true,true], fastestLapCar null', () => {
    const st: readonly QualiStanding[] = [
      { car: 0, position: 2, bestLap: null, laps: 0, lastLap: null, lastValid: null, done: false },
      { car: 1, position: 1, bestLap: 80, laps: 3, lastLap: 80.4, lastValid: true, done: true },
    ];
    const r = qualiSessionResult(st);
    expect(r.order).toEqual([1, 0]);
    expect(r.bestLaps).toEqual([null, 80]);
    expect(r.classified).toEqual([true, true]);
    expect(r.fastestLapCar).toBeNull();
  });
});
