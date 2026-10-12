# 013 — Render the track (asphalt and start line)

Status: done
Phase: 0
Depends on: 002, 007, 012
Roles: coder, tester, reviewer

## Goal

`createTrackObject` turns the ribbon geometry from task 007 (`RibbonGeometry`, passed as `RibbonData`) into a `THREE.Group` with the asphalt and the start line.

## Context

`render` layer (three + core, no Rapier). The ribbon is produced by `buildRibbon` in `src/track/ribbon.ts` (task 007, returns `RibbonGeometry`). `render` must NOT import `src/track` (layers), so this module declares a structurally identical local type `RibbonData` (below); a `RibbonGeometry` is assignable to it. Only the test imports `buildRibbon`. `TrackData` comes from `src/core/types.ts`. Yaw formula: `architecture.md`, "Conventions". The track is flat (y = 0).

## Files

- `src/render/trackRenderer.ts` — create
- `tests/unit/render/trackRenderer.test.ts` — create

## Steps

1. Export EXACTLY:

```ts
export interface RibbonData { positions: Float32Array; indices: Uint32Array; uvs: Float32Array; vertexCount: number }
export interface TrackObject { group: THREE.Group; dispose(): void }
export function createTrackObject(ribbon: RibbonData, track: Pick<TrackData, 'centerline' | 'widthMeters'>): TrackObject;
```

2. Asphalt: `BufferGeometry` with `setAttribute('position', new BufferAttribute(ribbon.positions, 3))`, `setAttribute('uv', new BufferAttribute(ribbon.uvs, 2))`, `setIndex(new BufferAttribute(ribbon.indices, 1))` (Uint32Array), then `computeVertexNormals()`. Material `MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.9, metalness: 0 })`. Mesh `name = 'asphalt'`.
3. Start line: `Mesh(PlaneGeometry(track.widthMeters, 1.5), MeshBasicMaterial({ color: '#ffffff' }))`, `name = 'startLine'`.
   - Position: `(centerline[0][0], 0.03, centerline[0][1])`.
   - Direction `(dx, dz) = centerline[1] - centerline[0]`; `yaw = Math.atan2(-dx, -dz)`.
   - To lay it flat and orient it: `mesh.rotation.order = 'YXZ'`; `mesh.rotation.set(-Math.PI / 2, yaw, 0)`. The wide side (local X) ends up perpendicular to the travel direction.
4. `group = new THREE.Group()` with children in order: asphalt, startLine.
5. `dispose()`: `geometry.dispose()` and `material.dispose()` for both meshes.
6. Comments only where the logic is not obvious.

## Tests (`tests/unit/render/trackRenderer.test.ts`, Node)

Fixture: build in the test a circle of radius 100 m with 64 points (`[100cos a, -100 sin a]`, `a = 2πk/64`), `widthMeters` 12, and `ribbon = buildRibbon(centerline, 12, 0)` from `src/track/ribbon.ts`. Do not write a ribbon builder in the test.

- `group has asphalt and start line children`: `group.children.length === 2`; names 'asphalt' and 'startLine'.
- `asphalt geometry matches ribbon`: `geometry.index!.count === ribbon.indices.length`; `geometry.getAttribute('position').count === ribbon.vertexCount`; `normal` and `uv` attributes exist.
- `asphalt uses expected material`: `material.color.getHexString() === '3a3a3e'`, roughness ≈ 0.9.
- `start line sits on first centerline point`: `position.x ≈ centerline[0][0]`, `position.z ≈ centerline[0][1]` (4 decimals), `position.y ≈ 0.03`.
- `start line is oriented along the track`: `new Vector3(0,0,1).applyQuaternion(mesh.quaternion)` ≈ (0, 1, 0) (4 decimals), and `new Vector3(1,0,0).applyQuaternion(mesh.quaternion)` has dot product ≈ 0 with the normalised `(dx, 0, dz)`.
- `dispose does not throw` and calls `dispose` on both geometries (spy with `vi.spyOn`).

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract: the `acceptance` worker writes these rows as `tests/unit/acceptance/013-*.test.ts` before the coder starts. Coder, tester and spec writers must not change them.

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | ribbon from `buildRibbon` on circle r = 100 (N points), width 12 | `createTrackObject` | group has children named 'asphalt' and 'startLine' |
| AT2 | same | asphalt geometry | index.count = ribbon.indices.length; position.count = ribbon.vertexCount; has 'normal' and 'uv' attributes |
| AT3 | same | startLine | x,z = centerline[0] ±1e-6; y 0.03 |
| AT4 | same | `dispose()` | does not throw; geometries disposed (spy on dispose called) |

## Acceptance criteria

- [ ] Tests pass in Node without WebGL.
- [ ] No import of Rapier, `physics` or `track` in `trackRenderer.ts` (only the test imports `buildRibbon`).

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Textures, kerbs, side lines, grass, fences, shadows.
- Loading the track JSON, building the ribbon in production code (tasks 006/007) and adding the group to the scene (task 018).
