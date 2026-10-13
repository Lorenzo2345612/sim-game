# 103 — Real-size tyre walls, W-beam armco with posts, catch fences

Status: pending
Phase: 1
Depends on: 083, 086
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

Barriers look like the real thing: stacked 4-row tyre walls, W-profile armco rails with posts every 2 m, and a 3 m catch fence behind armco.

## Context

M1.2c. `createBarrierObject(track, loadTexture?)` in `src/render/barrierRenderer.ts` as left by 083 (textured materials, `loadTexture` param, tyre colour parity, dispose rules) and 086 (`barrierRuns`/spans from `src/track/barrierPath.ts`; continuous quads). Colliders (`src/physics/trackColliders.ts`) do not change. Mesh names stay `armco`, `armcoPosts`, `tyres`, `wall`; new mesh `fence`. Textures in `public/textures/{rubber,metal,fence}/` (`color.jpg`, `normal.jpg`, `roughness.jpg` / `opacity.jpg`). "Behind" = away from the track, on the side's outward normal (as the wall's section already does).

## Files

- `src/render/barrierProfiles.ts` — create — constants and `wBeamProfile`, pure, no three import.
- `src/render/barrierRenderer.ts` — modify.
- `tests/unit/acceptance/103-trackside-realism.test.ts` — create (acceptance worker); e2e AT4 added to the existing barrier e2e pattern.

## Steps

```ts
// barrierProfiles.ts
export const TYRE_PITCH = 0.62, TYRE_ROWS = 4, TYRE_ROW_HEIGHT = 0.25, TYRE_OUTER_RADIUS = 0.31;
export const ARMCO_RAIL_HEIGHT = 0.31, ARMCO_RAIL_CENTER = 0.6, ARMCO_POST_SPACING = 2.0;
export const FENCE_HEIGHT = 3.0, FENCE_OFFSET = 1.0;
export function wBeamProfile(): Array<[t: number, y: number]>; // 9 points, y in [0.445, 0.755], t in [-0.05, 0.05] (t > 0 = away from track), two lobes bulging toward the track
```

1. Tyres: `InstancedMesh` `tyres`, one tyre per instance (flat torus, outer radius 0.31, height 0.25, ≤ 150 triangles), rubber material with color/normal/roughness maps (via `loadTexture`), instance colours exactly as 083. Per span: row r (0..3, y = r·0.25 + 0.125 above the path) places tyres at `s = (r % 2) · 0.31 + k · 0.62`, k ≥ 0, while `s ≤ length`; centre shifted outward by 0.31 m so the inner face is flush with the barrier line. Instance order: row-major (row 0 all k, then row 1, …).
2. Armco rail: mesh `armco`, `wBeamProfile` extruded along the span path (continuous, from `barrierRuns` as today), uv u = arc length / 2, v = profile arc fraction 0..1; same textured material as 083. Rail occupies y 0.445–0.755 above the path.
3. Posts: `armcoPosts` InstancedMesh, one every 2.0 m of arc length starting at 0 (`floor(length/2)+1` per span), box 0.08 × 0.75 × 0.12 m, centred 0.1 m behind the rail line, same material as the rail.
4. Fence: mesh `fence`, for each armco span one vertical quad per path edge, 3.0 m tall, bottom at path y, 1.0 m behind the rail line; material `MeshStandardMaterial` with `map` = `textures/fence/color.jpg`, `alphaMap` = `textures/fence/opacity.jpg`, `alphaTest` 0.5, `DoubleSide`, uv u = arc length / 3, v = height / 3. Not created when there is no armco.
5. Wall: unchanged. Total scene draw calls from barriers ≤ 5 (one per mesh above).
6. `dispose()` still disposes every geometry, material and texture exactly once; second call is a no-op.

Conventions: lengths in metres along the XZ polyline arc; tyre `s ≤ length` inclusive; zero-length span creates no instances; colours exact in linear RGB; no allocations per frame.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/103-trackside-realism.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: tyre wall along a 10 m straight segment | build | tyres every 0.62 m along the line (16 or 17 per row), 4 rows high (top at 1.0 ± 0.05 m), one InstancedMesh per material |
| AT2 | unit: armco along 10 m | build | W-beam rail cross-section 0.31 m tall, rail centre at 0.6 m; posts every 2.0 m (6 posts) |
| AT3 | unit: catch fence | build | 3.0 m tall quads behind armco segments, material with opacity map and alphaTest |
| AT4 | e2e each track | ready | `drawCalls()` ≤ 300; barrier colliders unchanged (086 AT4 still passes) |

## Acceptance criteria

- [ ] All AT rows pass; existing barrier tests (038, 083, 086) still pass; any edit to them is reported.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Colliders, damage/deformation, new texture files, wall (concrete) changes, tyre physics, fence collision, barrier offsets or placement (084/098), post-processing.
