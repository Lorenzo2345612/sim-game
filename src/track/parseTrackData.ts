import type { Board, Bollard, EscapeRoad, Sausage, TrackData, TrackDataV2 } from '../core/types';

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

/** Validates fetched track JSON; v2 gets `environment`, `escapeRoads`, `boards`, `sausages` and `bank` defaulted. */
export function parseTrackData(json: unknown): TrackData | TrackDataV2 {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('Track data must be an object');
  }
  const obj = json as Record<string, unknown>;
  validateBarriers(obj.barriers);
  if (obj.version === 2) {
    const out = { ...obj } as Record<string, unknown>;
    if (out.environment === undefined) out.environment = 'parkland';
    if (!Array.isArray(out.escapeRoads)) out.escapeRoads = [] as EscapeRoad[];
    if (!Array.isArray(out.boards)) out.boards = [] as Board[];
    if (!Array.isArray(out.sausages)) out.sausages = [] as Sausage[];
    if (!Array.isArray(out.bollards)) out.bollards = [] as Bollard[];
    if (!Array.isArray(out.bank)) {
      const n = Array.isArray(out.centerline) ? (out.centerline as unknown[]).length : 0;
      out.bank = new Array<number>(n).fill(0);
    }
    return out as unknown as TrackDataV2;
  }
  return obj as unknown as TrackData;
}
