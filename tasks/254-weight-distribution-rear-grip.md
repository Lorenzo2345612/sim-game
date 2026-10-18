# 254 — Weight distribution and rear grip (stable OW-26 rear)

Status: pending
Phase: 2
Depends on: 146, 239
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

OW-26 is stable at the rear: front-biased static weight (45.5 % front), wider/grippier rear tyres. Every other car stays bit-identical.

## Context

User report: "the F1 is very unstable at the rear". `public/cars/ow26.json` has wheel z = ±1.7032 with CoM at the body origin (50/50), identical grip on all wheels, and low-speed wheel torque far above rear grip with TC off. Real car: ~45.5 % front, rear tyres ~405 mm vs 305 mm front. Guides: `ai/guides/architecture.md`, `ai/guides/vehicle-dynamics.md`, `ai/guides/testing.md`. 146 adds damage and `getDownforce` in `vehicleModel.ts`; 239 edits only `sound.synth.turbo` in ow26.json.

## Files

- `src/physics/carSpec.ts` — modify: optional fields, defaults, validation.
- `src/physics/vehicleModel.ts` — modify: CoM shift and rear mu scale.
- `public/cars/ow26.json` — modify: new values only.
- `tests/unit/acceptance/254-weight-distribution-rear-grip.test.ts` — create (acceptance worker).

## Steps

1. `CarSpec` gains (parsed, defaults make existing cars identical): `chassis.weightFront: number` (0.3–0.7, default 0.5), `tyres.rearMuScale: number` (0.8–1.3, default 1), `wheels.widthRear: number` (default `wheels.width`; render/data only, no physics use). Out-of-range values throw with a field-path error, same style as the other `parseCarSpec` validation.
2. CoM: in `applyMass` set the body's local centre of mass z to `comZ = zFront + (1 − weightFront)·(zRear − zFront)` using mean front and rear wheel z (front is more negative z). Mass and inertia values unchanged. Do not move wheels or the visual model. With `weightFront` 0.5 the CoM must equal today's value exactly.
3. Every place that assumes CoM at the body origin (load transfer, cgHeight use, aero and suspension force points, damage, telemetry) must use the CoM. The coder lists the changed places in its report.
4. `rearMuScale` multiplies mu (grip factor) of wheels 2 and 3 only, all compounds, where the compound/`gripFactor` enters the wheel solver.
5. `ow26.json`: `chassis.weightFront 0.455`, `tyres.rearMuScale 1.10`, `wheels.width 0.305`, `wheels.widthRear 0.405`. Other cars untouched.
6. Re-run `tests/unit/calibration/ow26.test.ts`. If lap-time targets break, retune only ow26 aero balance (`claFront`/`claRear` split, total constant) or rear springs/ARB, and document the change in the report. No engine/power changes.

Conventions: `weightFront` and `rearMuScale` bounds inclusive; invalid input throws; defaults applied when the field is absent; spec objects not mutated.

## Planner answers (round 2)

State after two coder timeouts: steps 1–5 are implemented in the worktree and AT1–AT5, AT7 pass. Only AT6 fails: `ow26.test.ts` AT2 (0-100 = 2.26 s, floor 2.3) and AT3 (0-200 = 4.54 s, floor 4.8). The car is now traction-better at launch, so it is too quick, not too slow. Do not rewrite finished work; fix only this.

Authorised levers (ow26.json only, in this order; stop at the first that makes `ow26.test.ts` fully pass while AT4/AT5 still pass):
1. `tyres.rearMuScale` down from 1.10 to any value in 1.00–1.10 (AT4/AT5 must still pass).
2. `aids.tc.slip` (the slip target used when TC is on) in 0.08–0.25.
3. Final-drive / 1st-gear ratio change of at most ±8 %.
No calibration test window changes. Run only `npx vitest run tests/unit/calibration/ow26.test.ts tests/unit/acceptance/254-weight-distribution-rear-grip.test.ts` while tuning (each run is about 10 s); do not run the full suite until the end. Report the chosen values.

## Planner answers (round 3)

Accepted final tune: `rearMuScale` 1.03, `aids.tc.slip` 0.08, `gearbox.ratios[0]` 3.7 → 3.404 (lever 3 is authorised; keep it). No `src/` changes. The coder's report must list every CoM-dependent site changed in `vehicleModel.ts` (spec step 3).

Planner-authorised test edits (only these; nothing else in protected tests):
- `tests/unit/edge/244-engine-voice-timbre-edge.test.ts` EDGE8: update `PINNED['ow26.json']` to the hash of the new `ow26.json` (other cars' hashes unchanged).
- `tests/unit/edge/254-weight-distribution-rear-grip-edge.test.ts` EDGE1: build `bare` with `chassis.weightFront`, `tyres.rearMuScale` and `wheels.widthRear` deleted (as POST1 does) and compare it with the same spec carrying explicit defaults (0.5, 1, `width`).
- Same file EDGE8: expect `rearMuScale` within 1.00–1.10 (inclusive) instead of exactly 1.10; other values unchanged.
- Same file EDGE9: delete it (POST7 covers it).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/254-weight-distribution-rear-grip.test.ts` before the coder starts. AT2 baselines (position, velocity, yaw) are recorded from master by the acceptance worker at test-writing time, before any `src/` change, and hard-coded in the test. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | f4, gt3-a, lmp2-a specs (no new fields) | parse | `weightFront` 0.5, `rearMuScale` 1, `widthRear` = `width` |
| AT2 | f4 and gt3-a on a flat plane, scripted inputs (full throttle 3 s, then steer 0.1 rad 3 s), fixed seed | 6 s sim | final position, velocity and yaw equal the values recorded from master at test-writing time (±1e-9) |
| AT3 | ow26 at rest on a flat plane | settle 2 s | front axle normal load / total normal load = 0.455 ± 0.01 |
| AT4 | ow26 vs ow26 with overrides `weightFront 0.5, rearMuScale 1` (same code) | flat plane, 2nd gear at 15 m/s, steer 0.08 rad held, full throttle step for 3 s | max body sideslip of the new spec ≤ 0.7 × max sideslip of the override run, and the new spec does not spin (\|sideslip\| < 30° throughout) |
| AT5 | ow26, flat plane | constant-radius 50 m circle at the limit (lateral accel ramp until slide) | the rear axle saturates no earlier than the front (front slip-angle peak reached first or within 0.1 s) |
| AT6 | ow26 | `tests/unit/calibration/ow26.test.ts` | passes |
| AT7 | invalid values (`weightFront 0.9`, `rearMuScale 2`) | parse | rejected with a field-path error like other carSpec validation |

## Acceptance criteria

- [ ] AT1–AT7 pass.
- [ ] Full `npm test` passes (existing car tests unchanged).
- [ ] Coder report lists every CoM-dependent site changed and any ow26 retune.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Other cars' weight distribution or tyre widths (follow-up).
- Engine, power, TC or gearbox changes.
- Moving wheels or the visual model; rendering the rear width (data only).
- AI tuning (252).
