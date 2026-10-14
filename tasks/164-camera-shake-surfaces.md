# 164 — Camera shake from surfaces

Status: pending
Phase: 1
Depends on: 163
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The camera vibrates when driving over kerbs, grass and gravel, scaled by speed.

## Context

Uses `surfaceFeedback` (163). `Game` (`src/game/game.ts`) does not expose telemetry today; it owns `vehicle`. `CameraMode` is exported from `src/render/cameraRig.ts`. Shake is applied after `cameraRig.update` each frame, so it must not accumulate (update rewrites the pose every frame).

## Files

- `src/render/cameraShake.ts` — create (pure).
- `src/render/cameraRig.ts` — modify: `applyShake`, `setShakeScale`.
- `src/game/game.ts` — modify: `getTelemetry(out?: Telemetry): Telemetry` delegating to `vehicle.getTelemetry` (Telemetry from `src/physics/vehicle.ts`, task 065).
- `src/main.ts` — modify: allocate one `Feedback` and one `Telemetry` outside the frame loop; each non-paused frame after `cameraRig.update`: `surfaceFeedback(telemetry.wheels, |interp.forwardSpeed|, fb)` then `cameraRig.applyShake(fb.shake, game.simTime)`. Expose `fb` in scope for 165.
- `tests/unit/acceptance/164-camera-shake-surfaces.test.ts` — create.

## Steps

```ts
import type { CameraMode } from './cameraRig';
export const SHAKE_MAX_M = 0.015; export const SHAKE_MAX_ROLL = 0.004; // m, rad
export function shakeOffset(amount: number, t: number, mode: CameraMode, out: { y: number; roll: number }): { y: number; roll: number };
// a = clamp01(amount) (non-finite → 0); k = mode === 'chase' ? 0.5 : 1
// y = SHAKE_MAX_M·a·k·(0.6·sin(2π·17t) + 0.4·sin(2π·29t + 1.3)); roll = SHAKE_MAX_ROLL·a·k·sin(2π·11t + 0.7)
CameraRig.applyShake(amount: number, t: number): void; // adds y to camera.position.y and rotates by roll about the camera's local view (z) axis; scaled by shake scale
CameraRig.setShakeScale(s: number): void; // clamp 0..1, default 1; non-finite → 1
```

- `applyShake` is a no-op when the scaled amount is 0. No allocation (reuse a temp quaternion/object).
- `shakeOffset` writes into and returns `out`.

Conventions: clamps inclusive; invalid input → 0 shake; `out` mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | shakeOffset amount 0, any mode | t = 0.37 | y 0, roll 0 |
| AT2 | amount 1, cockpit | t = k/120, k = 0..119 | max abs y ≤ 0.015 + 1e-12 and ≥ 0.009; max abs roll ≤ 0.004 + 1e-12 and ≥ 0.003 |
| AT3 | amount 1, chase | same sampling | max abs y ≤ 0.0075 + 1e-12 |
| AT4 | amount 2 vs 1; amount NaN | t = 0.21 | same as amount 1; y 0, roll 0 |
| AT5 | CameraRig cockpit with a fixed VehicleState | update; applyShake(1, 0.21); update again | camera position and quaternion equal those after a plain update (1e-9): no accumulation |
| AT6 | setShakeScale(0) | update; applyShake(1, 0.21) | camera position equals the unshaken one (1e-9) |

## Acceptance criteria

- [ ] All AT rows pass; existing `tests/unit/render/cameraRig.test.ts` and `acceptance/047-cameras.test.ts` still pass unchanged.
- [ ] Protected tests: none change numbers.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Settings UI toggle (only `setShakeScale`), rumble (165), particles (167), shake while paused.
