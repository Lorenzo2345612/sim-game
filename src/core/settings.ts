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

export function parseQuality(search: string): Preset | null {
  const requested = new URLSearchParams(search).get('quality');
  return isPreset(requested) ? requested : null;
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

/** The stored settings object as-is; corrupt or non-object payloads read as empty. */
function storedSettings(storage: KeyValueStorage): Record<string, unknown> {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    /* treat as missing */
  }
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // corrupt JSON falls through to an empty object
  }
  return {};
}

export function savePreset(storage: KeyValueStorage, preset: Preset): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify({ ...storedSettings(storage), preset }));
}

export type CompoundOption = 'soft' | 'medium' | 'hard';

export interface GameOptions {
  wear: number;
  fuel: number;
  compound: CompoundOption;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = { wear: 1, fuel: 1, compound: 'medium' };

function isCompound(value: unknown): value is CompoundOption {
  return value === 'soft' || value === 'medium' || value === 'hard';
}

function multiplier(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Wear/fuel multipliers and tyre compound from the stored settings; invalid or missing values fall back to the defaults. */
export function loadGameOptions(storage: KeyValueStorage): GameOptions {
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_KEY);
  } catch {
    /* treat as missing */
  }
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const stored = parsed as { wear?: unknown; fuel?: unknown; compound?: unknown };
        return {
          wear: multiplier(stored.wear) ?? DEFAULT_GAME_OPTIONS.wear,
          fuel: multiplier(stored.fuel) ?? DEFAULT_GAME_OPTIONS.fuel,
          compound: isCompound(stored.compound) ? stored.compound : DEFAULT_GAME_OPTIONS.compound,
        };
      }
    } catch {
      // corrupt JSON falls through to the defaults
    }
  }
  return { ...DEFAULT_GAME_OPTIONS };
}

/** Writes wear/fuel/compound into settings, keeping every other stored key (e.g. preset). */
export function saveGameOptions(storage: KeyValueStorage, opts: GameOptions): void {
  storage.setItem(
    SETTINGS_KEY,
    JSON.stringify({ ...storedSettings(storage), wear: opts.wear, fuel: opts.fuel, compound: opts.compound }),
  );
}
