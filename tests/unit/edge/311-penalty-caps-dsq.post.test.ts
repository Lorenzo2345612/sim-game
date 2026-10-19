import { describe, it, expect } from 'vitest';
import { DEFAULT_PENALTY_LIMITS, PenaltyBook } from '../../../src/race/penalties';
import { RaceClassification } from '../../../src/race/classification';

function order(c: RaceClassification): number[] {
  return c.standings().map((s) => s.car);
}

function finishCar(c: RaceClassification, car: number, fromDist: number, fromTime: number): void {
  for (let k = 0; k <= 40 * 120; k++) c.update(car, (fromDist + 50 * (k / 120)) % 1000, fromTime + k / 120);
}

describe('311 penalty caps and disqualification post', () => {
  it('POST1: only the final-warning penalty carries finalWarning, never warnings or the black-flag entry', () => {
    const book = new PenaltyBook(1);
    book.add(0, 'warning', 0, 'track limits', 0);
    book.add(0, 'penalty', 5, 'track limits', 1);
    book.add(0, 'penalty', 5, 'track limits', 2);
    expect(book.add(0, 'penalty', 5, 'track limits', 3)).toBe('final-warning');
    expect(book.add(0, 'penalty', 5, 'track limits', 4)).toBe('black-flag');
    const entries = book.entries();
    expect(entries[0].finalWarning).toBeUndefined();
    expect(entries[3].finalWarning).toBe(true);
    expect(entries[4].kind).toBe('black flag');
    expect(entries[4].finalWarning).toBeUndefined();
  });

  it('POST2: an explicit undefined limit key falls back to the default', () => {
    const book = new PenaltyBook(1, { maxPerReason: undefined });
    expect(book.add(0, 'penalty', 5, 'jump start', 1)).toBe('ok');
    expect(book.add(0, 'penalty', 5, 'jump start', 2)).toBe('ok');
    expect(book.add(0, 'penalty', 5, 'jump start', 3)).toBe('final-warning');
  });

  it('POST3: a zero-car book rejects every car index', () => {
    const book = new PenaltyBook(0);
    expect(book.entries()).toEqual([]);
    expect(() => book.add(0, 'warning', 0, 'track limits', 0)).toThrow(RangeError);
    expect(() => book.count(0)).toThrow(RangeError);
    expect(() => book.isBlackFlagged(0)).toThrow(RangeError);
    expect(() => book.total(0)).toThrow(RangeError);
  });

  it('POST4: DEFAULT_PENALTY_LIMITS is 3 per reason and 5 in total', () => {
    expect(DEFAULT_PENALTY_LIMITS).toEqual({ maxPerReason: 3, maxTotal: 5 });
  });

  it('POST5: disqualify then retire keeps the car single-counted and its distance frozen under a large time delta', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.update(0, 300, 1);
    c.update(1, 200, 1);
    c.disqualify(1);
    c.retire(1);
    expect(c.isDisqualified(1)).toBe(true);
    expect(c.finished).toBe(false);
    expect(order(c)).toEqual([0, 1]);
    c.update(1, 500, 1e6);
    expect(c.standings().find((s) => s.car === 1)?.distance).toBe(-800);
  });

  it('POST6: finished, running, retired and disqualified keep group order in one standings', () => {
    const c = new RaceClassification(5, 1, 1000);
    finishCar(c, 0, 990, 0);
    c.update(1, 400, 1);
    c.update(2, 800, 1);
    c.update(3, 100, 1);
    c.update(4, 200, 1);
    c.retire(3);
    c.disqualify(4);
    expect(order(c)).toEqual([0, 2, 1, 3, 4]);
    expect(c.finished).toBe(false);
  });

  it('POST7: a race where every car is disqualified counts as finished', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.disqualify(0);
    expect(c.finished).toBe(false);
    c.disqualify(1);
    expect(c.finished).toBe(true);
    expect(order(c)).toEqual([0, 1]);
  });

  it('POST8: Infinity maxTotal with finite maxPerReason — black flag purely per reason, total stops at the last recorded penalty', () => {
    const book = new PenaltyBook(1, { maxPerReason: 2, maxTotal: Infinity });
    expect(book.add(0, 'penalty', 5, 'jump start', 1)).toBe('ok');
    expect(book.add(0, 'penalty', 5, 'jump start', 2)).toBe('final-warning');
    expect(book.add(0, 'penalty', 5, 'jump start', 3)).toBe('black-flag');
    expect(book.total(0)).toBe(10);
    expect(book.count(0)).toBe(2);
    expect(book.forCar(0)[2]).toMatchObject({ kind: 'black flag', seconds: 0 });
  });

  it('POST9: an ok penalty after a per-reason final-warning carries no flag; the maxTotal final-warning does', () => {
    const book = new PenaltyBook(1, { maxPerReason: 2 });
    book.add(0, 'penalty', 5, 'track limits', 1);
    expect(book.add(0, 'penalty', 5, 'track limits', 2)).toBe('final-warning');
    expect(book.add(0, 'penalty', 5, 'jump start', 3)).toBe('ok');
    expect(book.add(0, 'penalty', 5, 'VSC delta', 4)).toBe('ok');
    expect(book.add(0, 'penalty', 5, 'yellow flag overtake', 5)).toBe('final-warning');
    const entries = book.forCar(0);
    expect(entries.map((e) => e.finalWarning)).toEqual([undefined, true, undefined, undefined, true]);
  });

  it('POST10: fractional and NaN car indices throw; warnings-only reason counts stay zero', () => {
    const book = new PenaltyBook(2);
    expect(() => book.add(1.5, 'penalty', 5, 'track limits', 0)).toThrow(RangeError);
    expect(() => book.count(Number.NaN)).toThrow(RangeError);
    expect(book.add(0, 'warning', 7, 'jump start', 1)).toBe('ok');
    expect(book.total(0)).toBe(0);
    expect(book.count(0, 'jump start')).toBe(0);
    expect(book.forCar(0)[0].seconds).toBe(0);
  });

  it('POST11: disqualify a retired car mid-pack, then a finish ends the race with DSQ last', () => {
    const c = new RaceClassification(4, 1, 1000);
    c.update(0, 500, 1);
    c.update(1, 300, 1);
    c.update(2, 200, 1);
    c.retire(3);
    c.disqualify(3);
    c.retire(2);
    finishCar(c, 0, 990, 10);
    c.disqualify(1);
    expect(c.finished).toBe(true);
    expect(order(c)).toEqual([0, 2, 3, 1]);
    expect(c.isDisqualified(3)).toBe(true);
    expect(c.isDisqualified(1)).toBe(true);
  });
});
