import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar } from '../../../src/race/flags';

const BOUNDS: [number, number, number] = [0, 500, 1000];
const LAPS = 1500;

function car(distance: number, lapDistance: number, speed: number, offTrack = false, retired = false): FlagCar {
  return { distance, lapDistance, speed, offTrack, retired };
}

describe('128 flags post-code gaps', () => {
  it('GAP1: sectorFlag is green and blueFor throws before the first update', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    expect(flags.sectorFlag(1)).toBe('green');
    expect(flags.sectorFlag(2)).toBe('green');
    expect(flags.sectorFlag(3)).toBe('green');
    expect(() => flags.blueFor(0)).toThrow(RangeError);
  });

  it('GAP2: non-integer car index and non-integer sector throw RangeError', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, 60)], 0);
    expect(() => flags.blueFor(0.5)).toThrow(RangeError);
    expect(() => flags.sectorFlag(1.5)).toThrow(RangeError);
  });

  it('GAP3: non-finite or decreasing time is ignored and does not reset the cause timer', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, 0, true)], 0);
    flags.update([car(100, 100, 0, true)], 0.5);
    flags.update([car(100, 100, 60)], 0.4);
    flags.update([car(100, 100, Number.NaN)], Number.NaN);
    flags.update([car(100, 100, 0, true)], 1);
    expect(flags.sectorFlag(1)).toBe('yellow');
  });

  it('GAP4: equal-time updates are accepted', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, 0, true)], 0);
    flags.update([car(100, 100, 0, true)], 0);
    flags.update([car(100, 100, 0, true)], 1);
    expect(flags.sectorFlag(1)).toBe('yellow');
  });

  it('GAP5: double-yellow decays to yellow while the yellow window is still fresh', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stoppedOn = car(100, 100, 0);
    for (const t of [0, 1, 2, 3]) flags.update([stoppedOn], t);
    expect(flags.sectorFlag(1)).toBe('double-yellow');
    flags.update([car(100, 100, 0, true)], 3.5);
    flags.update([car(100, 100, 0, true)], 5);
    expect(flags.sectorFlag(1)).toBe('yellow');
    flags.update([car(100, 100, 60)], 7.5);
    expect(flags.sectorFlag(1)).toBe('green');
  });

  it('GAP6: a single large time delta still arms yellow and double-yellow', () => {
    const off = new FlagState(BOUNDS, LAPS);
    off.update([car(100, 100, 0, true)], 0);
    off.update([car(100, 100, 0, true)], 100);
    expect(off.sectorFlag(1)).toBe('yellow');

    const on = new FlagState(BOUNDS, LAPS);
    on.update([car(100, 100, 0)], 0);
    on.update([car(100, 100, 0)], 100);
    expect(on.sectorFlag(1)).toBe('double-yellow');
  });

  it('GAP7: a swap where either car currently sits in a green sector is not reported', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(600, 600, 0, true, true);
    flags.update([cause, car(400, 400, 60), car(700, 700, 60)], 0);
    flags.update([cause, car(400, 400, 60), car(700, 700, 60)], 1.5);
    flags.update([cause, car(700, 700, 60), car(450, 450, 60)], 2);
    expect(flags.sectorFlag(2)).toBe('yellow');
    expect(flags.overtakeUnderYellow()).toEqual([]);
  });

  it('GAP8: equal distances are not a swap', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(10, 10, 0, true);
    flags.update([car(100, 100, 60), car(100, 100, 30), cause], 0);
    flags.update([car(100, 100, 60), car(100, 100, 30), cause], 1.5);
    expect(flags.overtakeUnderYellow()).toEqual([]);
  });

  it('GAP9: multiple overtakes are ordered by overtaker index then passed index', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(10, 10, 0, true);
    flags.update([car(100, 100, 60), car(50, 50, 30), car(80, 80, 45), cause], 0);
    flags.update([car(100, 100, 60), car(50, 50, 30), car(80, 80, 45), cause], 1.5);
    flags.update([car(90, 90, 60), car(200, 200, 30), car(150, 150, 45), cause], 2);
    expect(flags.overtakeUnderYellow()).toEqual([
      { car: 1, passed: 0 },
      { car: 1, passed: 2 },
      { car: 2, passed: 0 },
    ]);
  });

  it('GAP10: a car-count change suppresses overtake detection across the boundary', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(10, 10, 0, true);
    flags.update([car(200, 200, 60), car(100, 100, 30), cause], 0);
    flags.update([car(200, 200, 60), car(100, 100, 30), cause], 1.5);
    flags.update([car(100, 100, 60), car(200, 200, 30), car(150, 150, 45), cause], 2);
    expect(flags.overtakeUnderYellow()).toEqual([]);
  });

  it('GAP11: shrinking the field makes stale indices unknown', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const x = car(200, 200, 60);
    const y = car(1700, 100, 60);
    flags.update([x, y], 1);
    expect(flags.blueFor(1)).toBe(false);
    flags.update([x], 2);
    expect(() => flags.blueFor(1)).toThrow(RangeError);
  });

  it('GAP12: update does not mutate the cars array or its entries', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cars = [car(100, 100, 0, true), car(200, 200, 60)];
    const snapshot = JSON.parse(JSON.stringify(cars));
    flags.update(cars, 0);
    flags.update(cars, 1.5);
    expect(cars).toEqual(snapshot);
  });

  it('GAP13: blueFor uses a stale-invalid Y skip but a valid same-lapDistance Y at behind 0 counts', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const x = car(100, 600, 60);
    const y = car(2600, 600, 60);
    flags.update([x, y], 1);
    expect(flags.blueFor(0)).toBe(true);
    expect(flags.blueFor(1)).toBe(false);
  });
});
