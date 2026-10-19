export interface CarTrafficState {
  distance: number; // along lap (m)
  lateral: number; // from centerline (+ right)
  speed: number;
}

export interface TrafficDecision {
  offset: number;
  speedCap: number | null;
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

const BLOCK_AHEAD = 25;
const BLOCK_LATERAL = 2.5;
const BLOCK_SPEED_MARGIN = 0.5;
const PASS_LATERAL = 3.0;
const EDGE_MARGIN = 1.0;
const ALONGSIDE_GAP = 5;
const ALONGSIDE_LATERAL = 2.2;

const DIFFICULTY: Record<Difficulty, { speedScale: number; mistakesPerLap: number }> = {
  easy: { speedScale: 0.86, mistakesPerLap: 0.4 },
  medium: { speedScale: 0.93, mistakesPerLap: 0.2 },
  hard: { speedScale: 0.98, mistakesPerLap: 0.08 },
  expert: { speedScale: 1.0, mistakesPerLap: 0 },
};

function wrapGap(raw: number, lapLength: number): number {
  // wrap to (-L/2, L/2]; a raw gap of exactly -L/2 maps to +L/2
  const g = ((raw % lapLength) + lapLength) % lapLength;
  return g > lapLength / 2 ? g - lapLength : g;
}

function passDecision(
  blocker: CarTrafficState,
  halfWidth: number,
  lineOffsetAhead: number,
  curvatureAhead: number,
  out: TrafficDecision,
): TrafficDecision {
  const limit = halfWidth - EDGE_MARGIN;
  const right = blocker.lateral + PASS_LATERAL;
  const left = blocker.lateral - PASS_LATERAL;
  const preferRight = curvatureAhead > 0;
  const preferred = preferRight ? right : left;
  const alternative = preferRight ? left : right;
  if (Math.abs(preferred) <= limit) {
    out.offset = preferred - lineOffsetAhead;
    out.speedCap = null;
  } else if (Math.abs(alternative) <= limit) {
    out.offset = alternative - lineOffsetAhead;
    out.speedCap = null;
  } else {
    out.offset = 0;
    out.speedCap = blocker.speed;
  }
  return out;
}

// `out` (optional) is filled and returned so per-tick callers can avoid allocating.
export function trafficDecision(
  self: CarTrafficState,
  others: readonly CarTrafficState[],
  lapLength: number,
  halfWidth: number,
  lineOffsetAhead: number,
  curvatureAhead: number,
  out?: TrafficDecision,
): TrafficDecision {
  let blocker: CarTrafficState | null = null;
  let blockerGap = Infinity;
  let alongside: CarTrafficState | null = null;
  let alongsideGap = Infinity;

  for (const other of others) {
    const gap = wrapGap(other.distance - self.distance, lapLength);
    if (
      gap > 0 &&
      gap < BLOCK_AHEAD &&
      Math.abs(other.lateral - lineOffsetAhead) < BLOCK_LATERAL &&
      self.speed > other.speed + BLOCK_SPEED_MARGIN &&
      gap < blockerGap
    ) {
      blockerGap = gap;
      blocker = other;
    }
    const absGap = Math.abs(gap);
    if (
      absGap < ALONGSIDE_GAP &&
      Math.abs(other.lateral - self.lateral) < ALONGSIDE_LATERAL &&
      absGap < alongsideGap
    ) {
      alongsideGap = absGap;
      alongside = other;
    }
  }

  const res = out ?? { offset: 0, speedCap: null };
  if (blocker) return passDecision(blocker, halfWidth, lineOffsetAhead, curvatureAhead, res);
  if (alongside) {
    res.offset = alongside.lateral >= self.lateral ? -1.0 : 1.0;
    res.speedCap = null;
  } else {
    res.offset = 0;
    res.speedCap = null;
  }
  return res;
}

export function difficultyParams(d: Difficulty): { speedScale: number; mistakesPerLap: number } {
  const p = DIFFICULTY[d];
  return { speedScale: p.speedScale, mistakesPerLap: p.mistakesPerLap };
}
