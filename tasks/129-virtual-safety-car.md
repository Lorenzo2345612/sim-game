# 129 — Virtual safety car

Status: pending
Phase: 2
Depends on: 088, 092
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure `Vsc` that deploys when a car is stopped on track, measures each car's delta to a reference pace and reports a +5 s penalty event for cars that stay too fast.

## Context

Design: `docs/plans/game-features.md` section 129. Layer `src/race` (pure: only `src/core`; no `three`, no `Math.random`). Reference speeds are the 088 `speedProfile` (`Float64Array`, m/s per racing-line point; `src/ai/speedProfile.ts`) with the matching cumulative distances along the lap (same convention as `RacingLine`, `src/ai/racingLine.ts`). `lapDistance` from `TrackProgress`. `time` = race seconds. Wiring and the AI cap are task 130.

## Files

- `src/race/vsc.ts` — create
- `tests/unit/race/vsc.test.ts` — create (edge cases)
- `tests/unit/acceptance/129-virtual-safety-car.test.ts` — create (acceptance worker)

## Steps

```ts
export type VscPhase = 'off' | 'deployed' | 'ending';
export interface VscEvent { car: number; seconds: 5 }
export class Vsc {
  constructor(speeds: Float64Array, dist: Float64Array, lapLength: number, carCount: number); // dist[i] = lap distance of speeds[i] (ascending, m)
  update(stoppedOnTrackSeconds: number, time: number): void; // max seconds any car has been stopped on track (0 = none)
  readonly phase: VscPhase;
  delta(car: number, lapDistance: number, time: number): number;
  drainEvents(): VscEvent[]; // returned once
}
```

- Phases: `off → deployed` when `stoppedOnTrackSeconds >= 10`. While deployed, `stoppedOnTrackSeconds === 0` means the cause cleared: phase `ending` for 5 s, then `off` (`time − clearTime >= 5` → off; `< 5` → ending). A cause reappearing (`> 0`) during `ending` returns to `deployed`. Going `off` resets every car's state.
- Reference pace = 0.6 × profile speed, linearly interpolated by `lapDistance` (wrapping). Per car, per deployment: the first `delta` call records the start time. Each later call adds `Δs / (0.6·v(lapDistance))` to the reference time, where `Δs` is the forward wrapped distance since the previous call (negative steps count 0). `delta` = (time − start time) − reference time; positive = slower than reference (OK). Returns 0 when phase is `off`.
- Penalty: per car, accumulate the time between `delta` calls during which delta < 0; when the accumulated time exceeds 2 s (`> 2`) push one `{ car, seconds: 5 }` event, once per car per deployment.
- Applies in phases `deployed` and `ending`.

Conventions: no rounding; `car` out of range → `RangeError`; non-finite `lapDistance`/`time` ignored (returns last delta); empty profile or lengths mismatch → throws `Error`; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | stopped 9.9 s / 10.0 s | phase | off / deployed |
| AT2 | constant profile 50 m/s, car at 30 m/s for 10 s after deploy | delta | 10 − 300/30 = 0 ± 1e-6 |
| AT3 | car at 35 m/s for 10 s | delta and events | delta < 0; one +5 s event |
| AT4 | cause clears at t | phase at t + 4.9 / t + 5.1 | ending / off |

## Acceptance criteria

- [ ] All AT rows pass; edge tests pass (second deployment resets state, event once per deployment, lap wrap).
- [ ] `src/race/vsc.ts` has no `three`/Rapier import and no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Detecting stopped cars, AI speed cap, HUD banner, `PenaltyBook` (task 130).
- Full safety car with a pace car.
