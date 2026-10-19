# 289 — Stop the yellow-flag cap from freezing the field behind a stopped car
Status: pending
Phase: 2
Depends on: 130
Complexity: complex
Type: bugfix
Models: standard
Roles: acceptance, coder, tester-pre, tester, reviewer

## Goal
Today, under yellow every AI caps its speed to the nearest car ahead within 30 m (`RaceGame.updateRuleReactions`). A stopped car (player parked, AI held by `debugStopCar`, wrecked car) gives cap 0, the car behind stops too, the stuck respawn puts it back on the same spot, and the whole field freezes for the rest of the race (seen in-game: 6 AI DNFs). After this task, AIs follow only moving traffic under yellow and drive past stationary cars.

## Files
- `src/race/yellowCap.ts` — create — pure cap selection.
- `src/game/raceGame.ts` — modify — use it in `updateRuleReactions`; yellow lateral offset rule below.
- `tests/unit/acceptance/289-*.test.ts` — create (acceptance worker).

## Steps
1. `export const YELLOW_GAP_M = 30` (m, moved from raceGame) and `export const YELLOW_FOLLOW_MIN_MS = 5` (m/s, equal to the flag cause speed in `src/race/flags.ts`).
2. `export function yellowCap(i: number, lapDist: ArrayLike<number>, speed: ArrayLike<number>, out: ArrayLike<number>, lapLength: number): number` — speed of the nearest car j ≠ i ahead (wrapped gap `0 < gap ≤ YELLOW_GAP_M`) among cars with `out[j] === 0` and `speed[j] >= YELLOW_FOLLOW_MIN_MS`; `NaN` when none. Ineligible cars are skipped, not blocking (a moving car behind a stopped one still counts). Inputs not mutated, no allocation.
3. RaceGame: `out[j] = 1` for `stopped[j] === 1` or finished cars. Yellow cap = `yellowCap(...)` combined with VSC as today (min).
4. Under yellow, `applyRulesReaction` forces lateral offset 0 only when `yellowCap` returned a number; otherwise the traffic (or residual, task 288) offset is kept so the car can steer around the stationary car.
5. Unchanged: flag causes (`flags.ts`), the yellow-overtake penalty (passing a stopped car under yellow still books it; frozen 130 EDGE7), blue and VSC reactions, stuck respawn.

## Acceptance tests (defined by the planner with Opus, before coding)
| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | lap 1000, lapDist [100, 120, 110], speed [30, 20, 0], out [0, 0, 0] | `yellowCap(0, …)` | 20 (car 2 at 10 m is stationary and skipped) |
| AT2 | AT1 with speed[1] = 4.9 | `yellowCap(0, …)` | NaN |
| AT3 | lap 1000, lapDist [990, 10], speed [30, 12], out [0, 0] | `yellowCap(0, …)` | 12 (gap 20 m across the line) |
| AT4 | lapDist [100, 131], speed [30, 20], lap 1000 / same with lapDist[1] = 120 and out [0, 1] | `yellowCap(0, …)` | NaN / NaN |
| AT5 | lapDist [100, 130], speed [30, 5], out [0, 0], lap 1000 | `yellowCap(0, …)` | 5 (both bounds inclusive) |
| AT6 | Monza (`public/tracks/monza.json`), f4, 3 AI, player input idle (parked on grid) | step 200 s sim time after go (seed 1, difficulty medium) | every AI row of `standings()` has `lap ≥ 2` and distance > 5793 m (prototype: 6059–6696 m; today 5163–5208 m) |
| AT7 | as AT6, `debugStopCar(1)` 5 s after go | step 120 s sim time | cars 2 and 3 each moved ≥ 2000 m since the stop and their race distance exceeds car 1's (prototype: 2299 / 2419 m; today ≤ 0 m) |

## Verification
```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/289- tests/unit/acceptance/130- tests/unit/edge/130- tests/unit/acceptance/128- tests/unit/edge/093-
```

## Out of scope
- Flag causes, penalties, VSC, blue flags, AI driving/traffic logic, the neural/residual policies, UI.

## Planner answers (round 1)

- EDGE6 (planner-authorised, `tests/unit/edge/289-yellow-cap-edge.test.ts`): drop `&& !nanSeen` from the loop condition and extend the window from `steps(15)` to `steps(40)`, so the ticks where car 3 follows car 2 after it passes the stopped car are counted. Assertions unchanged.
- Passing a stopped car under yellow is legal: the yellow-overtake booking (130) must not book when the passed car is out (stopped/retired/finished) or slower than `YELLOW_FOLLOW_MIN_MS`. 130 AT2 stays unchanged and must pass; 130 EDGE7 (overtaking a moving car under yellow) must still book. If EDGE7 uses a car slower than 5 m/s, stop and report its numbers.

## Planner answers (round 2)

The coder timed out (40 min). Work already in the worktree (`yellowCap.ts`, `raceGame.ts`, EDGE6 edit) is kept: continue from it, do not restart. Run only `npx vitest run tests/unit/acceptance/289- tests/unit/edge/289- tests/unit/acceptance/130-`, typecheck and lint, each once; no full suite (the reviewer runs it), no `sleep`, no probe scripts. If a test still fails after one fix attempt, report BLOCKED with the numbers.
