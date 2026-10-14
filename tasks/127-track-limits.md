# 127 — Track limits strikes

Status: pending
Phase: 2
Depends on: 092, 093
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure `TrackLimits` counter turns repeated all-four-wheels-off excursions into warnings and then 5 s penalty events.

## Context

Design: `docs/plans/game-features.md` section 127. Layer `src/race` (pure: imports only `src/core`; no `three`, no Rapier, no `Math.random`). Wheel surfaces come from `Vehicle.getWheelSurfaces(): Surface[]` (`src/physics/vehicle.ts`; `Surface` in `src/core/types.ts`). Car index = index in `RaceGame` (093, player 0). `time` is race seconds. Wiring into `RaceGame` is task 130.

## Files

- `src/race/trackLimits.ts` — create
- `tests/unit/acceptance/127-track-limits.test.ts` — create (acceptance worker)

## Steps

```ts
import type { Surface } from '../core/types';
export type TrackLimitEvent = { type: 'warning'; count: number } | { type: 'penalty'; seconds: number };
export interface TrackLimitsOptions { warnings: number; penalty: number; minOffSeconds: number }
export const DEFAULT_TRACK_LIMITS: TrackLimitsOptions; // { warnings: 3, penalty: 5, minOffSeconds: 0.25 }
export function countWheelsOff(surfaces: readonly Surface[]): number; // wheels on grass | gravel | runoff
export class TrackLimits {
  constructor(carCount: number, opts?: Partial<TrackLimitsOptions>);
  update(car: number, wheelsOff: number, time: number): TrackLimitEvent | null;
  forceStrike(car: number): TrackLimitEvent; // test hook: registers a strike immediately
  strikes(car: number): number;
}
```

- Excursion: `wheelsOff === 4` continuously. A strike is registered the first update where the excursion has lasted `>= minOffSeconds` (one strike per excursion).
- Re-arming: after a strike, a new excursion counts only once `wheelsOff < 4` has held continuously for `>= 1 s`; shorter gaps continue the same excursion state (no new strike).
- Strike number n: `n <= warnings` → `{ type: 'warning', count: n }`; `n > warnings` → `{ type: 'penalty', seconds: penalty }`.
- `wheelsOff < 4` (e.g. 3 wheels off for any duration) never strikes. Kerb and asphalt wheels are "on".

Conventions: durations compared with `>=` (1e-9 slack); `car` out of range → `RangeError`; `wheelsOff` clamped to [0, 4], non-finite treated as 0; no rounding; `update` returns at most one event per call.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 4 excursions of 0.5 s separated by 2 s | update at 1/120 | events warning 1, warning 2, warning 3, penalty 5 |
| AT2 | excursion of 0.2 s | update | no event |
| AT3 | 4 wheels off 0.5 s, back 0.5 s, off 0.5 s | update | one strike only |
| AT4 | 3 wheels off for 5 s | update | no event |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `src/race/trackLimits.ts` imports nothing from `three`/Rapier and does not use `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into `RaceGame`, HUD toasts, `PenaltyBook` (task 130).
- Detecting wheel surfaces (use the existing `getWheelSurfaces`).
- Lap invalidation (already exists in `LapTimer`).
