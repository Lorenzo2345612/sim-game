# 310 — Yellow countdown in race HUD and minimap

Status: pending
Phase: 2
Depends on: 309
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Show the 3 s yellow countdown of task 309: a "YELLOW FLAG IN 3 · SECTOR 2" alert with a big digit, and the counting-down sector on the minimap as white with a dashed yellow overlay.

## Context

Approved mockup: `docs/design/mockups/yellow-flag-hud.html?state=countdown&n=3` (+ `mock-countdown-3.png`, `mock-countdown-1.png`). Task 303: `src/ui/yellowAlert.ts` (`YellowAlert`, `AlertView`, `AlertMode`, `CLEAR_S`), `#yellow-alert`/`#yellow-banner` in `src/ui/raceHud.ts`. Task 302: `sectorStyle`, `Minimap.updateRace`, `__SIMGAME__.debugFlagOverride`, `minimapStats`. Task 309: `FlagState.sectorCountdown(s)` (NaN = none). e2e page `/?race=1&track=cleveland&ai=5&laps=3`.

## Files

- `src/ui/yellowAlert.ts`, `src/ui/raceHud.ts`, `src/ui/raceHud.css`, `src/ui/minimap.ts`, `src/main.ts` — modify.
- `tests/unit/acceptance/310-yellow-countdown-hud.test.ts`, `tests/e2e/acceptance/310-yellow-countdown-hud.spec.ts` — create (acceptance worker).

## Contract

```ts
export type AlertMode = 'none' | 'yellow' | 'double' | 'clear' | 'countdown';
export interface AlertView { mode: AlertMode; text: string; lightsOn: boolean; digit: number } // digit 0 unless countdown
YellowAlert.update(playerFlag: SectorFlag, playerSector: number, timeS: number, countdowns?: readonly number[]): AlertView // countdowns[i] = sector i+1, NaN = none
export function countdownStyle(): { color: string; width: number; dash: readonly number[] } // same object every call
Minimap.updateRace(cars, flags, timeS, countdowns?: readonly number[]): void
RaceHudData.countdowns: readonly number[]
debugFlagOverride(o: { flags: SectorFlag[]; playerSector: number; countdowns?: number[] } | null)
```

Rules:
- Player flag yellow/double wins (303 behaviour). Else a finite countdown in the player's sector is shown; else one in the next sector ahead (3 → 1). Mode `'countdown'`, digit `Math.ceil(c)`, text `` `YELLOW FLAG IN ${digit} · SECTOR ${s}` ``, lightsOn true.
- A countdown that disappears without the player's flag turning yellow gives `'none'`, never `'clear'`.
- DOM: `#yellow-countdown` (visible only in countdown mode) with child `.cd-digit` showing the digit; `#yellow-alert` gets `dataset.lights = 'slow'` in countdown mode.
- `countdownStyle()` → `{color: '#ffd400', width: 8, dash: [10, 8]}`. updateRace draws a green sector with a finite countdown in `sectorStyle('green')`, then the dashed overlay. No allocations per call.
- main.ts fills `countdowns` from `sectorCountdown(1..3)` into a reused array; the override replaces it when given.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected) |
|---|---|---|---|
| AT1 | new YellowAlert | `update('green', 2, 10, [NaN, 2.4, NaN])` | mode `'countdown'`, digit 3, text `'YELLOW FLAG IN 3 · SECTOR 2'`, lightsOn true |
| AT2 | new YellowAlert | `update('green', 3, 10, [NaN, NaN, 0.9])` | digit 1, text `'YELLOW FLAG IN 1 · SECTOR 3'` |
| AT3 | after AT1 | `update('yellow', 2, 11, [NaN, NaN, NaN])`, then `update('green', 3, 12, [NaN, NaN, NaN])` | first mode `'yellow'`, digit 0; second mode `'clear'` |
| AT4 | after AT1 | `update('green', 2, 11, [NaN, NaN, NaN])` and `update('green', 2, 11 + CLEAR_S, [NaN, NaN, NaN])` | both mode `'none'` |
| AT5 | — | `countdownStyle()` twice | `{color:'#ffd400', width:8}`, dash `[10, 8]`; both calls return the same object (`toBe`) |
| AT6 | e2e race page, after go | `debugFlagOverride({flags:['green','green','green'], playerSector:2, countdowns:[NaN, 2.5, NaN]})`, wait 0.5 s | `#yellow-countdown` visible, `.cd-digit` text `'3'`, `#yellow-alert` `dataset.lights` `'slow'`; minimap canvas pixels within ±12 per channel of (255,212,0) ≥ 60 |
| AT7 | after AT6 | override `{flags:['green','yellow','green'], playerSector:2}`, wait 0.5 s | `#yellow-countdown` hidden; `#yellow-alert` `dataset.mode` `'yellow'` |
| AT8 | new YellowAlert | `update('green', 1, 10, [NaN, 1.5, NaN])` | text `'YELLOW FLAG IN 2 · SECTOR 2'`, digit 2 |
| AT9 | — | run 302, 303, 293, 294 e2e and 303 unit acceptance tests | pass |

## Acceptance criteria

- [ ] AT1–AT9 pass.

## Verification

```
npm run typecheck
npm run lint
npx vitest run tests/unit/acceptance/310- tests/unit/acceptance/303-
npx playwright test 310- 302- 303- 293- 294-
```

## Out of scope

- Flag rules (309), sounds, changing yellow/double/clear visuals.
