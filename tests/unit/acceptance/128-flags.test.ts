import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar } from '../../../src/race/flags';

const BOUNDS: [number, number, number] = [0, 500, 1000];
const LAPS = 1500;

function car(distance: number, lapDistance: number, speed: number, offTrack = false): FlagCar {
  return { distance, lapDistance, speed, offTrack, retired: false };
}

describe('128 flags acceptance', () => {
  it('AT1: car stopped off track in sector 2 for 1.5 s shows yellow in s2 and green in s1 and s3', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stopped = car(600, 600, 0, true);
    for (const t of [0, 0.5, 1, 1.5]) flags.update([stopped], t);
    expect(flags.sectorFlag(1)).toBe('green');
    expect(flags.sectorFlag(2)).toBe('yellow');
    expect(flags.sectorFlag(3)).toBe('green');
  });

  it('AT2: car stopped on track for 3.5 s shows double-yellow', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stopped = car(100, 100, 0);
    for (const t of [0, 1, 2, 3, 3.5]) flags.update([stopped], t);
    expect(flags.sectorFlag(1)).toBe('double-yellow');
  });

  it('AT3: cause leaves at t, sector stays yellow at t + 1.9 and is green at t + 2.1', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const stopped = car(100, 100, 0, true);
    const running = car(100, 100, 60);
    for (const t of [0, 0.5, 1, 1.5, 2]) flags.update([stopped], t);
    flags.update([running], 3.9);
    expect(flags.sectorFlag(1)).toBe('yellow');
    flags.update([running], 4.1);
    expect(flags.sectorFlag(1)).toBe('green');
  });

  it('AT4: blue for X when Y laps within 200 m behind on track, not at 250 m behind', () => {
    const x = car(1150, 1150, 60);
    const y250 = car(5900, 900, 60);
    const y150 = car(5900, 1000, 60);
    const behind250 = new FlagState([0, 1700, 3400], 5000);
    behind250.update([x, y250], 1);
    expect(behind250.blueFor(0)).toBe(false);
    const behind150 = new FlagState([0, 1700, 3400], 5000);
    behind150.update([x, y150], 1);
    expect(behind150.blueFor(0)).toBe(true);
  });

  it('AT5: two running cars swapping order inside a yellow sector report one overtake entry', () => {
    const flags = new FlagState(BOUNDS, LAPS);
    const cause = car(10, 10, 0, true);
    flags.update([car(100, 100, 60), car(200, 200, 30), cause], 0);
    flags.update([car(160, 160, 60), car(230, 230, 30), cause], 1);
    flags.update([car(220, 220, 60), car(260, 260, 30), cause], 2);
    flags.update([car(310, 310, 60), car(305, 305, 30), cause], 3.5);
    expect(flags.sectorFlag(1)).toBe('yellow');
    expect(flags.overtakeUnderYellow()).toEqual([{ car: 0, passed: 1 }]);
  });
});
