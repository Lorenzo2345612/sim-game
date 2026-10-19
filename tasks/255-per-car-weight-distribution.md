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
| f4 | unchanged (round 1) | unchanged | unchanged | unchanged |
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
| AT6 | each car except f4, flat straight, full throttle from 0 | time to 200 km/h | within ±10 % of master baseline B (round 1) |
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

## Planner answers (round 1)

1. **f4 is out of this task**: `public/cars/f4.json` stays bit-identical to master (no weightFront, widths or rearMuScale added). Revert any f4 change. The f4 calibration, lab mirror, neural AI models and tests 058 AT4, 215 AT1, 066, f4.test.ts, 252 EDGE7, 269 AT3 are therefore unaffected. AT1, AT2 and AT3–AT6 rows skip f4 (7 cars); AT7 still runs f4.test.ts and must pass unchanged. The acceptance and edge tests for 255 may be edited to drop f4 (planner-authorised).
2. **AT6 tolerance is ±10 %** (was ±3 %): moving weight rearward on RWD cars legitimately improves launch traction. gt3-b may keep table rearMuScale 1.05 or the reported 1.005; report which. Make the AT6 loop check all cars before failing (collect errors, one assertion).
3. **255 EDGE5**: use `toBeCloseTo(expected, 8)` (Rapier stores CoM as f32). Authorised.
4. **244 EDGE8 PINNED hashes**: authorised update for every car JSON this task changes (recompute with the test's own hash function); f4 hash unchanged.
5. **254 tests**: authorised edits — AT1: keep only the f4 parse expectation (weightFront default) and drop gt3-a/lmp2-a 0.5; AT2: keep only f4 bit-identical; EDGE8: ow26 width 0.275, widthRear 0.375; post test L215: replace `widthRear == width` with `widthRear >= width`.
6. **076 AT3** (gt3-d dynamics deep-equal gt3-a): authorised to exclude `chassis.weightFront`, `tyres.rearMuScale`, `wheels.width`, `wheels.widthRear` from the comparison.
7. Pre-existing failures (249 AT3, 250 AT9, 269 POST9, 224 POST4) are not this task's; ignore them.

Files added (authorised edits): `tests/unit/acceptance/254-weight-distribution-rear-grip.test.ts`, `tests/unit/edge/254-weight-distribution-rear-grip-edge.test.ts`, `tests/unit/edge/254-weight-distribution-rear-grip.post.test.ts`, `tests/unit/edge/244-engine-voice-timbre-edge.test.ts`, `tests/unit/acceptance/076-gt3-d.test.ts`, `tests/unit/edge/255-per-car-weight-distribution-edge.test.ts`.

## Planner answers (round 2)

- 255 EDGE5: compare against the f32-rounded value, `toBeCloseTo(Math.fround(expected), 7)` (authorised; f32 CoM storage). Then run the rest (AT1–AT7, typecheck, lint, task tests).
- ow26 rearMuScale stays 1.03; gt3-b 1.005 accepted; 076 AT3 handling accepted.
