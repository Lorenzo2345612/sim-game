import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar } from '../../src/race/flags';
import { OvertakeLog, type OvertakeCar } from '../../src/race/overtakeLog';

const BOUNDS: [number, number, number] = [0, 500, 1000];

function run(c: FlagCar, secs: number): FlagState {
  const f = new FlagState(BOUNDS, 1500);
  for (let t = 0; t <= secs + 1e-9; t += 0.5) f.update([c], t);
  return f;
}

describe('flags: running wide', () => {
  it('off track at 30 m/s for 3 s is no yellow cause', () => {
    const f = run({ distance: 600, lapDistance: 600, speed: 30, offTrack: true, retired: false }, 3);
    expect(f.sectorFlag(2)).toBe('green');
  });
  it('off track at 3 m/s is yellow', () => {
    const f = run({ distance: 600, lapDistance: 600, speed: 3, offTrack: true, retired: false }, 1.5);
    expect(f.sectorFlag(2)).toBe('yellow');
  });
  it('spinning at 30 m/s is yellow', () => {
    const f = run({ distance: 600, lapDistance: 600, speed: 30, offTrack: false, retired: false, spinning: true }, 1.5);
    expect(f.sectorFlag(2)).toBe('yellow');
  });
});

function oc(dist: number, speed: number, over: Partial<OvertakeCar> = {}): OvertakeCar {
  return { dist, lapDist: dist, lap: 1, speed, running: true, position: 1, lastContact: -1e9, ...over };
}

describe('overtake log: finish line', () => {
  it('running car passing a finished (frozen) car is a gift', () => {
    const log = new OvertakeLog(2);
    for (let k = 0; k <= 60; k++) {
      const t = k / 10;
      log.step(t, [oc(100 + 30 * t, 30), oc(200, 0, { running: false })]);
    }
    expect(log.events.length).toBe(1);
    expect(log.events[0].kind).toBe('gift');
  });
  it('non-running passer logs nothing', () => {
    const log = new OvertakeLog(2);
    for (let k = 0; k <= 60; k++) {
      const t = k / 10;
      log.step(t, [oc(100 + 30 * t, 30, { running: false }), oc(200, 25)]);
    }
    expect(log.events.length).toBe(0);
  });
});
