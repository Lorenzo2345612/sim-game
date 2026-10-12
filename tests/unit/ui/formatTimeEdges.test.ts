import { describe, it, expect } from 'vitest';
import { formatLapTime } from '../../../src/ui/formatTime';

describe('formatLapTime edge cases', () => {
  it('rounds half-up at 59.9995 to 1:00.000', () => {
    expect(formatLapTime(59.9995)).toBe('1:00.000');
  });

  it('rounds 83.4564 down to 1:23.456', () => {
    expect(formatLapTime(83.4564)).toBe('1:23.456');
  });

  it('rounds sub-millisecond values to zero', () => {
    expect(formatLapTime(0.0004)).toBe('0:00.000');
  });

  it('pads single-digit seconds and milliseconds', () => {
    expect(formatLapTime(9.007)).toBe('0:09.007');
  });

  it('does not wrap minutes past 60', () => {
    expect(formatLapTime(3661.5)).toBe('61:01.500');
  });

  it('formats -0 as 0:00.000 (-0 is not less than 0)', () => {
    expect(formatLapTime(-0)).toBe('0:00.000');
  });

  it('returns placeholder for -Infinity', () => {
    expect(formatLapTime(-Infinity)).toBe('-:--.---');
  });
});
