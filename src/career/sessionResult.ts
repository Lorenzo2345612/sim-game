import type { SessionResult } from './weekend';
import type { Standing } from '../race/classification';
import type { QualiStanding } from '../race/qualifying';

function byPosition<T extends { car: number; position: number }>(st: readonly T[]): number[] {
  return st.slice().sort((a, b) => a.position - b.position).map((s) => s.car);
}

export function raceSessionResult(st: readonly Standing[], laps: number): SessionResult {
  const n = st.length;
  const order = byPosition(st);
  const bestLaps: (number | null)[] = new Array<number | null>(n).fill(null);
  const classified = new Array<boolean>(n).fill(false);
  const minCompleted = Math.ceil(0.9 * laps);
  for (const s of st) {
    bestLaps[s.car] = s.bestLap;
    const completed = Math.max(0, s.lap - 1);
    classified[s.car] = s.finished || completed >= minCompleted;
  }
  let fastestLapCar: number | null = null;
  let fastest = Infinity;
  let fastestPos = Infinity;
  for (const s of st) {
    if (!classified[s.car] || s.bestLap === null) continue;
    const better =
      fastestLapCar === null ||
      s.bestLap < fastest ||
      (s.bestLap === fastest && s.position < fastestPos);
    if (better) {
      fastest = s.bestLap;
      fastestPos = s.position;
      fastestLapCar = s.car;
    }
  }
  return { order, bestLaps, classified, fastestLapCar };
}

export function qualiSessionResult(st: readonly QualiStanding[]): SessionResult {
  const bestLaps: (number | null)[] = new Array<number | null>(st.length).fill(null);
  for (const s of st) bestLaps[s.car] = s.bestLap;
  return {
    order: byPosition(st),
    bestLaps,
    classified: new Array<boolean>(st.length).fill(true),
    fastestLapCar: null,
  };
}
