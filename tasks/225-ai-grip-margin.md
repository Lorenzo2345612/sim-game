# 225 — Expert AI must not spin; difficulty orders pace

Status: pending
Phase: 1
Depends on: 093
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

AI cars at every difficulty drive the opening laps without spinning, and a harder difficulty covers more distance than an easier one.

## Context

Found in 093: on monza the expert AI (`speedScale` 1.0) overdrives the first chicane and spins; over 45 s it covers ~86 m less than easy (0.86). Cause: `speedProfile(line, carLimitsFromSpec(spec, fuelKg))` (`src/ai/speedProfile.ts`) is a point-mass limit with `mu = 0.95·mu0` that the real car (load sensitivity, cold tyres at the start, transients) cannot hold. Tasks 088/089 and their frozen tests stay unchanged: the fix lives in `RaceGame`.

## Files

- `src/game/raceGame.ts` — modify: `export const AI_GRIP_MARGIN: number` (calibrated, in [0.75, 1.0]); the limits passed to `speedProfile` are `carLimitsFromSpec(...)` with `muLat` and `muLong` multiplied by it. Nothing else changes.
- `tests/unit/acceptance/225-ai-grip-margin.test.ts` — create (acceptance worker).

## Steps

1. Set `AI_GRIP_MARGIN = 0.82` (no calibration sweep; see Planner answers — the last bullet overrides earlier ones).
2. If no value in [0.75, 1.0] passes, report BLOCKED with the per-value results (spin time, distance) — do not touch `aiDriver.ts`, `speedProfile.ts` or `traffic.ts`.

Definitions for the tests: "spin" = at any tick after go, the angle between the car's forward vector (−Z rotated by its quaternion, projected on XZ) and the track tangent at its `TrackProgress` index exceeds 60°. Distance = sum of horizontal displacement per tick after go. Setup: `RaceGame.create(track, spec, { trackId, carId, laps: 3, aiCount: 1, difficulty, seed: 1 })` with the default car spec used by 093 tests, player braking 1 throughout (stays on the grid, behind the AI); the AI is index 1 in `getStates`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, 1 AI, difficulty `expert`, seed 1 | step 60 s sim after go | AI distance > 1500 m (spin-free moved to 252) |
| AT2 | spa, 1 AI, difficulty `expert`, seed 1 | step 60 s sim after go | AI distance > 1500 m (spin-free moved to 252) |
| AT3 | monza, 1 AI, seed 1, difficulties `easy` and `expert` (separate games) | step 45 s after go | expert distance > easy distance + 5 m |
| AT4 | monza, 1 AI, seed 1, `medium` | step 45 s after go | easy distance < medium distance < expert distance |
| AT5 | source | read `src/game/raceGame.ts` | exports `AI_GRIP_MARGIN`, value in [0.75, 1.0] |

Existing tests that must still pass: all 088, 089, 092 and 093 acceptance and edge tests.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

AI driver controller changes, mistakes per lap, overtaking logic, speedProfile/traffic changes, HUD.

## Planner answers

- Margin alone cannot satisfy AT1/AT2. Add a stability aid in the AI controller (AI throttle/steer code, plus `raceGame.ts` if needed): when rear slip angle > 6° or |yaw rate − v·steerCurvature| > 0.25 rad/s, scale throttle by `max(0, 1 − excess/threshold)` and limit the steering increase that tick; all difficulties. Superseded where the split bullet below differs; EDGE3/EDGE4 must pass; add a unit test for the throttle scaling.
- No margin sweeps (previous runs timed out sweeping all values). Order: (1) implement the stability aid and its unit test; (2) run only `tests/unit/acceptance/225-*` with `AI_GRIP_MARGIN` = 0.82, then 0.80, then 0.85 if needed — at most 3 full runs; keep the first value that passes AT1–AT4. (3) If none passes, the tuning knobs are the aid thresholds (slip 4–8°, yaw error 0.15–0.30 rad/s), at most 3 more runs at margin 0.82. (4) Still failing: stop and report BLOCKED with the AT1–AT4 numbers per run. No debug re-runs of the 60 s probes.
- Split (planner, after 4 timeouts): the spin-free requirement moves to task 252. This task lands the stability aid + its unit test + `AI_GRIP_MARGIN = 0.82`; AT1–AT3 no longer assert spins (table updated). Do not tune further: at most 2 runs of the 225 acceptance file, no probes of speedProfile/racingLine/traffic.

## Planner-authorised test edits

- `tests/unit/acceptance/225-*.test.ts`: remove the "never spins"/"neither spins" assertions from AT1–AT3 to match the updated table; keep the distance assertions.
