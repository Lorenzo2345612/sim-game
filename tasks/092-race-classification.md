# 092 — Race classification

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure `RaceClassification` that tracks laps, lap times, positions, penalties, gaps to the leader and race end for N cars from per-tick lap distances.

## Context

Layer `src/race` (imports only `src/core`, `src/track`; pure, no `Math.random`). `lapDistance` is `ProgressSample.distance` from `TrackProgress` (`src/track/trackProgress.ts`): metres along the lap in [0, L), wraps to 0 at the start line. Race time 0 = race start; `time` passed to `update` is race time in seconds. Cars start behind the line.

## Files

- `src/race/classification.ts` — create
- `tests/unit/race/classification.test.ts` — create

## Steps

```ts
export interface Standing { car: number; position: number; lap: number; distance: number; finished: boolean; totalTime: number | null; /* finish crossing time, race start = time 0 */ penalty: number; gapToLeader: number | null; lastLap: number | null; bestLap: number | null }
export class RaceClassification {
  constructor(carCount: number, laps: number, lapLength: number);
  update(car: number, lapDistance: number, time: number): void;
  addPenalty(car: number, seconds: number): void;
  standings(): readonly Standing[];   // sorted by position (1-based); same array and objects reused between calls
  readonly finished: boolean;         // getter: every car finished or retired
  retire(car: number): void;
}
```

- Lap counting: before the first crossing a car has lap 0 and race distance `lapDistance − L`. The first crossing (lapDistance jumps from > 0.9·L to < 0.1·L between consecutive samples) starts lap 1 at the interpolated crossing time. Each later crossing completes a lap only if the car passed 0.5·L since the previous crossing (reverse crossings and re-crossings do not count). Crossing time = linear interpolation between the two samples by distance travelled (wrapping at L). Completing lap `laps` sets `finished`/`totalTime` for the leader and starts the chequered flag; every other car finishes at its next crossing after the flag (also counting lap completion).
- Race distance = (lap − 1)·L + lapDistance. Position order: finished cars by (totalTime + penalty) ascending, then running cars by race distance descending, then retired cars (retire order). `Standing.distance` = race distance; `lastLap`/`bestLap` are raw lap times (null until a lap completes); `penalty` accumulated seconds.
- gapToLeader (s): time the car reached its current race distance minus the time the leader reached that distance (leader's distance→time history sampled every 50 m, linear interpolation); leader 0; null if the leader has no history that far or the car has not started a lap.

Conventions: `car` out of range → throw `RangeError`; non-finite input ignored; a negative-direction jump or no jump leaves the lap unchanged; ties in order broken by lower car index; times in seconds, no rounding; `update` after a car finished is ignored.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | 2 cars, 2 laps, L 1000; race starts at time 0; car 0 constant 50 m/s, car 1 constant 40 m/s, both from lapDistance 990 | feed samples at 1/120 s until finished | car 0 lap times 20.0 ± 0.01, totalTime 40.2 ± 0.01, position 1; car 1 lap times 25.0 ± 0.01, totalTime 50.25 ± 0.01, position 2 |
| AT2 | AT1 at time 15 s | standings | car 1 gapToLeader = 15 − (race dist 590 reached by car 0 at 11.8+0.2=12.0) → 3.0 ± 0.05 s |
| AT3 | car crosses the line, reverses back across, crosses again | update | lap counted once |
| AT4 | 2 cars finish 0.5 s apart, the first with addPenalty 5 | standings | the penalised car is 2nd |
| AT5 | AT1 at time 45 | standings / finished | car 0 finished, car 1 not finished, `finished` false; after 50.25 s `finished` true |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `standings()` returns the same array instance on every call and allocates no per-call objects.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Computing `lapDistance` (TrackProgress does), penalty rules (jump start, track limits), pit stops.
- HUD/results UI, persistence, wiring into `src/game`.
- Editing `ai/guides/architecture.md` (done in 089).
