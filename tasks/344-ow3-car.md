# 344 — `ow3` car data, menu entry and voice

Status: pending
Phase: 7
Depends on: 340
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A drivable brand-neutral 673 kg NA feeder car "OW-3 Feeder" (`ow3`) with DRS spec and its own NA V6 voice.

## Context

Design: `docs/design/ow-ladder.md`. Values: `docs/research/cars/ow-ladder-f3-f2.md` sections 1.4 (carSpec) and 1.5 (sound) plus the gap decisions in the design doc (tyre widths 0.30 front / `widthRear` 0.36; DRS dragScale 0.88, downforceScale 0.90, transitionS 0.2, `drs: true`). Model `/models/f4.glb` (`model.url`; custom scaled model later). Models reuse existing `.glb` (no new asset, no licence line). Never write real-series and manufacturer brand names anywhere in the JSON. Index/menu/protected-test edits follow the pattern of task 286 (listed below; the planner authorises these number-only edits).

## Files

- `public/cars/ow3.json` — create (id `ow3`, name `OW-3 Feeder`, category `open-wheel`)
- `public/cars/index.json` — modify: append `{ "id": "ow3", "name": "OW-3 Feeder", "category": "open-wheel" }` last
- `src/ui/menu.ts` — modify: append `'ow3'` to `CAR_IDS`
- Protected enumerating tests, numbers only (append the new id/name after the last entry): `tests/e2e/acceptance/073-car-selection.spec.ts`, `tests/unit/calibration/ow26.test.ts` (AT9 `INDEX_OTHERS`), `tests/unit/edge/221-ow26-car.test.ts` (EDGE2), `tests/unit/edge/221-ow26-car.post.test.ts` (POST11), `tests/unit/acceptance/231-car-synth-data.test.ts` (`CAR_IDS`), `tests/unit/acceptance/244-engine-voice-timbre.test.ts` (AT8 maps: pipeM/tailM/drive/exhaustGain/crackle for the new id), `tests/unit/acceptance/226-engine-sound-spec.test.ts` (AT6 valid via cylinders 6)
- `tests/unit/acceptance/344-ow3-car.test.ts`, `tests/e2e/acceptance/344-ow3-car.spec.ts` — create

## Steps

1. `ow3.json` valid for `parseCarSpec` and `parseEngineSynth`; mass 673, rwd, 6 ratios, limiter 8500, torque curve peaks 420 N.m, <= 283 kW everywhere, 283 kW at 8000 rpm; fuel 50 L cap / 35 L start; wings 0-10 setup as f4.
2. Voice: 6 cylinders, firing [0,95,240,335,480,575], no turbo, `whine` order 11 source wheel, explicit `pipeM`, `tailM`, `drive`, `exhaustGain`, `crackle` values (research 1.5) so tests 244 AT8 maps are filled.
3. Menu/index entries and the protected-test updates listed in Files.

Conventions: engine power check uses torque x rpm in the curve; carSpec numbers copied, not re-derived.

## Acceptance tests (defined by the planner with Opus, before coding)

Finalised by the Opus planner. Executable contract; the `acceptance` worker turns each row into `tests/unit/acceptance/344-ow3-car.test.ts` (e2e rows into `tests/e2e/acceptance/344-ow3-car.spec.ts`). Nobody else may change these rows or tests.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | ow3.json | parseCarSpec | massKg 673, drive rwd, 6 gears, activeAero {0.88, 0.90, 0.2, drs true}, fuel start 35 |
| AT2 | ow3 spec | max over torqueCurve of torque x rpm x pi/30 | <= 283e3 x 1.01; value at 8000 rpm within 2 % of 283e3 |
| AT3 | flat world, TC on, full throttle (as 221 AT2/AT3) | 0-100 / 0-200 km/h | 2.6-3.6 s / 6.8-9.0 s |
| AT4 | flat world, 40 s full throttle, zone off | vmax | 285-315 km/h |
| AT5 | 100 m radius skidpad (as 221 AT7) | max lateral accel | 2.2-3.2 g |
| AT6 | ow3 voice, 6000 rpm, 0.5 s at 48 kHz | render + FFT | finite, RMS > 1e-3; strongest peak below 1500 Hz and above 100 Hz |
| AT7 | e2e menu | open car select | "OW-3 Feeder" listed; `/?car=ow3&track=monza` loads and speed > 0 after 3 s |

## Acceptance criteria

- [ ] All ATs pass; every listed protected test updated and green; f4/ow26 behaviour unchanged; no forbidden names in `ow3.json`.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run tests/unit/acceptance/344- tests/unit/acceptance/231- tests/unit/acceptance/244- tests/unit/acceptance/226- tests/unit/calibration/ow26.test.ts tests/unit/edge/221-
npx playwright test 344- 073-
```

## Out of scope

- Custom 3D model, livery art, tuning to lap-time ratios (346), series data, setup presets beyond f4 defaults.
