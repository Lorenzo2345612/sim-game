import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { limitGrade, smoothProfile } from '../../../tools/track-builder/elevation';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');

function loadTrack(id: string): TrackDataV2 {
  return JSON.parse(
    readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
  ) as TrackDataV2;
}

// Grade per closed-loop centerline segment (last -> first included); Y is horizontal here.
function segmentGrades(track: TrackDataV2): number[] {
  const cl = track.centerline;
  const el = track.elevation;
  const grades: number[] = [];
  for (let i = 0; i < cl.length; i++) {
    const j = (i + 1) % cl.length;
    const run = Math.hypot(cl[j][0] - cl[i][0], cl[j][1] - cl[i][1]);
    grades.push((el[j] - el[i]) / run);
  }
  return grades;
}

function maxAbsGrade(grades: number[]): number {
  let max = 0;
  for (const g of grades) {
    const a = Math.abs(g);
    if (a > max) max = a;
  }
  return max;
}

function closedLoopSine(length: number, spacing: number, wavelength: number, amplitude: number): number[] {
  return Array.from({ length }, (_, i) =>
    amplitude * Math.sin((2 * Math.PI * i * spacing) / wavelength));
}

function elevationRange(track: TrackDataV2): number {
  let min = Infinity;
  let max = -Infinity;
  for (const h of track.elevation) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return max - min;
}

describe('085 elevation profile smoothing acceptance', () => {
  it('AT1: smoothing a constant profile leaves it constant at 5', () => {
    const raw = new Array<number>(1000).fill(5);
    const out = smoothProfile(raw, 2, 60);
    expect(out).toHaveLength(1000);
    for (const v of out) {
      expect(Math.abs(v - 5)).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT2: a 60 m-wavelength sine is attenuated below 0.05 by a sigma-60 smoothing', () => {
    const raw = closedLoopSine(3000, 2, 60, 1);
    const out = smoothProfile(raw, 2, 60);
    expect(out).toHaveLength(3000);
    for (const v of out) {
      expect(Math.abs(v)).toBeLessThan(0.05);
    }
  });

  it('AT3: a 2000 m-wavelength sine keeps amplitude above 9 under sigma-60 smoothing', () => {
    const raw = closedLoopSine(3000, 2, 2000, 10);
    const out = smoothProfile(raw, 2, 60);
    expect(out).toHaveLength(3000);
    const amplitude = (Math.max(...out) - Math.min(...out)) / 2;
    expect(amplitude).toBeGreaterThan(9);
  });

  it('AT4: limitGrade clamps a 10 m step to 0.08 per segment on a closed loop and does not mutate the input', () => {
    const raw = new Array<number>(500);
    for (let i = 0; i < raw.length; i++) raw[i] = i < 250 ? 0 : 10;
    const snapshot = raw.slice();
    const out = limitGrade(raw, 2, 0.04);
    expect(out).toHaveLength(500);
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length;
      expect(Math.abs(out[j] - out[i])).toBeLessThanOrEqual(0.08 + 1e-9);
    }
    expect(raw).toStrictEqual(snapshot);
  });

  it('AT5: limitGrade returns an already-compliant profile unchanged', () => {
    // max |dh| = 2*sin(pi/100) ~ 0.0628 <= 0.04*2, compliant including last->first
    const raw = closedLoopSine(200, 2, 400, 1);
    const out = limitGrade(raw, 2, 0.04);
    expect(out).toHaveLength(200);
    for (let i = 0; i < out.length; i++) {
      expect(Math.abs(out[i] - raw[i])).toBeLessThanOrEqual(1e-9);
    }
  });

  it('AT6: regenerated monza and silverstone keep max grade <= 0.04 and monza <= 3 sign flips per km', () => {
    for (const id of ['monza', 'silverstone']) {
      const grades = segmentGrades(loadTrack(id));
      expect(maxAbsGrade(grades)).toBeLessThanOrEqual(0.04 + 1e-6);
    }
    const monza = loadTrack('monza');
    let flips = 0;
    let lastSign = 0;
    for (const g of segmentGrades(monza)) {
      if (Math.abs(g) < 0.002) continue;
      const sign = g > 0 ? 1 : -1;
      if (lastSign !== 0 && sign !== lastSign) flips++;
      lastSign = sign;
    }
    const km = monza.lengthMeters / 1000;
    expect(flips / km).toBeLessThanOrEqual(3);
  });

  it('AT7: regenerated spa keeps max grade <= 0.20 and elevation range 90-110 m', () => {
    const spa = loadTrack('spa');
    expect(maxAbsGrade(segmentGrades(spa))).toBeLessThanOrEqual(0.20);
    const range = elevationRange(spa);
    expect(range).toBeGreaterThanOrEqual(90);
    expect(range).toBeLessThanOrEqual(110);
  });
});
