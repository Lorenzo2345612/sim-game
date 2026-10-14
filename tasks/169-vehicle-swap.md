# 169 — Vehicle model on Rapier (part 2: swap in and migrate old tests)

Status: pending
Phase: 1
Depends on: 065
Complexity: standard
Type: feature
Models: standard
Roles: coder, reviewer

## Goal

`Vehicle` becomes the in-house `VehicleModel` (task 065) instead of `DynamicRayCastVehicleController`; callers and superseded tests are migrated. Mechanical task: no physics changes.

## Files

- `src/physics/vehicle.ts` — replace: remove the old controller; `export { VehicleModel as Vehicle }` from `./vehicleModel` (plus any type exports other files import from `vehicle.ts`, re-exported).
- `src/physics/vehicleConfig.ts` — modify only if something no longer compiles; keep exports used elsewhere.
- Callers of the old `VehicleConfig` constructor in `src/` pass the `CarSpec` parsed from `public/cars/f4.json` (`src/main.ts` already loads it).
- `tests/unit/acceptance/065-vehicle-model.test.ts:9`, `tests/unit/edge/065-vehicle-model-edge.test.ts:5`: import back to `import { Vehicle } from '../../../src/physics/vehicle';`.
- Planner-authorised edits to superseded tests (coder applies exactly these, nothing else; load the car with `parseCarSpec(JSON.parse(readFileSync('public/cars/f4.json','utf8')))`):
  - Constructor call sites passing `PLACEHOLDER_CAR`/a `VehicleConfig` become the parsed F4 `CarSpec`: `acceptance/011-vehicle-physics.test.ts:72`, `acceptance/032-physics-track-colliders.test.ts:156`, `acceptance/033-surface-grip.test.ts:48`, `acceptance/045-gearbox.test.ts:80`, `edge/011-vehicle-physics.test.ts:59`, `edge/011-vehicle-physics.post.test.ts:32-36`, `edge/033-surface-grip.post.test.ts:61`, `edge/033-surface-grip-edge.test.ts:75,128,130`, `edge/045-gearbox-edge.test.ts:35`, `edge/045-gearbox.post.test.ts:71,87,122`.
  - `acceptance/011` AT1: replace the y band 0.33-0.45 with: y finite and |Δy| < 5 mm over the last 0.5 s; 4 wheels in contact stays. AT2: band becomes 3.0-5.0 s. AT3: unchanged (55-66 m/s). AT4: band becomes 10-20 m/s².
  - `edge/011-vehicle-physics.post.test.ts`: POST3 → `brakes.maxTorque = 0` (same assertion); POST4 → delete; POST5 → every torqueCurve torque × 0.25, assert speed after 30 s is < 0.85 × the unmodified F4's; POST6 → `aero.cda` 0 vs 0.8 (same assertion).
  - `edge/033-surface-grip.post.test.ts:70-96`: replace `controller.wheelFrictionSlip(i)` checks with `getTelemetry().wheels[i].surface` equal to the surface under that wheel; keep the ordering asphalt grip > grass/gravel via the existing surface factor table.
  - `acceptance/045-gearbox.test.ts:78-93` (AT5), `edge/045-gearbox-edge.test.ts:128-148` (EDGE7/EDGE8): expected rpm/upshift/limiter values recomputed from f4.json (wheel radius 0.28, ratios, final 3.5, idleRpm 1200, upRpm 6400, limiterRpm 6900) using the same formulas; pure `Gearbox` class rows keep their defaults.
  - Do not touch `acceptance/010` AT4 or `057` AT1.
  - `edge/011-vehicle-physics.test.ts` (round 2, all F4 `SPEC` = parsed f4.json): EDGE1 :80 band → y > 0.2; EDGE2 :106 advance 10 → 40 steps; EDGE6 :187-190 lo = `SPEC.steering.maxAngleLow` × 0.85, check after 40 steps; EDGE6 :202-203 run 2 → 40 steps (band unchanged); EDGE7 :222-229 hub offsets from `SPEC.wheels.positions`, wheel y band 0.28 ± 0.05; EDGE10 :280 run 40 steps before the steering assertion.
  - `edge/033-surface-grip.post.test.ts:117` and `:128`: delete both assertions (old-model drag isolation; superseded by 065 and 162 coast tests).
  - `edge/045-gearbox.post.test.ts:82` expected rpm from f4.json (r 0.28, ratio[0] 2.3, final 3.5, idle 1200) with the same formula; `:93` expect ≈ `SPEC.engine.idleRpm` (± 100).
  - `tests/unit/physics/surfaceGrip.test.ts`: constructor :54 → F4 `CarSpec`; delete `controllerOf` (:63); the two `frictionSlip` tests (:93 asphalt, :118 grass) become `getTelemetry().wheels[i].surface` equal to `'asphalt'` / `'grass'` for all 4 wheels; other tests unchanged.
  - `tests/unit/physics/vehicle.test.ts`: constructor → F4 `CarSpec`; bands same as the new acceptance/011 values.


## Work order

Apply the edits above with targeted Edit calls at the listed lines; do not read whole test files or investigate physics. If a listed edit does not make its test pass, or an unlisted test fails, stop and report BLOCKED with file:line (the planner fixes it).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | existing Phase 0/1 vehicle and e2e tests | run | pass with only the listed edits — verification gate only (npm test + this task's e2e), no new acceptance test |

## Acceptance criteria

- [ ] `npm test` green; `grep -rn DynamicRayCastVehicleController src` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 011- 033- 045-
```
