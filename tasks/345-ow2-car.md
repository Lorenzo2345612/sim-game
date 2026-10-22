# 345 — `ow2` car data, menu entry and voice

Status: pending
Phase: 7
Depends on: 344
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A drivable brand-neutral turbo feeder car "OW-2 Feeder Turbo" (`ow2`) with DRS spec and its own turbo V6 voice.

## Context

Design: `docs/design/ow-ladder.md`. Values: research doc sections 2.3 (carSpec) and 4 (sound) plus design decisions: massKg 795, wheel radius 0.33, width 0.31 front / `widthRear` 0.37, limiter 8750, 462 kW at ~8750 rpm, 570 N.m at 6000, DRS dragScale 0.85, downforceScale 0.88, transitionS 0.2, `drs: true`; turbo lag by steep 3000-5000 rpm torque rise and `sound.synth.turbo.lagS` 0.5. Model `/models/ow26.glb`. Models reuse existing `.glb` (no new asset, no licence line). `massKg` 795 is a planner decision; the 740 fallback is allowed only inside 346. Never write real-series and manufacturer brand names anywhere in the JSON. Index/menu/protected-test edits follow the pattern of task 286 (listed below; the planner authorises these number-only edits).

## Files

- `public/cars/ow2.json` — create (id `ow2`, name `OW-2 Feeder Turbo`)
- `public/cars/index.json` — modify: append `ow2` entry last
- `src/ui/menu.ts` — modify: append `'ow2'` to `CAR_IDS`
- Protected enumerating tests, numbers only (append `ow2` after `ow3`): `tests/e2e/acceptance/073-car-selection.spec.ts`, `tests/unit/calibration/ow26.test.ts` (AT9 `INDEX_OTHERS`), `tests/unit/edge/221-ow26-car.test.ts` (EDGE2), `tests/unit/edge/221-ow26-car.post.test.ts` (POST11), `tests/unit/acceptance/231-car-synth-data.test.ts` (`CAR_IDS`), `tests/unit/acceptance/244-engine-voice-timbre.test.ts` (AT8 maps: pipeM/tailM/drive/exhaustGain/crackle for the new id), `tests/unit/acceptance/226-engine-sound-spec.test.ts` (AT6 valid via cylinders 6)
- `tests/unit/acceptance/345-ow2-car.test.ts`, `tests/e2e/acceptance/345-ow2-car.spec.ts` — create

## Steps

1. `ow2.json` valid for `parseCarSpec`/`parseEngineSynth`; sound per research section 4 incl. turbo block (wastegate/valve fields as ow26 pattern), explicit exhaust fields filled for 244 AT8.
2. Menu/index/protected-test updates as in 344, with `ow2` after `ow3`.

Conventions: as 344.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/345-ow2-car.test.ts` (e2e rows into `tests/e2e/acceptance/345-ow2-car.spec.ts`). Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | ow2.json | parseCarSpec | massKg 795, rwd, 6 gears, limiter 8750, activeAero {0.85, 0.88, 0.2, drs true}, fuel cap 125 |
| AT2 | ow2 spec | torque x rpm | <= 462e3 x 1.01; within 2 % of 462e3 near 8700 rpm; torque at 6000 rpm 570 (1e-6) |
| AT3 | flat world, TC on, full throttle | 0-100 / 0-200 km/h | 2.4-3.4 s / 6.0-8.2 s |
| AT4 | 40 s full throttle, zone off / forced open (`setAeroZone(true)`) | vmax | 300-335 km/h; open >= 8 km/h above closed |
| AT5 | 100 m skidpad | lateral accel | 2.6-3.8 g |
| AT6 | ow2 voice vs ow3 voice, 6000 rpm, same render settings | FFT low band (100-500 Hz) energy ratio | ow2 / ow3 >= 1.0 (heavier turbo voice); both finite |
| AT7 | e2e menu | open car select | "OW-2 Feeder Turbo" listed after "OW-3 Feeder"; `/?car=ow2&track=monza` loads |

## Acceptance criteria

- [ ] All ATs pass; protected tests updated and green; no forbidden names.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run tests/unit/acceptance/345- tests/unit/acceptance/344- tests/unit/acceptance/231- tests/unit/acceptance/244- tests/unit/acceptance/226- tests/unit/calibration/ow26.test.ts tests/unit/edge/221-
npx playwright test 345- 344- 073-
```

## Out of scope

- Custom model, lap-time calibration (346), series data.
