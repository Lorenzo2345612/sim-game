# 062 — Powertrain: engine, launch rpm, differential, generalised gearbox

Status: pending
Phase: 1
Depends on: 058, 045
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure powertrain functions driven by `CarSpec` (torque curve, limiter, launch rule, diff) and the task 045 `Gearbox` generalised to `CarSpec.gearbox` with a shift delay.

## Context

Design: `ai/guides/vehicle-dynamics.md` (Powertrain section, `engine`/`gearbox`/`diff` fields). Reference: `ai/lab/vehicle-model.mjs`. Types `CarSpec` come from `src/physics/carSpec.ts` (task 058); do not redefine. Pure TypeScript, no `three`, no Rapier.

## Files

- `src/physics/powertrain.ts` — create
- `src/physics/gearbox.ts` — modify (created by 045)
- `tests/unit/physics/powertrain.test.ts` — create (edge cases)

## Steps

```ts
import type { CarSpec } from './carSpec';
type Engine = CarSpec['engine']; type Diff = CarSpec['diff'];
export function engineTorque(engine: Engine, rpm: number, throttle: number): number;
export function engineRpm(spec: CarSpec, gear: number, drivenOmega: number, throttle: number): number;
export function diffSplit(diff: Diff, tIn: number, omegaL: number, omegaR: number, onThrottle: boolean): [number, number];
// gearbox.ts additions (existing exports and defaults keep working)
export class Gearbox {
  constructor(params?: CarSpec['gearbox'], wheelRadius?: number, engine?: Pick<CarSpec['engine'], 'idleRpm' | 'limiterRpm'>);
  update(speedMs: number, dt?: number): void;   // dt defaults to FIXED_DT (src/core/constants); advances the shift timer
  driveScale(speedMs: number): number;           // 0 at limiter or while shifting
}
```

- `engineTorque`: linear interpolation of `torqueCurve` clamped to end values; `rpm >= limiterRpm` and throttle > 0 gives 0; throttle 0 gives `-brakingTorque`; otherwise curve·throttle (throttle clamped 0..1).
- `engineRpm`: rpm = |drivenOmega|·ratio[gear-1]·final·60/(2π); in gear 1 rpm = max(raw, idle + throttle·(launchRpm − idle)); never below `idleRpm`; `gear` 1-based.
- `diffSplit`: open = equal split; lsd = coupling torque clamp(K·Δω, ±(preload + lock·|tIn|)) with K = 30 N·m·s/rad, lock = `lockPower` on throttle, `lockCoast` off; the slower wheel gets +coupling, the faster −coupling; locked = lsd with lock 1. Sum of outputs always equals `tIn`.
- Gearbox: with `params` use its ratios/final/upRpm/downRpm and `engine.limiterRpm`/`idleRpm` (defaults: task 045 constants); `shiftTime` s after any shift during which `driveScale` is 0; no params = task 045 defaults and behaviour (no delay); existing 045 callers of `update(speedMs)` keep working (`dt` defaults to `FIXED_DT`).

Conventions: no rounding; limiter boundary inclusive (`>=` cuts); invalid gear index clamps to 1..N; NaN throttle treated as 0; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | F4 curve | rpm between two points | linear interpolation exact; below first / above last point → clamp to end values |
| AT2 | rpm ≥ limiterRpm, throttle 1 | engineTorque | 0 |
| AT3 | throttle 0, rpm 5000 | engineTorque | −brakingTorque |
| AT4 | gear 1, omega 0, throttle 1 | engineRpm | launchRpm (4000); throttle 0 → idleRpm |
| AT5 | gear 3, omega 50 rad/s | engineRpm | 50·ratio3·final·60/(2π) ± 1e-6 |
| AT6 | open diff, tIn 400, ωL ≠ ωR | split | [200, 200] |
| AT7 | lsd preload 50, lock 0.3, tIn 400, Δω large | split | difference capped at 2·(50 + 0.3·400) total transfer; sum = 400 |
| AT8 | Gearbox with F4 params, manual mode, `shiftUp()` from gear 1 | `update(speed, dt)` during the next 0.15 s | driveScale 0; after 0.15 s, 1 |

## Acceptance criteria

- [ ] All AT rows pass; existing 045 gearbox tests still pass.
- [ ] `powertrain.ts` imports only types from `./carSpec`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Clutch/engine inertia reflection (task 064/065), fuel burn (063), Vehicle integration (065), key bindings and HUD.
