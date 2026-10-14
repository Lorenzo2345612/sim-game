# 159 — Street-circuit trackside: walls, sidewalks, lamps, billboards

Status: pending
Phase: 1
Depends on: 157, 141
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

City tracks have concrete walls with catch fence all round, sidewalks, street lamps and generic billboards.

## Context

M1.2d, design `docs/plans/m1.2d-environments.md`. Read the current code first: this task runs after 157 (city `environment` type and env files; `environment` field from 156 is read from `tracks.json`) and 141 (barrier types incl. `foam`); adapt file names to what exists, keep the public contract. Catch fence rendering on walls comes from 103 (`src/render/barrierRenderer.ts`). Barrier generation is in `tools/track-builder/barriers.ts`; city ids: baku, singapore, lasvegas. Lamp model `public/models/props/lamp.glb` and texture `public/textures/pavement/` are installed by the planner. Billboards: no brands, plain coloured panels from the livery palette (`src/` livery colours). Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `tools/track-builder/barriers.ts` — modify: city tracks → every segment `wall` except `foam`.
- `src/render/streetFurniture.ts` — create.
- `src/main.ts` — modify: build and add; `SceneStats` adds `lamps`, `sidewalks`.
- `public/tracks/{baku,singapore,lasvegas}.json` — regenerate.
- `tests/unit/acceptance/159-street-trackside.test.ts`, `tests/e2e/acceptance/159-street-trackside.spec.ts` — create (acceptance worker).

## Steps

```ts
export interface StreetFurniture { group: THREE.Group; lamps: number; sidewalks: number; billboards: number; dispose(): void }
export function lampPositions(wallPath: [number, number][], spacing: number, inset: number): { x: number; z: number; yaw: number }[];
export function createStreetFurniture(track: TrackDataV2, loadTexture?: (url: string) => THREE.Texture): StreetFurniture;
```

1. Builder: when `environment === 'city'`, set every barrier segment's type to `wall` (keep `foam`); other environments unchanged.
2. Sidewalk: strip 3 m wide outside each wall run, flat at the wall's y, pavement texture (uv metres / 4); `sidewalks` = number of strips.
3. `lampPositions`: points at arc lengths 0, spacing, 2·spacing … ≤ length along the path, shifted `inset` m outward-behind the wall (outward = right-hand side normal as for barriers); yaw faces the track. Defaults in use: spacing 40, inset 1. `lamps` = total over both sides, instanced (`InstancedMesh`).
4. Billboards: one every 400 m of arc length on the outside of straights (centerline curvature radius > 500 m over the span), plain panels 12 × 4 m on two posts, colours cycled from the livery palette, instanced per colour.
5. Non-city track → empty group, counts 0. `dispose()` once.

Conventions: arc length in metres along the XZ polyline; endpoint at exactly length is included (n = floor(length / spacing) + 1 → 400 m gives 11); spacing tolerance 0.5 m; path < 2 points → []; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | rebuilt baku.json | read barriers | every segment type `wall` or `foam` |
| AT2 | unit: lamps along a 400 m straight wall run | place | 11 lamps per side (every 40 ± 0.5 m) |
| AT3 | e2e `/?track=lasvegas` | ready | `sceneStats().lamps` > 0, `sceneStats().sidewalks` > 0; drawCalls ≤ 300 |
| AT4 | rebuilt monza.json | compare | identical (not a city) |

## Acceptance criteria

- [ ] AT1–AT4 pass; 103 and 141 barrier tests still pass.
- [ ] typecheck, lint, test, test:e2e pass.

## Verification

```
npm run build:tracks -- baku singapore lasvegas
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Buildings and water (158), landmarks (160).
- Brand logos, readable text on billboards, night lamp lighting, lamp colliders.
