# 136 — Night lighting: floodlights, headlights

Status: pending
Phase: 2
Depends on: 102, 103, 135
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Night tracks are readable: instanced floodlight poles, an analytic "floodlit" light term in the track and terrain materials, player headlights and emissive head/tail lights on every car, within the draw-call budget.

## Context

Design: `docs/plans/game-features.md` section 136. `TimeOfDay` (135, `src/core/timeOfDay.ts`) and `sceneStats()` (135, `src/main.ts`). Materials are `MeshStandardMaterial` patched via `onBeforeCompile`: terrain `src/render/terrainMaterial.ts` (081; its track-distance input comes from `terrainTrackDistance`), surfaces `src/render/surfaceMaterials.ts`. Cars: `CarRenderer` (`src/render/carRenderer.ts`), `CarSpec.chassis.halfExtents` (car-local metres, car faces −Z). No real lights for floodlights (cost). Acceptance: Vitest `tests/unit/acceptance/136-night-lighting.test.ts` (AT1), Playwright `tests/e2e/acceptance/136-night-lighting.spec.ts` (AT2, AT3).

## Files

- `src/render/floodlights.ts` — create
- `src/render/terrainMaterial.ts` — modify: patch with the floodlit term using its distance-to-track value
- `src/render/surfaceMaterials.ts` — modify: patch with the floodlit term at distance 0 (full)
- `src/render/carRenderer.ts` — modify: `setLightsOn(on: boolean)`
- `src/main.ts` — modify: floodlights + headlight when `timeOfDay === 'night'`, `SceneStats.floodlights: number`

## Steps

```ts
import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
export const FLOODLIT_RANGE = 60; // m
export function floodlit(distance: number): number; // 1 - smoothstep(0, 60, distance), clamped to [0, 1]
export const floodlitMix: { value: number };         // shared uniform: 1 at night, 0 otherwise
export function patchFloodlit(material: THREE.MeshStandardMaterial, distanceExpr: string): void; // chains onBeforeCompile
export function createFloodlights(track: TrackDataV2): { object: THREE.Group; count: number; dispose(): void };
```

1. `floodlit(d)`: `1 − smoothstep(0, 60, d)` (Hermite smoothstep); `d <= 0` → 1, `d >= 60` → 0; negative → 1, NaN → 0.
2. `patchFloodlit`: preserves any existing `onBeforeCompile`; in the fragment shader adds `diffuseColor.rgb · floodlitMix · floodlit(distanceExpr) · 0.6` to `totalEmissiveRadiance` (before `#include <emissivemap_fragment>`), with the same Hermite formula in GLSL. `distanceExpr` is a GLSL float expression (`"0.0"` for surfaces; terrain passes its track-distance varying).
3. `createFloodlights`: one pole every 60 m of lap length on both sides at 15 m from the centreline (right normal `(-dz, dx)/len`), height 14 m, y from `track.elevation`; two `InstancedMesh` (poles, emissive heads with `emissiveIntensity` 4) → 2 draw calls; `count` = number of poles. `dispose()` releases geometries and materials.
4. `CarRenderer.setLightsOn(on)`: 2 small emissive white quads at the front (`z = −halfExtents.z`, `x = ±0.6·halfExtents.x`) and 2 red at the rear, hidden when off; created once, disposed with the car. `main.ts` calls it for every car when night.
5. Night only (`timeOfDay === 'night'`): set `floodlitMix.value = 1`, add floodlights, add one player `SpotLight` (no shadow, angle 0.5 rad, penumbra 0.5, intensity 400, decay 2, distance 80, attached to the player car at (0, 0.5, −2) aimed 20 m ahead along −Z); otherwise `floodlitMix.value = 0`, no poles, no spotlight. `sceneStats().floodlights` = pole count (0 by day).

Conventions: pure `floodlit` has no rounding and does not mutate; materials released with `dispose()`; no per-frame allocation.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit floodlit(distance) | 0 / 30 / 60 / 80 m | 1 / smoothstep value 0.5 ± 0.01 / 0 / 0 |
| AT2 | e2e lusail night | pixel under the car | luminance ≥ 0.15 (track visible) |
| AT3 | e2e | drawCalls() | ≤ 300; no console errors |

## Acceptance criteria

- [ ] All AT rows pass; daytime scenes unchanged (`sceneStats().floodlights` 0 on monza).
- [ ] `npm run test:e2e` existing barrier/terrain tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 136-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Real shadow-casting lights, light cookies, light bloom changes (105), AI headlight beams, damaged lights.
- Time-of-day presets (135).
