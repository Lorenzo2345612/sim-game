export const YELLOW_GAP_M = 30;
export const YELLOW_FOLLOW_MIN_MS = 5;

export function yellowCap(
  i: number,
  lapDist: ArrayLike<number>,
  speed: ArrayLike<number>,
  out: ArrayLike<number>,
  lapLength: number,
): number {
  const n = lapDist.length;
  let best = -1;
  let bestGap = Number.POSITIVE_INFINITY;
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    if (out[j] !== 0) continue;
    if (!(speed[j] >= YELLOW_FOLLOW_MIN_MS)) continue;
    let gap = (lapDist[j] - lapDist[i]) % lapLength;
    if (gap < 0) gap += lapLength;
    if (gap > 0 && gap <= YELLOW_GAP_M && gap < bestGap) {
      bestGap = gap;
      best = j;
    }
  }
  return best < 0 ? Number.NaN : speed[best];
}
