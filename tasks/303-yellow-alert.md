# 303 — Yellow-flag alert: flashing lights, banner, sector-clear notice

Status: pending
Phase: 2
Depends on: 302
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

While the player's sector is yellow/double yellow the screen shows flashing lights and a banner; on leaving it a 3 s "sector clear" notice appears.

## Context

Approved mockup: `docs/design/mockups/yellow-flag-hud.html` (+ `mock-yellow.png`, `mock-double.png`, `mock-clear.png`). `src/ui/raceHud.ts` (`RaceHudData`, `#flags` dots `flag-s1..3` with dataset.state), `src/ui/raceHud.css`; main.ts builds raceHudData ~1729. Task 302 adds `debugFlagOverride` (its playerSector field is consumed here). Tests 130 edge (reads `#flags`/`flag-sN` dataset.state), 293 and 294 overlap specs must stay passing. `SectorFlag` comes from `src/race/flags.ts`.

## Files

- `src/ui/yellowAlert.ts` — create (pure, no DOM).
- `src/ui/raceHud.ts`, `src/ui/raceHud.css`, `src/game/raceGame.ts` (playerSector getter), `src/main.ts` (fill new RaceHudData fields, honour override) — modify.
- `tests/unit/acceptance/303-yellow-alert.test.ts`, `tests/e2e/acceptance/303-yellow-alert.spec.ts` — create (acceptance worker).

## Contract

```ts
export const CLEAR_S = 3;
export type AlertMode = 'none' | 'yellow' | 'double' | 'clear';
export interface AlertView { mode: AlertMode; text: string; lightsOn: boolean }
export class YellowAlert { update(playerFlag: SectorFlag, playerSector: number, timeS: number): AlertView }
// RaceHudData gains: playerFlag: SectorFlag; playerSector: number; time: number
// RaceGame: get playerSector(): number  // 1..3, sector of the player's lap distance
```

Rules:
- yellow → mode 'yellow', text `⚠ YELLOW FLAG · SECTOR ${s} · NO OVERTAKING`; double-yellow → mode 'double', text `⚠⚠ DOUBLE YELLOW · SECTOR ${s} · SLOW DOWN, BE READY TO STOP`; lightsOn = Math.floor(timeS*4) % 2 === 0 in both.
- yellow/double → green (flag cleared or player left the sector): mode 'clear', text '✓ SECTOR CLEAR · GREEN', lightsOn false, until timeS ≥ transition + CLEAR_S, then 'none' (text ''). A new yellow during 'clear' shows yellow at once. double → yellow is plain yellow (no clear).
- DOM (as in mockup): `#yellow-alert` with dataset.mode and dataset.lights ('on'|'off'); two `.led` bars (`.led.l`, `.led.r`) of 4 `.light` each, lit when lightsOn; 6 px yellow inset screen border flashing with lightsOn; `#yellow-banner` top centre, nowrap, 21 px, yellow (double: same style, banner text differs), green background style in 'clear'; hidden in 'none'. Time = sim time (pause freezes it). No allocations per frame.
- `#flags` stays in the DOM and keeps updating dataset.state but is `display: none`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | `new YellowAlert()` | `update('green', 1, t)` for t = 0..5 step 1/120 | mode `'none'`, text `''` every call |
| AT2 | new instance | `update('yellow', 2, 10)` | mode `'yellow'`, text `'⚠ YELLOW FLAG · SECTOR 2 · NO OVERTAKING'`; lightsOn true at t = 10, false at t = 10.3, true at t = 10.5 |
| AT3 | new instance | `update('double-yellow', 3, 10)` | mode `'double'`, text `'⚠⚠ DOUBLE YELLOW · SECTOR 3 · SLOW DOWN, BE READY TO STOP'` |
| AT4 | yellow sector 2 every 1/120 s from t = 9 to 10 | `update('green', 2, 10 + 1/120)` then continue green | mode `'clear'`, text `'✓ SECTOR CLEAR · GREEN'`, lightsOn false; still `'clear'` at t = 12.9; `'none'` at t = 13.1 |
| AT5 | yellow sector 2 until t = 10 | `update('green', 3, 10 + 1/120)` (player entered sector 3) | mode `'clear'` |
| AT6 | as AT4, clear since t = 10 | `update('yellow', 3, 11)` | mode `'yellow'`, text with `SECTOR 3` |
| AT7 | `'double-yellow'` sector 2 until t = 10 | `update('yellow', 2, 10 + 1/120)` | mode `'yellow'` (never `'clear'`) |
| AT8 | `RaceGame` cleveland, f4, aiCount 5, seed 1, before go | read `playerSector` | integer in 1..3, equal to `Math.floor(lapDistance / (lapLength/3)) + 1` of car 0 |
| AT9 | page `/?race=1&track=cleveland&ai=5&laps=3`, viewport 1280×720, 2 s sim after lights out | `debugFlagOverride({flags:['green','yellow','green'], playerSector:2})`, wait 0.5 s | `#yellow-alert` dataset.mode `'yellow'`; `#yellow-banner` visible with text `'⚠ YELLOW FLAG · SECTOR 2 · NO OVERTAKING'`; 2 `.led` with 4 `.light` each; sampling dataset.lights every 100 ms for 1.5 s sees both `'on'` and `'off'` at least twice; banner rect does not overlap `.minimap`, `.minimap-legend`, `#race-tower`, `.race-hud-top` |
| AT10 | after AT9 | `debugFlagOverride({flags:['green','green','green'], playerSector:2})` | within 0.5 s mode `'clear'` and banner text `'✓ SECTOR CLEAR · GREEN'`; after 3.5 s more of sim time mode `'none'` and banner not visible |
| AT11 | race page, no override | 2 s after lights out | `#flags` exists, not visible; its `flag-s1..3` have dataset.state; 130 edge, 293 and 294 tests pass |

## Acceptance criteria

- [ ] AT1–AT11 pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 303- 293- 294-
```

## Out of scope

- Minimap (302), sounds, steering-wheel LEDs, changing flag rules.
