import { describe, expect, it } from 'vitest';
import { bankProfile, type BankRange } from '../../../tools/track-builder/banking';

const DEG = Math.PI / 180;
const deg = (rad: number): number => rad / DEG;
const cum5k = Array.from({ length: 5000 }, (_, i) => i);
const cum1k = Array.from({ length: 1000 }, (_, i) => i);
const A: BankRange = { fromMeters: 1000, toMeters: 2000, degrees: 31, raisedSide: 'right' };

function expectZero(bank: number[], i: number): void {
  expect(Math.abs(deg(bank[i])), `index ${i}`).toBeLessThanOrEqual(1e-12);
}

describe('240 smooth bank transitions edge cases', () => {
  it('EDGE1: a wrap-around auto range is zero at from/to across the seam and full on the wrapped plateau', () => {
    const W: BankRange = { fromMeters: 4900, toMeters: 100, degrees: 8, raisedSide: 'right' };
    const bank = bankProfile(cum5k, 5000, [W]);
    for (let i = 0; i < bank.length; i++) {
      expect(Number.isFinite(bank[i]), `index ${i}`).toBe(true);
    }
    expectZero(bank, 4900);
    expectZero(bank, 100);
    expectZero(bank, 4899);
    expectZero(bank, 101);
    expect(deg(bank[4960])).toBeCloseTo(8, 9);
    expect(deg(bank[40])).toBeCloseTo(8, 9);
    expect(deg(bank[0])).toBeCloseTo(8, 9);
    expect(deg(bank[4930])).toBeCloseTo(4, 9);
    expect(deg(bank[70])).toBeCloseTo(4, 9);
    expect(deg(bank[4959])).toBeCloseTo(8 * (59 / 60) ** 2 * (3 - (2 * 59) / 60), 9);
  });

  it('EDGE2: auto ramp length follows 7.5 times |degrees| and the exact smoothstep shape', () => {
    const S: BankRange = { fromMeters: 1000, toMeters: 2000, degrees: 16, raisedSide: 'right' };
    const bank = bankProfile(cum5k, 5000, [S]);
    expectZero(bank, 1000);
    expectZero(bank, 2000);
    expect(deg(bank[1030])).toBeCloseTo(2.5, 9);
    expect(deg(bank[1060])).toBeCloseTo(8, 9);
    expect(deg(bank[1120])).toBeCloseTo(16, 9);
    expect(deg(bank[1119])).toBeLessThan(16);
    expect(deg(bank[1119])).toBeCloseTo(16 * (119 / 120) ** 2 * (3 - (2 * 119) / 120), 9);
    expect(deg(bank[1500])).toBeCloseTo(16, 9);
  });

  it('EDGE3: negative degrees size the auto ramp by magnitude and keep the sign of degrees times side', () => {
    const N: BankRange = { fromMeters: 1000, toMeters: 2000, degrees: -10, raisedSide: 'right' };
    const bank = bankProfile(cum5k, 5000, [N]);
    expectZero(bank, 1000);
    expectZero(bank, 2000);
    expect(deg(bank[1075])).toBeCloseTo(-10, 9);
    expect(deg(bank[1060])).toBeCloseTo(-8.96, 9);
    expect(deg(bank[1500])).toBeCloseTo(-10, 9);
  });

  it('EDGE4: overlapping auto ranges take the larger signed magnitude per index', () => {
    const ranges: BankRange[] = [
      { fromMeters: 100, toMeters: 400, degrees: 10, raisedSide: 'right' },
      { fromMeters: 250, toMeters: 600, degrees: 31, raisedSide: 'left' },
    ];
    const bank = bankProfile(cum5k, 5000, ranges);
    for (let i = 0; i < bank.length; i++) {
      expect(Number.isFinite(bank[i]), `index ${i}`).toBe(true);
    }
    expect(deg(bank[175])).toBeCloseTo(10, 9);
    expect(deg(bank[280])).toBeCloseTo(10, 9);
    expect(deg(bank[325])).toBeCloseTo(-4185 / 343, 9);
    expect(deg(bank[450])).toBeCloseTo(-10044 / 343, 9);
    expectZero(bank, 100);
    expectZero(bank, 600);
  });

  it('EDGE5: overlapping auto ranges of equal magnitude keep the earlier range value', () => {
    const ranges: BankRange[] = [
      { fromMeters: 100, toMeters: 400, degrees: 16, raisedSide: 'right' },
      { fromMeters: 100, toMeters: 400, degrees: 16, raisedSide: 'left' },
    ];
    const bank = bankProfile(cum1k, 1000, ranges);
    expect(deg(bank[160])).toBeCloseTo(8, 9);
    expect(deg(bank[220])).toBeCloseTo(16, 9);
    expect(deg(bank[300])).toBeCloseTo(400 / 27, 9);
    expectZero(bank, 100);
  });

  it('EDGE6: an explicit non-60 rampMeters keeps the linear centred ramp at that distance', () => {
    const bank = bankProfile(cum5k, 5000, [A], 30);
    expect(deg(bank[985])).toBeCloseTo(0, 12);
    expect(deg(bank[1000])).toBeCloseTo(15.5, 12);
    expect(deg(bank[1015])).toBeCloseTo(31, 12);
    expect(deg(bank[1500])).toBeCloseTo(31, 12);
    expect(deg(bank[1985])).toBeCloseTo(31, 12);
    expect(deg(bank[2000])).toBeCloseTo(15.5, 12);
    expect(deg(bank[2015])).toBeCloseTo(0, 12);
  });

  it('EDGE7: non-positive lengthMeters is still an all-zero profile and invalid inputs still throw in auto mode', () => {
    const tiny = [0, 1, 2, 3];
    const zeros = (bank: number[]): void => {
      expect(bank).toHaveLength(4);
      for (const b of bank) expect(Math.abs(b)).toBeLessThanOrEqual(1e-15);
    };
    zeros(bankProfile(tiny, 0, [A]));
    zeros(bankProfile(tiny, -100, [A]));
    expect(() => bankProfile(tiny, NaN, [A])).toThrow(Error);
    expect(() =>
      bankProfile(tiny, 4, [{ fromMeters: 0, toMeters: 2, degrees: Infinity, raisedSide: 'right' }]),
    ).toThrow(Error);
  });

  it('EDGE8: zero-degree and zero-span ranges stay skipped in auto mode', () => {
    const cum = Array.from({ length: 200 }, (_, i) => i * 5);
    const zeros = (bank: number[]): void => {
      expect(bank).toHaveLength(200);
      for (const b of bank) expect(Math.abs(b)).toBeLessThanOrEqual(1e-15);
    };
    zeros(bankProfile(cum, 1000, []));
    zeros(bankProfile(cum, 1000, [{ fromMeters: 100, toMeters: 800, degrees: 0, raisedSide: 'right' }]));
    zeros(bankProfile(cum, 1000, [{ fromMeters: 400, toMeters: 400, degrees: 31, raisedSide: 'left' }]));
  });

  it('EDGE9: adjacent auto ranges meet at an exact zero on their shared boundary', () => {
    const ranges: BankRange[] = [
      { fromMeters: 100, toMeters: 300, degrees: 10, raisedSide: 'right' },
      { fromMeters: 300, toMeters: 500, degrees: 10, raisedSide: 'right' },
    ];
    const bank = bankProfile(cum1k, 1000, ranges);
    expectZero(bank, 300);
    expect(deg(bank[175])).toBeCloseTo(10, 9);
    expect(deg(bank[200])).toBeCloseTo(10, 9);
    expect(deg(bank[375])).toBeCloseTo(10, 9);
    expect(deg(bank[275])).toBeCloseTo(70 / 27, 9);
    expect(deg(bank[325])).toBeCloseTo(70 / 27, 9);
    expect(deg(bank[299])).toBeGreaterThan(0);
  });
});
