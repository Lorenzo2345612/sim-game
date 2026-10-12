# 015 — Chase camera

Status: done
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`ChaseCamera` follows the car from behind with framerate-independent exponential smoothing and a speed-dependent FOV.

## Context

`render` layer (three + core). Types `Vec3`, `Quat`, `VehicleState` from `src/core/types.ts`. Forward-vector formula: `architecture.md`, "Conventions". No allocations in `update`: use instance temporaries.

## Files

- `src/render/chaseCamera.ts` — create
- `tests/unit/render/chaseCamera.test.ts` — create

## Steps

1. Export EXACTLY:

```ts
export interface ChaseTarget { position: Vec3; lookAt: Vec3 }
export const CHASE_DISTANCE = 6.0;  // m behind
export const CHASE_HEIGHT = 2.2;    // m above car
export const LOOK_AHEAD = 4.0;      // m ahead
export const LOOK_HEIGHT = 0.8;     // m
export function computeChaseTarget(carPosition: Vec3, carRotation: Quat, previousForward: Vec3, out: ChaseTarget): ChaseTarget;
export class ChaseCamera {
  constructor(camera: THREE.PerspectiveCamera);
  snap(state: VehicleState): void;              // jump to target, no smoothing
  update(state: VehicleState, dt: number): void; // smoothed
}
```

2. `computeChaseTarget`:
   - `fx = -2*(q.x*q.z + q.w*q.y)`, `fz = -(1 - 2*(q.x*q.x + q.y*q.y))`; project onto XZ (ignore fy), `len = Math.hypot(fx, fz)`.
   - If `len < 1e-3`: fwd = `previousForward` (not modified). Otherwise fwd = (fx/len, 0, fz/len) and copy it into `previousForward` (`x`, `y = 0`, `z`).
   - `out.position = car - fwd*CHASE_DISTANCE + (0, CHASE_HEIGHT, 0)`; `out.lookAt = car + fwd*LOOK_AHEAD + (0, LOOK_HEIGHT, 0)`. Write into the existing `out` objects (create no new ones). Return `out`.
3. `ChaseCamera`: instance fields `target: ChaseTarget`, `pos: Vec3`, `look: Vec3`, `prevForward: Vec3` (initially (0,0,-1)), `initialized = false`.
   - `snap(state)`: `computeChaseTarget(...)`; copy target into `pos` and `look`; `camera.position.set(pos.x, pos.y, pos.z)`; `camera.lookAt(look.x, look.y, look.z)`; `camera.fov = targetFov` (formula below); `updateProjectionMatrix()`; `initialized = true`.
   - `update(state, dt)`: if `!initialized` → `snap(state)` and return. Otherwise compute the target; `kPos = 1 - Math.exp(-8*dt)`, `kLook = 1 - Math.exp(-12*dt)`; `pos += (target.position - pos)*kPos`; `look += (target.lookAt - look)*kLook`; `camera.position.set(pos...)`; `camera.lookAt(look...)`.
   - FOV: `targetFov = 60 + 10 * clamp(Math.abs(state.forwardSpeed) / 80, 0, 1)`; `newFov = camera.fov + (targetFov - camera.fov) * (1 - Math.exp(-3*dt))`; if `Math.abs(newFov - camera.fov) > 0.01` → `camera.fov = newFov; camera.updateProjectionMatrix()`.
4. Comments only where the logic is not obvious.

## Tests (`tests/unit/render/chaseCamera.test.ts`, Node)

Helper: `VehicleState` with dummy wheels (4 `WheelState` at zero), rotation from yaw as `{x:0, y:sin(yaw/2), z:0, w:cos(yaw/2)}`.

- `target behind car at yaw 0`: car at origin → `position` ≈ (0, 2.2, 6), `lookAt` ≈ (0, 0.8, -4) (5 decimals).
- `target is on +X at yaw pi/2`: `position` ≈ (6, 2.2, 0).
- `target falls back to previous forward`: vertical-pointing quaternion (pitch 90°: `{x: -sin(π/4), y:0, z:0, w:cos(π/4)}`) with `previousForward = (1,0,0)` → `position.x ≈ -6`; `previousForward` unchanged. Also `q = {x: sin(π/4), y:0, z:0, w:cos(π/4)}` (forward +Y) with `previousForward = (0,0,-1)` → `position ≈ (0, 2.2, 6)`.
- `snap places camera exactly on target`: after `snap`, `camera.position` equals the computed target (`toBeCloseTo(…, 9)`).
- `smoothing is framerate independent`: two cameras after `snap` at origin; car moved to (10, 0, -20); camera A: two `update(..., 1/60)`; camera B: one `update(..., 1/30)`; positions agree within 2 % of the distance travelled by the target.
- `update moves camera toward target`: after one `update` with dt 1/60 and the car moved, the distance to the target decreases but stays > 0.
- `fov tends to 70 at 80 m/s`: `snap` with forwardSpeed 0 (fov 60), then 600 `update` calls (10 s) with dt 1/60 and forwardSpeed 80 → `camera.fov` ≈ 70 (±0.1).
- `fov stays 60 at rest`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/015-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | car at origin, identity rotation (faces −Z) | `computeChaseTarget` | position (0, 2.2, 6); lookAt (0, 0.8, −4) (±1e-6) |
| AT2 | yaw π/2 (faces −X) | `computeChaseTarget` | position (6, 2.2, 0) ±1e-6 |
| AT3 | rotation q = (sin 45°, 0, 0, cos 45°) (forward = +Y) and previousForward (0,0,−1) | `computeChaseTarget` | uses previousForward: position (0, 2.2, 6) |
| AT4 | `ChaseCamera` snapped to A, target moved to B | two `update(…, 1/60)` vs one `update(…, 1/30)` on twin cameras | positions within 2 % of each other |
| AT5 | any | `snap(state)` | camera.position exactly at target (±1e-9) |
| AT6 | forwardSpeed 80 m/s | 10 s of `update(…, 1/60)` | fov 70 ±0.1 |

## Acceptance criteria

- [ ] Tests pass in Node. No `new` inside `update` or `computeChaseTarget`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Other cameras (cockpit, TV), camera switching keys, camera-ground collision, shake.
- Car state interpolation (task 017): this module receives the already-interpolated state.
