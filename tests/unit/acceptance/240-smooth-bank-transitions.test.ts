import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TrackDataV2 } from '../../../src/core/types';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const cum = Array.from({ length: 5000 }, (_, i) => i);
const A: BankRange = { fromMeters: 1000, toMeters: 2000, degrees: 31, raisedSide: 'right' };
const B: BankRange = { fromMeters: 3000, toMeters: 3100, degrees: 31, raisedSide: 'right' };
const C: BankRange = { fromMeters: 4000, toMeters: 4500, degrees: 2, raisedSide: 'left' };

const deg = (rad: number): number => rad / DEG;

function maxStepDeg(bank: number[]): number {
  let max = 0;
  for (let i = 0; i < bank.length; i++) {
    const step = Math.abs(deg(bank[(i + 1) % bank.length] - bank[i]));
    if (step > max) max = step;
  }
  return max;
}

describe('240 smooth bank transitions acceptance', () => {
  it('AT1: auto range A reaches full 31 deg by from+R and stays zero at and outside the boundaries', () => {
    const bank = bankProfile(cum, 5000, [A]);
    expect(Math.abs(deg(bank[1500]) - 31)).toBeLessThanOrEqual(1e-9);
    for (const i of [1000, 2000, 999, 2001, 500]) {
      expect(Math.abs(deg(bank[i])), `index ${i}`).toBeLessThanOrEqual(1e-12);
    }
    expect(Math.abs(deg(bank[1233]) - 31)).toBeLessThanOrEqual(1e-9);
  });

  it('AT2: auto range A consecutive bank steps stay within 0.2 deg per metre', () => {
    const bank = bankProfile(cum, 5000, [A]);
    expect(maxStepDeg(bank)).toBeLessThanOrEqual(0.2 * 1.01);
  });

  it('AT3: auto range A has no slope kink at the ramp ends', () => {
    const bank = bankProfile(cum, 5000, [A]);
    for (const i of [1000, 1233]) {
      const kink = Math.abs(deg(bank[i + 1] - 2 * bank[i] + bank[i - 1]));
      expect(kink, `index ${i}`).toBeLessThanOrEqual(0.003);
    }
  });

  it('AT4: auto range A ramp midpoint i=1116 sits at about half bank', () => {
    const bank = bankProfile(cum, 5000, [A]);
    expect(Math.abs(deg(bank[1116]) - 15.5)).toBeLessThanOrEqual(0.3);
  });

  it('AT5: auto range B halves its ramp when the span is under 2R', () => {
    const bank = bankProfile(cum, 5000, [B]);
    for (let i = 0; i < bank.length; i++) {
      expect(Number.isFinite(bank[i]), `index ${i}`).toBe(true);
    }
    expect(Math.abs(deg(bank[3050]) - 31)).toBeLessThanOrEqual(1e-9);
    expect(Math.abs(deg(bank[3000]))).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(deg(bank[3100]))).toBeLessThanOrEqual(1e-12);
  });

  it('AT6: auto range C keeps the left sign and the 60 m ramp of a shallow bank', () => {
    const bank = bankProfile(cum, 5000, [C]);
    for (let i = 4001; i < 4500; i++) {
      expect(bank[i], `index ${i}`).toBeLessThan(0);
    }
    expect(Math.abs(deg(bank[4060]) + 2)).toBeLessThanOrEqual(1e-9);
    expect(maxStepDeg(bank)).toBeLessThanOrEqual(((1.5 * 2) / 60) * 1.01);
  });

  it('AT7: an explicit 60 m ramp keeps the linear centred behaviour', () => {
    const bank = bankProfile(cum, 5000, [A], 60);
    expect(Math.abs(deg(bank[1000]) - 15.5)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(deg(bank[970]))).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(deg(bank[1030]) - 31)).toBeLessThanOrEqual(1e-12);
  });

  it('AT8: rebuilt ovals change bank by at most 0.2 deg per metre and keep their peak bank', () => {
    const tracks: Array<[string, number]> = [
      ['daytona', 31],
      ['fontana', 11],
      ['fontana-roval', 14],
    ];
    for (const [id, peak] of tracks) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2;
      const bank = track.bank;
      expect(bank, id).toBeDefined();
      const values = bank ?? [];
      expect(values).toHaveLength(track.centerline.length);
      let maxAbs = 0;
      for (const b of values) maxAbs = Math.max(maxAbs, Math.abs(deg(b)));
      expect(Math.abs(maxAbs - peak), `${id} peak bank`).toBeLessThanOrEqual(0.1);
      let maxRate = 0;
      let maxRateAt = 0;
      for (let i = 0; i < track.centerline.length; i++) {
        const j = (i + 1) % track.centerline.length;
        const ds = Math.hypot(
          track.centerline[j][0] - track.centerline[i][0],
          track.centerline[j][1] - track.centerline[i][1],
        );
        const rate = Math.abs(deg(values[j] - values[i])) / ds;
        if (rate > maxRate) {
          maxRate = rate;
          maxRateAt = i;
        }
      }
      expect(maxRate, `${id} step at ${maxRateAt}`).toBeLessThanOrEqual(0.2 * 1.05);
    }
  });

  it(
    'AT9: the 174 banking acceptance and edge suites pass with only the planner-authorised edits',
    () => {
      const acc = readFileSync(
        join(ROOT, 'tests', 'unit', 'acceptance', '174-track-banking.test.ts'),
        'utf8',
      );
      expect(acc).toContain('wrapMargin(cum[i], from, to, total) < 240');
      expect(acc).toContain('no index at least 240 m inside');
      expect(acc).not.toContain('wrapMargin(cum[i], from, to, total) < 60');
      expect(acc).not.toContain('no index at least 60 m inside');
      const edge = readFileSync(
        join(ROOT, 'tests', 'unit', 'edge', '174-track-banking-edge.test.ts'),
        'utf8',
      );
      expect(edge).toContain('EDGE2: omitting rampMeters selects auto mode');
      expect(edge).toContain(
        'expect(bankProfile(cum, 1000, ranges, 60)).not.toEqual(bankProfile(cum, 1000, ranges))',
      );
      expect(edge).not.toContain('EDGE2: omitting rampMeters equals passing 60');
      execSync(
        'npx vitest run tests/unit/acceptance/174-track-banking.test.ts tests/unit/edge/174-track-banking-edge.test.ts',
        { cwd: ROOT, stdio: 'pipe', timeout: 240000 },
      );
    },
    300000,
  );
});
