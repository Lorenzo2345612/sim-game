# 321 — Blue flags: lapped cars yield the line, the player is penalised for ignoring them

Status: pending
Phase: 2
Depends on: 314
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Blue flags work as a rule: a lapped car moves off the lapping car's line without dropping out of its own fight, and the player is penalised for ignoring them.

## Context

- User: "si alguien va a ser doblado tiene que apartarse de la trazada pero seguir haciendo racing si viene peleando, sin interferir con el que viene".
- Today `FlagState.blueFor` (`BLUE_WINDOW` 200 m) makes the AI cap speed at 0.95 × line speed the whole time and steer 2 m to the roomier side (not away from the lapper); the player only gets a banner.
- `src/game/raceGame.ts`: `updateRuleReactions()` (~1310) sets `ruleOffset`, `ruleCap`, `blueUntil` (`BLUE_HOLD_S` 3 s), `blue0`; `applyRulesReaction` applies them; `book()` (~1194) books penalties; `contactCount` getter; `RaceScenario` (~41).

## Files

- `src/race/flags.ts` — modify — `blueLapper`.
- `src/race/blueFlagTimer.ts` — create — pure, no `three`.
- `src/race/penalties.ts` — modify — new `PenaltyReason`.
- `src/game/raceGame.ts` — modify — scenario, AI reaction, player timer.
- `src/ui/raceHud.ts` — modify — banner text.
- `tests/unit/acceptance/321-blue-flags.test.ts` — create (acceptance worker).

## Contract

```ts
// FlagState
blueLapper(car: number): number; // nearest car (smallest gap behind on track) > half a lap ahead in race distance within BLUE_WINDOW behind; -1 if none; retired cars ignored; RangeError as blueFor
blueFor(car: number): boolean;   // = blueLapper(car) !== -1 (behaviour unchanged)
// blueFlagTimer.ts
export class BlueFlagTimer { update(lapper: number, gap: number, dt: number): boolean }
// penalties.ts: PenaltyReason gains 'ignoring blue flags'
// RaceScenario gains
lapsAhead?: number[]; // by car index, whole laps added to that car's race distance and lap count at start; default 0
// RaceHudData gains
blueLapper: number; // -1 none
```

## Rules

- `lapsAhead` is seen by classification, `FlagState` and standings.
- AI under blue (including the `BLUE_HOLD_S` hold): lateral offset 2.5 m to the side away from the lapper's current lateral position relative to the blue car (lapper to its right → move left), clamped so the car stays ≥ 1.2 m inside the track edge. Residual-net AIs follow the same offset and cap.
- Speed: `battling` = another car on the same lap as the blue car (not the lapper) within 50 m of race distance ahead or behind. Battling → no blue cap. Else lapper within 40 m behind → cap 0.92 × line speed. Otherwise no blue cap. Combined by minimum with the other caps as today.
- `BlueFlagTimer.update`: true once when accumulated time with `lapper !== -1 && gap <= 100` reaches 10 s for the same lapper; `gap > 100` pauses the count; `lapper === -1` for 3 s continuous resets it; a different lapper restarts the count; at most one true per lapper encounter.
- Player (car 0): feed the timer each tick with `blueLapper(0)` and the on-track gap behind to it; on true call `book(0, 'penalty', 5, 'ignoring blue flags')` (race control announces it, 311 caps apply).
- HUD: while `blue`, `#blue-banner` text `BLUE FLAG · LET AI ${blueLapper} BY`; hidden otherwise.

Conventions: gap in metres on track behind; `<=` 100 m counts; dt in s; timer tolerance 1 tick; no inputs mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

`halfLeft` and `lineD(s)` as in `tests/unit/acceptance/262-racecraft-wiring.test.ts` (`buildCorridor`/`corridorAt` from `src/ai/raceView`).

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new FlagState([0, 1000, 2000], 3000)`; car 0 lapDistance 1500 race distance 1500; car 1 race distance 4400 (lapDistance 1400); car 2 race distance 1400 | update one step | `blueLapper(0)` 1, `blueFor(0)` true; `blueLapper(1)` −1; `blueLapper(2)` −1 |
| AT2 | `BlueFlagTimer`; `update(1, 50, 1/120)` repeatedly | 12 s | returns true exactly once, at t = 10 s (±1/120); a further 20 s with the same lapper: no more true |
| AT3 | `BlueFlagTimer`; lapper 1 gap 50 for 6 s, gap 150 for 5 s, gap 50 for 4 s | update | true exactly once, at t = 15 s (±1/120) |
| AT4 | `BlueFlagTimer`; lapper 1 gap 50 for 6 s, lapper −1 for 3 s, lapper 1 gap 50 for 6 s; then lapper 2 gap 50 for 10 s | update | no true in the first 15 s; true once at t = 25 s (±1/120) |
| AT5 | Monza f4 headless `RaceGame` scenario, expert; player frozen at s 1500, d = −(halfLeft + 8); AI 1 s 300, `lapsAhead` 1, v 50, scale 1.0; AI 2 s 380, v 40, scale 0.85 | 30 s | AI 1 passes AI 2 (race distance) before 30 s; `contactCount` 0; AI 2 off track ≤ 0.5 s total; at the first tick with on-track gap AI 1 → AI 2 < 5 m their lateral separation ≥ 2.0 m |
| AT6 | as AT5 plus AI 3 s 400, v 40, scale 0.85 (same lap as AI 2); and the same scenario without AI 1 | 30 s each | AI 1 passes AI 2 and AI 3 before 40 s; `contactCount` 0; mean speed of AI 2 and of AI 3 over the run ≥ 0.97 × their mean speed in the run without AI 1 |
| AT7 | Monza scenario; player frozen at s 600, d = lineD(600) (on the line); AI 1 s 500, `lapsAhead` 1, v 10, scale 0.3 | 20 s | `penalties.forCar(0)` has exactly one `'ignoring blue flags'` 5 s entry; no AI car has one |
| AT8 | `RaceHud` (jsdom) `update` with `blue: true, blueLapper: 3` | render | `#blue-banner` visible with text `BLUE FLAG · LET AI 3 BY`; with `blue: false` hidden |

## Acceptance criteria

- [ ] AT1–AT8 pass.
- [ ] `typecheck`, `lint`, `npm test` green.

## Verification

```
npm run typecheck
npm run lint
npm test
npx vitest run 321- 128- 130- 261- 289- 298- 305- 309- 311- 314-
```

## Out of scope

- Unlapping rules, blue flags in practice/qualifying, AI training, sounds.
