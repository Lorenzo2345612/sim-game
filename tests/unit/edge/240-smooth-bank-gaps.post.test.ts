import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import { polylineLength } from '../../../src/track/geo';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;
const deg = (rad: number): number => rad / DEG;
const cum5k = Array.from({ length: 5000 }, (_, i) => i);
const A: BankRange = { fromMeters: 1000, toMeters: 2000, degrees: 31, raisedSide: 'right' };

function kinkDeg(bank: number[], i: number): number {
  return Math.abs(deg(bank[i + 1] - 2 * bank[i] + bank[i - 1]));
}

describe('240 smooth bank transitions post-code gaps', () => {
  it('an explicit undefined rampMeters selects auto mode', () => {
    const explicit = bankProfile(cum5k, 5000, [A], undefined);
    expect(explicit).toEqual(bankProfile(cum5k, 5000, [A]));
    expect(deg(explicit[1000])).toBeCloseTo(0, 12);
    expect(deg(explicit[1500])).toBeCloseTo(31, 9);
  });

  it('a non-finite explicit rampMeters still throws', () => {
    expect(() => bankProfile(cum5k, 5000, [A], Infinity)).toThrow(Error);
    expect(() => bankProfile(cum5k, 5000, [A], -Infinity)).toThrow(Error);
  });

  it('auto ramp clamps the 60 m floor down to span/2 for a shallow range under 120 m', () => {
    const S: BankRange = { fromMeters: 3000, toMeters: 3080, degrees: 4, raisedSide: 'right' };
    const bank = bankProfile(cum5k, 5000, [S]);
    expect(deg(bank[3000])).toBeCloseTo(0, 12);
    expect(deg(bank[3080])).toBeCloseTo(0, 12);
    expect(deg(bank[3040])).toBeCloseTo(4, 9);
    expect(deg(bank[3020])).toBeCloseTo(2, 9);
    let max = 0;
    for (const b of bank) max = Math.max(max, deg(b));
    expect(max).toBeCloseTo(4, 9);
  });

  it('auto range A ramps symmetrically about its midpoint', () => {
    const bank = bankProfile(cum5k, 5000, [A]);
    let worst = 0;
    for (let k = 0; k <= 1000; k++) {
      worst = Math.max(worst, Math.abs(deg(bank[1000 + k] - bank[2000 - k])));
    }
    expect(worst).toBeLessThanOrEqual(1e-12);
  });

  it('auto range A rises monotonically to the midpoint and falls after it', () => {
    const bank = bankProfile(cum5k, 5000, [A]);
    for (let i = 1001; i <= 1500; i++) {
      expect(bank[i], `rising at ${i}`).toBeGreaterThanOrEqual(bank[i - 1]);
    }
    for (let i = 1501; i <= 2000; i++) {
      expect(bank[i], `falling at ${i}`).toBeLessThanOrEqual(bank[i - 1]);
    }
  });

  it('the to-side of the auto ramp has no slope kink', () => {
    const bank = bankProfile(cum5k, 5000, [A]);
    for (const i of [1767, 1884, 2000]) {
      expect(kinkDeg(bank, i), `index ${i}`).toBeLessThanOrEqual(0.003);
    }
  });

  it('fontana and fontana-roval bank arrays equal the auto bankProfile of their registry ranges', () => {
    const registry = JSON.parse(
      readFileSync(join(ROOT, 'tools', 'track-builder', 'tracks.json'), 'utf8'),
    ) as Array<{ id: string; banking?: BankRange[] }>;
    for (const id of ['fontana', 'fontana-roval']) {
      const track = JSON.parse(
        readFileSync(join(ROOT, 'public', 'tracks', `${id}.json`), 'utf8'),
      ) as TrackDataV2 & { bank: number[] };
      const cx = track.centerline;
      const cum = [0];
      for (let i = 1; i < cx.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(cx[i][0] - cx[i - 1][0], cx[i][1] - cx[i - 1][1]));
      }
      const cfg = registry.find((t) => t.id === id);
      expect(cfg?.banking, id).toBeDefined();
      const expected = bankProfile(cum, polylineLength(cx, true), cfg!.banking!);
      expect(track.bank, id).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i++) {
        expect(Math.abs(track.bank[i] - expected[i]), `${id} index ${i}`).toBeLessThanOrEqual(1e-12);
      }
    }
  }, 60000);

  it('auto mode returns an empty profile for an empty cumulativeMeters input', () => {
    expect(bankProfile([], 5000, [A])).toEqual([]);
  });

  it('auto mode does not mutate its cumulativeMeters or ranges inputs', () => {
    const cum = [0, 500, 1500, 3000];
    const ranges: BankRange[] = [{ fromMeters: 1000, toMeters: 2000, degrees: 31, raisedSide: 'right' }];
    const cumSnap = [...cum];
    const rangesSnap = ranges.map((r) => ({ ...r }));
    bankProfile(cum, 5000, ranges);
    expect(cum).toEqual(cumSnap);
    expect(ranges).toEqual(rangesSnap);
  });

  it('auto mode wraps cumulativeMeters entries outside [0, lengthMeters) onto the ring', () => {
    const inside = bankProfile([1500], 5000, [A])[0];
    const wrapped = bankProfile([6500, -3500], 5000, [A]);
    expect(wrapped).toEqual([inside, inside]);
    expect(bankProfile([6000], 5000, [A])).toEqual([bankProfile([1000], 5000, [A])[0]]);
  });
});
