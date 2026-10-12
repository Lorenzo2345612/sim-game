import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  presetSettings,
  loadPreset,
  savePreset,
  SETTINGS_KEY,
  type KeyValueStorage,
} from '../../../src/core/settings';

class MapStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
}

describe('loadPreset defaults', () => {
  it('returns high when nothing is stored', () => {
    expect(loadPreset(new MapStorage())).toBe('high');
  });

  it('returns high for corrupt JSON', () => {
    const storage = new MapStorage();
    storage.setItem(SETTINGS_KEY, '{not json');
    expect(loadPreset(storage)).toBe('high');
  });

  it('returns high for an unknown preset name', () => {
    const storage = new MapStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify({ preset: 'ultra' }));
    expect(loadPreset(storage)).toBe('high');
  });

  it('returns high when the payload is not an object', () => {
    const storage = new MapStorage();
    storage.setItem(SETTINGS_KEY, JSON.stringify('medium'));
    expect(loadPreset(storage)).toBe('high');
  });
});

describe('savePreset / loadPreset round-trip', () => {
  it('round-trips every preset', () => {
    for (const preset of ['low', 'medium', 'high'] as const) {
      const storage = new MapStorage();
      savePreset(storage, preset);
      expect(loadPreset(storage)).toBe(preset);
    }
  });

  it('keeps the stored value stable across saves', () => {
    const storage = new MapStorage();
    savePreset(storage, 'low');
    const first = storage.getItem(SETTINGS_KEY);
    savePreset(storage, 'low');
    expect(storage.getItem(SETTINGS_KEY)).toBe(first);
  });
});

describe('presetSettings', () => {
  it('clamps pixelRatio to the device ratio', () => {
    expect(presetSettings('low', 3).pixelRatio).toBe(1);
    expect(presetSettings('medium', 1).pixelRatio).toBe(1);
    expect(presetSettings('high', 1.25).pixelRatio).toBe(1.25);
  });
});

describe('settings.ts purity', () => {
  const src = readFileSync('src/core/settings.ts', 'utf8');

  it('imports nothing and does not reference window or document', () => {
    expect(src).not.toMatch(/^import /m);
    expect(src).not.toMatch(/\bwindow\b/);
    expect(src).not.toMatch(/\bdocument\b/);
  });
});
