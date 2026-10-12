# 039 — Instanced procedural trees with LOD

Status: pending
Phase: 1
Depends on: 022, 035
Complexity: complex
Type: feature
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`createTreeField` turns `TrackDataV2.trees` into instanced, frustum-culled, LOD-switched tree meshes generated procedurally with EZ-Tree.

## Context

Design: `ai/guides/phase1.md` (Runtime > Trees). Acceptance tests (Vitest, `tests/unit/acceptance/039-trees-render.test.ts`) run in Node without WebGL, so the tree factory is injectable. Add exact dependencies `@dgreenheck/ez-tree@1.1.0` and `@three.ez/instanced-mesh@0.3.16` (`npm install --save-exact`). 035 is a dependency only to serialize `package.json` edits; do not use its textures.

## Files

- `src/render/treeField.ts` — create
- `package.json` — modify (two dependencies)
- `tests/unit/render/treeField.test.ts` — create (edge tests: empty species, instance order stable)

## Steps

```ts
import type * as THREE from 'three';
import type { TreeSpecies, TreeInstances, Vec3 } from '../core/types';
export type TreeFactory = (preset: string, seed: number, leafFactor: number) => THREE.Group; // 1 = LOD0 leaves, 0.5 = LOD1
export interface TreeFieldOptions {
  factory?: TreeFactory;                 // default: EZ-Tree, options.leaves.count scaled by leafFactor
  terrainY: (x: number, z: number) => number;
  lodDistance?: number; farDistance?: number;   // defaults 250 m, 1500 m
}
export interface TreeField {
  object: THREE.Group; update(cameraPosition: Vec3): void;
  instanceCount(species: string): number; variantCount(species: string): number;   // variants: 3
  getInstanceLod(species: string, index: number): 0 | 1 | -1;  // -1 = hidden
  getInstanceMatrix(species: string, index: number, out: THREE.Matrix4): THREE.Matrix4;
  dispose(): void;
}
export function scaleForHeight(variantHeight: number, targetHeight: number): number; // target / variant
export function createTreeField(trees: TreeInstances[], species: TreeSpecies[], options: TreeFieldOptions): TreeField;
```

- Per species: 3 variants (seeds 1, 2, 3), each built at LOD0 and LOD1. Variant height = bounding-box height of the LOD0 group. Instance `i` (index in `data` order) uses variant `i % 3`. One `InstancedMesh2` (`@three.ez/instanced-mesh`) per variant, LOD and part, frustum culling on.
- Matrix: translate (x, terrainY(x,z), z), rotate Y by rotY, uniform scale = instance scale × `scaleForHeight(variantHeight, species.heightMeters)`.
- `update`: horizontal distance d to the camera: d < lodDistance → LOD0; < farDistance → LOD1; else hidden. Reuse temporaries. `dispose` disposes every geometry, material and instanced mesh.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/039-trees-render.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | 2 species with 120 and 80 instances, injected fake tree factory (returns a 2-mesh Group of known height) | `createTreeField(trees, species, { factory })` (Node) | instance count per species = 120 / 80 across its variants; each species uses 3 variants |
| AT2 | same | instance matrices | position (x, terrainY(x,z), z), uniform scale = instance scale × heightMeters / variant height, rotation Y = rotY |
| AT3 | camera at origin, trees at 100 m, 400 m and 2000 m | `field.update(cameraPosition)` | 100 m uses LOD0, 400 m uses LOD1, 2000 m hidden (far = 1500 m) |
| AT4 | — | `scaleForHeight(45, 18)` | 0.4 ±1e-9 |
| AT5 | any | `dispose()` | all geometries and materials disposed |

## Acceptance criteria

- [ ] All AT rows pass; `package.json` pins both dependencies exactly; `treeField.ts` imports no Rapier, `window` or `document`.

## Verification

```
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Scene wiring (task 043); bark/leaf textures, wind, billboards, tree colliders.
