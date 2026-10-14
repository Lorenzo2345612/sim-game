import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from '../../../src/core/settings';
import {
  LIVERY_PALETTE,
  LIVERY_PATTERNS,
  defaultLivery,
  loadLivery,
  parseLivery,
  saveLivery,
  type Livery,
} from '../../../src/game/livery';

const COLOUR = /^#[0-9a-f]{6}$/;

class MapStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('119 livery data acceptance', () => {
  it('AT1: LIVERY_PALETTE has 16 valid entries with 16 distinct primaries', () => {
    expect(LIVERY_PALETTE).toHaveLength(16);
    const primaries = new Set<string>();
    for (const livery of LIVERY_PALETTE) {
      expect(livery.primary).toMatch(COLOUR);
      expect(livery.secondary).toMatch(COLOUR);
      expect(livery.accent).toMatch(COLOUR);
      expect(LIVERY_PATTERNS).toContain(livery.pattern);
      expect(Number.isInteger(livery.number)).toBe(true);
      expect(livery.number).toBeGreaterThanOrEqual(0);
      expect(livery.number).toBeLessThanOrEqual(99);
      primaries.add(livery.primary);
    }
    expect(primaries.size).toBe(16);
  });

  it('AT2: defaultLivery(17) uses palette[1] colours with number 18', () => {
    const livery = defaultLivery(17);
    const base = LIVERY_PALETTE[1];
    expect(livery.primary).toBe(base.primary);
    expect(livery.secondary).toBe(base.secondary);
    expect(livery.accent).toBe(base.accent);
    expect(livery.number).toBe(18);
  });

  it('AT3: parseLivery throws on bad colour, unknown pattern and out-of-range number', () => {
    const base = defaultLivery(0);
    expect(() => parseLivery({ ...base, primary: '#12345g' })).toThrow();
    expect(() => parseLivery({ ...base, pattern: 'dots' })).toThrow();
    expect(() => parseLivery({ ...base, number: 100 })).toThrow();
  });

  it('AT4: save then load round-trips; corrupt JSON loads defaultLivery(0)', () => {
    const storage = new MapStorage();
    const livery: Livery = {
      primary: '#ff0000',
      secondary: '#ffffff',
      accent: '#0000ff',
      pattern: 'stripe',
      number: 44,
    };
    saveLivery(storage, 'f4', livery);
    expect(loadLivery(storage, 'f4')).toEqual(livery);

    storage.setItem('livery:f4', '{corrupt');
    expect(loadLivery(storage, 'f4')).toEqual(defaultLivery(0));
  });
});
