# 100 — Bake realistic tree LODs with EZ-Tree (offline tool)

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`npm run build:trees` writes 12 textured tree GLBs (3 species × 4 variants), each with three LOD nodes, to `public/models/trees/`.

## Context

M1.2c (`docs/plans/m1.2c-realism.md`). Offline tool, same style as `tools/assets/buildCar.ts` (run with `tsx`). The runtime (task 101) loads these GLBs; this task does not touch `src/`. Generation uses the already installed `@dgreenheck/ez-tree` 1.1.0 (MIT; do not add another package). ez-tree loads its textures at module scope via `TextureLoader` and needs a DOM: the tool must provide minimal Node stubs (`document`, `Image`, `FileReader`, `Blob` as needed by ez-tree and `GLTFExporter`) and must never fetch the network. Textures already exist in `public/textures/{foliage/leaf-oak,foliage/leaf-pine,bark/plane,bark/pine}/`.

## Files

- `tools/assets/buildTrees.ts` — create — generation, LOD reduction, export, GLB post-process.
- `package.json` — modify — add script `"build:trees": "tsx tools/assets/buildTrees.ts"` only.
- `tests/unit/acceptance/100-tree-bake.test.ts` — create (acceptance worker). Reads the GLBs with `@gltf-transform/core` `NodeIO`; if the files are missing it runs the tool first.

## Steps

```ts
export type BakedSpecies = 'oak' | 'plane' | 'pine';
export const SPECIES: Record<BakedSpecies, { preset: string; leaf: 'leaf-oak' | 'leaf-pine'; bark: 'plane' | 'pine' }>;
export function buildAll(outDir: string): Promise<string[]>; // returns written file paths
```

1. Species: `oak` = preset `Oak Medium` (leaf-oak, bark plane); `plane` = `Ash Medium` (leaf-oak, bark plane); `pine` = `Pine Large` (leaf-pine, bark pine). Variants 0..3 use ez-tree seeds 11, 12, 13, 14. Files `<species>-<variant>.glb`.
2. Each GLB scene has three top-level nodes named exactly `lod0`, `lod1`, `lod2`, each holding a bark mesh and a leaf mesh (lod2: one mesh, leaf material only). Trunk base at y = 0, tree upright, units metres.
3. lod0 = ez-tree output with `leaves.count` reduced (halved repeatedly) until triangles ≤ 6000. lod1 = same tree with branch `sections`/`segments` and leaf count reduced until triangles ≤ 1500. lod2 = two crossed vertical quads (4 triangles) whose bounding box equals lod0's within 10 % (width, depth, height), textured with the leaf material.
4. Materials (exported by `GLTFExporter` with `binary: true`, then patched with `@gltf-transform/core`): bark = `MeshStandardMaterial` with color + normal + roughness maps; leaf = color + normal maps, opacity map as alpha, `alphaMode` MASK with `alphaCutoff` 0.5, `doubleSided`. Texture images are referenced by relative URI (`../../textures/<dir>/<file>.jpg`), not embedded. No untextured material.
5. Height (lod0 bbox): pine variants 18–30 m, oak and plane 12–22 m; if ez-tree output is outside, uniformly scale all three LODs to the middle of the range (pine 24 m, oak/plane 17 m).
6. Deterministic: no timestamps, no random without seed, fixed `asset.generator` string; two runs give byte-identical files.
7. `npm run build:trees` also overwrites existing files without prompting; it creates `public/models/trees/` if missing. Add a row to `ASSETS_LICENSES.md` for the generated models (generated with EZ-Tree, MIT; textures per their own rows).

Conventions: triangle count = index count / 3 summed over the node's meshes; limits inclusive (`≤`); bbox tolerance 10 % per axis relative to lod0; non-finite generation output throws.

## Acceptance tests (defined by the planner with Opus, before coding)

Executable contract. The `acceptance` worker turns each row into `tests/unit/acceptance/100-tree-bake.test.ts` before the coder starts. Nobody else may change these rows or tests.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:trees` | outputs | `public/models/trees/{oak,plane,pine}-{0..3}.glb` (3 species × 4 variants) |
| AT2 | each glb | inspect | nodes `lod0`, `lod1`, `lod2`; triangles lod0 ≤ 6000, lod1 ≤ 1500, lod2 ≤ 64 (crossed quads); lod2 bounding box within 10 % of lod0's |
| AT3 | each glb | materials | bark material with color+normal maps; leaf material with color map, `alphaTest` 0.5, double-sided; no untextured material |
| AT4 | pine variants vs oak variants | heights | pine 18–30 m, oak/plane 12–22 m |
| AT5 | run twice | outputs | byte-identical (seeded) |

## Acceptance criteria

- [ ] All AT rows pass.
- [ ] `npm run build:trees` exits 0 and offline; GLBs committed under `public/models/trees/`.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass.

## Verification

```
npm run build:trees
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Any change in `src/` (runtime loading and LOD switching is 101), new npm dependencies, texture files, billboard impostor atlases, wind animation, tree placement.
