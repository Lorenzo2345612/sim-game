# 094 — Race HUD and AI car rendering

Status: pending
Phase: 2
Depends on: 057, 092, 093, 119
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

In a race the browser shows every car, the start lights from the 'lights' phase, and a HUD with position, lap and a timing tower.

## Context

Wiring of `RaceGame` (093) in `src/main.ts`. Existing: `CarRenderer` (`src/render/carRenderer.ts`, one instance per car; livery material named `livery`), `createStartLights(track).setLights(n)` (`src/render/pitAndStart.ts`), `Hud` (`src/ui/hud.ts`). Race HUD is DOM only (no React), hidden outside races. Acceptance tests: Playwright `tests/e2e/acceptance/094-race-hud.spec.ts`.

## Files

- `src/ui/raceHud.ts` — create
- `src/render/carRenderer.ts` — modify: optional livery colour on load
- `src/main.ts` — modify: one `CarRenderer` per car, start lights wiring, race HUD update each frame, `sceneStats()` gains `cars: number` and `startLightsOn: number`

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

`Standing` from `src/race/classification`. `CarRenderer`: clone materials per instance so a livery colour never leaks to other cars (dispose them with the car); a model without a `livery` material (e.g. gt3-d) is left unchanged.

1. AI car k (k ≥ 1) is tinted with `defaultLivery(k).primary` from `src/game/livery.ts` (task 119, which owns `LIVERY_PALETTE`). Car 0 (player) is not tinted here: its livery comes from `main.ts` (120/122), or the model default.
2. Elements: `#race-pos` text `P3/12`; `#race-lap` text `Lap 2/5` (lap clamped to `laps`); `#race-tower` with one row per car for the top 10 plus the player if outside it (max 11 rows); row = position, name (`You` for the player, `AI n` for car n, n from 1), gap: leader empty, others `+1.234` (seconds, 3 decimals) or `+1 lap` when `gapToLeader` is null. Player row has class `player`.
3. Start lights: each frame `setLights(game.startLights())` for the gantry; `sceneStats().startLightsOn` = number currently lit; `sceneStats().cars` = number of car roots in the scene (1 outside races).
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
npm run test:e2e
```

## Out of scope

Menu and results screen (095), minimap, car labels in 3D, per-car setups or models, damage visuals, changes to `RaceGame` logic.
