import { describe, it, expect } from 'vitest';
import { GiveBack } from '../../../src/race/giveBack';

const NONE = [false, false, false];

describe('305 give back edge cases', () => {
  it('EDGE1: owes returns the oldest open passed car and advances when it closes', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.open(0, 2, 102);
    expect(gb.owes(0)).toBe(1);
    expect(gb.remaining(0, 104)).toBeCloseTo(6, 9);
    gb.update([1010, 1000, 1005], NONE, 110);
    gb.drainEvents();
    expect(gb.owes(0)).toBe(2);
    expect(gb.remaining(0, 110)).toBeCloseTo(2, 9);
  });

  it('EDGE2: returned wins over void and penalty in the same update', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([995, 1000, 0], [false, true, false], 120);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'returned' }]);
  });

  it('EDGE3: void wins over penalty when both apply', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], [false, true, false], 120);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'void' }]);
  });

  it('EDGE4: the 10 s deadline has a 1e-9 s tolerance', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], NONE, 110 - 1e-10);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'penalty' }]);
  });

  it('EDGE5: entries of different cars are independent', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.open(2, 1, 100);
    expect(gb.owes(1)).toBe(-1);
    gb.update([995, 1000, 1010], NONE, 105);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'returned' }]);
    expect(gb.owes(0)).toBe(-1);
    expect(gb.owes(2)).toBe(1);
  });

  it('EDGE6: drainEvents empties the queue', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([995, 1000, 0], NONE, 101);
    expect(gb.drainEvents().length).toBe(1);
    expect(gb.drainEvents()).toEqual([]);
  });

  it('EDGE7: a closed pair can be opened again', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], NONE, 110);
    gb.drainEvents();
    gb.open(0, 1, 120);
    expect(gb.owes(0)).toBe(1);
    expect(gb.remaining(0, 125)).toBeCloseTo(5, 9);
    gb.update([1010, 1000, 0], NONE, 129.99);
    expect(gb.drainEvents()).toEqual([]);
    gb.update([1010, 1000, 0], NONE, 130);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 1, kind: 'penalty' }]);
  });

  it('EDGE8: isGiveBack is false after a penalty or void closure', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.update([1010, 1000, 0], NONE, 110);
    expect(gb.isGiveBack(1, 0, 110)).toBe(false);
    gb.open(0, 2, 120);
    gb.update([1010, 1000, 1005], [false, false, true], 121);
    expect(gb.isGiveBack(2, 0, 121)).toBe(false);
  });

  it('EDGE9: isGiveBack covers an open entry up to the deadline and only that pair', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    expect(gb.isGiveBack(1, 0, 109.9)).toBe(true);
    expect(gb.isGiveBack(2, 0, 101)).toBe(false);
    expect(gb.isGiveBack(1, 2, 101)).toBe(false);
  });

  it('EDGE10: returning one of two owed cars leaves the other open', () => {
    const gb = new GiveBack(3);
    gb.open(0, 1, 100);
    gb.open(0, 2, 100);
    gb.update([1003, 1000, 1005], NONE, 103);
    expect(gb.drainEvents()).toEqual([{ car: 0, passed: 2, kind: 'returned' }]);
    expect(gb.owes(0)).toBe(1);
  });
});
