# 305 — Yellow overtake: 10 s to give the position back

Status: pending
Phase: 2
Depends on: 304
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

An overtake under yellow no longer books an immediate penalty: the overtaker gets 10 s to give the position back; if not returned, a 5 s 'yellow flag overtake' penalty is booked.

## Context

- `src/game/raceGame.ts` ~1036: `const overtakes = this.flags.overtakeUnderYellow();` loop skips passed cars that are stopped/finished or slower than `YELLOW_FOLLOW_MIN_MS`, then `this.book(car, 'penalty', 5, 'yellow flag overtake')`. Replace that booking with `giveBack.open(car, passed, time)`.
- `updateRuleReactions()` (~1066) builds AI speed caps (VSC, yellow) as a minimum with the traffic cap; the give-back cap joins that minimum.
- Task 304 adds `setPlayerAutopilot`, `isRetired`; 303 adds `#yellow-banner` in `src/ui/raceHud.ts`; `RaceHudData` lives there.
- Total race distance per car: `this.totalDist[i]` (classification distance).

## Files

- `src/race/giveBack.ts` — create — pure, no `three`.
- `src/game/raceGame.ts` — modify.
- `src/ui/raceHud.ts`, `src/ui/raceHud.css` — modify — banner.
- `src/main.ts` — modify — debug hook.
- `tests/unit/acceptance/305-give-back.test.ts` — create (acceptance worker).
- `tests/e2e/acceptance/305-give-back.spec.ts` — create (acceptance worker).

## Contract

```ts
export const GIVE_BACK_S = 10;
export const GIVE_BACK_PENALTY_S = 5;
export type GiveBackKind = 'returned' | 'void' | 'penalty';
export interface GiveBackEvent { car: number; passed: number; kind: GiveBackKind }
export class GiveBack {
  constructor(count: number);
  open(car: number, passed: number, time: number): void;
  update(distances: readonly number[], out: readonly boolean[], time: number): void;
  owes(car: number): number;            // passed car of the oldest open entry, -1 if none
  remaining(car: number, time: number): number; // s left on the oldest open entry, NaN if none
  drainEvents(): GiveBackEvent[];
  isGiveBack(car: number, passed: number, time: number): boolean; // `car` overtaking `passed` is a give-back: `passed` owes `car` (open entry) or that entry closed 'returned' at most 2 s ago
}
// RaceGame
debugGiveBack(car: number, passed: number): void   // calls giveBack.open at the current time
get playerGiveBack(): { passed: number; remaining: number } | null  // reused object, null when car 0 owes nothing
// RaceHudData gains: giveBack: { passed: number; remaining: number } | null
```

## Rules

