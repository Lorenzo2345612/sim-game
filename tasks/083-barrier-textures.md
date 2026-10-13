# 083 — Textured barriers

Status: pending
Phase: 1
Depends on: 080, 043
Complexity: standard
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Armco, concrete walls and tyre stacks render with PBR textures and colour variation instead of flat grey/black.

## Context

Barrier renderer from task 038 (`src/render/barrierRenderer.ts`, API `createBarrierObject(track): BarrierObject`); task 043 mounts it in the scene. `createSurfaceMaterial(kind, loadTexture?, macro?)` from task 080 (`src/render/surfaceMaterials.ts`) already provides 'concrete' (`userData.tileMeters` 4). Texture files exist in `public/textures/metal/{color,normal,roughness}.jpg`. Existing geometry, names (`armco`, `armcoPosts`, `tyres`, `wall`) and counts do not change.

## Files

- `src/render/barrierRenderer.ts` — modify.
- `tests/unit/acceptance/083-barrier-textures.test.ts` — create (acceptance worker).
- `tests/e2e/` — acceptance worker adds AT5 following the pattern of the 080 e2e test.

## Steps

```ts
export function createBarrierObject(
  track: TrackDataV2,
  loadTexture?: (url: string) => THREE.Texture,
): BarrierObject;
```

1. Default `loadTexture` = `THREE.TextureLoader().load` with `texture.name = url` (same as 080). Must still run in Node with a stub.
2. Armco rail and posts: one shared `MeshStandardMaterial` per object with `map` (`textures/metal/color.jpg`, SRGB), `normalMap` (`normal.jpg`), `roughnessMap` (`roughness.jpg`), all `RepeatWrapping`. Rail uv: u = arc length / 2 (one tile = 2 m along the rail), v = height fraction 0..1. Posts keep the same material (default box uvs).
3. Wall: material = `createSurfaceMaterial('concrete', loadTexture)`; wall uvs u = arc length / 10, v = height / 10 (metres/10, like asphalt). The wall owns the textures in its `userData.textures` and disposes them.
4. Tyres: keep one `InstancedMesh`; rubber material `roughness` 0.9, `metalness` 0; instance colours via `setColorAt`: even instance index (0.9, 0.9, 0.9), odd (0.75, 0.1, 0.1); base material colour white.
5. `dispose()` disposes every geometry, material and texture exactly once (shared textures once); second call is a no-op.

Conventions: no allocations per frame; colours exact in linear RGB as given; unused type creates no mesh or texture.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/083-barrier-textures.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | stub loader | createBarrierObject on a track with armco | armco material map URL ends with textures/metal/color.jpg; normalMap and roughnessMap loaded |
| AT2 | track with a wall segment | same | wall material userData.tileMeters = 4 (concrete from createSurfaceMaterial) |
| AT3 | track with tyres | same | tyres InstancedMesh has instanceColor; instance 0 colour (0.9,0.9,0.9), instance 1 (0.75,0.1,0.1) (± 1e-6) |
| AT4 | object | dispose() twice | every texture, material and geometry disposed exactly once |
| AT5 | e2e `/?track=silverstone` | ready | no console errors; no /textures/ 404 |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Existing `tests/unit/render/barrierRenderer.test.ts` and 038 acceptance tests still pass (geometry unchanged).
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- New texture files, anti-tiling shader for armco/tyres, barrier geometry or offsets (084), colliders, damage, scene integration changes (043).
