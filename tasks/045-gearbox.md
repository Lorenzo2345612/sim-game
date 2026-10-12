# 045 — Six-speed gearbox with rpm and limiter

Status: pending
Phase: 1
Depends on: 033
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The car has a 6-speed gearbox with engine rpm, auto and manual shifting, and a rev limiter that cuts drive force.

## Context

Design in `ai/guides/phase1.md` (Runtime, Gearbox) and `ai/guides/architecture.md` (placeholder car, drive force formula). Pure TypeScript, no `three`. Acceptance tests for this task are Vitest in `tests/unit/acceptance/`.

## Files

- `src/physics/gearbox.ts` — create — pure gearbox logic.
- `src/physics/vehicle.ts` — modify — own a `Gearbox`, expose gear/rpm, apply limiter.
- `tests/unit/physics/gearbox.test.ts` — create — extra edge tests.

## Steps

```ts
export const GEAR_RATIOS: readonly number[] = [3.2, 2.3, 1.8, 1.45, 1.2, 1.0];
export const FINAL_DRIVE = 3.4, IDLE_RPM = 3000, LIMITER_RPM = 9000, UPSHIFT_RPM = 8500, DOWNSHIFT_RPM = 5000;
export type GearboxMode = 'auto' | 'manual';
/** rpm = |speed| / wheelRadius(0.33) * ratio * FINAL_DRIVE * 60 / (2π), clamped to >= IDLE_RPM. */
export function rpmFor(speedMs: number, gear: number): number; // gear is 1-based
export class Gearbox {
  gear: number; mode: GearboxMode;   // start at 1, 'auto'
  setMode(mode: GearboxMode): void;
  shiftUp(): void; shiftDown(): void;   // manual mode only; clamp to 1..6
  update(speedMs: number): void;        // auto: up at rpm >= UPSHIFT_RPM (gear < 6), down at rpm < DOWNSHIFT_RPM (gear > 1); one shift per call
  rpm(speedMs: number): number;         // rpmFor with the current gear
  driveScale(speedMs: number): number;  // 0 when rpm >= LIMITER_RPM, else 1
}
```

- Vehicle: add `gear(): number`, `rpm(): number`, `shiftUp()`, `shiftDown()`, `setGearMode(mode)`; call `gearbox.update(forwardSpeed)` each step; multiply the engine force by `driveScale`. Existing drive force formula unchanged otherwise (wheel radius unchanged).
- Use `|forwardSpeed|` for rpm; reversing stays in gear 1. Existing vehicle tests (0-100 km/h, top speed) keep passing.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/045-gearbox.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | gear 1, v = 0 | `rpm` | 3000 (idle clamp) |
| AT2 | gear 3, v = 30 m/s | rpm | 30/0.33 × 1.8 × 3.4 × 60/2π ±1 rpm |
| AT3 | auto mode accelerating | rpm crosses 8500 | upshift to next gear; never above 6 |
| AT4 | auto mode braking | rpm < 5000 and gear > 1 | downshift |
| AT5 | manual mode, gear 2 at limiter 9000 | throttle | drive force 0 while at limiter |
| AT6 | manual | `shiftUp` ×7 | gear 6 (clamped); `shiftDown` ×7 → 1 |

## Acceptance criteria

- [ ] All AT rows pass; existing vehicle tests still pass.
- [ ] `src/physics/gearbox.ts` imports nothing outside `src/core`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Key/gamepad bindings and HUD (tasks 046, 048, 054); torque curve, clutch, shift delay, reverse gear.

