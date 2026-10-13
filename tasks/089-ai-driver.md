# 089 — AI driver controller

Status: pending
Phase: 2
Depends on: 087, 088
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure `AiDriver` that turns a car observation into a `DriverInput` by pure-pursuit steering along a racing line and a speed controller that follows a speed profile.

## Context

New layer `src/ai`: imports only `src/core` and `src/track` (pure: no `three`, no Rapier, no `Math.random`, no DOM). `RacingLine` comes from `src/ai/racingLine.ts` (087), speeds from `speedProfile` (088). Yaw: forward = `(-sin yaw, -cos yaw)`, `yaw = atan2(-dx, -dz)`; `DriverInput.steer` + = right (`ai/guides/architecture.md`). Right normal of travel direction `(dx,dz)` is `[-dz, dx]/len`; lateral offsets are metres along it, + = right. g not needed here.

## Files

- `src/ai/aiDriver.ts` — create
- `ai/guides/architecture.md` — modify: in "Layers and allowed dependencies" add the lines `src/ai → core, track, physics/carSpec types only (pure, no three, no Rapier)` and `src/race → core, track (pure, no three, no Rapier)`, and append `, ai, race` to the `src/game →` line
- `tests/unit/ai/aiDriver.test.ts` — create (fixtures built in the test: straight line, rounded square from 087 AT2)

## Steps

```ts
import type { DriverInput } from '../core/types';
import type { RacingLine } from './racingLine';
export interface AiObservation { x: number; z: number; yaw: number; speed: number } // speed = forward m/s
export interface AiParams { speedScale: number; lookaheadTime: number; minLookahead: number; maxLookahead: number; wheelbase: number; maxSteerAngle: number; kp: number; kb: number }
export const DEFAULT_AI_PARAMS: AiParams; // speedScale 1, lookaheadTime 0.6 s, minLookahead 8 m, maxLookahead 45 m, wheelbase 2.6 m, maxSteerAngle 0.35 rad, kp 0.5, kb 0.25
export class AiDriver {
  constructor(line: RacingLine, speeds: Float64Array, params?: Partial<AiParams>);
  setLateralOffset(m: number): void;   // added to the line offset; effective offset slews at 1.5 m/s
  setSpeedCap(v: number | null): void;
  reset(obs: AiObservation): void;      // global nearest-point search
  update(obs: AiObservation, dt: number, out: DriverInput): DriverInput; // writes and returns `out`; local search +-50 points; no allocation
}
```

- The followed path is `line.points` shifted by the effective lateral offset along each point's right normal (computed on the fly, not stored per call).
- Pure pursuit: nearest point projection s on the shifted path (closed loop); target = point at s + L along the path; L = clamp(speed·lookaheadTime, minLookahead, maxLookahead); ld = distance car→target; α = angle from car forward to target (positive = target to the right); δ = atan(2·wheelbase·sin α / ld); `steer = clamp(δ / maxSteerAngle, -1, 1)`.
- Speed: target = min(speeds at the projection index advanced by 0.3 s·speed of preview distance, speedCap if not null) · speedScale; err = target − speed; `throttle = clamp(kp·err, 0, 1)`, `brake = clamp(-kb·err, 0, 1)`; never both > 0; `reset = false`.
- Effective offset moves toward the requested one by at most 1.5·dt per update.

Conventions: `update` before any `reset` behaves as if `reset(obs)` was called first; `ld` < 1e-6 → steer 0; dt ≤ 0 → no slew; `out` is mutated, `obs` and `line` never.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | straight line along −Z, car on it heading −Z, speed 20 | update | steer 0 ± 1e-6 |
| AT2 | same line, car 2 m to the LEFT of it, heading −Z, speed 20 | update | steer = atan(2·2.6·(2/√148)/√148)/0.35 = 0.2004 ± 0.005 (positive) |
| AT3 | target speed 30, speed 20 / 32 | update | throttle 1, brake 0 / throttle 0, brake 0.5 |
| AT4 | rounded square (087 AT2) with 088 profile (muLat 1.5), speedScale 0.9; kinematic bicycle test model: x' = −v·sin(yaw), z' = −v·cos(yaw), yaw' = −v·tan(steer·0.35)/2.6, v' = 8·throttle − 12·brake (clamped ≥ 0), 120 Hz | 1 lap | lap completed; max lateral error from the line < 1.0 m |
| AT5 | setLateralOffset(3) then 4 s on a straight (AT4 model) | update | settles 3 ± 0.2 m right of the line; offset never changes faster than 1.5 m/s |

## Acceptance criteria

- [ ] All AT rows pass; `update` allocates no objects or arrays in its body.
- [ ] `src/ai/aiDriver.ts` imports only `src/core`, `src/track`, `./racingLine`.
- [ ] `ai/guides/architecture.md` lists the `src/ai` and `src/race` layers.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Traffic avoidance and difficulty (090), racing line and speed profile (087, 088).
- Mistakes/randomness, gear shifting (`shiftUp/shiftDown` left undefined), pit logic.
- Wiring into `src/game` or rendering.
