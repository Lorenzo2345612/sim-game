# 138 — Wet visuals: rain, wet road, spray

Status: pending
Phase: 2
Depends on: 080, 136, 137
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Rain falls around the camera, track and kerb surfaces darken, get glossier and form puddles as wetness rises, and cars throw spray; `/?rain=` forces the state for tests.

## Context

Design: `docs/plans/game-features.md` section 138. `TrackWeather` (137, `src/physics/weather.ts`) holds `rain`/`wetness` in [0, 1]. Surface materials are `MeshStandardMaterial` patched with `onBeforeCompile` in `src/render/surfaceMaterials.ts` (080; asphalt and kerb). `SceneStats`, `sceneStats()`, `drawCalls()` in `src/main.ts`. Rendering code may import `three`; release geometries/materials with `dispose()`; no per-frame allocation. In this task `?rain=<0..1>` sets `TrackWeather.setRain(r)` and `setWetness(r)` and `update` is not called (static); race weather is task 139. Acceptance e2e: `tests/e2e/acceptance/138-wet-visuals.spec.ts`; edge unit tests `tests/unit/render/rain.test.ts`.

## Files

- `src/render/rain.ts` — create
- `src/render/surfaceMaterials.ts` — modify: call `patchWet` on the asphalt and kerb materials
- `src/main.ts` — modify: `?rain=`, add/update the fields each frame, `SceneStats` gains `rainParticles: number`, `trackWetness: number`

## Steps

```ts
import * as THREE from 'three';
export const MAX_RAIN_POINTS = 20000;
export const RAIN_BOX = 40;        // m, edge of the box centred on the camera (x, z) and spanning camera.y ± 20
export const SPRAY_PER_CAR = 600;
export const MAX_SPRAY_CARS = 16;
export function rainParticleCount(rain: number): number;   // round(MAX_RAIN_POINTS · clamp(rain, 0, 1))
export const wetnessUniform: { value: number };            // shared by every patched material
export function patchWet(material: THREE.MeshStandardMaterial): void; // chains onBeforeCompile
export class RainField {
  readonly object: THREE.Points;
  readonly count: number;                                  // currently drawn points
  setRain(rain: number): void;
  update(camera: { x: number; y: number; z: number }, timeSeconds: number): void;
  dispose(): void;
}
export class SprayField {
  readonly object: THREE.Points;                           // one draw call for all cars
  readonly activeCount: number;
  update(dt: number, cars: readonly { x: number; y: number; z: number; speed: number }[], wetness: number): void;
  dispose(): void;
}
```

1. Rain: static point buffer of `MAX_RAIN_POINTS`; `setRain` changes only the draw range to `rainParticleCount(rain)`; fall (15 m/s) and wrap inside the box are done in the vertex shader from `timeSeconds`; `update` moves the object to follow the camera. Hidden (`visible = false`) when count 0.
2. `patchWet`: with `w = wetnessUniform.value`: albedo `× (1 − 0.35·w)`; roughness `× (1 − 0.6·w)`; puddle mask where `w > 0.6` and value noise at world xz (scale 0.15 /m) `> 0.55`: albedo × 0.85 and roughness set to 0.05. All no-ops at `w = 0`.
3. Spray: per car a ring of `SPRAY_PER_CAR` particles; emitted behind the car at emission rate `speed · wetness · 20` particles/s (speed in m/s), life 0.8 s, rising 1.5 m/s, size 0.4 m, white at 0.35 alpha; cars beyond `MAX_SPRAY_CARS` are ignored. `activeCount` = live particles; zero when `wetness === 0`.
4. `main.ts`: `?rain=<n>` (invalid or absent → 0, clamped to [0, 1]); `wetnessUniform.value = weather.wetness`; `sceneStats().rainParticles = rain.count`, `trackWetness = weather.wetness`.

Conventions: `rain`/`wetness` clamped to [0, 1], non-finite → 0; rounding to nearest integer for counts; `dt <= 0` → no emission; dispose releases geometry and material.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/?track=spa&rain=1` (wetness forced 1) | sceneStats | rainParticles > 0; trackWetness 1 |
| AT2 | e2e screenshot track pixel under the car dry vs wet | luminance | wet < 0.8 × dry |
| AT3 | e2e rain=1 | drawCalls | ≤ 300; no console errors |

## Acceptance criteria

- [ ] All AT rows pass; without `?rain=` the scene and `sceneStats()` (except the new fields = 0) are unchanged.
- [ ] Edge unit tests: `rainParticleCount` clamps and rounds; `SprayField` never exceeds 600 live particles per car.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Wetness dynamics, race weather, HUD (task 139); wet terrain/grass shading; windscreen/camera droplets; rain audio.
