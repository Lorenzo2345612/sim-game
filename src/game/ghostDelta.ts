/**
 * Time of the ghost lap at a given track distance, for the live lap delta.
 *
 * Ghost distances wrap at the lap length: the first sample may sit just behind
 * the line (distance ~lapLength) and the last may have crossed it (~0). Both
 * ends are ignored, and the call is stateless so a backward jump of the car
 * (lap change, reset) yields the right value at once.
 */
export function ghostTimeAt(
  ghostTimes: ArrayLike<number>,
  ghostDist: ArrayLike<number>,
  d: number,
  lapTime: number,
  lapLength: number,
): number | null {
  const n = ghostTimes.length;
  if (n < 2 || ghostDist.length !== n) return null;
  if (!Number.isFinite(d) || !Number.isFinite(lapTime)) return null;

  const half = lapLength / 2;
  // The interpolated position lags the sim at lap start, so the car reads just
  // behind the line while the lap clock is near zero: treat it as at the line.
  if (d > half && lapTime < 10) d = 0;

  let first = 0;
  while (first < n && ghostDist[first] > half) first++;
  if (first === n) return null;

  // A drop of more than half a lap is the distance wrapping past the line.
  let last = first;
  for (let i = first + 1; i < n && ghostDist[i] >= ghostDist[i - 1] - half; i++) last = i;

  let k = first - 1;
  for (let i = first; i <= last; i++) {
    if (ghostDist[i] <= d) k = i;
    else break;
  }
  if (k < first) return ghostTimes[first];
  if (k === last) return ghostTimes[last];

  const span = ghostDist[k + 1] - ghostDist[k];
  const u = span > 0 ? (d - ghostDist[k]) / span : 0;
  return ghostTimes[k] + (ghostTimes[k + 1] - ghostTimes[k]) * u;
}
