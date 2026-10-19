import { describe, it, expect } from 'vitest';
import { PenaltyBook } from '../../../src/race/penalties';
import { RaceClassification } from '../../../src/race/classification';

function order(c: RaceClassification): number[] {
  return c.standings().map((s) => s.car);
}

describe('311 penalty caps and disqualification edge', () => {
  it('EDGE1: {maxTotal: 1} alone uses default maxPerReason — final-warning then black-flag across reasons', () => {
    const book = new PenaltyBook(1, { maxTotal: 1 });
    expect(book.add(0, 'penalty', 5, 'jump start', 1)).toBe('final-warning');
    expect(book.add(0, 'penalty', 5, 'VSC delta', 2)).toBe('black-flag');
    expect(book.total(0)).toBe(5);
    expect(book.count(0)).toBe(1);
    expect(book.isBlackFlagged(0)).toBe(true);
    expect(book.entries()[1]).toMatchObject({ kind: 'black flag', seconds: 0, reason: 'VSC delta', time: 2 });
  });

  it('EDGE2: {maxPerReason: Infinity} alone uses default maxTotal 5 — 6 mixed-reason penalties, finalWarning on the fifth', () => {
    const book = new PenaltyBook(1, { maxPerReason: Infinity });
    const reasons = ['track limits', 'jump start', 'VSC delta', 'yellow flag overtake', 'track limits', 'jump start'] as const;
    const outcomes = reasons.map((r, i) => book.add(0, 'penalty', 5, r, i));
    expect(outcomes).toEqual(['ok', 'ok', 'ok', 'ok', 'final-warning', 'black-flag']);
    expect(book.total(0)).toBe(25);
    expect(book.count(0)).toBe(5);
    expect(book.entries()[4].finalWarning).toBe(true);
    expect(book.entries()[5].kind).toBe('black flag');
  });

  it('EDGE3: a warning after a final-warning still returns ok and does not advance counts', () => {
    const book = new PenaltyBook(1, { maxPerReason: 1 });
    expect(book.add(0, 'penalty', 5, 'jump start', 1)).toBe('final-warning');
    expect(book.add(0, 'warning', 0, 'track limits', 2)).toBe('ok');
    expect(book.count(0)).toBe(1);
    expect(book.isBlackFlagged(0)).toBe(false);
  });

  it('EDGE4: negative, fractional and NaN maxTotal throw; Infinity maxTotal alone constructs', () => {
    for (const v of [-1, 1.5, Number.NaN]) {
      expect(() => new PenaltyBook(1, { maxTotal: v })).toThrow(RangeError);
    }
    expect(() => new PenaltyBook(1, { maxTotal: Infinity })).not.toThrow();
  });

  it('EDGE5: disqualify and isDisqualified validate the car index', () => {
    const c = new RaceClassification(2, 1, 1000);
    expect(() => c.disqualify(2)).toThrow(RangeError);
    expect(() => c.isDisqualified(-1)).toThrow(RangeError);
  });

  it('EDGE6: disqualifying the same car twice is a no-op and keeps its sequence', () => {
    const c = new RaceClassification(3, 1, 1000);
    c.disqualify(2);
    c.disqualify(2);
    c.disqualify(1);
    expect(order(c)).toEqual([0, 2, 1]);
    expect(c.isDisqualified(2)).toBe(true);
  });

  it('EDGE7: a retired car that is disqualified leaves the retired group', () => {
    const c = new RaceClassification(3, 1, 1000);
    c.retire(2);
    c.retire(1);
    c.disqualify(2);
    expect(order(c)).toEqual([0, 1, 2]);
  });

  it('EDGE8: multiple retired cars keep retireSeq order, disqualified cars go last', () => {
    const c = new RaceClassification(4, 1, 1000);
    c.retire(1);
    c.retire(0);
    c.disqualify(3);
    expect(order(c)).toEqual([2, 1, 0, 3]);
  });

  it('EDGE9: disqualifying a running car counts it once toward finished', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.update(0, 990, 0);
    for (let k = 1; k <= 40 * 120; k++) c.update(0, (990 + 50 * (k / 120)) % 1000, k / 120);
    expect(c.standings().find((s) => s.car === 0)?.finished).toBe(true);
    c.disqualify(1);
    expect(c.finished).toBe(true);
  });

  it('EDGE10: update on a disqualified car is ignored across a lap crossing', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.update(1, 990, 0);
    c.disqualify(1);
    c.update(1, 10, 1);
    const st = c.standings().find((s) => s.car === 1);
    expect(st?.distance).toBe(-10);
    expect(st?.lap).toBe(0);
    expect(st?.finished).toBe(false);
    expect(st?.totalTime).toBeNull();
    expect(c.isDisqualified(1)).toBe(true);
  });
});
