# 066 — Calibration suite and F4 tuning

Status: pending
Phase: 1
Depends on: 058, 065, 169
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A headless calibration suite drives the real `Vehicle` (task 065) and `public/cars/f4.json` is tuned until every F4 target passes.

## Context

Design and targets: `ai/guides/vehicle-dynamics.md` (section "Calibration targets"). Reference results and calibrated data: run `node ai/lab/vehicle-model.mjs`; `ai/lab/f4-carspec.json`, `ai/lab/vehicle-calibration.mjs`. Test harness style: `ai/guides/testing.md`. The thresholds are law: the worker may ONLY change values in `public/cars/f4.json` (never test thresholds, never `src/`). If a target cannot be met by JSON changes alone, stop and report as blocked. Planner clarifications: (a) every value changed in `public/cars/f4.json` must be mirrored with the same value in `ai/lab/f4-carspec.json` (058 AT4 keeps them equal) — this is the only allowed lab-file edit; tunable values may deviate from the original lab data within that rule. (b) The braking target (≤ 60 m) applies with ABS on only, as in AT3.

## Files

- `tests/unit/calibration/f4.test.ts` — create — scripted-input scenarios on the real `Vehicle` (physics world headless, `FIXED_DT` steps, flat ground).
- `public/cars/f4.json` — modify — tuning only.

## Steps

1. Helper `runScenario(script: (t: number, state: VehicleState) => VehicleInput, seconds: number)` inside the test file; each test builds a fresh world and `Vehicle` from `parseCarSpec(f4.json)`.
2. Implement AT1–AT8 as one `it` each, with exactly the thresholds in the table. Steering for AT4 is closed loop on lateral error (simple proportional controller), speed ramped slowly.
3. AT8 compares metrics against the output of the lab model for the same scenario: hard-code the lab values as constants (obtained by running `node ai/lab/vehicle-model.mjs`) in the test file with a comment on how to refresh them.
4. Tune `f4.json` (tyre mu0/Fz0/B/C/E, spring/damper, aero, diff, brake bias, aids) until all pass; keep values physically plausible and compounds ordered soft > medium > hard in grip.

Conventions: speeds km/h in test names only, SI in code; distance and time thresholds inclusive at both ends; seeded script for AT7 (fixed PRNG seed); inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat, full throttle, TC on | 0→100 km/h | 3.4–4.2 s |
| AT2 | full throttle 30 s | vmax | 215–235 km/h |
| AT3 | 150 km/h, full brake, ABS on | to stop | ≤ 60 m |
| AT4 | constant-radius 100 m (closed-loop steer on lateral error), speed ramp | max steady lateral accel | 1.5–2.2 g |
| AT5 | 150 km/h, full brake + full left steer 2 s, bias 0.6, ABS on | heading vs velocity | < 30° |
| AT6 | 5 km/h full lock 5 s | yaw-rate second difference RMS | < 0.05 rad/s³ |
| AT7 | 90 s mixed stint (seeded script) | end | tyre temps 60–120 °C; wear 0.5–5 %; fuel decreased |
| AT8 | same scenario as lab | each metric | within 15 % of `node ai/lab/vehicle-model.mjs` results |

## Acceptance criteria

- [ ] AT1–AT8 pass with `npm test`.
- [ ] `git diff` shows changes only in `public/cars/f4.json` (plus the new test file); no threshold relaxed.
- [ ] Phase 0/1 tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

Editing `src/`, the lab files, other cars, other compounds' data beyond keeping the ordering, UI, e2e.
