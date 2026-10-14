# 121 — Race number decals

Status: pending
Phase: 1
Depends on: 120
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Each rendered car shows its race number on both sides and on the nose.

## Context

`bounds` = bounding box of the car model in the car root space (after 057 the renderer applies no body rotation/scale/offset).

Design: `docs/plans/game-features.md` section 121. `Livery.number` from `src/game/livery.ts` (119). Car local frame: nose at -Z, Y up. Use `DecalGeometry` from `three/examples/jsm/geometries/DecalGeometry.js`. Livery applied in `src/render/liveryMaterial.ts` (120); `bounds` is the car's `THREE.Box3`. `sceneStats()` is in `src/main.ts`. e2e: `tests/e2e/acceptance/121-number-decals.spec.ts`.

## Files

- `src/render/numberDecal.ts` — create.
- `src/main.ts` — modify: add decals to the player car after livery; `sceneStats().decals: number` = total decal meshes on rendered cars; `__SIMGAME__.setLivery` (120) also updates the number.
- `tests/unit/acceptance/121-number-decals.test.ts` — acceptance worker.

## Steps

```ts
import * as THREE from 'three';
export interface DecalAnchor { position: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } }
export function numberTexture(n: number, fg?: string, bg?: string): THREE.CanvasTexture;
export function decalAnchors(bounds: THREE.Box3): { left: DecalAnchor; right: DecalAnchor; nose: DecalAnchor };
export function addNumberDecals(car: THREE.Object3D, bounds: THREE.Box3, n: number, size?: number /* 0.35 */): THREE.Mesh[];
export function disposeNumberDecals(meshes: THREE.Mesh[]): void;
```

1. `numberTexture`: 256×256 canvas, filled disc `bg` (default `#ffffff`), digits `fg` (default `#000000`), bold sans-serif, centred; cached in a Map keyed `n|fg|bg` (same object returned); `n` integer 0–99 else throw.
2. `decalAnchors` with h = max.y − min.y, len = max.z − min.z: left (min.x, min.y + 0.55·h, min.z + 0.45·len) normal (−1,0,0); right same with max.x, normal (1,0,0); nose (centre x, max.y, min.z + 0.12·len) normal (0,1,0).
3. `addNumberDecals`: 3 `DecalGeometry` meshes (transparent, `polygonOffset`, depthWrite false), added under `car`; projects onto the car body mesh named `body` (or the first mesh if absent). `disposeNumberDecals` disposes geometries and removes meshes (cached textures stay).

Conventions: anchors exact (no rounding); invalid `n` throws; `bounds` not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | bounds x[−0.9,0.9] y[0,1] z[−2.5,2.5] (nose at −Z) | decalAnchors | left (−0.9, 0.55, −0.25) n(−1,0,0); right (0.9, 0.55, −0.25) n(1,0,0); nose (0, 1, −1.9) n(0,1,0) (± 1e-9) |
| AT2 | numberTexture(7) twice | call | same texture object (cache) |
| AT3 | e2e monza | sceneStats().decals | 3 per car |

## Acceptance criteria

- [ ] AT1–AT3 pass; drawCalls grows by at most 3 per car.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Sponsor logos, per-car decal sizes for GT3 (use size 0.35 for all), AI cars decals (094 wires them later), editor.
