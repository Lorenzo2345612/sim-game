# 277 — Qualifying classification

Status: pending
Phase: 3
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Pure class that times laps in a fixed-duration session (practice/qualifying): lap crossings, track-limit validity, best lap, order.

## Context

No `three`, no DOM, no allocation per `update` call beyond reuse. Sibling: `src/race/classification.ts` (race), `src/race/trackLimits.ts` (`countWheelsOff` gives the `wheelsOff` input, 0..4). Used by task 278. Guide: `ai/guides/testing.md`.

## Files

- `src/race/qualifying.ts` — create
- `tests/unit/acceptance/277-qualifying-classification.test.ts` — create (acceptance worker); edge tests by tester-pre.
- No protected tests change.

## Steps

```ts
export interface QualiStanding { car: number; position: number; bestLap: number | null; laps: number; lastLap: number | null; lastValid: boolean | null; done: boolean }
export class QualifyingClassification {
  constructor(carCount: number, lapLength: number, durationS: number);
  update(car: number, lapDistance: number, time: number, wheelsOff: number, dt: number): void;
  retire(car: number): void;
  get finished(): boolean;
  standings(): QualiStanding[];
}
export const QUALI_GRACE_S = 300; export const OFF_LIMIT_S = 0.25;
```

1. Forward crossing: `lapDistance` drops by more than `lapLength/2` between two consecutive updates of that car. Backward crossing: it rises by more than `lapLength/2` → the current lap is void and the next forward crossing only restarts timing (no lap counted).
2. The first forward crossing starts timing (out-lap untimed, not counted). Each later forward crossing completes a lap: `laps++`, `lastLap = time − start`, `lastValid`; valid unless 4 wheels were off continuously for ≥ `OFF_LIMIT_S` during it (accumulate `dt` while `wheelsOff` = 4, reset when < 4). Crossing time is the `time` of the update that detects it. Then timing restarts at that crossing.
3. `bestLap` = min over valid laps. Invalid laps still count in `laps`.
4. A car's first forward crossing at `time ≥ durationS` completes its lap (if timing) and sets `done`. `retire` sets `done`. Updates for a done car are ignored.
5. `finished` = all cars done, or any `update` with `time ≥ durationS + QUALI_GRACE_S` (then all cars become done).
6. `standings()` order: `bestLap` asc (null last); tie → earlier time that best was set; then car index. `position` 1-based.

Conventions: `≥ OFF_LIMIT_S` and `≥ durationS` inclusive; `> lapLength/2` strict; invalid car index → ignored; `lastLap`/`lastValid` null before the first lap; no rounding.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given (lapLength 1000, duration 600, 2 cars, updates every 0.05 s) | When | Then |
|---|---|---|---|
| AT1 | car 0 crosses at t=1 (990→5) and at t=61 | standings | car 0 laps 1, bestLap 60 (1e-6), lastValid true; car 1 bestLap null |
| AT2 | lap with wheelsOff 4 for 0.30 s continuous | lap completes | laps 1, bestLap null, lastValid false |
| AT3 | lap with two 0.20 s 4-off spells separated by on-track | lap completes | valid |
| AT4 | invalid lap then 58 s valid lap; separate car: 60 then 62 valid | standings | bests 58 and 60 |
| AT5 | lap started at 545, crossing at 605 | — | lap counted (60 s), done true; finished false while car 1 not done |
| AT6 | car 1 retire() after AT5 | — | finished true |
| AT7 | car never crosses | update at t=900.0 | finished true, that car done, bestLap null |
| AT8 | timing started t=1; backward crossing (5→995) at t=30, then forward crossings at 70 and 130 | — | no lap from the voided one; laps 1 with lastLap 60 |
| AT9 | both cars best 60.0, car 1 set it earlier | standings | car 1 position 1 |

## Acceptance criteria

- [ ] All AT rows pass; no `three` import in `src/race/qualifying.ts`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Wiring into `RaceGame` (278), UI, session result adapters (279), pit stops, tyre/compound logic.
