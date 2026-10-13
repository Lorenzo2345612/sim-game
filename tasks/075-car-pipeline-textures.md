# 075 — Car pipeline: textures and wheel nodes; build gt3-d

Status: pending
Phase: 1
Depends on: 071
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`buildCar.ts` supports textured sources and wheels identified by node name, and builds the brand-neutral model `gt3-d`.

## Context

Extends `tools/assets/buildCar.ts` and `CarPipelineConfig` from `tasks/071-car-pipeline.md` (output format, frame, nodes, `f4.json` shape unchanged). Source `assets/vendor/cars/mustang-gt3/ford_mustang_gt3.glb`: CC-BY 4.0 (uploader's claim; author MattDoesBlender, possibly sim-extracted: verify or replace before any public release). 375k tris, 85 meshes, 39 materials named `mat_<n>` (no wheel names), 44 PNG textures with brand logos baked in (de-brand before release; known limitation). Nose +Z; length ≈ 4.8 m (targetLength 4.79). Wheels are identified by node name (suffix after `.nr_`): tyres `25, 26, 28, 29`, rims `68, 69, 70, 71`, discs `5, 6, 7, 8`. Inspect with `python3 -I scripts/preview/glb_inspect.py <glb> --nodes`. Do not modify `src/`.

## Files

- `tools/assets/buildCar.ts` — modify
- `assets/cars/gt3-d.pipeline.json` — create (triBudget 90000, maxTextureSize 1024)
- `package.json` — modify: exact-version devDependency `sharp`
- `public/models/gt3-d.{glb,json}` — generated and committed
- `ASSETS_LICENSES.md` — already has the row for this source; do not edit

## Steps

1. Config additions: `wheelNodes?: string[]` (node-name substrings, case-sensitive; nodes whose name contains `.nr_<suffix>` of any listed entry) and `maxTextureSize?: number` (default 1024). `wheelMaterials` becomes optional; at least one of the two must be given, else throw. Wheel nodes: names containing `tyre`-listed suffixes (tyres) go to `tyre`, the others to `rim`; the config lists entries as `"tyre:25"` / `"rim:68"` / `"rim:5"` (prefix selects the material class).
2. Wheel quadrant assignment, ground, scale, nose rotation and derived json exactly as 071.
3. Textures: resize every texture to ≤ `maxTextureSize` per side and encode WebP using `@gltf-transform/functions` `textureCompress` with `sharp` (a standard encoder). Materials not wheel/livery keep their textures and are renamed `body_<n>`; livery merge applies only to materials in `liveryMaterials` (gt3-d: none, keeps original textures).
4. Strip source titles, author and brand strings from node, material, texture and image names and from `asset.extras`; rename textures `tex_<n>`.
5. Simplify to ≤ `triBudget`; output deterministic (byte-identical on rerun).
6. `gt3-d.pipeline.json`: source above, forward `+z`, targetLength 4.79, wheelNodes as listed, liveryMaterials `[]`, triBudget 90000, maxTextureSize 1024, outputs `public/models/gt3-d.{glb,json}`.

Conventions: metres; tolerance 1 cm for derived dimensions; missing source/unknown id throws; image sizes never upscaled.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | gt3-d output | nodes, tris | `body` + 4 wheels; tris ≤ 90 000 |
| AT2 | gt3-d output | textures | every image ≤ 1024 px on each side; glb ≤ 12 MB |
| AT3 | gt3-d json | dimensions | length 4.79 ± 0.08; width [1.9, 2.15]; wheelbase [2.6, 2.95]; wheelRadius [0.30, 0.37]; front wheels z < 0, left x < 0; min y ≥ −0.02 |
| AT4 | gt3-d glb + json | names, extras | no "ford", "mustang" in names/strings (textures excluded: known) |
| AT5 | gt3-a/b/c and f4 outputs | rebuild | unchanged (071 ATs still pass) |

## Acceptance criteria

- [ ] AT1–AT5 pass; existing tests (incl. 053, 071) still pass.
- [ ] `npm run build:cars` builds all five cars.

## Verification

```
npm run build:cars
npm run typecheck
npm run lint
npm test
```

## Out of scope

Changes in `src/`, car definitions (076), removing logos from textures, LODs, livery editor, edits to 071 outputs.
