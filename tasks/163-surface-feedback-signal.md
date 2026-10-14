# 163 — Surface feedback signal (pure)

Status: pending
Phase: 1
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A pure function turns per-wheel surface and slip into three 0..1 feedback channels (camera shake, low-frequency rumble, high-frequency rumble) used by 164, 165.

## Context

Milestone M1.5b. `Surface` comes from `src/core/types.ts`. Simulation-side code: no `three`, no allocation per call.

## Files

- `src/core/surfaceFeedback.ts` — create.
- `tests/unit/acceptance/163-surface-feedback-signal.test.ts` — create (from the table).

## Steps

```ts
import type { Surface } from './types';
export interface Feedback { shake: number; low: number; high: number } // each 0..1
export const SURFACE_ROUGHNESS: Record<Surface, number>; // asphalt 0, runoff 0.1, grass 0.3, kerb 0.6, gravel 0.8
export function surfaceFeedback(wheels: ReadonlyArray<{ surface: Surface; kappa: number }>, speed: number, out: Feedback): Feedback;
```

- s = clamp(speed/30, 0, 1); non-finite speed gives s = 0.
- rough = mean of SURFACE_ROUGHNESS over wheels (unknown surface counts 0; no wheels gives 0).
- kerbFrac = fraction of wheels on kerb. slipExcess = clamp((max finite |kappa| − 0.15)/0.35, 0, 1); non-finite kappa ignored.
- shake = rough·s; low = rough·s; high = clamp01(kerbFrac·s + 0.5·slipExcess).
- Writes into and returns `out`.

Conventions: clamps are inclusive; invalid input degrades to 0, never throws; `wheels` not mutated; `out` is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 4 wheels asphalt, kappa 0 | speed 50 | {shake 0, low 0, high 0} (±1e-9) |
| AT2 | 4 wheels gravel, kappa 0 | speed 30 | {0.8, 0.8, 0} (±1e-9) |
| AT3 | 2 kerb + 2 asphalt, kappa 0 | speed 15 | {0.15, 0.15, 0.25} (±1e-9) |
| AT4 | 4 grass, kappa 0 | speed 60 | {0.3, 0.3, 0} (±1e-9) |
| AT5 | 4 asphalt, kappas 0, 0.5, 0.1, 0 | speed 40 | {0, 0, 0.5} (±1e-9) |
| AT6 | 4 kerb, kappa 0.85 | speed 30 | high = 1 (clamped) |
| AT7 | 4 gravel | speed NaN / −5; or kappas all NaN at speed 30 | all 0 / all 0; {0.8, 0.8, 0} |
| AT8 | empty wheel array | speed 30 | all 0 |
| AT9 | any input | call | returns the same `out` object passed in |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No import from `three`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into main.ts, camera, rumble (164, 165).
- Wet or weather effects.
