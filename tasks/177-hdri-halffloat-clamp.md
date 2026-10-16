# 177 — Clamp HDRI values below half-float max (black lit surfaces on half-float GPUs)

Status: pending
Phase: 1
Depends on: 099
Complexity: simple
Type: bugfix
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Tracks with sunny HDRIs (monza, elkhart, lusail...) render lit surfaces (ground, track, car, buildings) normally on GPUs/drivers whose PMREM render targets are HalfFloat, instead of pure black.

## Context

Since task 099 `applyEnvironment` in `src/render/environment.ts` loads `/hdri/<name>_2k.hdr` with `RGBELoader` (`THREE.FloatType`) and feeds it to `PMREMGenerator`. Sunny HDRI peaks exceed the half-float max 65504 (kloofendal_48d_partly_cloudy_puresky 73216, qwantani_noon_puresky 135168; overcast ones peak 6.7). On half-float PMREM targets (SwiftShader in review/e2e, many integrated/mobile GPUs) the sun becomes Inf then NaN in the prefiltered env map, so all lit surfaces go black; the sky background stays fine. Bisected to commit 4364b12 (task 099). The directional sun light carries the direct sun, so clamping the HDRI peak keeps the look. Layout: RGBELoader with FloatType returns an RGBA `Float32Array` (4 floats per pixel); `horizonColor` in the same file already assumes this. Verify in `node_modules/three/examples/jsm/loaders/RGBELoader.js` before coding.

## Files

- `src/render/environment.ts` — modify — add `HDR_MAX`, `clampHdrData`; call it in `applyEnvironment`
- `tests/unit/acceptance/177-hdri-clamp.test.ts` — create (acceptance) — AT1-AT3
- `tests/e2e/acceptance/177-hdri-clamp.spec.ts` — create (acceptance) — AT4-AT6

## Steps

1. Export from `src/render/environment.ts`:
```ts
export const HDR_MAX = 60000;
export function clampHdrData(data: Float32Array, max: number): number;
```
`clampHdrData` clamps in place every R, G, B value (indices where `i % 4 !== 3`) that is `> max` or non-finite (Infinity, -Infinity, NaN) to `max`; alpha values are never touched; returns the number of values changed.
2. In `applyEnvironment`, right after `loadAsync` and before `horizonColor`/PMREM, call `clampHdrData(image.data, HDR_MAX)` and set `texture.needsUpdate = true`. Change nothing else.

Conventions: `> max` strict (a value equal to max is not counted); non-finite → max (including -Infinity); mutates input in place; empty array → returns 0; no throw.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `Float32Array` RGBA [1, 70000, Infinity, 99999, NaN, 0.5, 2, 1] | `clampHdrData(data, 60000)` | data becomes [1, 60000, 60000, 99999, 60000, 0.5, 2, 1]; returns 3 (alpha values untouched) |
| AT2 | `Float32Array` with all values ≤ 60000 | `clampHdrData` | data unchanged; returns 0 |
| AT3 | `HDR_MAX` | read | equals 60000 and is < 65504 (half-float max) |
| AT4 | e2e `/?track=monza` (Playwright, project's default chromium) | ready + 2 s | screenshot region x 300-980, y 400-640 (1280x720 viewport) has < 50 % of pixels with luminance < 8/255 (today: 100 %) |
| AT5 | e2e `/?track=lusail` | ready + 2 s | same check as AT4 |
| AT6 | e2e `/?track=monza` | ready | `__SIMGAME__.sceneStats().horizonColor` all three channels finite and within [0, 1] |

Test notes: `pngjs` is NOT in node_modules; compute luminance in-page by drawing the screenshot (base64 PNG) into a canvas, as `samplePixel` does in `tests/e2e/acceptance/055-phase1-e2e.spec.ts`. Luminance = 0.2126 R + 0.7152 G + 0.0722 B (0-255).

## Acceptance criteria

- [ ] AT1-AT6 pass.
- [ ] `HDR_MAX` and `clampHdrData` exported with the signatures above.
- [ ] Only `src/render/environment.ts` changed in `src/`; existing 099 tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 177-
npx playwright test 099-
```

## Out of scope

- Switching PMREM/HDRI to other data types or formats, re-encoding HDRI files.
- Changing light intensities, exposure, `environmentIntensity` or background.
- Editing existing tests or `ai/guides/architecture.md`.
