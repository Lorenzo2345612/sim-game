import { describe, it, expect } from 'vitest';
import { tyreColour, fuelText } from '../../../src/ui/hudTyres';

describe('tyreColour', () => {
  it('AT1: colours temps [60, 90, 120, 90] blue, green, red, green for opt 90 window 40', () => {
    const temps = [60, 90, 120, 90];
    expect(temps.map((t) => tyreColour(t, 90, 40))).toEqual([
      'blue',
      'green',
      'red',
      'green',
    ]);
  });
});

describe('fuelText', () => {
  it('AT2: 10 L with 2.5 L mean lap shows "10.0 L · 4.0 laps"; no laps completed shows "10.0 L · —"', () => {
    expect(fuelText(10, 2.5)).toBe('10.0 L · 4.0 laps');
    expect(fuelText(10, null)).toBe('10.0 L · —');
  });
});
