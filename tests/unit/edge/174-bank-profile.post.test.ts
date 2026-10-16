import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';
import { parseTrackData } from '../../../src/track/parseTrackData';
import type { TrackDataV2 } from '../../../src/core/types';

const ROOT = join(__dirname, '..', '..', '..');
const DEG = Math.PI / 180;

function fixture(bank?: unknown): Record<string, unknown> {
  return {
    version: 2,
    id: 'profile-edge',
    name: 'Profile Edge',
    widthMeters: 12,
    lengthMeters: 12,
    officialLengthMeters: 12,
    centerline: [[0, 0], [0, -4], [0, -8], [0, -12]] as [number, number][],
    sectors: [0, 1, 2],
    elevation: [0, 0, 0, 0],
    kerbs: [],
    runoffs: [],
    barriers: [],
    terrain: { originX: 0, originZ: 0, sizeX: 10, sizeZ: 10, rows: 1, cols: 1, heights: [0, 0, 0, 0] },
    treeSpecies: [],
    trees: [],
    grandstands: [],
    pit: { start: 0, end: 0, side: 'left' },
    escapeRoads: [],
    source: { dataset: 'test', license: 'test', url: '', dem: '' },
    ...(bank !== undefined ? { bank } : {}),
  };
}

describe('174 bankProfile and parser post-coder gaps', () => {
  it('POST1: a non-positive lengthMeters returns an all-zero profile without touching the ranges', () => {
    const cum = Array.from({ length: 50 }, (_, i) => i * 2);
    const ranges: BankRange[] = [{ fromMeters: 0, toMeters: 100, degrees: 31, raisedSide: 'right' }];
    for (const length of [0, -100]) {
      const bank = bankProfile(cum, length, ranges, 60);
      expect(bank).toHaveLength(50);
      for (const b of bank) expect(Math.abs(b)).toBeLessThanOrEqual(1e-15);
    }
  });

  it('POST2: rampMeters 0 is a hard step: full inside, zero outside, half exactly on each boundary', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const ranges: BankRange[] = [{ fromMeters: 200, toMeters: 500, degrees: 31, raisedSide: 'right' }];
    const bank = bankProfile(cum, 1000, ranges, 0);
    const full = 31 * DEG;
    expect(bank[350]).toBeCloseTo(full, 12);
    expect(bank[199]).toBe(0);
    expect(bank[501]).toBe(0);
    expect(bank[200]).toBeCloseTo(full / 2, 12);
    expect(bank[500]).toBeCloseTo(full / 2, 12);
    expect(bank[201]).toBeCloseTo(full, 12);
    expect(bank[499]).toBeCloseTo(full, 12);
  });

  it('POST3: negative degrees keep their sign and the larger magnitude wins over an overlapping range', () => {
    const cum = Array.from({ length: 1000 }, (_, i) => i);
    const left: BankRange[] = [{ fromMeters: 200, toMeters: 500, degrees: -20, raisedSide: 'left' }];
    expect(bankProfile(cum, 1000, left, 60)[350]).toBeCloseTo(20 * DEG, 6);
    const mixed = bankProfile(
      cum,
      1000,
      [
        { fromMeters: 200, toMeters: 500, degrees: -20, raisedSide: 'right' },
        { fromMeters: 350, toMeters: 450, degrees: 15, raisedSide: 'right' },
      ],
      60,
    );
    expect(mixed[350]).toBeCloseTo(-20 * DEG, 6);
    expect(mixed[400]).toBeCloseTo(-20 * DEG, 6);
    expect(mixed[425]).toBeCloseTo(-20 * DEG, 6);
  });

  it('POST4: a wrap range whose span is a whole number of laps contributes nothing', () => {
    const cum = Array.from({ length: 400 }, (_, i) => i * 2.5);
    for (const r of [
      { fromMeters: 0, toMeters: 1000, degrees: 31, raisedSide: 'right' },
      { fromMeters: 250, toMeters: 1250, degrees: 18, raisedSide: 'left' },
    ] as BankRange[]) {
      for (const b of bankProfile(cum, 1000, [r], 60)) expect(Math.abs(b)).toBeLessThanOrEqual(1e-15);
    }
  });

  it('POST5: cumulativeMeters entries outside [0, lengthMeters) wrap onto the ring', () => {
    const bank = bankProfile([250, 1250, -750], 1000, [
      { fromMeters: 200, toMeters: 500, degrees: 31, raisedSide: 'right' },
    ], 60);
    const full = 31 * DEG;
    for (const b of bank) expect(b).toBeCloseTo(full, 6);
  });

  it('POST6: empty cumulativeMeters returns an empty profile', () => {
    expect(bankProfile([], 1000, [{ fromMeters: 0, toMeters: 10, degrees: 31, raisedSide: 'right' }], 60)).toEqual([]);
  });

  it('POST7: parseTrackData replaces a non-array bank with zeros of centerline length', () => {
    for (const bad of [0.5, null, 'bank', { 0: 1 }]) {
      const parsed = parseTrackData(JSON.parse(JSON.stringify(fixture(bad)))) as TrackDataV2 & {
        bank?: number[];
      };
      expect(parsed.bank, String(bad)).toHaveLength(parsed.centerline.length);
      for (const b of parsed.bank ?? []) expect(b).toBe(0);
    }
  });

  it('POST8: every shipped track except daytona has no bank or an all-zero bank', () => {
    const dir = join(ROOT, 'public', 'tracks');
    const daytona = JSON.parse(readFileSync(join(dir, 'daytona.json'), 'utf8')) as { bank?: number[] };
    expect((daytona.bank ?? []).some((b) => Math.abs(b) > 1e-12)).toBe(true);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      if (f === 'daytona.json') continue;
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { bank?: number[] };
      if (data.bank === undefined) continue;
      for (const b of data.bank) expect(Math.abs(b), f).toBeLessThanOrEqual(1e-12);
    }
  });
});