- Entries are per (car, passed) pair; `open` on an already-open pair is ignored. A car may owe several cars.
- `update`: an entry closes `'returned'` when `distances[car] < distances[passed]` (strictly); `'void'` when `out[passed]` is true; `'penalty'` when `time >= openTime + GIVE_BACK_S` (1e-9 s tolerance). Checked in that order. No allocations in `update`.
- `RaceGame`: each tick call `giveBack.update(totalDist, out, time)` with `out[j] = stopped[j] === 1 || finished[j] === 1` (retired counts as stopped); on `'penalty'` book `penalty`, `GIVE_BACK_PENALTY_S`, `'yellow flag overtake'`.
- AI that owes (car >= 1; autopilot does not apply to car 0): speed cap = `max(0, speed of the owed car - 3 m/s)` while it owes, combined by minimum with the other caps.
- HUD: while `giveBack` is non-null show `#giveback-banner` with text `GIVE THE POSITION BACK TO AI ${passed} · ${Math.ceil(remaining)} s`, orange `#ff9f1a` background, top centre directly below `#yellow-banner` (no overlap with it, `.minimap`, `#race-tower`, `.race-hud-top`); hidden otherwise.
- Debug hook `window.__SIMGAME__.debugGiveBack(car, passed)` in `main.ts`.
- No loop (user rule): returning the position is not an overtake. `RaceGame` calls `giveBack.update` before reading `overtakeUnderYellow()` in the same tick, and skips (no `open`, no penalty) every reported pass `{car, passed}` with `giveBack.isGiveBack(car, passed, time)`. Remember closed-'returned' pairs in a fixed-size buffer (no allocations).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new GiveBack(3)`, `open(0, 1, 100)` | `update([1010, 1000, 0], [false,false,false], 105)` then `update([995, 1000, 0], [false,false,false], 105.5)`, then `update` at 111 with the same distances | events drained after 105.5: exactly `[{car:0, passed:1, kind:'returned'}]`; none after 111; `owes(0)` −1 |
| AT2 | `open(0, 1, 100)`, car 0 stays ahead (1010 vs 1000) | `update` at 109.99 and at 110 | no events after 109.99, `remaining(0, 109.99)` 0.01 (±1e-9); after 110 exactly `[{0, 1, 'penalty'}]`; `owes(0)` −1, `remaining(0, 110)` NaN |
| AT3 | `open(0, 1, 100)` | `update([1010, 1000, 0], [false, true, false], 103)` | exactly `[{0, 1, 'void'}]` |
| AT4 | `open(0, 1, 100)`, `open(0, 1, 101)`, `open(0, 2, 102)` | `owes(0)` at 102; then `update([1010, 1000, 1005], all false, 111)` | `owes(0)` = 2 before; events: `[{0,1,'penalty'}]` only (pair 0–2, due at 112, still open); `owes(0)` = 1 after |
| AT5 | `open(0, 1, 100)`, distances equal `[1000, 1000, 0]` | `update` at 105 | no event (strictly behind required) |
| AT6 | `RaceGame` cleveland, f4, aiCount 3, expert, seed 1, `setPlayerAutopilot(true)`, step to 40 s after go | pick AI cars a, b with a directly ahead of b in `standings()` (both ≥ 1, gap ≤ 150 m); `debugGiveBack(a, b)`; step 10 s | at some tick within the 10 s, `standings()` distance of b > distance of a; `penalties.forCar(a)` has no `'yellow flag overtake'` entry |
| AT7 | `new GiveBack(3)`, `open(0, 1, 100)` | `isGiveBack(1, 0, 101)`; `update([995, 1000, 0], all false, 105.5)`; then `isGiveBack(1, 0, 105.5)`, `isGiveBack(1, 0, 107.4)`, `isGiveBack(1, 0, 107.6)`, `isGiveBack(0, 1, 105.5)`, `isGiveBack(2, 0, 105.5)` | true; then true, true, false, false, false |
| AT8 | as AT6 at 40 s after go | `debugGiveBack(0, c)` with c the last car in `standings()`; step 10.5 s, recording whether car 0 stayed ahead of c at every tick | `playerGiveBack` non-null right after the call with `passed` = c and `remaining` 10 (±0.01); if car 0 stayed ahead: exactly one `'yellow flag overtake'` penalty of 5 s for car 0, else none; `playerGiveBack` null at the end |
| AT9 | page `/?race=1&track=cleveland&ai=3&laps=3`, viewport 1280×720, 3 s sim after lights out | `debugGiveBack(0, 3)` | within 0.5 s `#giveback-banner` visible, text matches `/^GIVE THE POSITION BACK TO AI 3 · (10\|9) s$/`; no overlap with `.minimap`, `#race-tower`, `.race-hud-top` |
| AT10 | — (regression, no new test file: the acceptance worker writes nothing for it) | run 128, 130, 289, 298 unit tests and 294, 303 e2e acceptance specs | pass |

## Acceptance criteria

- [ ] AT1–AT10 pass.
- [ ] `typecheck`, `lint`, `npm test` green.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 305- 294- 303-
```

## Out of scope

- Give-back for track-limits or contact overtakes, changing the 5 s value elsewhere, sounds.
