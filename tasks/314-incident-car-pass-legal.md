# 314 — Incident car may be passed under yellow; yellow clears 3 s after the threat

Status: pending
Phase: 2
Depends on: 305, 309
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Overtaking the car that caused the yellow (spinning, off track or slow) is legal for as long as that yellow lasts; a spinning car is itself a yellow cause; in races a yellow lasts 3 s after the last cause (was 2 s).

## Context

User reports: penalised for passing a car that was spinning; the yellow should stay ~3 s after the threat ends. `RaceGame` (~raceGame.ts:1130) only exempts passed cars that are stopped, finished or slower than `YELLOW_FOLLOW_MIN_MS`; a car spinning at speed is not exempt, and it is not a yellow cause in `FlagState` (`src/race/flags.ts`: cause = `offTrack` or speed < `CAUSE_SPEED`). Tasks 305 (give-back) and 309 (countdown) land first and touch the same code; keep their behaviour.

## Files

- `src/race/flags.ts` — modify — `spinning` cause, `lastCauseAt`, `isIncidentPass`.
- `src/game/raceGame.ts` — modify — fill `spinning`, skip incident passes.
- `tests/unit/acceptance/314-incident-car-pass-legal.test.ts` — create (acceptance worker).

## Steps

```ts
// FlagCar gains: spinning?: boolean   (absent = false)
// FlagOptions (308/309) gains: decayS?: number   // default 2 = DECAY today
export const RACE_DECAY_S = 3;
// FlagState gains:
isIncidentCar(car: number): boolean; // true from the first update where the car is a cause until the sector where it last was a cause is green again
```
1. In `FlagState.update` a car is a cause when `offTrack`, or `spinning`, or slow (existing rule incl. start grace). `spinning` feeds the same single-yellow timer as `offTrack` (not double yellow).
2. Incident mark: set when a car is a cause (even before its 1 s `YELLOW_AFTER` or 309 countdown completes); remember the sector of its latest cause tick; clear it on the first update where that sector's flag is `'green'` and the car is not a cause.
3. `decayS` replaces the `DECAY` constant (default 2 keeps every existing test); `RaceGame` passes `decayS: RACE_DECAY_S` with the 308/309 options.
4. `RaceGame` sets `spinning` for car i when speed > 2 m/s and (|yaw rate| > 1.2 rad/s or the angle between heading and track tangent > 0.6 rad). Reuse existing per-step data; no allocations.
5. In the overtake loop, skip (no give-back, no penalty) when `flags.isIncidentCar(passed)`, in addition to the existing exemptions.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new FlagState([0, 1000, 2000], 3000)`; car 0 lapDistance 500, speed 15, on track, `spinning: true`; car 1 lapDistance 300, speed 40 | update every 1/120 s to t = 1.2 | `sectorFlag(1)` `'yellow'` at t = 1.1 (one step); `isIncidentCar(0)` true from t = 0; `isIncidentCar(1)` false |
| AT2 | same FlagState; car 0 off track at lapDistance 500 for t ∈ [0, 2), then on track, speed 20, lapDistance 500 + 20 (t − 2); car 1 on track, speed 40, lapDistance 410 + 40 t | update every 1/120 s to t = 2.6 | `overtakeUnderYellow()` reports `{car: 1, passed: 0}` at t ≈ 2.5; `isIncidentCar(0)` true at 2.5 |
| AT3 | as AT2, continue to t = 4.5 | update | `sectorFlag(1)` `'green'` at 4.1; `isIncidentCar(0)` false at 4.1 and after |
| AT4 | as AT2 with options `{decayS: 3}` | update to t = 5.2 | `'yellow'` at 4.9, `'green'` at 5.1 (one step) |
| AT5 | FlagState without `spinning` or `decayS` | 128 AT3 scenario | unchanged results (yellow/green times identical to 128) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 128, 130, 289, 298, 305, 308, 309 tests still pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/314- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289- tests/unit/acceptance/298- tests/unit/acceptance/305- tests/unit/acceptance/308- tests/unit/acceptance/309-
```

## Out of scope

- HUD changes, AI behaviour around spinning cars, double-yellow rules, penalty amounts.
