import { describe, it, expect } from 'vitest';
import { formatLapTime } from '../../../src/ui/formatTime';

describe('formatLapTime', () => {
  it('formats 83.456 as 1:23.456', () => {
    expect(formatLapTime(83.456)).toBe('1:23.456');
  });

  it('formats 5.0 as 0:05.000', () => {
    expect(formatLapTime(5)).toBe('0:05.000');
  });

  it('rounds 59.9996 to 1:00.000', () => {
    expect(formatLapTime(59.9996)).toBe('1:00.000');
  });

  it('formats 0 as 0:00.000', () => {
    expect(formatLapTime(0)).toBe('0:00.000');
  });

  it('returns placeholder for null', () => {
    expect(formatLapTime(null)).toBe('-:--.---');
  });

  it('formats 600.001 as 10:00.001', () => {
    expect(formatLapTime(600.001)).toBe('10:00.001');
  });

  it('returns placeholder for negative, NaN and Infinity', () => {
    expect(formatLapTime(-1)).toBe('-:--.---');
    expect(formatLapTime(NaN)).toBe('-:--.---');
    expect(formatLapTime(Infinity)).toBe('-:--.---');
  });
});
