# 120 — Paint materials in the car pipeline and livery shader

Status: pending
Phase: 1
Depends on: 075, 112, 119
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Cars expose which glb materials carry the livery, and `applyLivery` paints them with a pattern shader driven by a `Livery`.

## Context

`bounds` = bounding box of the car model in the car root space (after 057 the renderer applies no body rotation/scale/offset).

Design: `docs/plans/game-features.md` section 120. Pipeline: `tools/assets/buildCar.ts` (configs `assets/cars/<id>.pipeline.json`, field `liveryMaterials` already selects source materials that are MERGED into a single output glb material named `livery`) and `tools/assets/buildF4.ts` (f4, same output material name `livery`). Outputs `public/models/<car>.glb` + `<car>.json` (wheel metadata). So no new config field: the output json just gains `paintMaterials`. `Livery` from 119 (`src/game/livery.ts`). Renderer: `src/render/carRenderer.ts`. Three.js `MeshStandardMaterial.onBeforeCompile` + `customProgramCacheKey`.

## Files

- `tools/assets/buildCar.ts`, `tools/assets/buildF4.ts` — modify: output json gains `"paintMaterials": ["livery"]` (only if the glb contains a material named `livery`; else fail the build).
- `public/models/*.json` (f4, gt3-a, gt3-b, gt3-c, gt3-d and any prototype that has a model json) — modify: add `paintMaterials` (re-run `npm run build:cars` / `build:f4`, or edit by hand if the sources are not available; each name must exist in the glb).
- `src/render/liveryMaterial.ts` — create.
- `src/main.ts` — modify: apply the saved/default livery to the player car; `__SIMGAME__.setLivery(l: Partial<Livery>)` and `sceneStats().carScreenRect: {x:number;y:number;w:number;h:number}` (pixels of the player car's projected bounding box).
- `tests/unit/acceptance/120-livery-shader.test.ts` — acceptance worker.

## Steps

```ts
import * as THREE from 'three';
import type { Livery, LiveryPattern } from '../game/livery';
export function liveryColorAt(pattern: LiveryPattern, u: number, v: number, h: number): 0 | 1 | 2; // 0 primary, 1 secondary, 2 accent
export function applyLivery(root: THREE.Object3D, paintMaterials: string[], livery: Livery, bounds: THREE.Box3): void;
```

1. `liveryColorAt` (the GLSL mirrors it): solid → 0; stripe → `|u−0.5| < 0.08` ? 1 : (`|u−0.5| < 0.1` ? 2 : 0); split → `h > 0.55` ? 1 : 0; chevron → `v < 0.35 && |u−0.5| < (0.35−v)` ? 1 : 0.
2. `applyLivery`: for each mesh material whose `name` is in `paintMaterials`, clone it once per call (so two cars never share it), patch via `onBeforeCompile` adding uniforms `uPrimary`, `uSecondary`, `uAccent` (vec3 colours), `uPattern` (int 0–3 as in `LIVERY_PATTERNS` order), `uBoundsMin`, `uBoundsSize`; fragment colour = chosen colour × base map luminance-preserving (base texture kept for detail). Object-space position normalised by `bounds`: u = x across width 0..1, v = z along length 0..1 from the nose (nose at −Z, so v = 0 at `bounds.min.z`), h = y 0..1. Other materials untouched.
3. Program sharing: `customProgramCacheKey` returns a constant string (one program for all liveries; pattern is a uniform), so cars with different liveries share one compiled program.
4. Calling `applyLivery` again on the same root updates uniforms only (no new clone). Colour change takes effect without recompiling.
5. `setLivery` merges into the current livery, re-applies and persists nothing.

Conventions: u, v, h not clamped; boundaries as written (`<` strict); `bounds` with zero size on an axis → that coordinate 0; missing material name ignored silently.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each `public/models/<car>.json` | read | `paintMaterials` non-empty; every name exists among the glb's materials |
| AT2 | liveryColorAt for (stripe, 0.5, 0.5, 0.5) / (stripe, 0.59, 0.5, 0.5) / (stripe, 0.8, 0.5, 0.5) / (split, 0.5, 0.5, 0.6) / (chevron, 0.5, 0.1, 0.5) / (chevron, 0.9, 0.1, 0.5) | call | 1 / 2 / 0 / 1 / 1 / 0 |
| AT3 | unit: applyLivery on a scene with materials A (paint) and B | inspect | A has the livery uniforms, B untouched; two cars with different liveries share one compiled program per pattern (program cache key) |
| AT4 | e2e monza, set player livery primary #ff0000 then #0000ff via `__SIMGAME__.setLivery` | screenshot pixel on the car body (chase cam, from `sceneStats().carScreenRect` centre) | red channel dominant then blue channel dominant |

## Acceptance criteria

- [ ] AT1–AT4 pass; `npm run build:cars` still succeeds.
- [ ] No existing carRenderer/pipeline test regresses.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 120-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Decals (121), editor UI (122), AI liveries, glb texture changes, new paint material names per car.
