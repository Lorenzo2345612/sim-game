import { describe, expect, it } from 'vitest';
import { Racecraft } from '../../../src/ai/racecraft';
import type { CarView, Neighbour, PlanBias, TrackCorridor } from '../../../src/ai/raceView';

const EPS = 1e-9;
const DT = 0.1;
const AGG = 0.7;

function fixtureC(): TrackCorridor {
  const lapLength = 2000;
  const ds = 2;
  const n = Math.ceil(lapLength / ds);
  const halfLeft = new Float64Array(n).fill(6);
  const halfRight = new Float64Array(n).fill(6);
  const lineD = new Float64Array(n);
  const curv = new Float64Array(n);
  const profileV = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const s = k * ds;
    if (s >= 580 && s <= 620) curv[k] = 0.02;
    if (s <= 500) profileV[k] = 60;
    else if (s < 600) profileV[k] = 60 + ((20 - 60) * (s - 500)) / 100;
    else if (s < 700) profileV[k] = 20 + ((60 - 20) * (s - 600)) / 100;
    else profileV[k] = 60;
  }
  return { lapLength, ds, halfLeft, halfRight, lineD, profileV, curv };
}

function car(s: number, v: number, d = 0, stopped = false, offTrack = false): CarView {
  return { s, d, v, halfLen: 2, halfWid: 0.9, stopped, offTrack };
}

function nb(selfS: number, gap: number, v: number, d = 0, stopped = false): Neighbour {
  return { car: car(selfS + gap, v, d, stopped), gap };
}

function bias(): PlanBias {
  return { preferD: null, preferWeight: 0, speedCap: null };
}

function dist(a: number | null, b: number): number {
  return a === null ? Number.POSITIVE_INFINITY : Math.abs(a - b);
}

describe('260 racecraft intents acceptance', () => {
  it('AT1: a close slower car ahead starts attack with preferD 4.5, weight 1.9, no speedCap', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const intent = rc.update(car(300, 55), [nb(300, 20, 50)], DT, out);
    expect(intent).toBe('attack');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(out.preferWeight - 1.9)).toBeLessThanOrEqual(EPS);
    expect(out.speedCap).toBeNull();
  });

  it('AT2: a 1.09 s time gap ahead keeps follow with preferD null', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const intent = rc.update(car(300, 55), [nb(300, 60, 50)], DT, out);
    expect(intent).toBe('follow');
    expect(out.preferD).toBeNull();
  });

  it('AT3: gap 30 without the profile edge follows, gap 14 attacks', () => {
    const a = new Racecraft(fixtureC(), AGG);
    const follow = a.update(car(300, 55), [nb(300, 30, 59.8)], DT, bias());
    expect(follow).toBe('follow');
    const b = new Racecraft(fixtureC(), AGG);
    const attack = b.update(car(300, 55), [nb(300, 14, 59.8)], DT, bias());
    expect(attack).toBe('attack');
  });

  it('AT4: no fresh attack inside 30 m of braking; a running attack keeps preferD', () => {
    const C = fixtureC();
    const fresh = new Racecraft(C, AGG);
    const first = fresh.update(car(495, 55), [nb(495, 20, 50)], DT, bias());
    expect(first).toBe('follow');

    const rc = new Racecraft(C, AGG);
    const out = bias();
    const self = car(300, 55);
    const ahead = [nb(300, 20, 50)];
    for (let i = 0; i < 6; i++) rc.update(self, ahead, DT, out);
    const held = rc.update(car(495, 55), [nb(495, 20, 50)], DT, out);
    expect(held).toBe('attack');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
  });

  it('AT5: a close faster car behind starts defend with preferD 4.5 and weight 1.5', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const intent = rc.update(car(300, 55), [nb(300, -20, 58)], DT, out);
    expect(intent).toBe('defend');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
    expect(Math.abs(out.preferWeight - 1.5)).toBeLessThanOrEqual(EPS);
  });

  it('AT6: one defend move per straight: blocked at s 420, a new move past the minimum', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    let intent = rc.update(car(300, 55), [nb(300, -20, 58)], DT, out);
    expect(intent).toBe('defend');
    for (let i = 0; i < 10; i++) intent = rc.update(car(300, 55), [], DT, out);
    expect(intent).toBe('follow');
    intent = rc.update(car(420, 55), [nb(420, -20, 58)], DT, out);
    expect(intent).toBe('follow');
    expect(out.preferD).toBeNull();
    for (const s of [550, 590, 600]) rc.update(car(s, 55), [nb(s, -20, 58)], DT, out);
    intent = rc.update(car(610, 55), [nb(610, -20, 58)], DT, out);
    expect(intent).toBe('follow');
    intent = rc.update(car(700, 55), [nb(700, -20, 58)], DT, out);
    expect(intent).toBe('follow');
    intent = rc.update(car(300, 55), [nb(300, -20, 58)], DT, out);
    expect(intent).toBe('defend');
  });

  it('AT7: off-track self rejoins to clamped preferD 4.5 with speedCap 12', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const intent = rc.update(car(100, 20, 7, false, true), [], DT, out);
    expect(intent).toBe('rejoin');
    expect(dist(out.preferD, 4.5)).toBeLessThanOrEqual(EPS);
    expect(out.speedCap).toBe(12);
  });

  it('AT8: rejoin speedCap is 0 for a neighbour in the rejoin lane, 12 outside it', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const self = car(100, 20, 7, false, true);
    const first = rc.update(self, [nb(100, -40, 50, 4)], DT, out);
    expect(first).toBe('rejoin');
    expect(out.speedCap).toBe(0);
    const second = rc.update(self, [nb(100, -40, 50, -4)], DT, out);
    expect(second).toBe('rejoin');
    expect(out.speedCap).toBe(12);
  });

  it('AT9: a stopped on-track car rejoins', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const intent = rc.update(car(300, 0, 0, true), [], DT, bias());
    expect(intent).toBe('rejoin');
  });

  it('AT10: attack holds at 0.4 s without conditions and falls back to follow by 0.6 s', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const out = bias();
    const self = car(300, 55);
    const ahead = [nb(300, 20, 50)];
    const empty: Neighbour[] = [];
    expect(rc.update(self, ahead, DT, out)).toBe('attack');
    rc.update(self, ahead, DT, out);
    rc.update(self, empty, DT, out);
    rc.update(self, empty, DT, out);
    expect(rc.update(self, empty, DT, out)).toBe('attack');
    rc.update(self, empty, DT, out);
    expect(rc.update(self, empty, DT, out)).toBe('follow');
  });

  it('AT11: a stopped car ahead is not attacked', () => {
    const rc = new Racecraft(fixtureC(), AGG);
    const intent = rc.update(car(300, 55), [nb(300, 20, 50, 0, true)], DT, bias());
    expect(intent).not.toBe('attack');
  });

  it('AT12: aggression 0.2 gives attack preferWeight 0.9', () => {
    const rc = new Racecraft(fixtureC(), 0.2);
    const out = bias();
    rc.update(car(300, 55), [nb(300, 20, 50)], DT, out);
    expect(Math.abs(out.preferWeight - 0.9)).toBeLessThanOrEqual(EPS);
  });
});
