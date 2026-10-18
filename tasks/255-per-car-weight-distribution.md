# 255 — Per-car weight distribution and tyre widths

Status: pending
Phase: 2
Milestone: M2.1
Depends on: 254, 252
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Every car gets a realistic static weight distribution and front/rear tyre widths for its archetype (user request: "review weight distribution and tyres on all cars").

## Context

254 adds `chassis.weightFront`, `tyres.rearMuScale`, `wheels.widthRear` (see `tasks/254-weight-distribution-rear-grip.md`); ow26 is already set there. Here only data changes. f4 wheel z is already asymmetric (zF −1.469, zR 1.251); `weightFront` sets the CoM explicitly via 254's formula, independent of wheel placement. Guides: `ai/guides/architecture.md`, `ai/guides/vehicle-dynamics.md`, `ai/guides/testing.md`.

## Files

- `public/cars/{f4,gt3-a,gt3-b,gt3-c,gt3-d,hyper-a,lmp2-a,ow26}.json` — modify (data only).
- `tests/unit/acceptance/255-per-car-weight-distribution.test.ts` — create (acceptance worker).
- No `src/` change expected; if one is needed the coder stops and reports.

## Steps

Set these values in each car's JSON:

| car | weightFront | wheels.width | wheels.widthRear | tyres.rearMuScale |
|---|---|---|---|---|
| f4 | 0.43 | 0.200 | 0.250 | 1.05 |
| gt3-a (front-engine V8) | 0.48 | 0.300 | 0.310 | 1.00 |
| gt3-b (rear-engine flat-six) | 0.40 | 0.300 | 0.310 | 1.05 |
| gt3-c (mid-engine V8) | 0.44 | 0.300 | 0.310 | 1.03 |
| gt3-d (mid-engine V10) | 0.43 | 0.300 | 0.310 | 1.03 |
| hyper-a | 0.47 | 0.290 | 0.340 | 1.08 |
| lmp2-a | 0.44 | 0.300 | 0.310 | 1.03 |
| ow26 | 0.455 (unchanged) | 0.275 | 0.375 | 1.10 (unchanged) |

Sources: tyre widths from series regs/press (FIA F4 200/250, 2026 OW 275/375, GT3 Michelin 300/310, LMDh 290/340 per FIA LMDh regs Art. 12.3.3, LMP2 300/310); weight splits are estimates by archetype (no published values).

Allowed retune if a row fails: per car, `rearMuScale` within ±0.05 of target, and aero balance split (`claFront`/`claRear`, total constant). Never mass, power, engine, gearbox or wheel positions. Report every retune.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/255-per-car-weight-distribution.test.ts` before the coder starts. Baselines B are recorded from master by the acceptance worker at test-writing time, before any data change, and hard-coded. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each of the 8 cars at rest on a flat plane | settle 2 s | front axle normal load / total = its weightFront target ± 0.01 |
| AT2 | each car's parsed spec | parse | `wheels.width`, `wheels.widthRear` equal the table (±1e-9); widthRear ≥ width for every car |
| AT3 | each car, flat plane, 2nd gear at 15 m/s, steer 0.08 rad held | full-throttle step 3 s | no spin: \|body sideslip\| < 30° throughout |
| AT4 | each car, 50 m constant-radius circle at the limit (lateral accel ramp until slide) | run | front slip-angle peak reached first or within 0.1 s of the rear (no limit oversteer) |
| AT5 | each car, same circle | max steady lateral accel | within ±8 % of its master baseline B |
| AT6 | each car, flat straight, full throttle from 0 | time to 200 km/h (time to 150 km/h for f4) | within ±3 % of master baseline B |
| AT7 | f4, ow26 | `tests/unit/calibration/f4.test.ts`, `ow26.test.ts` | pass |

## Acceptance criteria

- [ ] AT1–AT7 pass.
- [ ] Full `npm test` passes.
- [ ] Report lists any retune.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `src/` changes, AI tuning, rendering the rear width, BoP, engine changes.
