# 328 — RaceConfig per-AI pace

Status: pending
Phase: 3
Depends on: 262
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

`RaceConfig.aiPace` lets the caller scale each AI car's pace, so season drivers and teams differ in speed (milestone M3.2, design `docs/design/c1-season.md`).

## Context

`src/game/raceGame.ts`: AI k is car index k+1. `baseSpeedScale` is computed as `(speedScale + jitter) * (config.scenario?.speedScales?.[k + 1] ?? 1)` (~line 602). Residual neural AI: `ai.driver.setSpeedScale(r.scale * dmgScale)` (~line 836); classic: `ai.baseSpeedScale * dmgScale`. Validation lives at the top of `RaceGame.create` next to `validateGridOrder` (aiCount is clamped there first; validate against the clamped `count`).

## Files

- `src/game/raceGame.ts` — modify — new field, validation, application.
- `tests/unit/acceptance/328-race-ai-pace.test.ts` — create (acceptance worker).
- Existing RaceConfig validation tests (`tests/unit/acceptance/276-race-grid-order.test.ts`, `tests/unit/edge/093-race-game*.ts`) do not touch `aiPace` and must stay green unchanged; no e2e test references RaceConfig.

## Steps

```ts
// RaceConfig gains:
/** aiPace[i] = pace multiplier of car i (length = aiCount + 1; [0] is the player and ignored). */
aiPace?: number[];
```

1. Absent → behaviour byte-identical to today.
2. Validate in `create` (after the aiCount clamp, before `initPhysics`): `aiPace.length` must equal `aiCount + 1` and every AI entry (index ≥ 1) must be a finite number in (0.8, 1.05]; else `throw new Error('aiPace ...')` (message contains `aiPace`). Entry [0] is not validated.
3. Apply: multiply `aiPace[k + 1]` into `baseSpeedScale` (together with `scenario.speedScales`, so classic AI gets it via `ai.baseSpeedScale`). Residual neural AI: multiply it into the net's `r.scale` in `setSpeedScale(r.scale * aiPace[k+1] * dmgScale)`.

Conventions: bounds exclusive at 0.8, inclusive at 1.05; invalid input throws; `aiPace` array is not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | monza, aiCount 1, medium, seed 3, player brake 1; runs with aiPace [1, 1] and [1, 0.9] | step 90 s each | AI distance ratio (0.9 run / 1.0 run) in [0.80, 0.98] |
| AT2 | same, aiPace [1, 1] vs no aiPace | step 20 s | AI state identical (position within 1e-9) |
| AT3 | aiPace [1] / [1, 0.5] / [1, 1.1] with aiCount 1 | create | rejects, message contains `aiPace` |

## Acceptance criteria

- [ ] All AT rows pass in `tests/unit/acceptance/328-race-ai-pace.test.ts`.
- [ ] Existing 276 and 093 tests still pass.
- [ ] Both the classic and the residual paths multiply `aiPace`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Season/team logic, UI, `aiPace` for the player car.
- Changing neural models, difficulty speed scales or jitter.
