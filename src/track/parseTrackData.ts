import type { EscapeRoad, TrackData, TrackDataV2 } from '../core/types';

const BARRIER_TYPES = new Set(['armco', 'tyres', 'wall', 'foam']);

function validateBarriers(barriers: unknown): void {
  if (!Array.isArray(barriers)) return;
  for (const b of barriers) {
    const type = (b as { type?: unknown } | null)?.type;
    if (typeof type !== 'string' || !BARRIER_TYPES.has(type)) {
      throw new Error(`Invalid barrier type: ${String(type)}`);
    }
  }
}

/** Validates fetched track JSON; v2 gets `escapeRoads` defaulted to []. */
export function parseTrackData(json: unknown): TrackData | TrackDataV2 {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('Track data must be an object');
  }
  const obj = json as Record<string, unknown>;
  validateBarriers(obj.barriers);
  if (obj.version === 2) {
    const out = { ...obj } as Record<string, unknown>;
    if (!Array.isArray(out.escapeRoads)) out.escapeRoads = [] as EscapeRoad[];
    return out as unknown as TrackDataV2;
  }
  return obj as unknown as TrackData;
}
