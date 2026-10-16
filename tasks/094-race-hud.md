# 094 — Race HUD and AI car rendering

Status: pending
Phase: 2
Depends on: 057, 092, 093, 119, 207
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In a race the browser shows every car, the start lights from the 'lights' phase, and a HUD with position, lap and a timing tower.

## Context

Wiring of `RaceGame` (093, `src/game/raceGame.ts`) in the race branch of `startGame` in `src/main.ts`. Existing: `CarRenderer.load(url, bodyOffsetY)` (`src/render/carRenderer.ts`; `root`, `update(state)`, `dispose()`), `applyLivery(root, paintMaterials, livery, bounds)` (`src/render/liveryMaterial.ts`; clones painted materials per call, so liveries never leak between cars; `paintMaterials` comes from `<model>.json`, empty for models without paint such as gt3-d, which then stay unchanged), `defaultLivery(index)` (`src/game/livery.ts`, 119), `createStartLights(track).setLights(n)` (`src/render/pitAndStart.ts`, already added to the scene by `main.ts`), DOM HUD (`HudV2`, `Minimap`, `HudTyres`, `SetupHud`; theme variables in `src/ui/theme.css`, 207). Race HUD is DOM only (no React), hidden outside races, and must not overlap those widgets. Acceptance tests: Playwright `tests/e2e/acceptance/094-race-hud.spec.ts`.

## Files

- `src/ui/raceHud.ts` - create (imports `./raceHud.css`)
- `src/ui/raceHud.css` - create
- `src/main.ts` - modify: in a race, one `CarRenderer` per car (index k = `RaceGame.getStates` index), interpolated from `getPrevStates`/`getStates` like the single car; start lights wiring; race HUD update each frame; `sceneStats()` gains `cars: number` and `startLightsOn: number`

## Steps

```ts
export interface RaceHudData { standings: readonly Standing[]; playerCar: number; laps: number }
export class RaceHud {
  constructor(parent: HTMLElement);
  update(data: RaceHudData): void;
  setVisible(v: boolean): void;
  dispose(): void;
}
```

`Standing` from `src/race/classification`.

1. Car 0 (player) keeps the livery path of `startGame` (`loadLivery` + `applyLivery` + number decals). AI car k >= 1 loads `baseSpec.model.url` (same model as the player), gets `applyLivery(root, paintMaterials, defaultLivery(k), bounds)` and no number decal; `dispose()` each renderer with the session.
2. Elements: `#race-pos` text `P3/12`; `#race-lap` text `Lap 2/5` (lap clamped to `laps`); `#race-tower` with one row per car for the top 10 plus the player if outside it (max 11 rows); row = position, name (`You` for the player, `AI n` for car n, n from 1), gap: leader empty, others `+1.234` (seconds, 3 decimals) or `+1 lap` when `gapToLeader` is null. Player row has class `player`.
3. Start lights: each frame `setLights(game.startLights())`; `sceneStats().startLightsOn` = number of lit lights (the same count `setLights` was given, clamped 0-5); `sceneStats().cars` = number of car roots in the scene (1 outside races; the ghost car root is not counted).
4. HUD hidden (`display: none`) when no `RaceGame` is active.

Conventions: gap in seconds rounded to 3 decimals with `toFixed`; rows update in place (no per-frame DOM rebuild when text is unchanged).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e race ai=5, during 'lights' with 3 lights | `__SIMGAME__.startLights()` and DOM | 3; gantry shows 3 red lights (sceneStats().startLightsOn = 3) |
| AT2 | e2e 10 s after go | DOM | `#race-tower` has 6 rows, player row highlighted; `#race-pos` matches raceStandings |
| AT3 | e2e | `sceneStats().cars` | 6 |

## Acceptance criteria

- [ ] AT1–AT3 pass; single-car flow and existing e2e tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 094-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

Menu and results screen (095), race markers on the minimap, car labels in 3D, per-car setups or models, damage visuals, changes to `RaceGame` logic.

Frozen tests: none need editing (`sceneStats` only gains fields; single-car HUD/render unchanged).
