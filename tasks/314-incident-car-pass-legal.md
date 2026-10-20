# 314 — Passing the incident car under yellow is legal

Status: pending
Phase: 2
Depends on: 305, 309
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Overtaking the car that caused the yellow (spinning, off track or slow) never opens a give-back or penalty; a spinning car is itself a yellow cause.

## Context

User report: penalised for passing a car that was spinning. `RaceGame` (~raceGame.ts:1130) only exempts passed cars that are stopped, finished or slower than `YELLOW_FOLLOW_MIN_MS`; a car spinning at speed is not exempt, and it is not a yellow cause in `FlagState` (`src/race/flags.ts`: cause = `offTrack` or speed < `CAUSE_SPEED`). Tasks 305 (give-back) and 309 (countdown) land first and touch the same code; keep their behaviour.

## Files

- `src/race/flags.ts` — modify — `spinning` cause, `lastCauseAt`, `isIncidentPass`.
- `src/game/raceGame.ts` — modify — fill `spinning`, skip incident passes.
- `tests/unit/acceptance/314-incident-car-pass-legal.test.ts` — create (acceptance worker).

## Steps

```ts
// FlagCar gains: spinning?: boolean   (absent = false)
// FlagState gains:
lastCauseAt(car: number): number;   // sim time of the last update where the car was a cause; NaN if never
export const INCIDENT_EXEMPT_S = 5;
export function isIncidentPass(lastCauseAt: number, time: number): boolean; // time - lastCauseAt <= 5 + 1e-9; false for NaN
```
1. In `FlagState.update` a car is a cause when `offTrack`, or `spinning`, or slow (existing rule incl. start grace). `spinning` feeds the same single-yellow timer as `offTrack` (not double yellow). `lastCauseAt` is set on every update where the car is a cause, including during the grace-free countdown of 309.
2. `RaceGame` sets `spinning` for car i when speed > 2 m/s and (|yaw rate| > 1.2 rad/s or the angle between the car's heading and the track tangent at its position > 0.6 rad). Reuse existing per-step yaw-rate/heading data; no allocations.
3. In the overtake loop, skip (no give-back, no penalty) when `isIncidentPass(flags.lastCauseAt(passed), time)` is true, in addition to the existing exemptions.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | — | `isIncidentPass(NaN, 10)`, `(5, 10)`, `(5.5, 10)`, `(4.99, 10)` | false, true, true, false |
| AT2 | `new FlagState([0, 1000, 2000], 3000)`; car 0 lapDistance 500, speed 15, on track, `spinning: true`; car 1 lapDistance 300, speed 40 | update every 1/120 s from t = 0 to t = 1.2 | `sectorFlag(1)` `'yellow'` at t = 1.1 (one step tolerance); `lastCauseAt(0)` = 1.2 ± 1e-9; `lastCauseAt(1)` NaN |
| AT3 | same FlagState; car 0 off track at lapDistance 500 for t ∈ [0, 2), then on track at speed 20, not spinning, lapDistance 500 for t < 2, then 500 + 20 (t − 2); car 1 on track, speed 40, lapDistance 410 + 40 t | update every 1/120 s to t = 2.6 (car 1 passes car 0 at t = 2.5; sector still yellow by DECAY) | `overtakeUnderYellow()` reports `{car: 1, passed: 0}` and `isIncidentPass(lastCauseAt(0), 2.5)` is true |
| AT4 | same FlagState, no `spinning` field on any car | 128 AT3 scenario | unchanged results (yellow/green times identical to 128) |

## Acceptance criteria

- [ ] AT1–AT4 pass; 128, 130, 289, 298, 305, 308, 309 tests still pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/314- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289- tests/unit/acceptance/298- tests/unit/acceptance/305- tests/unit/acceptance/308- tests/unit/acceptance/309-
```

## Out of scope

- HUD changes, AI behaviour around spinning cars, double-yellow rules, penalty amounts.
