import type { KeyValueStorage } from '../core/settings';

export type LiveryPattern = 'solid' | 'stripe' | 'split' | 'chevron';

export interface Livery {
  primary: string;
  secondary: string;
  accent: string;
  pattern: LiveryPattern;
  number: number;
}

export const LIVERY_PATTERNS: readonly LiveryPattern[] = ['solid', 'stripe', 'split', 'chevron'];

const COLOUR_RE = /^#[0-9a-f]{6}$/;

// primaries: red, orange, yellow, lime, green, teal, cyan, blue, navy, purple, magenta, pink, white, silver, black, brown
const PALETTE_PRIMARY: readonly string[] = [
  '#e03131', '#f76707', '#f5c518', '#99e022',
  '#2f9e44', '#0ca678', '#15aabf', '#1c7ed6',
  '#22357a', '#7048e8', '#c2258c', '#f06595',
  '#ffffff', '#adb5bd', '#111318', '#8f5a3c',
];
// secondary = black on bright primaries, white on dark ones (better contrast)
const PALETTE_SECONDARY: readonly string[] = [
  '#000000', '#000000', '#000000', '#000000',
  '#000000', '#000000', '#000000', '#000000',
  '#ffffff', '#ffffff', '#ffffff', '#000000',
  '#000000', '#000000', '#ffffff', '#ffffff',
];

export const LIVERY_PALETTE: readonly Livery[] = PALETTE_PRIMARY.map((primary, i): Livery => ({
  primary,
  secondary: PALETTE_SECONDARY[i],
  accent: PALETTE_PRIMARY[(i + 1) % PALETTE_PRIMARY.length],
  pattern: 'solid',
  number: i + 1,
}));

export function defaultLivery(index: number): Livery {
  const base = LIVERY_PALETTE[((index % 16) + 16) % 16];
  return { ...base, number: ((index + 1) % 100 + 100) % 100 };
}

function parseColour(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`invalid livery ${field}: ${String(value)}`);
  }
  const lower = value.toLowerCase();
  if (!COLOUR_RE.test(lower)) {
    throw new Error(`invalid livery ${field}: ${value}`);
  }
  return lower;
}

function parsePattern(value: unknown): LiveryPattern {
  if (typeof value !== 'string' || !LIVERY_PATTERNS.includes(value as LiveryPattern)) {
    throw new Error(`invalid livery pattern: ${String(value)}`);
  }
  return value as LiveryPattern;
}

function parseNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 99) {
    throw new Error(`invalid livery number: ${String(value)}`);
  }
  return value;
}

export function parseLivery(json: unknown): Livery {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`invalid livery: not an object (${String(json)})`);
  }
  const o = json as Record<string, unknown>;
  return {
    primary: parseColour(o.primary, 'primary'),
    secondary: parseColour(o.secondary, 'secondary'),
    accent: parseColour(o.accent, 'accent'),
    pattern: parsePattern(o.pattern),
    number: parseNumber(o.number),
  };
}

function liveryKey(carId: string): string {
  return `livery:${carId}`;
}

export function loadLivery(storage: KeyValueStorage, carId: string): Livery {
  try {
    const raw = storage.getItem(liveryKey(carId));
    if (raw == null) return defaultLivery(0);
    return parseLivery(JSON.parse(raw));
  } catch {
    return defaultLivery(0);
  }
}

export function saveLivery(storage: KeyValueStorage, carId: string, livery: Livery): void {
  storage.setItem(liveryKey(carId), JSON.stringify(parseLivery(livery)));
}
