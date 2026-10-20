export type TimeOfDay = 'day' | 'sunset' | 'night';

export const TRACK_DEFAULT_TOD: Record<string, TimeOfDay> = {
  lusail: 'night',
  bahrain: 'night',
  singapore: 'night',
  lasvegas: 'night',
};

export function defaultTimeOfDay(trackId: string): TimeOfDay {
  return TRACK_DEFAULT_TOD[trackId] ?? 'day';
}

// Exact lowercase match only; anything else is ignored (never throws).
export function parseTimeOfDay(value: string | null | undefined): TimeOfDay | null {
  if (value === 'day' || value === 'sunset' || value === 'night') return value;
  return null;
}
