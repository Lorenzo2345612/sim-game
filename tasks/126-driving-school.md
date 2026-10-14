# 126 — Driving school lessons

Status: pending
Phase: 2
Depends on: 123, 125, 143, 044
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

A driving school offers four lessons on a track, each with a goal, a hint and a pass/fail result, with progress saved and a first-launch prompt.

## Context

Design: `docs/plans/game-features.md` section 126. Reuses: distance boards from the track JSON (`boards`, task 143; board100 = distance of the first label-100 board), driving line (123), assist preset beginner (125, `src/game/assists.ts`), `speedProfile`/`carLimitsFromSpec` (088), `computeRacingLine` (087), menu screens (044, `src/ui/menu.ts`), single-car `Game` (`src/game/game.ts`, exposes lap info and state). Lessons run on monza with `f4`. Distances along the lap from the start line, lateral + = right. Pure module: no `three`, no DOM, no `Math.random`. e2e: `tests/e2e/acceptance/126-driving-school.spec.ts`.

## Files

- `src/game/lessons.ts` — create (pure).
- `src/ui/schoolOverlay.ts` — create: DOM overlay ids `#school-prompt`, `#school-skip`, `#school-start`, `#lesson-goal`, `#lesson-hint`, `#lesson-result`; lesson list `#school-lessons` with buttons `[data-lesson="L1".."L4"]`.
- `src/ui/menu.ts` — modify: "Driving school" entry (optional handler `onSchool`).
- `src/main.ts` — modify: menu entry "Driving school" opens the list; a lesson starts a `Game` session with the beginner preset and builds `LessonState` samples each tick; storage `school:<track>` (JSON `{L1?: boolean, ...}`), `school-skip` = "1" when Skip pressed.
- `tests/unit/acceptance/126-driving-school.test.ts` — acceptance worker.

## Steps

```ts
export type LessonId = 'L1' | 'L2' | 'L3' | 'L4';
export interface LessonState { t: number; speed: number; distance: number; lateral: number; offTrack: boolean; lapTime: number; stoppedInBox: boolean; brake?: number; lapValid?: boolean }
export interface LessonContext { lineOffset?: (distance: number) => number; board100?: number; targetLapTime?: number }
export interface LessonResult { passed: boolean; reason?: 'outside box' | 'timeout' | 'off line' | 'off track' | 'brake point' | 'slow lap' | 'invalid lap' }
export const LESSON_GOALS: Record<LessonId, string>;
export function evaluateLesson(id: LessonId, samples: readonly LessonState[], ctx?: LessonContext): LessonResult;
export function profileLapTime(speeds: Float64Array, dist: Float64Array, length: number): number;
export function lapTargetTime(profileLap: number): number;
```

1. `LESSON_GOALS`: L1 "Accelerate to 100 km/h then stop inside the box", L2 "Follow the line through the first chicane", L3 "Brake at the 100 board", L4 "Complete a lap under target time". `#lesson-goal` shows the goal; `#lesson-hint` a short text per lesson.
2. L1: box = distance 400–420 m (inclusive). Pass: some sample reached speed ≥ 27.78 m/s earlier, and a sample with `stoppedInBox` true has `t ≤ 30`. Else `timeout` if last `t > 30`, else `outside box` if the final sample has speed < 0.5 and `stoppedInBox` false. `stoppedInBox` is computed by the caller (speed < 0.5 and distance in box).
3. L2: samples with distance in [600, 1000]: pass when ≥ 90 % have `|lateral − ctx.lineOffset(distance)| < 2` and none `offTrack`; else `off track` / `off line`. No samples in the range: fail `off line`.
4. L3: brake start = first sample with `brake > 0.3` and distance ≥ `ctx.board100 − 100`; pass when it lies within `board100 ± 20` and no `offTrack` sample after it up to `board100 + 400`; else `brake point` / `off track`.
5. L4: last sample: `lapValid !== false` else `invalid lap`; `lapTime ≤ ctx.targetLapTime` else `slow lap`.
6. L2 without `ctx.lineOffset` uses offset 0. `profileLapTime` = Σ ds / mean of the two end speeds over the closed loop (ds from `dist`, closing segment uses `length`). `lapTargetTime(p) = 1.15·p`.
7. Prompt: on page load with no `school-skip` item and no `school:*` item, show `#school-prompt` with Start and Skip; Skip stores `school-skip`, hides the prompt.

Conventions: thresholds as written (`<` for lateral, `≤` for times); empty samples fail with the lesson's primary reason; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | L1 with samples reaching 28 m/s then speed 0 at 410 m by 20 s | evaluate | passed |
| AT2 | L1 stopping at 425 m / after 31 s | evaluate | failed with reason 'outside box' / 'timeout' |
| AT3 | L2 with 85 % of samples within 2 m | evaluate | failed |
| AT4 | L4 target for f4 at monza | call | 1.15 × profile lap time ± 1e-6 |
| AT5 | e2e first launch (empty storage) | `/` | `#school-prompt` visible; Skip → reload → not visible |
| AT6 | e2e start L1 | DOM | `#lesson-goal` text contains "100 km/h"; no console errors |

## Acceptance criteria

- [ ] AT1–AT6 pass.
- [ ] Passing a lesson writes `school:<track>`; reload keeps it.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 126-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- New tracks/cars for lessons, voice or video hints, ghost instructor, rewards, race rules (127+).
