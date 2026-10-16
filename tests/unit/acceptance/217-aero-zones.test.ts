import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cumulativeLengths } from '../../../src/track/centerline';
import { deriveAeroZones, inAeroZone } from '../../../src/track/aeroZones';

const ROOT = join(__dirname, '..', '..', '..');

const STADIUM_R = 200;
const STADIUM_STRAIGHT = 1000;
const STADIUM_L = 2 * STADIUM_STRAIGHT + 2 * Math.PI * STADIUM_R;

function stadiumAt(s: number): [number, number] {
  const h = STADIUM_STRAIGHT / 2;
  const half = Math.PI * STADIUM_R;
  if (s < h) return [s, -STADIUM_R];
  if (s < h + half) {
    const a = -Math.PI / 2 + (s - h) / STADIUM_R;
    return [h + STADIUM_R * Math.cos(a), STADIUM_R * Math.sin(a)];
  }
  if (s < h + half + STADIUM_STRAIGHT) {
    return [h - (s - (h + half)), STADIUM_R];
  }
  if (s < h + 2 * half + STADIUM_STRAIGHT) {
    const a = Math.PI / 2 + (s - (h + half + STADIUM_STRAIGHT)) / STADIUM_R;
    return [-h + STADIUM_R * Math.cos(a), STADIUM_R * Math.sin(a)];
  }
  return [-h + (s - (h + 2 * half + STADIUM_STRAIGHT)), -STADIUM_R];
}

function stadiumCenterline(): [number, number][] {
  const n = Math.round(STADIUM_L / 2);
  const step = STADIUM_L / n;
  return Array.from({ length: n }, (_, i): [number, number] => stadiumAt(i * step));
}

function circleCenterline(r: number): [number, number][] {
  const n = Math.round((2 * Math.PI * r) / 2);
  return Array.from({ length: n }, (_, i): [number, number] => {
    const a = (i / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

function lapLength(centerline: [number, number][]): number {
  return cumulativeLengths(centerline, true)[centerline.length];
}

describe('217 aero zones acceptance', () => {
  it('AT1: stadium yields two zones on the straights; inAeroZone true at d=0 and d=L-1, false mid-semicircle', () => {
    const cl = stadiumCenterline();
    const cum = cumulativeLengths(cl, true);
    const L = cum[cl.length];
    const zones = deriveAeroZones(cl);
    expect(zones).toHaveLength(2);
    for (const z of zones) {
      const len = z.end - z.start;
      expect(len).toBeGreaterThanOrEqual(960);
      expect(len).toBeLessThanOrEqual(1000);
    }
    expect(inAeroZone(zones, 0, L)).toBe(true);
    expect(inAeroZone(zones, L - 1, L)).toBe(true);
    const step = L / cl.length;
    const half = Math.PI * STADIUM_R;
    const mids = [
      STADIUM_STRAIGHT / 2 + half / 2,
      STADIUM_STRAIGHT / 2 + half + STADIUM_STRAIGHT + half / 2,
    ];
    for (const s of mids) {
      const i = Math.round(s / step);
      expect(inAeroZone(zones, cum[i], L)).toBe(false);
    }
  });

  it('AT2: circle of R=150 m yields no zones', () => {
    expect(deriveAeroZones(circleCenterline(150))).toEqual([]);
  });

  it('AT3: circle of R=1000 m yields one zone {start 0, end L} within 1e-6', () => {
    const cl = circleCenterline(1000);
    const L = lapLength(cl);
    const zones = deriveAeroZones(cl);
    expect(zones).toHaveLength(1);
    expect(zones[0].start).toBeCloseTo(0, 6);
    expect(Math.abs(zones[0].end - L)).toBeLessThanOrEqual(1e-6);
  });

  it('AT4: monza centerline derives 4-6 zones covering 45-62% of the lap, each at least 300 m', () => {
    const track = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'monza.json'), 'utf8'),
    ) as { centerline: [number, number][] };
    const L = lapLength(track.centerline);
    const zones = deriveAeroZones(track.centerline);
    expect(zones.length).toBeGreaterThanOrEqual(4);
    expect(zones.length).toBeLessThanOrEqual(6);
    let total = 0;
    for (const z of zones) total += z.end - z.start;
    expect(total / L).toBeGreaterThanOrEqual(0.45);
    expect(total / L).toBeLessThanOrEqual(0.62);
    for (const z of zones) {
      expect(z.end - z.start).toBeGreaterThanOrEqual(300);
    }
  });

  it('AT5: every track in public/tracks/index.json derives >= 1 sorted, non-overlapping zone within [0, L]', () => {
    const index = JSON.parse(
      readFileSync(join(ROOT, 'public', 'tracks', 'index.json'), 'utf8'),
    ) as Array<{ id: string }>;
    expect(index.length).toBeGreaterThan(0);
    for (const { id } of index) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as { centerline: [number, number][] };
      const L = lapLength(track.centerline);
      const zones = deriveAeroZones(track.centerline);
      expect(zones.length, `${id}: zone count`).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < zones.length; i++) {
        const z = zones[i];
        expect(z.start, `${id} zone ${i}: start >= 0`).toBeGreaterThanOrEqual(0);
        expect(z.start, `${id} zone ${i}: start < L`).toBeLessThan(L);
        expect(z.end, `${id} zone ${i}: end <= start + L`).toBeLessThanOrEqual(z.start + L);
        if (i > 0) {
          expect(z.start, `${id} zone ${i}: sorted`).toBeGreaterThanOrEqual(zones[i - 1].start);
          expect(zones[i - 1].end, `${id} zone ${i}: non-overlapping`).toBeLessThanOrEqual(z.start);
        }
      }
    }
  });

  it('AT6: inAeroZone wraps d modulo L with inclusive boundaries', () => {
    const zones = [{ start: 900, end: 1100 }];
    const L = 1000;
    const cases: Array<[number, boolean]> = [
      [950, true],
      [50, true],
      [100, true],
      [101, false],
      [500, false],
      [-50, true],
      [2050, true],
    ];
    for (const [d, expected] of cases) {
      expect(inAeroZone(zones, d, L), `d=${d}`).toBe(expected);
    }
  });

  it('AT7: src/track/aeroZones.ts has no three import', () => {
    const src = readFileSync(join(ROOT, 'src', 'track', 'aeroZones.ts'), 'utf8');
    expect(src).not.toMatch(/from\s*['"]three['"]/);
    expect(src).not.toMatch(/import\s+['"]three['"]/);
    expect(src).not.toMatch(/require\s*\(\s*['"]three['"]\s*\)/);
  });
});
