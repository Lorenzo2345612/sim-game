import { describe, it, expect } from 'vitest';
import { PenaltyBook } from '../../../src/race/penalties';
import { RaceClassification } from '../../../src/race/classification';

function applyAt1(book: PenaltyBook, car: number): void {
  for (let t = 1; t <= 3; t++) book.add(car, 'warning', 0, 'track limits', t);
  for (let t = 1; t <= 4; t++) book.add(car, 'penalty', 5, 'track limits', t);
}

function at10(): RaceClassification {
  const c = new RaceClassification(3, 1, 1000);
  for (let i = 0; i < 3; i++) {
    c.update(i, 990, 0);
    c.update(i, 50, 1);
  }
  c.update(0, 300, 2);
  c.update(1, 200, 2);
  c.update(2, 100, 2);
  c.retire(2);
  c.disqualify(1);
  return c;
}

function finishCar(c: RaceClassification, car: number, fromDist: number, fromTime: number): void {
  for (let k = 0; k <= Math.round(40 * 120); k++) {
    c.update(car, (fromDist + 50 * (k / 120)) % 1000, fromTime + k / 120);
  }
}

function order(c: RaceClassification): number[] {
  return c.standings().map((s) => s.car);
}

describe('311 penalty caps and disqualification acceptance', () => {
  it('AT1: 3 warnings then 4 track-limits penalties — ok/ok/final-warning/black-flag, total 15, finalWarning on the third', () => {
    const book = new PenaltyBook(1);
    const warnings = Array.from({ length: 3 }, (_, i) => book.add(0, 'warning', 0, 'track limits', i + 1));
    const penalties = [1, 2, 3, 4].map((t) => book.add(0, 'penalty', 5, 'track limits', t));
    expect(warnings).toEqual(['ok', 'ok', 'ok']);
    expect(penalties).toEqual(['ok', 'ok', 'final-warning', 'black-flag']);
    expect(book.total(0)).toBe(15);
    expect(book.entries()[book.entries().length - 1]).toMatchObject({
      kind: 'black flag',
      seconds: 0,
      reason: 'track limits',
      time: 4,
    });
    expect(book.entries()[3].finalWarning).toBeUndefined();
    expect(book.entries()[4].finalWarning).toBeUndefined();
    expect(book.entries()[5].finalWarning).toBe(true);
    expect(book.isBlackFlagged(0)).toBe(true);
  });

  it('AT2: penalties across reasons — final-warning at each limit, black-flag over maxTotal, counts per reason', () => {
    const book = new PenaltyBook(1);
    const outcomes = [
      book.add(0, 'penalty', 5, 'track limits', 1),
      book.add(0, 'penalty', 5, 'track limits', 2),
      book.add(0, 'penalty', 5, 'track limits', 3),
      book.add(0, 'penalty', 5, 'jump start', 4),
      book.add(0, 'penalty', 2, 'VSC delta', 5),
      book.add(0, 'penalty', 5, 'yellow flag overtake', 6),
    ];
    expect(outcomes).toEqual(['ok', 'ok', 'final-warning', 'ok', 'final-warning', 'black-flag']);
    expect(book.total(0)).toBe(22);
    expect(book.count(0)).toBe(5);
    expect(book.count(0, 'track limits')).toBe(3);
    expect(book.count(0, 'yellow flag overtake')).toBe(0);
  });

  it('AT3: after a black flag further adds return black-flag and record nothing', () => {
    const book = new PenaltyBook(1);
    applyAt1(book, 0);
    const entriesBefore = book.entries().length;
    const totalBefore = book.total(0);
    expect(book.add(0, 'warning', 0, 'jump start', 5)).toBe('black-flag');
    expect(book.add(0, 'penalty', 5, 'VSC delta', 6)).toBe('black-flag');
    expect(book.entries().length).toBe(entriesBefore);
    expect(book.total(0)).toBe(totalBefore);
  });

  it('AT4: 10 warnings — all ok, count 0, not black-flagged', () => {
    const book = new PenaltyBook(1);
    const outcomes = Array.from({ length: 10 }, (_, i) => book.add(0, 'warning', 0, 'track limits', i));
    expect(outcomes).toEqual(Array(10).fill('ok'));
    expect(book.count(0)).toBe(0);
    expect(book.isBlackFlagged(0)).toBe(false);
  });

  it('AT5: Infinity limits — 20 penalties all ok, total 100', () => {
    const book = new PenaltyBook(1, { maxPerReason: Infinity, maxTotal: Infinity });
    const outcomes = Array.from({ length: 20 }, (_, i) => book.add(0, 'penalty', 5, 'track limits', i));
    expect(outcomes).toEqual(Array(20).fill('ok'));
    expect(book.total(0)).toBe(100);
  });

  it('AT6: maxPerReason 1 — final-warning then black-flag, total 5', () => {
    const book = new PenaltyBook(1, { maxPerReason: 1 });
    expect(book.add(0, 'penalty', 5, 'jump start', 1)).toBe('final-warning');
    expect(book.add(0, 'penalty', 5, 'jump start', 2)).toBe('black-flag');
    expect(book.total(0)).toBe(5);
  });

  it('AT7: limits that are not integer >= 1 and not Infinity throw RangeError', () => {
    for (const v of [0, -1, 1.5, Number.NaN]) {
      expect(() => new PenaltyBook(2, { maxPerReason: v })).toThrow(RangeError);
    }
    expect(() => new PenaltyBook(2, { maxTotal: 0 })).toThrow(RangeError);
  });

  it('AT8: a black flag on car 1 does not affect car 0', () => {
    const book = new PenaltyBook(2);
    applyAt1(book, 1);
    expect(book.add(0, 'penalty', 5, 'track limits', 9)).toBe('ok');
    expect(book.isBlackFlagged(0)).toBe(false);
    expect(book.total(0)).toBe(5);
  });

  it('AT9: count and isBlackFlagged validate the car index', () => {
    const book = new PenaltyBook(2);
    expect(() => book.count(2)).toThrow(RangeError);
    expect(() => book.isBlackFlagged(-1)).toThrow(RangeError);
  });

  it('AT10: retire then disqualify — order running, retired, disqualified; flags; race not finished', () => {
    const c = at10();
    expect(order(c)).toEqual([0, 2, 1]);
    expect(c.isDisqualified(1)).toBe(true);
    expect(c.isDisqualified(2)).toBe(false);
    expect(c.finished).toBe(false);
  });

  it('AT11: with car 1 disqualified and car 2 retired, car 0 finishing ends the race', () => {
    const c = at10();
    finishCar(c, 0, 300, 2);
    expect(c.finished).toBe(true);
  });

  it('AT12: disqualify order — earlier disqualified car comes first', () => {
    const c = new RaceClassification(3, 1, 1000);
    c.update(0, 300, 1);
    c.update(1, 200, 1);
    c.update(2, 100, 1);
    c.disqualify(2);
    c.disqualify(1);
    expect(order(c)).toEqual([0, 2, 1]);
  });

  it('AT13: disqualify a finished car is a no-op — still classified 1st', () => {
    const c = new RaceClassification(2, 1, 1000);
    finishCar(c, 0, 990, 0);
    c.disqualify(0);
    expect(c.isDisqualified(0)).toBe(false);
    expect(c.standings()[0].car).toBe(0);
    expect(c.standings()[0].position).toBe(1);
  });

  it('AT14: retired then disqualified counts once toward finished', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.retire(1);
    c.disqualify(1);
    expect(c.isDisqualified(1)).toBe(true);
    expect(c.finished).toBe(false);
    finishCar(c, 0, 990, 0);
    expect(c.finished).toBe(true);
  });

  it('AT15: a disqualified car keeps its distance on update', () => {
    const c = new RaceClassification(2, 1, 1000);
    c.update(1, 990, 0);
    c.update(1, 50, 1);
    c.update(1, 100, 2);
    c.disqualify(1);
    c.update(1, 500, 3);
    expect(c.standings().find((s) => s.car === 1)?.distance).toBe(100);
  });
});
