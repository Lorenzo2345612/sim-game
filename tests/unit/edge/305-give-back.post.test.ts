import { describe, it, expect } from 'vitest';
import { GiveBack } from '../../../src/race/giveBack';

const NONE = [false, false, false];

describe('305 give back post-code gaps', () => {
  it('POST1: update with no open entries emits nothing', () => {
    const gb = new GiveBack(3);
    gb.update([0, 0, 0], NONE, 50);
    expect(gb.drainEvents()).toEqual([]);
    expect(gb.owes(1)).toBe(-1);
    expect(Number.isNaN(gb.remaining(1, 50))).toBe(true);
  });

  it('POST2: a pair reopened after a penalty gets a fresh 10 s window', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.update([10, 0], [false, false], 10);
    gb.drainEvents();
    gb.open(0, 1, 12);
    expect(gb.remaining(0, 12)).toBeCloseTo(10, 9);
    gb.update([10, 0], [false, false], 21.9);
    expect(gb.drainEvents()).toEqual([]);
  });

  it('POST3: reopening an open pair later does not extend its deadline', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.open(0, 1, 8);
    expect(gb.remaining(0, 8)).toBeCloseTo(2, 9);
  });

  it('POST4: remaining is NaN once the entry closed by penalty', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.update([10, 0], [false, false], 10);
    expect(Number.isNaN(gb.remaining(0, 10))).toBe(true);
  });

  it('POST5: a large time delta still emits a single penalty', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.update([10, 0], [false, false], 10_000);
    gb.update([10, 0], [false, false], 20_000);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'penalty' }]);
  });

  it('POST6: isGiveBack is false for a pair never opened and at time before open', () => {
    const gb = new GiveBack(3);
    expect(gb.isGiveBack(1, 0, 0)).toBe(false);
    expect(gb.isGiveBack(2, 1, 1e6)).toBe(false);
  });

  it('POST7: isGiveBack grace after returned ends exactly at 2 s', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.update([0, 5], [false, false], 3);
    expect(gb.isGiveBack(1, 0, 5)).toBe(true);
    expect(gb.isGiveBack(1, 0, 5.001)).toBe(false);
  });

  it('POST8: events from several pairs in one update are all emitted', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 0);
    gb.open(2, 1, 0);
    gb.update([0, 5, 3], NONE, 1);
    const ev = gb.drainEvents();
    expect(ev).toHaveLength(2);
    expect(ev).toContainEqual({ car: 0, passed: 1, kind: 'returned' });
    expect(ev).toContainEqual({ car: 2, passed: 1, kind: 'returned' });
  });

  it('POST9: negative distances compare strictly', () => {
    const gb = new GiveBack(2);
    gb.open(0, 1, 0);
    gb.update([-5, -5], [false, false], 1);
    expect(gb.drainEvents()).toEqual([]);
    gb.update([-6, -5], [false, false], 2);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'returned' }]);
  });
});
