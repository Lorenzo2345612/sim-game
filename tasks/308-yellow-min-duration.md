# 308 — Yellow flags: minimum duration and continuous spin cause

Status: pending
Phase: 2
Depends on: 307
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Yellow flags no longer flicker: in races a sector stays yellow at least 10 s, and a car spinning on/off the track keeps a continuous cause.

## Context

User report: a car turning around to rejoin crosses the track edge several times and the yellow comes and goes. In `src/race/flags.ts` (`YELLOW_AFTER` 1 s of continuous cause, `DOUBLE_AFTER` 3 s, `DECAY` 2 s after the last cause) the per-car timers `yellowFrom`/`doubleFrom` reset to NaN on the first cause-free tick, so on/off-track toggling never accumulates 1 s and the flag decays after 2 s. `flagOf(sector)` decides the flag. `RaceGame` builds `new FlagState([0, this.sectorB1, this.sectorB2], this.lapLength)` (~raceGame.ts:310). Many tests (128 acceptance/edge, 130, 289, 298, 305, 307) pin today's timings: defaults must keep them unchanged.

## Files

- `src/race/flags.ts` — modify.
- `src/game/raceGame.ts` — modify — pass options.
- `tests/unit/acceptance/308-yellow-min-duration.test.ts` — create (acceptance worker).

## Contract

```ts
export interface FlagOptions { minYellowS?: number; causeGapS?: number } // both default 0 = today's behaviour
constructor(sectorBounds: [number, number, number], lapLength: number, options?: FlagOptions)
readonly minYellowS: number; readonly causeGapS: number;
export const RACE_MIN_YELLOW_S = 10; export const RACE_CAUSE_GAP_S = 2;
```

Rules:
- `causeGapS`: a car's yellow and double-yellow cause timers reset only after the car has been free of that cause continuously for ≥ `causeGapS` (a shorter cause-free gap keeps the original start time). With 0, reset on the first cause-free tick (today).
- `minYellowS`: when a sector goes from green to yellow/double-yellow, record its onset time; while time − onset < `minYellowS` the sector is at least `'yellow'` (double-yellow still follows its own DECAY rule and falls back to yellow). A new onset is only recorded from green.
- `RaceGame` constructs `FlagState` with `{ minYellowS: RACE_MIN_YELLOW_S, causeGapS: RACE_CAUSE_GAP_S }`.
- No allocations per update.

## Acceptance tests (defined by the planner with Opus, before coding)

All updates every 1/120 s unless stated; B = [0, 1000, 2000], L = 3000; one car at lapDistance = distance = 500, sector 1.

| ID | Given | When | Then (expected, tolerance one step) |
|---|---|---|---|
| AT1 | `new FlagState(B, L)` (no options) | 128 AT3 scenario | unchanged: yellow at t + 1.9, green at t + 2.1; `minYellowS` 0, `causeGapS` 0 |
| AT2 | options `{minYellowS: 10, causeGapS: 2}`; car off track at 30 m/s for t ∈ [0, 1.5), then on track at 60 m/s | update to t = 11.2 | `sectorFlag(1)` `'yellow'` at t = 1.1 and at 10.9; `'green'` at 11.1 |
| AT3 | same options; car alternates off track 0.6 s / on track 0.6 s (off first) at 30 m/s for t ∈ [0, 20), then on track at 60 m/s | update to t = 22 | `'yellow'` at every update with t ∈ [1.2, 21.7]; `'green'` at 21.9 |
| AT4 | no options, same alternating car as AT3 | update to t = 20 | `'green'` at every update (documents today's flicker baseline) |
| AT5 | options `{minYellowS: 10, causeGapS: 2}`; car off track t ∈ [0, 0.5), on track at 60 m/s t ∈ [0.5, 2.6), off track t ∈ [2.6, 3.4), then on track | update to t = 3.4 | `'green'` at every update (gap 2.1 s ≥ causeGapS resets the timer; neither stint reaches 1 s) |
| AT6 | options `{minYellowS: 10, causeGapS: 2}`; car on track at speed 0 for t ∈ [0, 3.5), then 60 m/s | update to t = 11.2 | `'double-yellow'` at 3.1 and 5.4; `'yellow'` at 5.6 and 10.9; `'green'` at 11.1 |
| AT7 | `RaceGame` cleveland, f4, aiCount 3, seed 1 | read `(g as any).flags.minYellowS`, `.causeGapS` | 10 and 2 |
| AT8 | — | regression only, no new test: run 128, 130, 289, 298, 305, 307 unit acceptance tests and 128 edge tests | pass |

## Acceptance criteria

- [ ] AT1–AT8 pass; existing flag tests unchanged and passing.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/308- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289- tests/unit/acceptance/298- tests/unit/acceptance/305- tests/unit/acceptance/307- tests/unit/edge/128-
```

## Out of scope

- Changing `YELLOW_AFTER`, `DOUBLE_AFTER`, `DECAY`, `CAUSE_SPEED`, sector bounds or the HUD.
