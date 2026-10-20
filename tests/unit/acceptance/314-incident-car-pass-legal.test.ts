import { describe, it, expect } from 'vitest';
import { FlagState, type FlagCar, type FlagOptions } from '../../../src/race/flags';

const DT = 1 / 120;

function car(lapDistance: number, speed: number, offTrack = false, spinning = false): FlagCar {
  return { distance: lapDistance, lapDistance, speed, offTrack, retired: false, spinning };
}

function make(options?: FlagOptions): FlagState {
  return new FlagState([0, 1000, 2000], 3000, options);
}

function offTrackScenario(k: number): FlagCar[] {
  const t = k * DT;
  const c0 = t < 2 ? car(500, 0, true) : car(500 + 20 * (t - 2), 20);
  return [c0, car(410 + 40 * t, 40)];
}

describe('314 incident car pass legal acceptance', () => {
  it('AT1: spinning car is an incident car from t = 0 and turns sector 1 yellow after 1 s', () => {
    const flags = make();
    for (let k = 0; k <= 144; k++) {
      flags.update([car(500, 15, false, true), car(300, 40)], k * DT);
      if (k === 0) expect(flags.isIncidentCar(0)).toBe(true);
      if (k === 132) expect(flags.sectorFlag(1)).toBe('yellow');
      expect(flags.isIncidentCar(1)).toBe(false);
    }
    expect(flags.isIncidentCar(0)).toBe(true);
  });

  it('AT2: passing the recovered incident car is reported and the car is still an incident car', () => {
    const flags = make();
    const reports: { car: number; passed: number; k: number }[] = [];
    for (let k = 0; k <= 312; k++) {
      flags.update(offTrackScenario(k), k * DT);
      for (const r of flags.overtakeUnderYellow()) reports.push({ ...r, k });
      if (k === 300) expect(flags.isIncidentCar(0)).toBe(true);
    }
    const hit = reports.filter((r) => r.car === 1 && r.passed === 0);
    expect(hit.length).toBe(1);
    expect(hit[0].k * DT).toBeCloseTo(2.5, 1);
  });

  it('AT3: sector 1 is green and the car is no longer an incident car at t = 4.1', () => {
    const flags = make();
    for (let k = 0; k <= 540; k++) {
      flags.update(offTrackScenario(k), k * DT);
      if (k >= 492) expect(flags.isIncidentCar(0)).toBe(false);
      if (k === 492) expect(flags.sectorFlag(1)).toBe('green');
    }
  });

  it('AT4: with decayS 3 sector 1 is yellow at 4.9 and green at 5.1', () => {
    const flags = make({ decayS: 3 });
    for (let k = 0; k <= 624; k++) {
      flags.update(offTrackScenario(k), k * DT);
      if (k === 588) expect(flags.sectorFlag(1)).toBe('yellow');
      if (k === 612) expect(flags.sectorFlag(1)).toBe('green');
    }
  });

  it('AT5: without spinning or decayS the 128 scenario keeps yellow at t + 1.9 and green at t + 2.1', () => {
    const flags = new FlagState([0, 500, 1000], 1500);
    const stopped: FlagCar = { distance: 100, lapDistance: 100, speed: 0, offTrack: true, retired: false };
    const running: FlagCar = { distance: 100, lapDistance: 100, speed: 60, offTrack: false, retired: false };
    for (const t of [0, 0.5, 1, 1.5, 2]) flags.update([stopped], t);
    flags.update([running], 3.9);
    expect(flags.sectorFlag(1)).toBe('yellow');
    flags.update([running], 4.1);
    expect(flags.sectorFlag(1)).toBe('green');
  });
});
