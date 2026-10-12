# 010 — Create the Rapier physics world and car config

Status: pending
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`initPhysics()`, `createPhysicsWorld()` (gravity, fixed timestep, ground) and `PLACEHOLDER_CAR` typed as `VehicleConfig` exist.

## Context

Read `ai/guides/architecture.md`, sections "Placeholder car" and "Rapier: verified facts". Copy values verbatim; do not change them. `src/physics` must not import `three`.

## Files

- `src/physics/vehicleConfig.ts` — create
- `src/physics/physicsWorld.ts` — create
- `tests/unit/physics/physicsWorld.test.ts` — create

## Steps

1. `vehicleConfig.ts` (import `Vec3` from `../core/types`):
```ts
export interface VehicleConfig {
  massKg: number;
  chassisHalfExtents: Vec3;
  wheelRadius: number;
  suspensionRestLength: number;
  maxSuspensionTravel: number;
  suspensionStiffness: number;
  suspensionCompression: number;
  suspensionRelaxation: number;
  frictionSlip: number;
  sideFrictionStiffness: number;
  wheelPositions: Vec3[]; // FL, FR, RL, RR
  enginePowerW: number;
  maxDriveForceN: number;
  brakeMax: number;
  maxSteerLowSpeed: number;
  maxSteerHighSpeed: number;
  dragAreaCdA: number;
  liftAreaClA: number;
}
export const PLACEHOLDER_CAR: VehicleConfig = { /* exact values from architecture.md */ };
```
2. `physicsWorld.ts` (import `FIXED_DT`, `GRAVITY` from `../core/constants`):
```ts
import RAPIER from '@dimforge/rapier3d-compat';
export async function initPhysics(): Promise<void>;
export function createPhysicsWorld(): RAPIER.World;
export { RAPIER };
```
   - `initPhysics`: module-level `let initPromise: Promise<void> | null = null`; if null, `initPromise = RAPIER.init()`; return it (memoized, safe to call repeatedly).
   - `createPhysicsWorld`: `new RAPIER.World({ x: 0, y: GRAVITY, z: 0 })`; `world.timestep = FIXED_DT`; create a fixed collider with `world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0))` (no rigid body). Return the world. Requires a prior `initPhysics()` (does not call it).

## Tests (`tests/unit/physics/physicsWorld.test.ts`)

`beforeAll(async () => { await initPhysics(); })`; `afterEach` calls `world.free()`.
- `initPhysics can be called twice without failing`.
- `world timestep equals FIXED_DT`: `world.timestep` `toBeCloseTo(1/120, 6)`.
- `dynamic cube dropped from y=5 rests at y≈0.5`: dynamic body at (0,5,0), `cuboid(0.5,0.5,0.5)` collider, 360 `world.step()` calls (3 s); `Math.abs(y - 0.5) < 0.05`.
- `PLACEHOLDER_CAR matches architecture values`: `massKg === 650`, `wheelPositions.length === 4`, `enginePowerW === 130000`.

## Acceptance criteria

- [ ] All 4 tests pass; `typecheck` and `lint` clean.
- [ ] `vehicleConfig.ts` does not import Rapier.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Vehicle, track as collider, other ground surfaces/friction materials.
- Code comments only where logic is non-obvious.
