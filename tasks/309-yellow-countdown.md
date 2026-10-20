# 309 — Yellow flags: 3 s countdown before a sector turns yellow

Status: pending
Phase: 2
Depends on: 308
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

In races a sector does not turn yellow at once: a 3 s countdown runs first, during which the sector is still green (overtaking legal); the yellow starts when it reaches 0.

## Context

Approved mockup: `docs/design/mockups/yellow-flag-hud.html?state=countdown&n=3` (+ `mock-countdown-3.png`, `mock-countdown-1.png`); HUD is task 310. `src/race/flags.ts` `FlagState` (task 308 adds `FlagOptions {minYellowS, causeGapS}`, `RACE_MIN_YELLOW_S`, `RACE_CAUSE_GAP_S`); `sectorFlag(s)` drives overtake detection (`overtakeUnderYellow` skips green sectors) and the HUD. `RaceGame` builds `new FlagState([0, this.sectorB1, this.sectorB2], this.lapLength, {...})` (~raceGame.ts:310).

## Files

- `src/race/flags.ts`, `src/game/raceGame.ts` — modify.
- `tests/unit/acceptance/309-yellow-countdown.test.ts` — create (acceptance worker).
- Planner-authorised edits: `tests/unit/acceptance/298-*.test.ts` AT7 steps to 13.5 s after go instead of 10.5 s; other RaceGame-level acceptance/edge tests (130, 289, 305, 307, 308 AT7 excluded) may shift an expected yellow onset time by exactly +3 s, nothing else.

## Contract

```ts
export interface FlagOptions { minYellowS?: number; causeGapS?: number; countdownS?: number } // countdownS default 0 = no countdown
export const RACE_COUNTDOWN_S = 3;
readonly countdownS: number;
sectorCountdown(sector: number): number // seconds left (> 0) while a countdown runs in that sector, else NaN
```

Rules:
- Raw flag = the flag computed by today's rules (cause timers, DECAY, causeGapS) before minYellowS.
- When a sector's published flag is green and its raw flag becomes yellow or double-yellow, a countdown starts; `sectorFlag` stays `'green'` until `countdownS` has elapsed, then publishes the raw flag. The minYellowS onset is the activation time, not the countdown start.
- If the raw flag returns to green during the countdown, it is cancelled (NaN) and the sector stays green.
- Overtakes during the countdown are not yellow overtakes (the sector is green).
- `countdownS` 0: behaviour identical to 308. `RaceGame` passes `countdownS: RACE_COUNTDOWN_S`.
- No allocations per update.

## Acceptance tests (defined by the planner with Opus, before coding)

Updates every 1/120 s; B = [0, 1000, 2000], L = 3000; car at lapDistance = distance = 500 (sector 1) unless stated. "Off track" = off track at 30 m/s; otherwise on track at 60 m/s.

| ID | Given | When | Then (expected, tolerance one step) |
|---|---|---|---|
| AT1 | options `{countdownS: 3}`; car off track for all t | update to t = 4.2 | `sectorFlag(1)` `'green'` at t = 3.9, `'yellow'` at 4.1; `sectorCountdown(1)` NaN at 0.9, 2.9 (±0.02) at 1.1, 0.1 (±0.02) at 3.9, NaN at 4.1 |
| AT2 | `{countdownS: 3}`; car off track t ∈ [0, 1.5), then on track | update to t = 8 | `'green'` at every update; `sectorCountdown(1)` NaN at every update with t ≥ 3.6 |
| AT3 | `{countdownS: 3}`; car 1 off track at 500 for all t; cars 2 and 3 on track in sector 1, car 2 behind car 3 | car 2 moves ahead of car 3 at t = 2, back behind at t = 3, ahead again at t = 4.5; drain `overtakeUnderYellow()` after each update | overtakes recorded at t = 2: none; at t = 4.5: exactly `[{car: 2, passed: 3}]` (car/passed fields as in 128) |
| AT4 | `new FlagState(B, L)` and `{minYellowS: 10, causeGapS: 2}` | 128 AT3 and 308 AT2 scenarios | unchanged results; `countdownS` 0; `sectorCountdown(1)` NaN at every update |
| AT5 | `{minYellowS: 10, causeGapS: 2, countdownS: 3}`; car off track t ∈ [0, 5), then on track | update to t = 14.3 | `'green'` at 3.9; `'yellow'` at 4.1 and 13.9; `'green'` at 14.1 |
| AT6 | `RaceGame` cleveland, f4, aiCount 3, seed 1 | read `(g as any).flags.countdownS`, `.minYellowS` | 3 and 10 |
| AT7 | — | verification gate: run 128, 130, 289, 298, 305, 307, 308 unit acceptance tests and 128 edge tests | pass |

## Acceptance criteria

- [ ] AT1–AT7 pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/309- tests/unit/acceptance/128- tests/unit/acceptance/130- tests/unit/acceptance/289- tests/unit/acceptance/298- tests/unit/acceptance/305- tests/unit/acceptance/307- tests/unit/acceptance/308- tests/unit/edge/128-
```

## Out of scope

- HUD and minimap display (310), changing YELLOW_AFTER/DOUBLE_AFTER/DECAY/CAUSE_SPEED, give-back rules.
