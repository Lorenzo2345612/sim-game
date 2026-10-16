# 073 — Car registry and selection

Status: pending
Phase: 1
Depends on: 070, 044, 072
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The start menu has a car picker next to the track picker; the chosen car is persisted and loaded by the game.

## Context

Menu: `src/ui/menu.ts` (task 044). Game wiring: `src/main.ts` (task 070, which loads `public/cars/<id>.json` and its model). Acceptance tests are Playwright in `tests/e2e/acceptance/073-car-selection.spec.ts`. Persisted key `simgame.car` (localStorage), like the track choice. Names and ids brand-neutral.

## Files

- `public/cars/index.json` — create: `[{ "id", "name", "category" }]` in order f4, gt3-a, gt3-b, gt3-c (names "F4", "GT3 A", "GT3 B", "GT3 C")
- `src/ui/menu.ts` — modify: car picker (fetches `/cars/index.json`)
- `src/main.ts` — modify: `?car=<id>` query (wins over saved choice), load chosen `CarSpec` and model, extend `window.__SIMGAME__` with `carId(): string`

## Steps

1. Default car `f4`. Unknown id in `?car=` or storage falls back to `f4`.
2. Picker element id `car-picker` (a `<select>`), options in index order, value = car id.
3. Selecting a car saves `simgame.car`; Start loads that car's spec and model.
4. With `?track=` and `?car=` the game starts directly (as in 044).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: start menu | open | car picker lists 4 cars in index order; default f4 |
| AT2 | e2e: pick GT3 B, Monza, start | ready | `carId()` = 'gt3-b'; no console errors; 3 s throttle → speed > 30 km/h |
| AT3 | e2e: reload | menu | GT3 B preselected |
| AT4 | e2e: `?car=gt3-c&track=spa` | ready | `carId()` 'gt3-c'; `\|carPosition().y − trackHeightUnderCar()\| < 0.8` after 3 s throttle |

## Acceptance criteria

- [ ] AT1–AT4 pass; existing e2e and unit tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 073-   # this task's e2e files only; never the full e2e suite
```

## Planner-authorised test edits

- `tests/unit/edge/053-f4-car.post.test.ts` POST9: replace the `src/` grep for `models/f4.glb` with: `public/cars/f4.json` has `model.url === '/models/f4.glb'`, that file exists under `public/`, and some file in `src/` reads `model.url` (regex `model\.url`). Title: "the game loads the F4 model from its car spec (057, 073)". Change nothing else.

## Out of scope

Per-car setup storage, car stats display, livery colours, AI cars, changes to the dynamics or to model files.
