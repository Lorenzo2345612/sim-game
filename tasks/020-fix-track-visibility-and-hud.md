# 020 — Fix invisible track and off-screen HUD in the browser game

Status: done
Phase: 0
Depends on: 019
Complexity: simple
Type: bugfix
Roles: acceptance, coder, reviewer

## Goal

In `npm run dev` the asphalt is visible under and ahead of the car, and the HUD panel is visible at the top-left of the viewport.

## Context

Bugs found by the planner after task 019 (screenshots `test-results/phase0-*.png`):
- The track renders correctly when drawn alone from a high camera, but from the chase camera (2.2 m high) only grass is visible. Most likely cause: depth precision — asphalt sits only 0.02 m above the ground plane at y = 0, so the ground wins at grazing angles (worse on software GL). Verify the cause before fixing.
- `#hud` is `position: fixed` without `top`/`left`, so it is laid out below the 100vh canvas (bounding rect y = 720, size 0).

Acceptance tests for this task are Playwright e2e (not Vitest): `tests/e2e/acceptance/020-track-hud.spec.ts`, using the same browser setup as `playwright.config.ts`.

## Files

- `index.html` — modify: position `#hud` (top/left 12 px, z-index above canvas)
- `src/render/sceneSetup.ts` and/or `src/render/trackRenderer.ts` — modify: make the asphalt win the depth test robustly (e.g. ground at y = -0.05 and/or `polygonOffset` on the asphalt material; keep track y = 0.02)
- `tests/e2e/acceptance/020-track-hud.spec.ts` — created by the acceptance worker

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | game loaded (`__SIMGAME__.ready`), car at spawn, viewport 1280×720 | screenshot | pixel (640, 690) (road just below the car) is asphalt: R, G, B each < 90 and G − R < 25 (not grass green) |
| AT2 | same | screenshot | pixel (640, 330) (road ahead, below horizon) is asphalt by the same rule |
| AT3 | same | read `#hud` bounding rect | top ≤ 40, left ≤ 40, width > 50, height > 20, fully inside the viewport |
| AT4 | same | read `#hud` text | contains "km/h" and "Lap" |
| AT5 | hold ArrowUp 3 s | read `#hud` speed text | number before "km/h" > 50 |

## Acceptance criteria

- [ ] AT1–AT5 pass with `npm run test:e2e`.
- [ ] Existing unit tests and the phase-0 e2e still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Shadows, track textures, kerbs, new HUD fields, camera retuning.
