# 101 — Tree field uses baked LODs

Status: pending
Phase: 1
Depends on: 100, 039
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

The tree field renders the baked GLB trees from task 100 with three distance LODs and hysteresis, replacing the runtime ez-tree generation and the SwiftShader cone factory.

## Context

M1.2c. Files `public/models/trees/<species>-<0..3>.glb` with nodes `lod0`, `lod1`, `lod2` (see 100). Track species names (`oak`, `ash`, `aspen`, `pine`) map to baked species: oak→oak, ash→plane, aspen→plane, pine→pine, any other→oak. Current `src/render/treeField.ts` (039) uses `InstancedMesh2` from `@three.ez/instanced-mesh`, 3 variants and 2 LODs by leaf factor; keep `InstancedMesh2` and the instance data layout (`x,y,z,scale,rotY`). Per-frame code must not allocate (CLAUDE.md).

## Files

- `src/render/treeModels.ts` — create — GLB loading.
- `src/render/treeField.ts` — modify — LODs, hysteresis, models option; remove `factory`, `ez-tree` import and `defaultFactory`.
- `src/main.ts` — modify — load models before `createTreeField`; delete `makeCheapTreeFactory`; software GL passes `minLod: 1`.
- `tests/unit/acceptance/101-tree-lods.test.ts`, `tests/unit/render/treeField.test.ts` (adapt to the new options), `tests/e2e/` — acceptance worker adds AT2/AT3.

## Steps

```ts
// treeModels.ts
export type BakedSpecies = 'oak' | 'plane' | 'pine';
export interface TreeVariant { height: number; lods: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]] }
export type TreeModels = Record<BakedSpecies, TreeVariant[]>; // 4 variants each
export function bakedSpeciesFor(name: string): BakedSpecies;
export function loadTreeModels(baseUrl?: string): Promise<TreeModels>; // default '/models/trees/', GLTFLoader; height = lod0 bbox height

// treeField.ts
export type Lod = 0 | 1 | 2;
export function lodFor(distance: number, current?: Lod): Lod;
export interface TreeFieldOptions { models: TreeModels; terrainY: (x: number, z: number) => number; minLod?: Lod }
export interface TreeField { /* existing members, getInstanceLod returns Lod; */ lodCounts(): readonly [number, number, number] }
```

1. `lodFor`: thresholds 80 m (0→1) and 250 m (1→2), horizontal distance. Without `current`: `<80` → 0, `<250` → 1, else 2. With `current`, moving to a coarser LOD needs `distance ≥ threshold + 10`; moving finer needs `distance < threshold`. A jump over a level (e.g. 0 to 2) is allowed when both conditions hold.
2. Variant of instance i = `i % 4`; uniform scale = `instanceScale * spec.heightMeters / variant.height`. Instances never culled by distance (LOD 2 is the farthest).
3. `update(cameraPosition)` updates each instance LOD with `lodFor(d, current)` clamped to `≥ minLod` (default 0), toggling per-instance visibility only on change; matrices are written once at creation and never re-created; `lodCounts()` returns the same array object, updated in place, sum = total tree count.
4. One `InstancedMesh2` per (baked species, variant, lod, part), created only for species present in the track; mesh geometries/materials come from `TreeModels` and are disposed by `dispose()` exactly once (second call no-op).
5. `main.ts`: `await loadTreeModels()` in `startGame`; `stats.treeInstances` unchanged.

Conventions: distance in metres, XZ plane only; threshold comparisons as in step 1 (`<` for finer/no-hysteresis, `≥` for coarser with hysteresis); unknown species falls back to oak, never throws; `TreeInstances.data` is not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/101-tree-lods.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: lodFor(distance) | 50 / 150 / 400 m | 0 / 1 / 2 (thresholds 80 and 250 m, 10 m hysteresis: a tree at LOD 0 stays 0 until 90 m) |
| AT2 | e2e spa | ready | `sceneStats().treeInstances` = trees in spa.json; `drawCalls()` ≤ 300 |
| AT3 | e2e spa screenshot from the start, band y 200–330 | pixels | ≥ 30 % have G > R and luminance < 0.5, and the band's luminance std dev ≥ 0.04 (textured foliage, not flat cones) |
| AT4 | unit: tree field update with a moving camera | 1000 updates | no allocations per update (instance matrices rewritten in place); LOD counts sum to the tree count |

## Acceptance criteria

- [ ] All AT rows pass; unit tests use synthetic `TreeModels` (no GLB loading in Node).
- [ ] No import of `@dgreenheck/ez-tree` remains in `src/`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Generating or editing GLBs (100), wind, shadows from trees, impostor billboards, tree placement/density, removing the `@dgreenheck/ez-tree` dependency from `package.json`.
