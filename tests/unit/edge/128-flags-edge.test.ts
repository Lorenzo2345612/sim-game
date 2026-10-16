import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar } from '../../../src/race/flags';

const BOUNDS: [number, number, number] = [0, 500, 1000];
const LAPS = 1500;

function car(distance: number, lapDistance: number, speed: number, offTrack = false, retired = false): FlagCar {
  return { distance, lapDistance, speed, offTrack, retired };
}

describe('128 flags edge cases', () => {
  it('EDGE1: invalid sector and unknown car index throw RangeError', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, 60), car(200, 200, 60)], 0);
    expect(() => flags.sectorFlag(0)).toThrow(RangeError);
    expect(() => flags.sectorFlag(4)).toThrow(RangeError);
    expect(() => flags.sectorFlag(-1)).toThrow(RangeError);
    expect(() => flags.blueFor(-1)).toThrow(RangeError);
    expect(() => flags.blueFor(2)).toThrow(RangeError);
    expect(() => flags.blueFor(0)).not.toThrow();
    expect(() => flags.blueFor(1)).not.toThrow();
  });

  it('EDGE2: a car with any non-finite field is ignored entirely', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, Number.NaN, true)], 0);
    flags.update([car(100, 100, Number.NaN, true)], 1.5);
    expect(flags.sectorFlag(1)).toBe('green');

    flags.update([car(Number.POSITIVE_INFINITY, 100, 0, true)], 2);
    flags.update([car(Number.POSITIVE_INFINITY, 100, 0, true)], 3.5);
    expect(flags.sectorFlag(1)).toBe('green');

    flags.update([car(100, 100, 0, true, false), car(1000, 600, 60), car(4000, Number.NaN, 60)], 4);
    expect(flags.blueFor(1)).toBe(false);
  });

  it('EDGE3: overtakeUnderYellow drains — entries are returned once', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(10, 10, 0, true);
    flags.update([car(100, 100, 60), car(200, 200, 30), cause], 0);
    flags.update([car(160, 160, 60), car(230, 230, 30), cause], 1);
    flags.update([car(220, 220, 60), car(260, 260, 30), cause], 2);
    flags.update([car(310, 310, 60), car(305, 305, 30), cause], 3.5);
    expect(flags.overtakeUnderYellow()).toEqual([{ car: 0, passed: 1 }]);
    expect(flags.overtakeUnderYellow()).toEqual([]);
  });

  it('EDGE4: blueFor is false for a retired X and ignores a retired Y', () => {
    const x = car(200, 200, 60);
    const y = car(1700, 100, 60);
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([x, y], 1);
    expect(flags.blueFor(0)).toBe(true);

    const retiredX = new FlagState(BOUNDS, LAPS);
    retiredX.update([{ ...x, retired: true }, y], 1);
    expect(retiredX.blueFor(0)).toBe(false);

    const retiredY = new FlagState(BOUNDS, LAPS);
    retiredY.update([x, { ...y, retired: true }], 1);
    expect(retiredY.blueFor(0)).toBe(false);
  });

  it('EDGE5: a retired car stopped off track still raises yellow in its sector', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stopped = car(600, 600, 0, true, true);
    flags.update([stopped], 0);
    flags.update([stopped], 1.5);
    expect(flags.sectorFlag(1)).toBe('green');
    expect(flags.sectorFlag(2)).toBe('yellow');
    expect(flags.sectorFlag(3)).toBe('green');
  });

  it('EDGE6: blueFor uses mod lapDistance, wrapping across the start line', () => {
    const x = car(5100, 100, 60);
    const yNear = car(14950, 4950, 60);
    const yFar = car(14950, 4700, 60);
    const behind = new FlagState([0, 1700, 3400], 5000);
    behind.update([x, yNear], 1);
    expect(behind.blueFor(0)).toBe(true);
    const far = new FlagState([0, 1700, 3400], 5000);
    far.update([x, yFar], 1);
    expect(far.blueFor(0)).toBe(false);
  });

  it('EDGE7: blueFor boundaries — lapLength/2 strict, 200 m inclusive', () => {
    const x = car(1000, 600, 60);
    const exactHalf = car(3500, 400, 60);
    const halfPlus = car(3510, 400, 60);
    const behind201 = car(3510, 399, 60);

    const atHalf = new FlagState([0, 1700, 3400], 5000);
    atHalf.update([x, exactHalf], 1);
    expect(atHalf.blueFor(0)).toBe(false);

    const overHalf = new FlagState([0, 1700, 3400], 5000);
    overHalf.update([x, halfPlus], 1);
    expect(overHalf.blueFor(0)).toBe(true);

    const gap200 = new FlagState([0, 1700, 3400], 5000);
    gap200.update([x, halfPlus], 1);
    expect(gap200.blueFor(0)).toBe(true);

    const gap201 = new FlagState([0, 1700, 3400], 5000);
    gap201.update([x, behind201], 1);
    expect(gap201.blueFor(0)).toBe(false);
  });

  it('EDGE8: thresholds inclusive at 1 s and 3 s, 2 s decay strict', () => {
    const stoppedOff = car(100, 100, 0, true);
    const atOne = new FlagState(BOUNDS, LAPS);
    atOne.update([stoppedOff], 0);
    atOne.update([stoppedOff], 1);
    expect(atOne.sectorFlag(1)).toBe('yellow');

    const underOne = new FlagState(BOUNDS, LAPS);
    underOne.update([stoppedOff], 0);
    underOne.update([stoppedOff], 0.9);
    expect(underOne.sectorFlag(1)).toBe('green');

    const stoppedOn = car(100, 100, 0);
    const atThree = new FlagState(BOUNDS, LAPS);
    for (const t of [0, 1, 2, 3]) atThree.update([stoppedOn], t);
    expect(atThree.sectorFlag(1)).toBe('double-yellow');

    const underThree = new FlagState(BOUNDS, LAPS);
    for (const t of [0, 1, 2, 2.9]) underThree.update([stoppedOn], t);
    expect(underThree.sectorFlag(1)).toBe('yellow');

    const decay = new FlagState(BOUNDS, LAPS);
    for (const t of [0, 0.5, 1, 1.5, 2]) decay.update([stoppedOff], t);
    decay.update([car(100, 100, 60)], 4);
    expect(decay.sectorFlag(1)).toBe('green');
  });

  it('EDGE9: a gap below the threshold resets the continuous cause timer', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    flags.update([car(100, 100, 0, true)], 0);
    flags.update([car(100, 100, 60)], 0.6);
    flags.update([car(100, 100, 0, true)], 1);
    flags.update([car(100, 100, 0, true)], 1.5);
    expect(flags.sectorFlag(1)).toBe('green');
    flags.update([car(100, 100, 0, true)], 2);
    expect(flags.sectorFlag(1)).toBe('yellow');
  });

  it('EDGE10: sector is the last bound <= lapDistance', () => {
    const atBound = car(500, 500, 0, true);
    const s2 = new FlagState(BOUNDS, LAPS);
    s2.update([atBound], 0);
    s2.update([atBound], 1);
    expect(s2.sectorFlag(1)).toBe('green');
    expect(s2.sectorFlag(2)).toBe('yellow');

    const underBound = car(499, 499, 0, true);
    const s1 = new FlagState(BOUNDS, LAPS);
    s1.update([underBound], 0);
    s1.update([underBound], 1);
    expect(s1.sectorFlag(1)).toBe('yellow');
    expect(s1.sectorFlag(2)).toBe('green');

    const atLast = car(1000, 1000, 0, true);
    const s3 = new FlagState(BOUNDS, LAPS);
    s3.update([atLast], 0);
    s3.update([atLast], 1);
    expect(s3.sectorFlag(2)).toBe('green');
    expect(s3.sectorFlag(3)).toBe('yellow');
  });
});
