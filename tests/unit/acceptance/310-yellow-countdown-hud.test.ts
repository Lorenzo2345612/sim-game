import { describe, it, expect } from 'vitest';
import { YellowAlert, CLEAR_S } from '../../../src/ui/yellowAlert';
import { countdownStyle } from '../../../src/ui/minimap';

const NONE = [NaN, NaN, NaN];

describe('310 yellow countdown HUD', () => {
  it('AT1: countdown in the player sector shows digit 3', () => {
    const v = new YellowAlert().update('green', 2, 10, [NaN, 2.4, NaN]);
    expect(v.mode).toBe('countdown');
    expect(v.digit).toBe(3);
    expect(v.text).toBe('YELLOW FLAG IN 3 · SECTOR 2');
    expect(v.lightsOn).toBe(true);
  });

  it('AT2: countdown in the next sector ahead wraps 3 to 1', () => {
    const v = new YellowAlert().update('green', 3, 10, [NaN, NaN, 0.9]);
    expect(v.digit).toBe(1);
    expect(v.text).toBe('YELLOW FLAG IN 1 · SECTOR 3');
  });

  it('AT3: yellow wins and then clears when the player moves on', () => {
    const a = new YellowAlert();
    a.update('green', 2, 10, [NaN, 2.4, NaN]);
    const y = a.update('yellow', 2, 11, NONE);
    expect(y.mode).toBe('yellow');
    expect(y.digit).toBe(0);
    expect(a.update('green', 3, 12, NONE).mode).toBe('clear');
  });

  it('AT4: a vanished countdown gives none, never clear', () => {
    const a = new YellowAlert();
    a.update('green', 2, 10, [NaN, 2.4, NaN]);
    expect(a.update('green', 2, 11, NONE).mode).toBe('none');
    expect(a.update('green', 2, 11 + CLEAR_S, NONE).mode).toBe('none');
  });

  it('AT5: countdownStyle returns the same yellow dashed style object', () => {
    const s = countdownStyle();
    expect(s.color).toBe('#ffd400');
    expect(s.width).toBe(8);
    expect([...s.dash]).toEqual([10, 8]);
    expect(countdownStyle()).toBe(s);
  });

  it('AT8: countdown one sector ahead is shown', () => {
    const v = new YellowAlert().update('green', 1, 10, [NaN, 1.5, NaN]);
    expect(v.text).toBe('YELLOW FLAG IN 2 · SECTOR 2');
    expect(v.digit).toBe(2);
  });
});
