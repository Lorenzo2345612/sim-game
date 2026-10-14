# 122 — Livery editor screen

Status: pending
Phase: 1
Depends on: 044, 073, 074, 106, 114, 120, 121
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A "Livery" menu screen lets the player pick colours, pattern and number for a car, preview it on a turntable and save it; the player's car uses it in the game.

## Context

Design: `docs/plans/game-features.md` section 122. Menu: `src/ui/menu.ts` (task 044; follow its screen pattern, DOM only, no framework). Car list: `public/cars/index.json` (073). `loadLivery`/`saveLivery`/`defaultLivery`/`LIVERY_PATTERNS` from `src/game/livery.ts` (119); `applyLivery` (120) and `addNumberDecals` (121). Car loading: `CarRenderer.load` in `src/render/carRenderer.ts`. The preview needs a SECOND scene but reuses the page's single renderer (see `src/main.ts`). e2e: `tests/e2e/acceptance/122-livery-editor.spec.ts`.

## Files

- `src/ui/liveryEditor.ts` — create: `class LiveryEditor` (constructor takes container, storage, carIds, a preview-renderer callback); DOM ids `#livery-car`, `#livery-primary`, `#livery-secondary`, `#livery-accent`, `#livery-number`, `#livery-save`, `#livery-preview` (canvas), buttons `[data-pattern="solid|stripe|split|chevron"]`.
- `src/ui/menu.ts` — modify: "Livery" entry opening the editor; back returns.
- `src/main.ts` — modify: preview turntable (1 rev / 10 s, own scene/camera, disposed on close); the player car applies `loadLivery(storage, carId)`; `sceneStats().playerLivery: Livery`.
- `tests/unit/ui/liveryEditor.test.ts` — optional edge tests (jsdom if available, else skip).

## Steps

1. Colour inputs are `<input type="color">`; number input `type=number` min 0 max 99 step 1; pattern buttons toggle `aria-pressed`.
2. Any change updates the preview within 500 ms (re-`applyLivery`, decals updated); Save writes `saveLivery(storage, carId, livery)`.
3. Opening the editor loads the saved livery of the selected car (or `defaultLivery(0)`); changing the car selector reloads.
4. The player car (car 0, also in races) applies the saved livery; AI cars are tinted by 094 (`defaultLivery(k).primary`); no AI wiring here.
5. No console errors; dispose preview geometries/materials/render targets when leaving the screen.

Conventions: invalid input values are clamped by the inputs; `saveLivery` errors surface as a visible message `#livery-error`.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e menu → Livery, set primary #ff0000, pattern stripe, number 44, Save | localStorage `livery:f4` | parses to those values |
| AT2 | e2e then start monza | `sceneStats().playerLivery` | primary #ff0000, pattern stripe, number 44 |
| AT3 | e2e editor | change pattern | preview canvas pixels change (≥ 1 % differ) within 500 ms; no console errors |

## Acceptance criteria

- [ ] AT1–AT3 pass; existing menu e2e tests (044) still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 122-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Importing/exporting liveries, custom textures, per-AI livery editing, sponsor decals, live preview in the HUD.
