# 311 — Penalty caps and disqualification in PenaltyBook and RaceClassification

Status: pending
Phase: 2
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

PenaltyBook caps penalties per reason and in total (final warning, then black flag) and RaceClassification can disqualify a car.

## Context

Extends `src/race/penalties.ts` (task 130) and `src/race/classification.ts` (task 092). Return values of `add` are new; existing callers ignore them. Guide: `ai/guides/testing.md`.

## Files

- `src/race/penalties.ts` — modify
- `src/race/classification.ts` — modify
- `tests/unit/acceptance/311-penalty-caps.test.ts` — create (from the table)
- Protected, must pass unchanged: `tests/unit/acceptance/130-penalty-book-and-rules-wiring.test.ts`, `tests/unit/edge/130-penalty-book-and-rules-wiring-edge.test.ts`, `tests/unit/edge/130-penalty-book-and-rules-wiring.post.test.ts`, `tests/unit/acceptance/092-race-classification.test.ts`, `tests/unit/edge/092-race-classification-edge.test.ts`, `tests/unit/edge/092-race-classification.post.test.ts`, `tests/unit/race/classification.test.ts`; also keep compiling/passing `tests/unit/acceptance/093-race-game.test.ts`, `tests/unit/edge/093-race-game-*.test.ts`, `tests/unit/edge/289-yellow-cap*.test.ts`, `153-simulation-cost`, `269-evolved-neural-driver`, `292-race-lap-times-hud`, `294-race-control` and the e2e specs 093/094/095/130/294.

## Steps

```ts
// penalties.ts (PenaltyReason unchanged)
export type PenaltyOutcome = 'ok' | 'final-warning' | 'black-flag';
export interface PenaltyLimits { maxPerReason: number; maxTotal: number } // integer >= 1 or Infinity
export const DEFAULT_PENALTY_LIMITS: PenaltyLimits = { maxPerReason: 3, maxTotal: 5 };
// PenaltyEntry.kind: 'warning' | 'penalty' | 'black flag'; PenaltyEntry gains finalWarning?: true
constructor(carCount: number, limits?: Partial<PenaltyLimits>) // missing keys use defaults
add(car: number, kind: 'warning' | 'penalty', seconds: number, reason: PenaltyReason, time: number): PenaltyOutcome
count(car: number, reason?: PenaltyReason): number // number of 'penalty' entries (per reason if given)
isBlackFlagged(car: number): boolean
// classification.ts (class RaceClassification)
disqualify(car: number): void
isDisqualified(car: number): boolean
```

1. Limits: a limit that is not an integer >= 1 and not Infinity (0, negative, fractional, NaN) throws `RangeError` in the constructor.
2. Warnings never count toward limits and always return `'ok'` (unless black-flagged).
3. A 'penalty' is recorded, then outcome: `'black-flag'` if the car's penalty count (all reasons) or count for this reason exceeds its limit; else `'final-warning'` if either count equals its limit; else `'ok'`.
4. On `'black-flag'` the offending penalty is NOT recorded as a penalty: instead an entry `{kind:'black flag', seconds:0, reason, time}` is pushed and `total()` is not increased. Set `finalWarning: true` only on the penalty entry whose outcome is `'final-warning'`.
5. Once black-flagged, every `add` for that car returns `'black-flag'` and records nothing. Other cars are unaffected.
6. `count`, `isBlackFlagged`, `add` validate `car` with the existing RangeError check.
7. `disqualify`: no-op if the car finished or is already disqualified. Marks it disqualified with a sequence number (like `retireSeq`). A retired car moves from retired to disqualified. The DSQ car counts once toward `finished` (no double count with retire). `update()` ignores a disqualified car (distance frozen).
8. Order in `standings()`: finished, running, retired, disqualified (DSQ in disqualify order, earlier first). `Standing` type unchanged.

Conventions: limit comparison with `>` and `===` on integer counts; invalid limit or car index throws `RangeError`; no inputs mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Note: in rows, "Classification" means `RaceClassification` (constructor `(carCount, laps, lapLength)`); "finished" is its `finished` getter.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new PenaltyBook(1)` | add 3 warnings 'track limits' (0 s), then 4 penalties 'track limits' 5 s at times 1..4 | warnings return `'ok'`; penalties return `'ok'`, `'ok'`, `'final-warning'`, `'black-flag'`; `total(0)` = 15; last entry `{kind:'black flag', seconds:0, reason:'track limits', time:4}`; third penalty entry `finalWarning === true`, first two have no `finalWarning`; `isBlackFlagged(0)` true |
| AT2 | `new PenaltyBook(1)` | penalties: 3 × 'track limits' 5 s, 'jump start' 5 s, 'VSC delta' 2 s, 'yellow flag overtake' 5 s | outcomes `ok, ok, final-warning, ok, final-warning, black-flag`; `total(0)` = 22; `count(0)` = 5; `count(0,'track limits')` = 3; `count(0,'yellow flag overtake')` = 0 |
| AT3 | book from AT1 | `add(0,'warning',0,'jump start',5)` and `add(0,'penalty',5,'VSC delta',6)` | both return `'black-flag'`; `entries().length` and `total(0)` unchanged |
| AT4 | `new PenaltyBook(1)` | 10 warnings 'track limits' | all `'ok'`; `count(0)` = 0; `isBlackFlagged(0)` false |
| AT5 | `new PenaltyBook(1, {maxPerReason: Infinity, maxTotal: Infinity})` | 20 penalties 'track limits' 5 s | all `'ok'`; `total(0)` = 100 |
| AT6 | `new PenaltyBook(1, {maxPerReason: 1})` | 2 penalties 'jump start' 5 s | `'final-warning'`, `'black-flag'`; `total(0)` = 5 |
| AT7 | — | `new PenaltyBook(2, {maxPerReason: v})` for v in 0, -1, 1.5, NaN; and `{maxTotal: 0}` | each throws `RangeError` |
| AT8 | `new PenaltyBook(2)`, car 1 black-flagged as in AT1 | `add(0,'penalty',5,'track limits',9)` | returns `'ok'`; `isBlackFlagged(0)` false; `total(0)` = 5 |
| AT9 | `new PenaltyBook(2)` | `count(2)`, `isBlackFlagged(-1)` | `RangeError` |
| AT10 | `Classification` 3 cars, cars 0-2 updated to distances 300, 200, 100 m on lap 1 | `retire(2)`, `disqualify(1)`, `standings()` | car order 0, 2, 1; `isDisqualified(1)` true, `isDisqualified(2)` false; `finished` false |
| AT11 | AT10 state | car 0 finishes | `finished` true |
| AT12 | `Classification` 3 cars running | `disqualify(2)` then `disqualify(1)` | order 0, 2, 1 |
| AT13 | `Classification` 2 cars, car 0 finished | `disqualify(0)` | `isDisqualified(0)` false; car 0 position 1 |
| AT14 | `Classification` 2 cars | `retire(1)`, `disqualify(1)` | `isDisqualified(1)` true; `finished` false; after car 0 finishes `finished` true |
| AT15 | car 1 disqualified at distance 100 m | `update(1, 500, t)` | car 1 standing distance still 100 m |
| AT16 | — | run 130 and 092 unit tests and tests/unit/race/classification.test.ts | pass |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/311-penalty-caps.test.ts`.
- [ ] Protected tests listed in Files pass unchanged.
- [ ] `npm run typecheck` passes (no caller breaks from `add` returning a value or the widened `kind`).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- `src/game/raceGame.ts`, UI, HUD, qualifying, `trackLimits.ts`: no wiring of outcomes or `disqualify` calls.
- Changing the `Standing` type or existing method signatures.
