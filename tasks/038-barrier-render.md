# 038 — Render barriers

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`createBarrierObject(track)` builds the armco, tyre-stack and concrete-wall barriers of a `TrackDataV2` as efficient Three.js objects.

## Context

`BarrierSegment` and `TrackDataV2`: `ai/guides/phase1.md`. Fully procedural (no assets). Must run in Node. Acceptance tests: Vitest in `tests/unit/acceptance/038-barrier-render.test.ts`; tests use a straight fixture, flat elevation 0, centerline spacing 2 m.

## Files

- `src/render/barrierRenderer.ts` — create
- `tests/unit/render/barrierRenderer.test.ts` — create (edge cases)

## Steps

```ts
import * as THREE from 'three';
import type { TrackDataV2 } from '../core/types';
export interface BarrierObject { group: THREE.Group; dispose(): void }
export function createBarrierObject(track: TrackDataV2): BarrierObject;
```

- Per segment, polyline `P[i] + side × offsetMeters × rightNormal[i]` for indices `start…end` (wrapping when `end < start`); right normal as in `src/track/ribbon.ts` (`d = normalize(P[i+1] - P[i-1])`, `right = (-d.z, d.x)`, left = negative). Base height of each point = `elevation[i]`. Length = polyline length.
- Armco (mesh `armco`, one per object, all armco segments merged): rail = vertical strip, `y` from base+0.45 to base+0.75, light grey `MeshStandardMaterial`, double-sided. Posts (`InstancedMesh` named `armcoPosts`): box 0.1 × 0.75 × 0.1 with its bottom at base, one every 4 m of arc length starting at 0 (`floor(length/4) + 1` per segment).
- Tyres (`InstancedMesh` named `tyres`): geometry = 3 stacked cylinders (radius 0.3, height 0.25 each, merged with `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`, total 0.75 m), one instance per metre of arc length (`floor(length/1) + 1` per segment), dark `MeshStandardMaterial`.
- Wall (mesh `wall`, segments merged): rectangle section 0.3 m thick × 1.0 m high swept along the polyline, base at elevation, light concrete grey `MeshStandardMaterial`.
- A type with no segments creates no mesh. `castShadow = true` on all.
- `dispose()` disposes all geometries and materials once; second call is safe.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/038-barrier-render.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | one armco segment of 100 m along a straight | `createBarrierObject` | armco mesh along the offset polyline, height 0.75 m, posts instanced every 4 m (25 instances ±1) |
| AT2 | one tyres segment of 40 m | object | instanced tyre stacks every 1 m (40 ±1), 3 high |
| AT3 | one wall segment | object | concrete wall 1.0 m high, 0.3 m thick |
| AT4 | any | `dispose()` | disposes geometries/materials |

## Acceptance criteria

- [ ] All rows in `tests/unit/acceptance/038-barrier-render.test.ts` pass.
- [ ] Extra tests: no barriers gives an empty group; a wrapped segment (`end < start`) produces finite positions; right and left sides are on opposite sides of the centerline.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Barrier colliders (task 032).
- Textures, normal maps, damage or tyre-stack physics.
- Adding to the scene (task 043).
