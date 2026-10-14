# 065 — Vehicle model on Rapier

Status: pending
Phase: 1
Depends on: 058, 059, 060, 061, 062, 063, 064, 033, 045, 054, 057
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`Vehicle` runs the in-house model (own suspension, tyres, powertrain, aids, fuel) on a Rapier rigid body instead of `DynamicRayCastVehicleController`, keeping its public API.

## Context

Design: `ai/guides/vehicle-dynamics.md` (read all). **Reference implementation: `ai/lab/vehicle-model.mjs`** (port its logic onto the pure modules from 058–064; do not copy its physics inline). Calibrated data: `public/cars/f4.json`. Rapier calls to use: `world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, chassis)` (exclude chassis body), chassis collider density 0 + `body.setAdditionalMassProperties(mass, com, principalInertia, inertiaFrame, true)` (re-call when fuel mass changes), `body.applyImpulseAtPoint(F·dt, point, true)` before `world.step()`. Surface per wheel from the ray's collider via `surfaceOf` (task 033); `SURFACE_GRIP`/`SURFACE_DRAG` multiply the tyre factor/add rolling drag as today.

## Files

- `src/physics/vehicle.ts` — modify (replace controller; keep file's exports)
- `src/physics/vehicleConfig.ts` — modify (only what the new constructor needs; keep exports used elsewhere)
- `tests/unit/physics/vehicleModel.test.ts` — create

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
  - `tests/unit/physics/vehicle.test.ts`: constructor → F4 `CarSpec`; bands same as the new acceptance/011 values.

## Steps

```ts
import type { CarSpec } from './carSpec';
import type { Surface, SpawnPose, VehicleState } from '../core/types';
export interface WheelTelemetry { fz: number; kappa: number; alpha: number; tempC: number; wear: number; surface: Surface }
export interface Telemetry { wheels: WheelTelemetry[]; fuelKg: number; rpm: number; gear: number }
class Vehicle {
  constructor(world: RAPIER.World, spec: CarSpec, spawn: SpawnPose); // was VehicleConfig
  // unchanged: body, setInput, prePhysicsStep(dt), getWheelSurfaces, getState(out?), reset(spawn), gear/rpm/shiftUp/shiftDown/setGearMode
  getTelemetry(out?: Telemetry): Telemetry;
  setCompound(name: 'soft' | 'medium' | 'hard'): void;  // default 'medium'; resets tyre state
  setMultipliers(wear: number, fuel: number): void;      // finite > 0, else 1; default 1, 1
}
```

- `prePhysicsStep` order per the guide: rays and suspension, slip with gravity-predicted velocity, powertrain/aids, `solveWheel` per wheel, aero, impulses. One sub-step per tick, `FIXED_DT`.
- `getState` keeps `VehicleState` (wheel position, steering, rotation, inContact) from the model's own wheel state.
- Telemetry arrays reused when `out` is passed (no per-frame allocation). Tyre state per wheel uses `updateTyreState`/`gripFactor` (060); aero via 061; fuel/aids 063; compound defaults to `medium`; pressure for `pressureFactor`/`updateTyreState` is `spec.tyres.pressureKpa`.
- Callers of the old `VehicleConfig` constructor (also edited by 054/057, hence those dependencies) are updated minimally to pass `CarSpec` loaded from `public/cars/f4.json` (tests may import the JSON).

Conventions: SI units; wheel order FL, FR, RL, RR; positive steer = left; `dt <= 0` or non-finite is ignored; NaN input clamps to 0.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat ground, F4, spawn 0.02 m high | 2 s idle | ride height within 5 mm of static; no NaN |
| AT2 | flat, standstill, no input | 10 s | drift < 1 cm |
| AT3 | 5 % slope, full brake | 10 s | drift < 5 cm |
| AT4 | drop from 0.5 m | 3 s | settles, no NaN, not flipped |
| AT5 | full throttle on flat | 6 s | speed > 100 km/h; wheels' kappa finite |
| AT6 | telemetry | any tick | 4 wheels with fz ≥ 0 summing to (m+fuel)·g ± 5 % at rest |
| AT7 | existing Phase 0/1 vehicle and e2e tests | run | pass (update thresholds only where the spec's new targets replace them) — verification gate only (npm test + test:e2e), no new acceptance test |

## Acceptance criteria

- [ ] All AT rows pass; `npm test` and `npm run test:e2e` green.
- [ ] `grep -rn DynamicRayCastVehicleController src` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 065-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Setup application and UI (067/068), HUD (069), game wiring and `__SIMGAME__.telemetry` (070), F4 retuning (066), damage, AWD/FWD.
