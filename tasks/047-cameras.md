# 047 — T-cam and cockpit cameras with switching

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

Three camera modes (chase, tcam, cockpit) selectable in sequence.

## Context

Existing chase logic in `src/render/chaseCamera.ts` (`computeChaseTarget`, `ChaseCamera`). Car faces -Z; forward from quaternion per `ai/guides/architecture.md`. Do not allocate per frame: reuse temporaries. Acceptance tests for this task are Vitest in `tests/unit/acceptance/`.

## Files

- `src/render/cameraRig.ts` — create.
- `tests/unit/render/cameraRig.test.ts` — create — extra edge tests.

## Steps

```ts
import * as THREE from 'three';
import type { VehicleState } from '../core/types';
export type CameraMode = 'chase' | 'tcam' | 'cockpit';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'tcam', 'cockpit'];
export const TCAM_OFFSET = { x: 0, y: 1.15, z: 0.6 };      // car-local, m
export const COCKPIT_OFFSET = { x: 0, y: 0.75, z: -0.2 };  // car-local, m
export const COCKPIT_FOV = 75;
export class CameraRig {
  constructor(camera: THREE.PerspectiveCamera);
  mode: CameraMode;                 // starts 'chase'
  next(): CameraMode;               // chase → tcam → cockpit → chase; returns new mode
  update(state: VehicleState, dt: number): void; // positions/orients the camera
  dispose(): void;
}
```

- `chase` delegates to the existing `ChaseCamera` behaviour (reuse it; do not change its API) with the original FOV.
- `tcam` / `cockpit`: camera position = `state.position + rotate(offset, state.rotation)`; camera orientation = car rotation (looks along the car's forward, -Z local), no smoothing.
- Set `camera.fov` on mode change (cockpit 75, others the camera's initial fov) and call `updateProjectionMatrix()`.
- Tests construct a `THREE.PerspectiveCamera` directly (no WebGL).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/047-cameras.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | car at origin facing −Z | camera mode 'tcam' | position (0, 1.15, 0.6) relative to the car ±0.01, looks forward |
| AT2 | mode 'cockpit' | camera | (0, 0.75, −0.2) relative, FOV 75 |
| AT3 | `next()` from chase | sequence | chase → tcam → cockpit → chase |
| AT4 | car yawed π/2 | tcam | offset rotated with the car |

## Acceptance criteria

- [ ] All AT rows pass; existing chase camera tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Key binding (C) and wiring in `main.ts` (task 054), hiding the car body in cockpit, head movement or shake.

