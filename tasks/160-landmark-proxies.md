# 160 — Landmark proxies

Status: pending
Phase: 1
Depends on: 158
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

City tracks show procedural proxies of their landmarks (Maiden Tower, Flame Towers, Marina Bay towers and deck, observation wheel, lattice tower).

## Context

M1.2d, design `docs/plans/m1.2d-environments.md`. Read the current code first: this task runs after 158 (`src/render/cityRenderer.ts`, glass material/texture conventions) and the track builder (`tools/track-builder/tracks.json`, `buildTrackData.ts`, `src/track/geo.ts` `projectLonLat`); adapt file names to what exists, keep the public contract. The planner fills the `landmarks` coordinates in `tracks.json` before this task (baku 2, singapore 2, lasvegas 1). Proxies are generic shapes without brand or text. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `src/core/types.ts` — modify: `LandmarkKind`, `Landmark`; optional `landmarks?: Landmark[]` on `TrackDataV2`.
- `tools/track-builder/buildTrackData.ts` — modify: project `landmarks` lon/lat to local x/z (same origin as the track), copy to JSON.
- `src/render/landmarks.ts` — create.
- `src/main.ts` — modify: build, add, dispose; `SceneStats` adds `landmarks: number`.
- `public/tracks/{baku,singapore,lasvegas}.json` — regenerate.
- `tests/unit/acceptance/160-landmarks.test.ts`, `tests/e2e/acceptance/160-landmarks.spec.ts` — create (acceptance worker).

## Steps

```ts
export type LandmarkKind = 'cylinder-tower' | 'flame-towers' | 'twin-deck' | 'wheel' | 'lattice-tower';
export interface Landmark { kind: LandmarkKind; x: number; z: number; height: number; heading?: number } // JSON, local metres, heading rad (default 0)
// tracks.json entry: { kind; lon; lat; height; heading? }
export function buildLandmark(kind: LandmarkKind, height: number): THREE.Group; // origin at base centre, y up
export function createLandmarks(track: TrackDataV2, terrainY: (x: number, z: number) => number): { group: THREE.Group; count: number; dispose(): void };
```

1. Proxies (all procedural, base at y 0, bounding-box height = `height`): `cylinder-tower` stone cylinder (radius = height × 0.2, Maiden Tower, height 29 in data); `flame-towers` 3 curved tapering prisms of heights 0.84, 0.92, 1.0 × height; `twin-deck` 3 glass slabs side by side plus one deck slab across their tops (deck must not exceed `height`); `wheel` rim torus + spokes + capsules, diameter = height, lowest point at y ≈ 0 (sits on a base); `lattice-tower` 4 tapering legs with cross bracing.
2. Each proxy ≤ 3000 triangles; shared materials per group; `dispose()` disposes all geometries and materials once.
3. `createLandmarks`: place each landmark at (x, terrainY(x, z), z), rotate by `heading`. `count` = `track.landmarks?.length ?? 0`.

Conventions: metres/radians; bounding box measured with `THREE.Box3.setFromObject`; tolerance ±2 % of height; missing `landmarks` → empty group; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: each proxy kind with height H | build | triangles ≤ 3000; bounding box height = H ± 2 % |
| AT2 | e2e singapore / baku / lasvegas | ready | `sceneStats().landmarks` = 2 / 2 / 1; no console errors |

## Acceptance criteria

- [ ] AT1–AT2 pass; non-city tracks unaffected (`landmarks` 0).
- [ ] typecheck, lint, test, test:e2e pass.

## Verification

```
npm run build:tracks -- baku singapore lasvegas
npm run typecheck
npm run lint
npm test
npx playwright test 160-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Detailed or textured replicas, real logos, lit windows at night.
- Choosing landmark coordinates (planner), buildings/lamps (158, 159).

## Planner-authorised test edits (2026-10-16)

- `tests/unit/acceptance/168-us-tracks-in-game.test.ts`: delete the whole AT5 `it(...)` block ("other track JSONs changed vs base"). It only guarded task 168's own branch; 168 is merged. Remove imports left unused by that deletion. Nothing else. (Tasks 159/174 have the same authorisation; if it is already gone after a merge, nothing to do.)
