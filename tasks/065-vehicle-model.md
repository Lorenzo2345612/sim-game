# 065 — Vehicle model on Rapier (part 1: new model class)

Status: pending
Phase: 1
Depends on: 058, 059, 060, 061, 062, 063, 064, 033, 045, 054, 057
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

New class `VehicleModel` in `src/physics/vehicleModel.ts` runs the in-house model (own suspension, tyres, powertrain, aids, fuel) on a Rapier rigid body, with the same public API as today's `Vehicle` plus telemetry. Today's `Vehicle` stays untouched; task 169 swaps it in and migrates old tests.

## Context

Design: `ai/guides/vehicle-dynamics.md` (read all). **Reference implementation: `ai/lab/vehicle-model.mjs`** (port its logic onto the pure modules from 058–064; do not copy its physics inline). Calibrated data: `public/cars/f4.json`. Rapier calls to use: `world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, chassis)` (exclude chassis body), chassis collider density 0 + `body.setAdditionalMassProperties(mass, com, principalInertia, inertiaFrame, true)` (re-call when fuel mass changes), `body.applyImpulseAtPoint(F·dt, point, true)` before `world.step()`. Surface per wheel from the ray's collider via `surfaceOf` (task 033); `SURFACE_GRIP`/`SURFACE_DRAG` multiply the tyre factor/add rolling drag as today.

## Files

- `src/physics/vehicleModel.ts` — create.
- Planner-authorised edit (only this): `tests/unit/acceptance/065-vehicle-model.test.ts:9` and `tests/unit/edge/065-vehicle-model-edge.test.ts:5` import becomes `import { VehicleModel as Vehicle } from '../../../src/physics/vehicleModel';`.
- Do NOT modify `src/physics/vehicle.ts`, `vehicleConfig.ts`, callers, or any other test (that is task 169).

## Steps

```ts
import type { CarSpec } from './carSpec';
import type { Surface, SpawnPose, VehicleState } from '../core/types';
export interface WheelTelemetry { fz: number; kappa: number; alpha: number; tempC: number; wear: number; surface: Surface }
export interface Telemetry { wheels: WheelTelemetry[]; fuelKg: number; rpm: number; gear: number }
export class VehicleModel {
  constructor(world: RAPIER.World, spec: CarSpec, spawn: SpawnPose); 
  // unchanged: body, setInput, prePhysicsStep(dt), getWheelSurfaces, getState(out?), reset(spawn), gear/rpm/shiftUp/shiftDown/setGearMode
  getTelemetry(out?: Telemetry): Telemetry;
  setCompound(name: 'soft' | 'medium' | 'hard'): void;  // default 'medium'; resets tyre state
  setMultipliers(wear: number, fuel: number): void;      // finite > 0, else 1; default 1, 1
}
```

- `prePhysicsStep` order per the guide: rays and suspension, slip with gravity-predicted velocity, powertrain/aids, `solveWheel` per wheel, aero, impulses. One sub-step per tick, `FIXED_DT`.
- `getState` keeps `VehicleState` (wheel position, steering, rotation, inContact) from the model's own wheel state.
- Telemetry arrays reused when `out` is passed (no per-frame allocation). Tyre state per wheel uses `updateTyreState`/`gripFactor` (060); aero via 061; fuel/aids 063; compound defaults to `medium`; pressure for `pressureFactor`/`updateTyreState` is `spec.tyres.pressureKpa`.
- `unchanged` methods copy the signatures and semantics of today's `Vehicle` in `src/physics/vehicle.ts` (read it for its public API only).

Conventions: SI units; wheel order FL, FR, RL, RR; positive steer = left; `dt <= 0` or non-finite is ignored; NaN input clamps to 0.

## Work order

1. Read only: this spec, `ai/guides/vehicle-dynamics.md`, `ai/lab/vehicle-model.mjs`, the exports of the 058–064 modules and `carSpec.ts`, the public API of `src/physics/vehicle.ts`. Read large files in ranges. After a context summary do not re-read files already summarised.
2. Write `vehicleModel.ts` early, then iterate against `npx vitest run tests/unit/acceptance/065-vehicle-model.test.ts tests/unit/edge/065-vehicle-model-edge.test.ts`.
3. Run `npm run typecheck`, `npm run lint`, `npm test` (other tests must still pass untouched).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat ground, F4, spawn 0.02 m high | 2 s idle | ride height within 5 mm of static; no NaN |
| AT2 | flat, standstill, no input | 10 s | drift < 1 cm |
| AT3 | 5 % slope, full brake | 10 s | drift < 5 cm |
| AT4 | drop from 0.5 m | 3 s | settles, no NaN, not flipped |
| AT5 | full throttle on flat | 6 s | speed > 100 km/h; wheels' kappa finite |
| AT6 | telemetry | any tick | 4 wheels with fz ≥ 0 summing to (m+fuel)·g ± 5 % at rest |

## Acceptance criteria

- [ ] AT1–AT6 and the 065 edge tests pass against `VehicleModel`; `npm test` green with no other test edited.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/065-vehicle-model.test.ts tests/unit/edge/065-vehicle-model-edge.test.ts
npm test
```

## Out of scope

- Replacing `Vehicle`, callers and old-test migration (169). Setup/UI (067/068), HUD (069), game wiring (070), F4 retuning (066), damage, AWD/FWD.
