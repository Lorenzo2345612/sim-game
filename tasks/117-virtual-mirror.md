# 117 — Virtual rear-view mirror

Status: pending
Phase: 1
Depends on: 047, 054, 070, 099, 105, 111
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

A rear-view mirror (second camera rendered into a small canvas at the top centre) appears in cockpit and T-cam modes, toggleable by a setting.

## Context

Design: `docs/plans/game-features.md` section 117. Camera modes: `src/render/cameraRig.ts`. Settings storage: `src/core/settings.ts` (`SETTINGS_KEY = 'settings'`, `KeyValueStorage`, currently only `preset`; `savePreset` rewrites the whole JSON). Single WebGL context (see `src/main.ts`): render the mirror with the same renderer into a `WebGLRenderTarget`, then copy pixels to the DOM canvas. Car faces -Z, so "behind" is +Z. e2e: `tests/e2e/acceptance/117-virtual-mirror.spec.ts` (acceptance worker).

## Files

- `src/render/mirror.ts` — create.
- `src/core/settings.ts` — modify: `loadMirrorSetting(storage: KeyValueStorage): boolean` (default true; bad/missing -> true); `savePreset` must preserve all other keys already in the stored JSON object.
- `src/main.ts` — modify: create `#mirror` canvas (position fixed, top centre, 512×128 CSS px), render every 2nd frame when visible, hide in chase mode or when setting false; `__SIMGAME__.renderStats()` (099) gains the field `mirrorRenders: number`.
- `tests/unit/acceptance/117-virtual-mirror.test.ts` — acceptance worker.

## Steps

```ts
import * as THREE from 'three';
export const MIRROR_FOV = 50;
export function mirrorCameraPose(
  carPos: { x: number; y: number; z: number },
  carQuat: { x: number; y: number; z: number; w: number },
  out: { position: THREE.Vector3; forward: THREE.Vector3 },
): void;
```

1. `mirrorCameraPose`: position = carPos + carQuat · (0, 1.0, 0.5); forward = carQuat · (0, 0, +1). Writes `out`, allocates nothing per call (module-level temporaries).
2. Mirror render target 512×128, aspect 4, FOV 50, near 0.3, far = main camera far. Mirror image is horizontally flipped on the DOM canvas (CSS `transform: scaleX(-1)`).
3. `mirrorRenders` increments once per mirror render, stops when hidden.
4. Dispose render target on session dispose.

Conventions: no clamping; `out` mutated; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: car at (10, 0, 5), identity quat | mirrorCameraPose | position (10, 1.0, 5.5) ± 1e-9; forward = (0, 0, +1) ± 1e-9 |
| AT2 | unit: car yaw 90° (quat about +Y) | same | forward = rotate((0,0,1)) ± 1e-9 |
| AT3 | e2e cockpit mode | `#mirror` | visible; its pixels' luminance std dev > 0.02 |
| AT4 | e2e chase mode / mirror setting false | `#mirror` | hidden; `renderStats().mirrorRenders` stops increasing |

## Acceptance criteria

- [ ] AT1–AT4 pass; existing settings tests still pass.
- [ ] `savePreset` keeps unrelated keys (edge test in `tests/unit/core/settings.test.ts`).

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 117-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Settings UI toggle, mirror in replay, side mirrors, post-processing in the mirror.
