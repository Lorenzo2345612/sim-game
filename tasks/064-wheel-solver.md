# 064 — Implicit wheel solver

Status: pending
Phase: 1
Depends on: 058, 059
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A pure per-wheel solver that computes longitudinal/lateral tyre force and the new wheel spin with an implicit step that is stable at 120 Hz.

## Context

Design: `ai/guides/vehicle-dynamics.md` ("Longitudinal force and wheel spin are solved implicitly", locked wheel, safety clamp). Reference: `ai/lab/vehicle-model.mjs`. Uses `tyreMu`, `tyreForces` (task 059, `src/physics/tyre.ts`) and `TyreCompound` from `src/physics/carSpec.ts`. Pure TypeScript.

## Files

- `src/physics/wheelSolver.ts` — create
- `tests/unit/physics/wheelSolver.test.ts` — create (edge cases)

## Steps

```ts
import type { TyreCompound } from './carSpec';
export interface WheelSolveInput {
  omega: number; r: number; inertia: number; driveTorque: number; brakeTorque: number; // brakeTorque >= 0
  vx: number; fz: number; compound: TyreCompound; factor: number; alpha: number;
  massShare: number; dt: number; // massShare = total mass / 4
}
export interface WheelSolveOutput { omega1: number; fx: number; fy: number; locked: boolean }
export function solveWheel(p: WheelSolveInput, out: WheelSolveOutput): void;
```

- Fx(s) comes from `tyreForces` at κ(s); solve s1 = sFree − dt·c·Fx(s1) per the guide: 3–4 Newton steps with bisection fallback on [0, sFree]. `fy` is the lateral force for `alpha` at the final κ (friction ellipse included).
- Locked-wheel rule and safety clamp |Fx| ≤ massShare·|vx|/dt exactly as in the guide. `omega1` never changes sign through zero under braking (clamps to 0).
- No allocation per call; writes only into `out`.
- Hint (after failed rounds): `fy` from `tyreForces` at the final κ must be scaled so that (fx/Dx)² + (fy/Dy)² ≤ 1 with the solver's `fx` (scale `fy` only); the coder's own unit tests may not demand more than that.

Conventions: no rounding; `fz <= 0` gives fx = fy = 0 and ω advances freely with torques; `|vx|` floor is the tyre module's `V_LOW`; NaN input is a caller error (not handled); `p` is not mutated, `out` is.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | free rolling ω·r = vx = 30, no torques | solve | fx ≈ 0 (|fx| < 1 N), ω unchanged ± 1e-6 |
| AT2 | brake torque 50 000 N·m (enough to stop ω = vx/r in one step: > ω·I/dt ≈ 15 400), vx 30 | solve | locked = true, omega1 = 0, fx < 0 and |fx| ≤ mu·fz·1.0001 |
| AT3 | vx 0, ω 0, brake on, drive 0 | solve | omega1 0, |fx| ≤ (m/4)·|v|/dt = 0 → fx 0 |
| AT4 | drive torque 600 N·m (below the grip limit), vx 0, ω 0, r 0.28, I 1.2, m/4 162.5 | 120 steps (chassis vx updated by fx/(m/4)·dt each step) | no oscillation: ω monotonic non-decreasing; final fx = 600/(r + I/((m/4)·r)) ± 2 % (coupled steady state ≈ 1957.6 N); 0 < κ ≤ 0.25 |
| AT5 | any input from a 10 000-case random sweep (seeded) | solve | outputs finite; |fx| ≤ mu·fz·(1 + 1e-6) |
| AT6 | ω would cross zero under braking | solve | omega1 = 0 exactly, never sign-flipped |

## Acceptance criteria

- [ ] All AT rows pass; AT5 uses a seeded PRNG (mulberry32).
- [ ] No `three`/Rapier imports; no object creation inside `solveWheel`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Slip-angle relaxation state, engine reflected inertia, ABS/TC, chassis integration (all in 065).
