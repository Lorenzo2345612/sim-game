# 090 — AI traffic decisions and difficulty

Status: pending
Phase: 2
Depends on: 089
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure functions that decide, per AI car, a lateral offset and optional speed cap from nearby cars (overtaking and side-by-side room), plus the difficulty table.

## Context

Layer `src/ai` (imports only `src/core`, `src/track`; pure, no `Math.random`). Output feeds `AiDriver.setLateralOffset` / `setSpeedCap` (089). Lateral values are metres from the centerline, + = right (same as `TrackProgress.lateral`). `offset` is relative to the racing line at the point ahead (`lineOffsetAhead`), + = right. `curvatureAhead` is signed 1/m, + = turning right (Menger convention of 087).

## Files

- `src/ai/traffic.ts` — create
- `tests/unit/ai/traffic.test.ts` — create

## Steps

```ts
export interface CarTrafficState { distance: number; lateral: number; speed: number } // distance along lap (m), lateral from centerline (+ right)
export interface TrafficDecision { offset: number; speedCap: number | null }
export function trafficDecision(self: CarTrafficState, others: readonly CarTrafficState[], lapLength: number, halfWidth: number, lineOffsetAhead: number, curvatureAhead: number): TrafficDecision;
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export function difficultyParams(d: Difficulty): { speedScale: number; mistakesPerLap: number }; // easy 0.86/0.4, medium 0.93/0.2, hard 0.98/0.08, expert 1.0/0
```

gap = other.distance − self.distance wrapped to (−L/2, L/2], L = lapLength.
- Blocking car: 0 < gap < 25, |other.lateral − lineOffsetAhead| < 2.5, self.speed > other.speed + 0.5. The nearest blocking car (smallest gap) wins.
- Pass side for a blocker: prefer the inside of the next corner (curvatureAhead > 0 → pass on the right, < 0 → left; = 0 → prefer left); the side is feasible if `other.lateral ± 3.0` (+ for right, − for left) lies within ±(halfWidth − 1). Otherwise the other side if feasible. `offset = (other.lateral ± 3.0) − lineOffsetAhead`, `speedCap = null`. If neither side is feasible: `offset = 0`, `speedCap = other.speed`.
- Alongside (only when no blocker): |gap| < 5 and |other.lateral − self.lateral| < 2.2 → `offset` = −1.0 if other.lateral ≥ self.lateral (tie → −1.0), else +1.0; `speedCap = null`. Nearest |gap| wins.
- Otherwise `offset = 0`, `speedCap = null`.

Conventions: all comparisons strict as written (`<`, `>`); wrap boundary +L/2 maps to +L/2; empty `others` valid; `others` never mutated; `difficultyParams` returns a fresh object each call.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | no others | call | offset 0, speedCap null |
| AT2 | other 15 m ahead, same lateral 0, slower by 5, curvatureAhead +0.01, halfWidth 6 | call | offset +3.0 ± 1e-9 (inside = right) |
| AT3 | same but other.lateral +2, halfWidth 5.5 (right pass 5 > 4.5 does not fit) | call | offset −1.0 ± 1e-9 (left pass), speedCap null |
| AT4 | other ahead 15 m, slower, lateral 0, halfWidth 3 (nothing fits) | call | offset 0, speedCap = other.speed |
| AT5 | other at gap −3 (alongside), lateral +1.5, self 0 | call | offset −1.0 |
| AT6 | other ahead across the start line (self 5780, other 10, L 5788.4) | call | treated as gap 18.4 (blocking rule applies) |
| AT7 | difficultyParams for each level | call | table values exactly |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `src/ai/traffic.ts` has no imports other than types and no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying decisions to `AiDriver` or scheduling mistakes (`mistakesPerLap` is only returned).
- Defending lines, car-to-car contact avoidance beyond these rules, pit traffic.
- Computing `distance`/`lateral` (comes from `TrackProgress`).
