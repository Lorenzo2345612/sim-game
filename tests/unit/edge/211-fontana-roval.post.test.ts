import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

interface Roval {
  lengthMeters: number;
  centerline: [number, number][];
  bank: number[];
  elevation: number[];
  pit: { start: number; end: number; side: string };
  grandstands: { x: number; z: number; yaw: number; lengthMeters: number; rows: number; roof: boolean }[];
}

const t = JSON.parse(readFileSync(join(ROOT, 'public/tracks/fontana-roval.json'), 'utf8')) as Roval;
const n = t.centerline.length;

describe('fontana-roval built data', () => {
  it('POST1: bank and elevation have one finite value per centerline point', () => {
    expect(t.bank).toHaveLength(n);
    expect(t.elevation).toHaveLength(n);
    expect([...t.bank, ...t.elevation].every(Number.isFinite)).toBe(true);
  });

  it('POST2: all bank values are non-negative (raised side right only)', () => {
    expect(Math.min(...t.bank)).toBeGreaterThanOrEqual(0);
  });

  it('POST3: bank ramps are smooth, including across the index 0 wrap', () => {
    let maxStep = 0;
    for (let i = 0; i < n; i++) maxStep = Math.max(maxStep, Math.abs(t.bank[(i + 1) % n] - t.bank[i]));
    expect(maxStep).toBeLessThan(1.5 * DEG);
  });

  it('POST4: centerline is closed without a duplicated end point and has no NaN', () => {
    const [a, b] = [t.centerline[0], t.centerline[n - 1]];
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(0.1);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(10);
    expect(t.centerline.flat().every(Number.isFinite)).toBe(true);
  });

  it('POST5: start heads east (+x dominant)', () => {
    const [a, b] = [t.centerline[0], t.centerline[5]];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    expect(dx).toBeGreaterThan(Math.abs(dz) * 2);
  });

  it('POST6: pit range wraps through index 0 on the left side', () => {
    expect(t.pit.side).toBe('left');
    expect(t.pit.start).toBeGreaterThan(n / 2);
    expect(t.pit.end).toBeLessThan(n / 2);
  });

  it('POST7: two grandstands with the planner dimensions', () => {
    expect(t.grandstands).toHaveLength(2);
    expect(t.grandstands.map((g) => [g.lengthMeters, g.rows, g.roof])).toEqual([
      [120, 16, true],
      [100, 12, false],
    ]);
  });

  it('POST8: lengthMeters matches the closed polyline length', () => {
    let len = 0;
    for (let i = 0; i < n; i++) {
      const a = t.centerline[i];
      const b = t.centerline[(i + 1) % n];
      len += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    expect(Math.abs(len - t.lengthMeters)).toBeLessThan(5);
  });

  it('POST9: elevation has no spikes between neighbours (3% grade cap)', () => {
    let maxStep = 0;
    for (let i = 0; i < n; i++) maxStep = Math.max(maxStep, Math.abs(t.elevation[(i + 1) % n] - t.elevation[i]));
    expect(maxStep).toBeLessThan(0.5);
  });
});
