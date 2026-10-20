# 306 — Timing tower views: gap, tyres, laps

Status: pending
Phase: 2
Depends on: 305
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The race timing tower gets a view toggle (button and key T) cycling GAP → TYRES (compound + laps on it) → LAPS (last lap time, fastest-lap highlight) → GAP.

## Context

`src/ui/raceHud.ts`: `#race-tower` is built in the `RaceHud` constructor; `TowerRow {el,pos,name,gap,pen,...}`, `gapText(st)`, `TOWER_TOP = 10`, `RaceHudData.standings: Standing[]` (has `lap`, `lastLap`, `bestLap`). `TyreName` is exported from `src/physics/carSpec.ts`. `RaceGame` takes the player compound from `options.compound` (~361) and the AI compound from `tune?.compound ?? 'medium'` (~428/470). No pit stops exist, so laps on tyre = `max(0, lap - 1)`. Key T is free. Use `formatLapTime` from `src/ui/formatTime.ts`.

## Files

- `src/ui/raceHud.ts` — modify — views, header, button.
- `src/ui/raceHud.css` — modify — header, badge colours, `.fastest`.
- `src/game/raceGame.ts` — modify — `carCompound`.
- `src/main.ts` — modify — key T, fill `compounds`.
- `tests/unit/acceptance/306-tower-views.test.ts`, `tests/e2e/acceptance/306-tower-views.spec.ts` — create (acceptance worker).

## Contract

```ts
export type TowerView = 'gap' | 'tyres' | 'laps';
// RaceHudData gains: compounds: readonly TyreName[]   // indexed by car
// RaceHud gains: cycleView(): TowerView; get view(): TowerView
// RaceGame gains: carCompound(car: number): TyreName
```

## Rules

- Header `.race-tower-head` with button `#tower-view` whose text is `GAP` / `TYRES` / `LAPS`; click calls `cycleView`. `#race-tower` `dataset.view` = current view; the view survives `update()` calls.
- gap view: unchanged (existing tower tests keep passing).
- tyres view: per row a `.tyre` badge with letter S/M/H/I/W and class `compound-<name>` (soft #ff3b30, medium #ffd400, hard #f2f2f2, inter #2ecc40, wet #2f7dff), and `.tyre-laps` text `${max(0, lap - 1)} L`.
- laps view: per row `.last-lap` text `formatLapTime(lastLap)` or `-` when null; the row of the car with the lowest non-null `bestLap` among all standings gets class `fastest` (text #b05cff).
- Only text/class changes on update; no per-frame element creation (rows created once).
- `carCompound(car)`: player = `options.compound`, AI = tune compound; default `'medium'`.
- `main.ts`: `keydown` `KeyT` calls `cycleView`, ignored while a menu/pause/results overlay is open; fills `compounds` from `raceGame.carCompound(i)`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new RaceHud(document.body)` (jsdom), `update` with 3 standings (car 0 P1 lap 4 lastLap 92.5 bestLap 91.0; car 1 P2 lap 4 lastLap 93.0 bestLap 90.4; car 2 P3 lap 3 lastLap null bestLap null), compounds `['soft','hard','medium']` | — | `#tower-view` text `'GAP'`; `#race-tower` dataset.view `'gap'`; row texts as before this task |
| AT2 | AT1 | click `#tower-view`, `update` same data | text `'TYRES'`, dataset.view `'tyres'`; rows in position order have `.tyre` texts `S`, `H`, `M` with classes `compound-soft`, `compound-hard`, `compound-medium`; `.tyre-laps` texts `3 L`, `3 L`, `2 L` |
| AT3 | AT2 | click again, `update` same data | `'LAPS'`; `.last-lap` texts `formatLapTime(92.5)`, `formatLapTime(93.0)`, `'-'`; only the car 1 row has class `fastest` |
| AT4 | AT3 | `cycleView()` | returns `'gap'`; dataset.view `'gap'` |
| AT5 | AT2 | `update` called 5 more times | view stays `'tyres'`; tower row element instances unchanged |
| AT6 | `RaceGame` cleveland, f4, aiCount 3, seed 1, options `{compound:'soft', wear:0, fuel:20}`; second game with no options | `carCompound(0)`, `carCompound(2)` | `'soft'`, `'soft'` (the AI tune is built from the same options); second game both `'medium'` |
| AT7 | page `/?race=1&track=cleveland&ai=5&laps=3`, 3 s sim after lights out | press `T` | `#race-tower` dataset.view `'tyres'`; ≥ 4 rows with `.tyre` text matching `/^[SMHIW]$/`; press `T` twice more → `'gap'` |
| AT8 | same page | click `#tower-view` | dataset.view `'tyres'`; the 293 and 294 overlap specs still pass |

## Acceptance criteria

- [ ] AT1–AT8 pass; existing tower tests unchanged and passing.

Planner 2026-10-20 (decision 306-coder, two timeouts): the work in the worktree already passes 306 acceptance, typecheck and lint; do not run the full `npm test` (the pipeline runs it). Finish, run the commands below once and write the report.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/306- tests/unit/acceptance/305- tests/unit/acceptance/130- tests/unit/edge/130-
npx playwright test 306- 293- 294-
```

## Out of scope

- Pit stops/tyre changes, interval column, sector times, persisting the view between races.

Planner 2026-10-20 (decision 306-acceptance): there is no separate AI compound input; AT6 checks that AI cars report the tune compound built from `options`.
