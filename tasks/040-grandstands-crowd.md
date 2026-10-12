# 040 — Procedural grandstands with crowd

Status: pending
Phase: 1
Depends on: 022
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`createGrandstand` builds a tiered stand with optional roof and an instanced seeded crowd.

## Context

Acceptance tests for this task are Vitest in `tests/unit/acceptance/040-grandstands-crowd.test.ts` (Node, no WebGL). `Grandstand` is from `src/core/types.ts` (task 022). The object is local to its own origin: world placement (x, z, yaw, y) is done by the caller (task 043), but `createGrandstand` applies `position.x/z` and `rotation.y = yaw` itself; y stays 0.

## Files

- `src/render/grandstand.ts` — create
- `tests/unit/render/grandstand.test.ts` — create (rows 1, length 10)

## Steps

```ts
import * as THREE from 'three';
import type { Grandstand } from '../core/types';
export function createGrandstand(g: Grandstand): THREE.Group;
export function disposeGrandstand(group: THREE.Group): void;
```

- Long axis along local X, `lengthMeters` long. Tiers: one box step per row, each row 0.8 m higher and 0.9 m deeper than the previous; total height = rows × 0.8 m.
- Roof (only if `roof`): mesh named `roof`, a thin box over the whole length, supported by posts.
- Crowd: one `THREE.InstancedMesh` named `crowd`, count = rows × floor(lengthMeters / 0.6), one small box/capsule per person, seated on each row. Per-instance colour with `setColorAt` from mulberry32 seeded by `Math.round(x * 31 + z * 17)` (local copy of mulberry32; do not import from tools).
- `disposeGrandstand` disposes all geometries and materials.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/040-grandstands-crowd.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | grandstand {length 60, rows 12, roof true} | `createGrandstand` (Node) | bounding box ≈ 60 m long, ≥ 6 m high; has roof mesh |
| AT2 | same | crowd | instanced people = rows × floor(length / 0.6) ±5 %, random colours seeded |
| AT3 | roof false | object | no roof mesh |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] Same `Grandstand` input gives identical crowd colours.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Animated crowd, textures, adding to the scene, per-track placement.
