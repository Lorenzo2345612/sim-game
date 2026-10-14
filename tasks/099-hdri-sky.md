# 099 — HDRI sky, image-based lighting, neutral tone mapping, fog from horizon

Status: pending
Phase: 1
Depends on: 042
Complexity: simple
Type: feature
Models: heavy
Roles: acceptance, coder, reviewer

## Goal

The v2 scene uses a real HDRI as background and image-based lighting (IBL), Neutral tone mapping, and fog coloured from the HDRI horizon, instead of the procedural `Sky` gradient.

## Context

Plan: `docs/plans/m1.2c-realism.md`. Assets (installed by the planner, do not create): `public/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr` (monza), `public/hdri/kloofendal_overcast_puresky_2k.hdr` (spa, silverstone). Use `RGBELoader` (`three/addons/loaders/RGBELoader.js`) with `FloatType` (data = RGBA float32, 4 floats per pixel) and `PMREMGenerator`. Replaces the `Sky` addon in `src/render/environment.ts`.

## Files

- `src/render/environment.ts` — modify — HDRI environment, `horizonColor`, `ENV_TABLE`.
- `src/render/sceneSetup.ts` — modify — `renderer.toneMapping = THREE.NeutralToneMapping`; drop the `HemisphereLight` (IBL replaces it).
- `src/main.ts` — modify — await `applyEnvironment`, new stats and `renderStats()` hook.
- `tests/unit/acceptance/099-hdri-sky.test.ts` — create (acceptance worker).

## Steps

```ts
// environment.ts
export const ENV_TABLE: Record<string, string>; // trackId -> hdr base name (without "_2k.hdr"); unknown id -> monza
export function horizonColor(data: Float32Array, width: number, height: number): [number, number, number];
export interface EnvironmentInfo { name: string; horizon: [number, number, number] }
export function applyEnvironment(scene: THREE.Scene, trackId: string, renderer: THREE.WebGLRenderer): Promise<EnvironmentInfo>;
// main.ts
export interface SceneStats { /* existing fields + */ environment: string; ibl: boolean; horizonColor: [number, number, number]; fogColor: [number, number, number] }
window.__SIMGAME__.renderStats(): { toneMapping: string } // 'Neutral' | 'ACESFilmic' | 'Linear' | 'None' | other THREE names
```

1. `horizonColor`: `data` is RGBA float32 equirect, row 0 = zenith. Row r has centre latitude `(0.5 - (r+0.5)/height) * 180` degrees. Result = mean RGB over every pixel of rows with `|lat| <= 5`.
2. `applyEnvironment`: load `public/hdri/<ENV_TABLE[trackId]>_2k.hdr`; `scene.background` = the equirect texture (mapping `EquirectangularReflectionMapping`); `scene.environment` = PMREM of it; `scene.environmentIntensity = 0.7`; `scene.backgroundIntensity = 1`. Dispose the PMREM generator and any previous environment/background textures on re-call. Remove the old `Sky` object.
3. Fog: `scene.fog = new THREE.FogExp2(color, density)` with density from existing `FOG_TABLE` (keep the table's densities; its colours become unused, remove the `color` field) and colour = `horizonColor` result clamped to [0,1] per channel.
4. `sceneStats()` adds `environment` (= `ENV_TABLE` name), `ibl` (= `scene.environment !== null`), `horizonColor`, `fogColor` (= `scene.fog.color` r,g,b). `sky` is true when `scene.background` is not null.
5. `startGame` awaits `applyEnvironment(scene, track.id, handle.renderer)` before `ready = true`. `renderStats().toneMapping` maps `renderer.toneMapping` to its THREE constant name.

Conventions: horizon rows boundary `|lat| <= 5` inclusive; mean unweighted by cos(lat); no rounding; `data` not mutated; HDR load failure rejects (no silent fallback).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. Every row must be producible through the signatures in Steps. The `acceptance` worker turns each row into `tests/unit/acceptance/099-hdri-sky.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=monza` | ready | `sceneStats().environment` = 'kloofendal_48d_partly_cloudy_puresky'; `scene.environment` set (`sceneStats().ibl` true); `renderStats().toneMapping` = 'Neutral'; no console errors |
| AT2 | same, 1280×720 screenshot | sky band y 0–150 | ≥ 5 % of pixels differ from their row's mean luminance by > 0.03 (clouds, not a flat gradient) |
| AT3 | unit: `horizonColor(data, width, height)` on a synthetic equirect where rows within ±5° of the horizon are (0.6, 0.7, 0.8) and the rest black | call | (0.6, 0.7, 0.8) ± 1e-3 |
| AT4 | e2e `/?track=spa` | ready | environment 'kloofendal_overcast_puresky'; `scene.fog.color` equals `sceneStats().horizonColor` ± 0.02 per channel |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass; no remaining `Sky` import.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 099-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Sun/shadow direction changes (`ShadowRig`), post-processing (105), terrain/track materials, fetching HDRI files, v1 (Phase 0) scene, quality tiers.
