export type Preset = 'low' | 'medium' | 'high';

export interface PresetSettings {
  pixelRatio: number;
  shadows: boolean;
  treeFarDistance: number;
  antialias: boolean;
}

export interface KeyValueStorage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export const SETTINGS_KEY = 'settings';

export function presetSettings(preset: Preset, devicePixelRatio: number): PresetSettings {
  switch (preset) {
    case 'low':
      return { pixelRatio: 1, shadows: false, treeFarDistance: 600, antialias: false };
    case 'medium':
      return {
        pixelRatio: Math.min(devicePixelRatio, 1.5),
        shadows: true,
        treeFarDistance: 1000,
        antialias: true,
      };
    case 'high':
      return {
        pixelRatio: Math.min(devicePixelRatio, 2),
        shadows: true,
        treeFarDistance: 1500,
        antialias: true,
      };
  }
}

function isPreset(value: unknown): value is Preset {
  return value === 'low' || value === 'medium' || value === 'high';
}

export function loadPreset(storage: KeyValueStorage): Preset {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw == null) return 'high';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const preset = (parsed as { preset?: unknown }).preset;
      if (isPreset(preset)) return preset;
    }
  } catch {
    // corrupt JSON falls through to the default
  }
  return 'high';
}

export function savePreset(storage: KeyValueStorage, preset: Preset): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ preset }));
}
