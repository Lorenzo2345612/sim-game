# 091 — Start sequence and grid

Status: pending
Phase: 2
Depends on: nothing
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Pure start-light sequence with a random hold time, staggered grid slot poses behind the start line, and jump-start detection.

## Context

New layer `src/race`: imports only `src/core` and `src/track` (pure, no `three`, no Rapier, no `Math.random`; randomness is the injected `rng`). Types: `TrackDataV2`, `SpawnPose` from `src/core/types`. Yaw convention: `yaw = atan2(-dx, -dz)` (`ai/guides/architecture.md`). Lateral + = right of travel, normal `[-dz, dx]/len`.

## Files

- `src/race/startSequence.ts` — create
- `src/race/grid.ts` — create
- `tests/unit/race/startSequence.test.ts`, `tests/unit/race/grid.test.ts` — create

## Steps

```ts
export type StartPhase = 'grid' | 'lights' | 'hold' | 'go';
export class StartSequence {
  constructor(rng: () => number);
  update(dt: number): void;
  readonly phase: StartPhase;
  readonly lights: number;           // 0..5
  readonly goTime: number | null;    // elapsed time at which 'go' was reached
}
export function gridSlots(track: TrackDataV2, count: number, spacing?: number /* default 8 */): SpawnPose[];
export function isJumpStart(movedMeters: number, phase: StartPhase): boolean;
```

- Timeline (elapsed t since construction): 'grid' for t < 2 s, lights 0; 'lights' from 2 s: light k (1..5) turns on at 2 + (k − 1) s, so lights = 5 at 6 s; 'hold' from 6 s for `0.2 + 2.8·rng()` s (rng called once, at the transition to 'hold'), lights stay 5; then 'go', lights 0, `goTime` = elapsed time of that update. `goTime` null before.
- `gridSlots`: slot k (0 = pole) at distance d = 6 + spacing·k behind centerline index 0, measured along the centerline backwards (wrapping from index 0 to the last point, linear interpolation between points); lateral = (k even ? +1 : −1)·widthMeters/4 (pole on the right); `yaw` = track direction at that point (segment containing it); `position.y` = interpolated `elevation` + 0.6; x,z = centerline point + lateral · right normal.
- `isJumpStart(m, phase)` = `m > 0.5 && phase !== 'go'`.

Conventions: phase boundaries are reached when accumulated time ≥ boundary − 1e-9 s (time is a sum of dt steps, e.g. 240 × 1/120 = 1.9999999999999953); times in seconds, distances in metres; `count` ≤ 0 → empty array; `count` larger than the lap just keeps wrapping; `update` with dt ≤ 0 is a no-op; no input is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | rng → 0.5 | update in 1/120 steps | lights 0 until 2 s, 1 at 2 s, 5 at 6 s; 'go' at 6 + 0.2 + 1.4 = 7.6 s ± 1/120; lights 0 after |
| AT2 | rng → 0 / → 0.999999 | same | go at 6.2 / ≈ 9.0 s ± 1/120 |
| AT3 | closed rectangle loop 200 × 100 m, spacing 2 m, index 0 at (0, 0) on a long side driving towards −Z, the 50 points before index 0 at (0, +2k), flat, width 12, count 3 | gridSlots | slot 0 at 6 m behind, x +3; slot 1 at 14 m, x −3; slot 2 at 22 m, x +3 (± 1e-6); yaw facing −Z |
| AT4 | moved 0.6 in 'hold' / 0.6 in 'go' / 0.4 in 'lights' | isJumpStart | true / false / false |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] No imports outside `src/core`, `src/track`; no `Math.random`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Applying jump-start penalties, holding cars on the grid, pit-lane starts.
- Rendering lights or any UI (`createStartLights` is wired later).
- Editing `ai/guides/architecture.md` (done in 089).
