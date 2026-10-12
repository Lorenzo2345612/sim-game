# 003 — Implement the fixed-step loop

Status: done
Phase: 0
Depends on: 002
Roles: coder, tester, reviewer

## Goal

`FixedStepLoop` converts variable frame time into fixed-duration simulation steps and returns the interpolation factor.

## Context

Simulation at `FIXED_DT = 1/120` s; render interpolates (`ai/guides/architecture.md`, Conventions). No clock or `setTimeout`: the caller passes the frame seconds. `core` layer: pure TypeScript.

## Files

- `src/core/fixedStepLoop.ts` — create
- `tests/unit/core/fixedStepLoop.test.ts` — create

## Steps

1. Export (import `FIXED_DT`, `MAX_STEPS_PER_FRAME` from `./constants`):

```ts
export interface LoopAdvanceResult { steps: number; alpha: number }
export class FixedStepLoop {
  constructor(step: (dt: number) => void, fixedDt?: number /* default FIXED_DT */, maxSteps?: number /* default MAX_STEPS_PER_FRAME */);
  advance(frameSeconds: number): LoopAdvanceResult;
  reset(): void; // accumulator = 0
}
```

2. `advance(frameSeconds)`:
   - If `frameSeconds` is not finite (`!Number.isFinite`) or `<= 0`, nothing is added (continue with the rest of the algorithm using the current accumulator).
   - If valid: `accumulator += frameSeconds`.
   - `steps = 0`; `while (accumulator >= fixedDt && steps < maxSteps) { step(fixedDt); accumulator -= fixedDt; steps++ }`.
   - If `steps === maxSteps` and `accumulator >= fixedDt` → `accumulator = 0` (discard, avoids the spiral of death).
   - Return `{ steps, alpha: accumulator / fixedDt }`.
3. To avoid floating-point errors in tests, always compare with tolerance; do not add an epsilon in the code.

## Tests (`tests/unit/core/fixedStepLoop.test.ts`)

Use `new FixedStepLoop(fn, 1/120)` with an `fn` that counts calls and stores the received `dt`s.

- `advance(1/60) runs 2 steps with alpha near 0` → steps 2, alpha `toBeCloseTo(0, 6)` (tolerance: alpha may come out ≈0 or ≈1 due to rounding; accepting `alpha < 1e-6 || alpha > 1 - 1e-6` is valid).
- `partial frames accumulate` → `advance(0.5/120)` gives steps 0, alpha `toBeCloseTo(0.5, 6)`; another `advance(0.5/120)` gives steps 1.
- `huge frame is clamped to 8 steps and drops remainder` → `advance(1)` gives steps 8, alpha 0 (`toBeCloseTo(0, 10)`).
- `negative frame time adds nothing` → `advance(-1)` steps 0.
- `NaN and Infinity frame time add nothing` → `advance(NaN)` and `advance(Infinity)` steps 0 and `step` never called.
- `step always receives fixedDt` → all stored `dt`s `toBeCloseTo(1/120, 12)`.
- `reset clears the accumulator` → `advance(0.5/120)`, `reset()`, `advance(0)` returns alpha `toBeCloseTo(0, 10)`.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/003-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `FixedStepLoop` with fixedDt 1/120, maxSteps 8, step counter | `advance(1/60)` | 2 step calls, each with dt = 1/120; alpha ∈ [0, 1] |
| AT2 | fresh loop | `advance(0.5/120)` then `advance(0.5/120)` | first returns steps 0, alpha 0.5 ±1e-9; second returns steps 1 |
| AT3 | fresh loop | `advance(1.0)` | steps 8; alpha 0 (excess dropped) |
| AT4 | fresh loop | `advance(-1)`, `advance(NaN)`, `advance(Infinity)` | each returns steps 0; step never called |
| AT5 | loop after `advance(0.5/120)` | `reset()` then `advance(0)` | alpha 0 |

## Acceptance criteria

- [ ] The 7 tests pass; typecheck and lint without errors.
- [ ] `fixedStepLoop.ts` only imports from `./constants`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `requestAnimationFrame`, `performance.now`, real-time measurement.
- State interpolation (task 017).
- Pause, time scale, events.
