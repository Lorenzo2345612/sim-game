# 057 — Use the F4 car in the game and remove the Kenney placeholder

Status: pending
Phase: 1
Depends on: 053, 056
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

The game renders `public/models/f4.glb` (task 053) with spinning/steering wheels, the physics uses its real dimensions from `public/models/f4.json`, and every Kenney asset and reference is gone.

## Context

`f4.glb` frame: origin on the ground below the midpoint between the axles, −Z forward, Y up, metres; nodes `body` + `WHEEL_NODE_NAMES` with each wheel's pivot at its hub. `f4.json`: `{ wheelRadius, wheelbase, trackFront, trackRear, wheels: [{name, x, y, z}] }`. Never use the word "Tatuus" anywhere. Credit text for the model already exists in `ASSETS_LICENSES.md`.

## Files

- `src/physics/vehicleConfig.ts` — modify: add `F4_CAR` (mass, engine, aero, brake, steer, suspension values identical to `PLACEHOLDER_CAR`; `wheelRadius` and `wheelPositions` from `f4.json` as constants); remove `PLACEHOLDER_CAR`
- `src/render/carRenderer.ts` — modify: remove the Kenney-specific transforms (rotation π, scales 1.6/1.1, offset −0.45); body offset `bodyOffsetY` passed in
- `src/game/game.ts`, `src/main.ts` — modify: use `F4_CAR` and `/models/f4.glb`
- delete `public/models/race.glb`, `assets/vendor/kenney-car-kit/`, the Kenney row of `ASSETS_LICENSES.md`; update tests that referenced them
- `tests/unit/acceptance/057-*.test.ts`, `tests/e2e/acceptance/057-*.spec.ts` — created by the acceptance worker

## Steps

1. `F4_CAR.wheelPositions[i] = { x, y: 0, z }` from the `f4.json` hubs in order FL, FR, RL, RR; `F4_CAR.wheelRadius = wheelRadius`.
2. `bodyOffsetY = −(suspensionRestLength + wheelRadius)`, so the model's ground meets the tyre contact at rest.
3. Wheels: the renderer places each wheel node at the physics wheel position with its spin and steer, as today.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `F4_CAR` and `public/models/f4.json` | compare | `wheelRadius` and each `wheelPositions[i]` x, z equal the json hubs ± 1e-3, y = 0; massKg 650, enginePowerW 130000, dragAreaCdA 0.9, liftAreaClA 2.0 |
| AT2 | repo files | check | `public/models/race.glb` and `assets/vendor/kenney-car-kit` do not exist; no file in `src/`, `tests/`, `index.html` mentions `race.glb` or "kenney" (case-insensitive); `ASSETS_LICENSES.md` has no Kenney row; no file in `src/`, `public/`, `index.html` contains "tatuus" (case-insensitive) |
| AT3 | e2e: `/` | ready, 3 s throttle | no console errors; `__SIMGAME__.getSpeedKmh() > 30`; screenshot pixel at (640, 600) differs from the sky pixel (640, 40) by > 40 in some channel |
| AT4 | e2e: `/?track=spa` | ready, 3 s throttle | `|carPosition().y − trackHeightUnderCar()| < 0.8` (the car still rides on the track with the new geometry) |

AT3/AT4 are planner-written e2e tests in `tests/e2e/acceptance/057-f4-car.spec.ts` (AT3 loads `/?track=monza` since `/` shows the menu); the acceptance role writes only AT1/AT2.

## Acceptance criteria

- [ ] AT1–AT4 pass; all Phase 0/1 unit and e2e tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

Handling changes (brake bias, ABS: separate follow-up), livery editor, credits screen, LODs.
