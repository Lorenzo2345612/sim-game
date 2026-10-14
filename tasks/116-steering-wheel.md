# 116 — Animated steering wheel in cockpit view

Status: pending
Phase: 1
Depends on: 047, 054, 115
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In cockpit camera mode a 3D steering wheel is visible at the car's wheel anchor and rotates with the steering input.

## Context

Design: `docs/plans/game-features.md` section 116. `CarSpec.cockpit` from 115 (`wheel`, `wheelRadius`, `lockDeg`). Camera modes in `src/render/cameraRig.ts` (`CameraRig.mode`). `DriverInput.steer` in `src/core/types.ts`: -1 left, +1 right. `SceneStats` interface and `__SIMGAME__.sceneStats()` are in `src/main.ts`. Rendering code may import `three`; release geometry/materials with `dispose()`. e2e tests: `tests/e2e/acceptance/116-steering-wheel.spec.ts` (acceptance worker).

## Files

- `src/render/steeringWheel.ts` — create.
- `src/main.ts` — modify: attach wheel to the car root at `cockpit.wheel`, show only when `rig.mode === 'cockpit'`, update angle each frame from the current input steer; extend `SceneStats` with `steeringWheel: { visible: boolean; angle: number }`.
- `tests/unit/acceptance/116-steering-wheel.test.ts` — acceptance worker.

## Steps

```ts
import * as THREE from 'three';
export function createSteeringWheel(radius: number): THREE.Group;
export function setSteeringWheelAngle(group: THREE.Group, steer: number, lockDeg: number): void;
export function disposeSteeringWheel(group: THREE.Group): void;
```

1. `createSteeringWheel`: rim (torus, tube radius 0.012·(radius/0.13)), 3 spokes, a small display box; ≤ 2000 triangles total; materials shared by module-level cache (not created per call); wheel faces +Z in its local frame (towards the driver); tilted 20° back about X when attached.
2. `setSteeringWheelAngle`: `group.rotation.z = -steer · (lockDeg/2) · π/180`, `steer` clamped to [-1, 1]. `steeringWheel.angle` in `sceneStats` reports that `rotation.z` (rad).
3. `disposeSteeringWheel` disposes geometries only (shared materials stay).
4. Hidden (visible=false) in chase and T-cam modes.

Conventions: no rounding; steer clamped, not thrown; lockDeg > 0 assumed.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | createSteeringWheel(0.13) | count triangles | ≤ 2000; bounding radius in [0.12, 0.16] |
| AT2 | setSteeringWheelAngle(g, 1, 270) / (−0.5, 480) | rotation.z | −135° / +120° in radians ± 1e-9 |
| AT3 | e2e `/?track=monza`, cockpit camera, hold right 1 s | sceneStats().steeringWheel | visible true; angle < 0 |
| AT4 | e2e chase camera | sceneStats().steeringWheel | visible false |

## Acceptance criteria

- [ ] AT1–AT4 pass.
- [ ] No object allocation per frame in the update path.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 116-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Head motion, mirror, hands/driver model, per-car wheel meshes, gear/rpm display content on the wheel.
