import { describe, it, expect } from 'vitest';
import { formatLapTime } from '../../../src/ui/formatTime';

describe('016 HUD acceptance', () => {
  it('AT1: formatLapTime formats 83.456, 5 and 59.9996 correctly', () => {
    expect(formatLapTime(83.456)).toBe('1:23.456');
    expect(formatLapTime(5)).toBe('0:05.000');
    expect(formatLapTime(59.9996)).toBe('1:00.000');
  });

  it('AT2: formatLapTime returns the placeholder for null, -1, NaN and Infinity', () => {
    expect(formatLapTime(null)).toBe('-:--.---');
    expect(formatLapTime(-1)).toBe('-:--.---');
    expect(formatLapTime(NaN)).toBe('-:--.---');
    expect(formatLapTime(Infinity)).toBe('-:--.---');
  });

  it('AT3: formatLapTime formats 600.001 as 10:00.001', () => {
    expect(formatLapTime(600.001)).toBe('10:00.001');
  });
});
