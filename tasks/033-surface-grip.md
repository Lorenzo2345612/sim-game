# 033 — Per-wheel surface grip and drag

Status: pending
Phase: 1
Depends on: 022, 032
Complexity: complex
Type: feature
Roles: acceptance, coder, tester-pre, tester, reviewer

## Goal

The vehicle reads the surface under each wheel and scales tyre grip and adds rolling drag accordingly, so grass and gravel slow the car.

## Context

Rules: `ai/guides/phase1.md` (Runtime, Grip; constants `SURFACE_GRIP`, `SURFACE_DRAG` from `src/core/constants.ts`, added by task 022). Vehicle facts: `ai/guides/architecture.md`, `src/physics/vehicle.ts`. `surfaceOf` from `src/physics/trackColliders.ts` (task 032). Acceptance tests: Vitest in `tests/unit/acceptance/033-surface-grip.test.ts`; they build a flat fixture `TrackDataV2` and `createPhysicsWorld(track)`.

## Files

- `src/physics/vehicle.ts` — modify
- `tests/unit/physics/surfaceGrip.test.ts` — create (edge cases)

## Steps

```ts
import type { Surface } from '../core/types';
// Vehicle (new public method)
getWheelSurfaces(): Surface[]; // length 4: FL, FR, RL, RR
```

- Surface of wheel `i` = `surfaceOf(controller.wheelGroundObject(i))`; no ground object or `null` result → `'asphalt'`.
- `getWheelSurfaces()` refreshes and returns the same preallocated array every call (no allocation per step).
- In `prePhysicsStep`, before `updateVehicle`, for each wheel: `setWheelFrictionSlip(i, config.frictionSlip * SURFACE_GRIP[surface])`.
- Drag: for each wheel with `SURFACE_DRAG[surface] > 0`, apply an impulse on the chassis opposing its horizontal (x, z) velocity, magnitude `SURFACE_DRAG[surface] * massKg * |GRAVITY| * dt / 4`, clamped so one wheel's impulse never exceeds `massKg * horizontalSpeed / 4` (never reverses the velocity). Skip if horizontal speed < 0.01 m/s. Use the existing impulse/temporary style; no new objects per step.
- With the Phase 0 world (no track) behaviour and all existing vehicle tests are unchanged.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/033-surface-grip.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | flat fixture: asphalt strip, grass elsewhere; car at 30 m/s on asphalt | coast 2 s | reference speed v_a |
| AT2 | same car on grass | coast 2 s | speed ≤ v_a − 2 m/s |
| AT3 | same car on gravel | coast 2 s | speed ≤ v_a − 8 m/s |
| AT4 | left wheels on grass, right on asphalt | `getWheelSurfaces()` | ['grass','asphalt','grass','asphalt'] |
| AT5 | full throttle 3 s from rest on grass vs asphalt | distance | grass < 85 % of asphalt |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/033-surface-grip.test.ts` pass.
- [ ] Existing vehicle tests (`tests/unit/physics/*`) still pass unchanged.
- [ ] Extra tests: drag never makes the speed negative when coasting from 1 m/s on gravel; `getWheelSurfaces()` returns all `'asphalt'` in the Phase 0 world.
- [ ] No `new` object/array in the per-step path added by this task.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Gearbox, engine rpm (task 045).
- Track-limit rules (task 034).
- Changing constants values or the car config.
- Rendering of surfaces.
