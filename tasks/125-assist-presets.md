# 125 — Assist presets and braking assist

Status: pending
Phase: 2
Depends on: 054, 057, 070, 088, 089, 122, 123
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Three assist levels (beginner, intermediate, pro) configure ABS, TC, automatic gearbox, a braking assist, a steering assist and the driving line; the assists are applied to the player's inputs at runtime.

## Context

Design: `docs/plans/game-features.md` section 125. `DriverInput` in `src/core/types.ts` (steer -1 left, +1 right). Aids live in `CarSpec.aids.abs/tc` (`src/physics/carSpec.ts`: `{enabled, slip}`); gearbox mode `'auto' | 'manual'` in `src/physics/gearbox.ts`. Vehicle with dynamics: `src/physics/vehicle.ts` (070). AI: `AiDriver` (089, `src/ai/aiDriver.ts`, `AiParams.speedScale`), `speedProfile`/`carLimitsFromSpec` (088), `computeRacingLine` (087). Single-car `Game` (`src/game/game.ts`) invalidates a lap when no wheel is on asphalt/kerb (`getWheelSurfaces`). Sim logic: no `three`. Setting persistence: `src/core/settings.ts` (keep other keys on save).

## Files

- `src/game/assists.ts` — create.
- `src/core/settings.ts` — modify: `loadAssistLevel(storage): AssistLevel` (default `'intermediate'`), `saveAssistLevel`.
- `src/game/game.ts` — modify: optional `assists` option; applies preset aids to a copy of the `CarSpec` (abs/tc enabled flags), gearbox mode, and `applyAssists` to the input each tick.
- `src/ui/menu.ts` — modify: assist level selector `#assist-level` (3 options) persisted with `saveAssistLevel`.
- `tests/unit/acceptance/125-assist-presets.test.ts` — acceptance worker.

## Steps

```ts
import type { DrivingLineMode } from '../core/settings'; // defined by 123
export type AssistLevel = 'beginner' | 'intermediate' | 'pro';
export interface AssistPreset { abs: boolean; tc: boolean; autoGear: boolean; brakeAssist: boolean; steerAssist: number; drivingLine: DrivingLineMode }
export function assistPreset(level: AssistLevel): AssistPreset;
export function brakeAssist(speed: number, targetSpeed: number, distanceToTarget: number, decel: number): number;
export function steerAssist(input: number, yawRateError: number, k: number): number;
export interface AssistContext { speed: number; targetSpeed: number; distanceToTarget: number; decel: number; yawRateError: number }
export function applyAssists(preset: AssistPreset, input: DriverInput, ctx: AssistContext): DriverInput;
export function lookaheadTarget(speeds: Float64Array, dist: Float64Array, length: number, distance: number, horizon?: number /* 150 */): { targetSpeed: number; distance: number }; // length = lap length (m); returned distance = the target sample's position along the line (m), not the gap
```

1. Presets: beginner {abs true, tc true, autoGear true, brakeAssist true, steerAssist 0.5, drivingLine 'full'}; intermediate {true, true, true, false, 0.2, 'braking'}; pro {false, false, false, false, 0, 'off'}. Returns a fresh object each call.
2. `brakeAssist`: returns 0 if `speed ≤ targetSpeed + 1`; else `clamp(((speed² − target²) / (2·max(distance, 0.1))) / decel, 0, 1)`.
3. `steerAssist` = `clamp(input − k·clamp(yawRateError, −1, 1), −1, 1)`. `yawRateError` = desired − actual yaw rate (rad/s, + = left), desired = −speed·κ(line) (Menger κ + = right).
4. `applyAssists`: new object; `brake = max(input.brake, brakeAssist(...))` only if preset.brakeAssist; throttle set to 0 when the assist brake > 0.05; steer through `steerAssist` with `preset.steerAssist` (k = 0 leaves it unchanged).
5. `lookaheadTarget`: the minimum profile speed within `horizon` m ahead of `distance` (wrapping), and the distance to it. `decel` used by the game = 0.8 · muLong · 9.81 of the `CarLimits`.
6. `Game` option: `assists?: AssistLevel`. The preset's `drivingLine` is consumed by `main.ts` (126), not here.
7. `Game` option absent → behaviour unchanged (existing tests pass).

Conventions: clamps inclusive; `decel ≤ 0` throws; speeds in m/s; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | assistPreset for each level | call | table values exactly |
| AT2 | brakeAssist(60, 30, 100, 30) | call | (3600 − 900)/200/30 = 0.45 ± 1e-9 |
| AT3 | brakeAssist(30.5, 30, 50, 30) / (80, 20, 10, 30) | call | 0 / 1 |
| AT4 | steerAssist(0.2, 0.5, 0.5) / (0.9, −2, 0.5) | call | −0.05 / 1 |
| AT5 | Node: monza with the 070 vehicle, automatic gearbox in both legs (harness forces auto so gears are not part of the test), scripted full throttle with steering from 089 AiDriver at speedScale 1.15 (too fast), 120 s from standstill | beginner preset vs pro preset | time of the first all-4-wheels-off: beginner ≥ pro + 3 s (or beginner never leaves); count of all-4-wheels-off episodes: beginner ≤ pro; pro leaves at least once |

## Acceptance criteria

- [ ] AT1–AT5 pass; existing `Game`/menu tests unaffected.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Driving line rendering (123), lessons (126), ABS/TC algorithm changes, per-car assist tuning, gamepad mapping.

## Planner answers (round 1)

- AT5 rewritten (planner table fix, see the table): both legs use the automatic gearbox; compare first-off time and off count over 120 s. Update `tests/unit/acceptance/125-assist-presets.test.ts` AT5 to the new row (planner-authorised edit).
- `tests/unit/edge/125-assist-presets-edge.test.ts` (planner-authorised edits): EDGE2 expected value `61.062001 / 3000`; EDGE9 pass `length` 300 (lap length in metres) in all three calls, expected values unchanged.
- `lookaheadTarget` returns the target's absolute position along the line (as implemented); `length` is the lap length in metres.
