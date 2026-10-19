# 302 — Race minimap: all cars and sector flag colours

Status: pending
Phase: 2
Depends on: 298
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In race mode the minimap is 260 px and shows every car and each sector painted by its flag.

## Context

Approved mockup: `docs/design/mockups/yellow-flag-hud.html` (+ `mock-yellow.png`, `mock-double.png`, `mock-clear.png`). `src/ui/minimap.ts` (Minimap, fitMinimap, toMinimap; single red dot; `update(carX, carZ)`) is created in `src/main.ts` ~1288 with `new Minimap(document.body, track.centerline)` and updated ~1788. Sectors in RaceGame are lap-distance thirds (`FlagState([0, L/3, 2L/3], L)`); `raceFlags[0..2]` are filled in main.ts ~1729 from `raceGame.flags.sectorFlag(1..3)`. CSS `canvas.minimap` in `src/ui/hud.css` uses `--minimap-size`. `SectorFlag` comes from `src/race/flags.ts`.

## Files

- `src/ui/minimap.ts`, `src/game/raceGame.ts`, `src/main.ts` (wiring, size, debug hooks), `src/ui/hud.css` (legend) — modify.
- `tests/unit/acceptance/302-race-minimap.test.ts`, `tests/e2e/acceptance/302-race-minimap.spec.ts` — create (acceptance worker).

## Contract

```ts
export interface MinimapCar { x: number; z: number; player: boolean; stopped: boolean }
export function splitSectors(centerline: readonly [number, number][], fractions: readonly [number, number]): [number, number][][]
export function sectorStyle(flag: SectorFlag, timeS: number): { color: string; width: number }
// Minimap: keep constructor(container, centerline, size = 160) and update(carX, carZ) unchanged (existing tests)
Minimap.prototype.updateRace(cars: readonly MinimapCar[], flags: readonly SectorFlag[], timeS: number): void
// RaceGame:
carMapState(i: number, out: { x: number; z: number; stopped: boolean }): void
```

Rules:
- splitSectors: closed loop (last point connects to first); cut by cumulative arc-length fractions, linearly interpolated cut points shared by adjacent sectors; sector 3 ends at centerline[0].
- sectorStyle: green → '#e8edf3', 5; yellow → '#ffd400' when Math.floor(timeS*4) % 2 === 0 else '#a08600', width 9; double-yellow → same colours, width 12.
- updateRace draws background, the three sector polylines with sectorStyle, start line, then cars: AI #9aa4b2 r7, stopped #ff3b30 r10 with white ✕, player #2f7dff r10 with 2 px white outline drawn last. No allocations per call (reuse temporaries).
- carMapState: x,z = car i's current position; stopped = stopped[i] === 1 || (not finished && go happened && raceTime ≥ goTime + 8 s && |forwardSpeed| < 5 m/s).
- main.ts race mode: Minimap size 260; legend div `.minimap-legend` directly below the canvas, right-aligned, text "you ● AI ● stopped ✕" with coloured dots; call updateRace every frame (simTime as timeS) instead of update. Non-race modes unchanged (160 px, update()).
- Debug hooks on `window.__SIMGAME__`: `debugFlagOverride(o: { flags: SectorFlag[]; playerSector: number } | null)` — replaces flags (and player sector, used by task 303) fed to HUD and minimap only, never the simulation; `minimapStats(): { size: number; ai: number; player: number; stopped: number }` — counts drawn by the last updateRace.
- If the 260 px map + legend overlaps any element checked by the 293/294 overlap tests, move that element below the legend.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | centerline square `[[0,0],[100,0],[100,100],[0,100]]` (perimeter 400) | `splitSectors(sq, [1/3, 2/3])` | 3 polylines; s1 = `[[0,0],[100,0],[100,33.333]]`, s2 starts `[100,33.333]` ends `[33.333,100]`, s3 starts `[33.333,100]` ends `[0,0]`; each polyline length 133.333 (±1e-3) |
| AT2 | — | `sectorStyle` | `('green', 0)` → `{color:'#e8edf3', width:5}`; `('yellow', 0)` → `{'#ffd400', 9}`; `('yellow', 0.3)` → `{'#a08600', 9}`; `('yellow', 0.5)` → `'#ffd400'`; `('double-yellow', 0)` → `{'#ffd400', 12}` |
| AT3 | `RaceGame` cleveland, f4, aiCount 5, expert, seed 1, player input brake 1 | before go, `carMapState(i, out)` for i = 0..5 | every `out.stopped` false; for i = 0, `out.x`,`out.z` equal the player's current position (±1e-6) |
| AT4 | same as AT3 | step to 10 s after go | `carMapState(0, out).stopped` true (player braked on the grid); at least 3 AI cars have `stopped` false |
| AT5 | page `/?race=1&track=cleveland&ai=5&laps=3`, viewport 1280×720 | 2 s of sim time after lights out | `.minimap` 260 px square (±1), top 12 px and right gap 12 px (±1); `.minimap-legend` visible, text contains "you", "AI", "stopped", top ≥ minimap bottom; `minimapStats()` → `{size:260, ai:5, player:1}` |
| AT6 | same page, after AT5 | `debugFlagOverride({flags:['green','yellow','green'], playerSector:2})`, wait 1 s | canvas pixels within ±12 per channel of (255,212,0) or (160,134,0): ≥ 150 |
| AT7 | after AT6 | `debugFlagOverride({flags:['green','green','green'], playerSector:2})`, wait 0.5 s | those pixels ≤ 5; pixels within ±12 of (47,125,255) ≥ 150 |
| AT8 | page `/?track=cleveland` (no race) | loaded | `.minimap` 160 px (±1); no `.minimap-legend`; 049, 161 and 207 tests unchanged and passing |
| AT9 | — | run 293 and 294 e2e acceptance specs | pass |

## Acceptance criteria

- [ ] AT1–AT9 pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 302- 293- 294- 161- 207-
```

## Out of scope

- Banner/LED alert (303), changing FlagState rules or sector bounds, car labels or numbers on the map, zoom/rotation.
