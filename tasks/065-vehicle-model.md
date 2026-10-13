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
| AT7 | existing Phase 0/1 vehicle and e2e tests | run | pass (update thresholds only where the spec's new targets replace them) |

## Acceptance criteria

- [ ] All AT rows pass; `npm test` and `npm run test:e2e` green.
- [ ] `grep -rn DynamicRayCastVehicleController src` returns nothing.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Setup application and UI (067/068), HUD (069), game wiring and `__SIMGAME__.telemetry` (070), F4 retuning (066), damage, AWD/FWD.
