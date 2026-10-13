# 071 — Generic car asset pipeline

Status: pending
Phase: 1
Depends on: 053
Complexity: complex
Type: feature
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`npm run build:cars` builds every car in `assets/cars/*.pipeline.json` into `public/models/<id>.glb` + `<id>.json`, generalising task 053 (f4 included) and producing brand-neutral GT3 models `gt3-a`, `gt3-b`, `gt3-c`.

## Context

Output format, node names (`body` + `WHEEL_NODE_NAMES`), frame (origin on the ground below the axle midpoint, −Z forward, Y up, metres) and `f4.json` shape are exactly those of `tasks/053-f4-car.md`. Libraries already installed (see 053). Sources are CC-BY 4.0 (`ASSETS_LICENSES.md`), real-brand shapes, dev only: the output must contain no brand text. Do not modify `src/`.
Planner facts per source (verified 2026-10-12), inspect with `python3 -I scripts/preview/glb_inspect.py <glb> --nodes`:
- gt3-a (`assets/vendor/cars/mclaren-720s-gt3/*.glb`): 17 primitives, no textures, coordinates far from origin, node matrix converts Z-up; nose −X; targetLength 4.64. Wheel materials `wheelslodatyre`, `wheelslodawheelrear`, `wheelslodarotor`: all four wheels inside each primitive.
- gt3-b (`porsche-911-gt3-rsr/*.glb`): 25 primitives, no textures; nose +Z; targetLength 4.60. Wheels: four separate primitives with material `Meshesrim191Mtl` (rim + tyre). Huge rear wing is part of the body.
- gt3-c (`audi-r8-gt3-lowpoly/*.glb`): 11 meshes, no textures, near metric; nose +Z; targetLength 4.58. Wheels: meshes `WHEELS_*` (rubber, rims, paint, silver), all four wheels inside each.

## Files

- `tools/assets/buildCar.ts` — create: `buildCar(id: string): Promise<void>` and CLI `tsx tools/assets/buildCar.ts <id>`
- `tools/assets/buildF4.ts` — modify: thin wrapper calling `buildCar('f4')`
- `assets/cars/{f4,gt3-a,gt3-b,gt3-c}.pipeline.json` — create; `package.json` — script `build:cars` (builds all configs)
- `public/models/{gt3-a,gt3-b,gt3-c}.{glb,json}` — generated and committed

## Steps

1. Config type: `interface CarPipelineConfig { source: string; forward: '+x'|'-x'|'+z'|'-z'; targetLength: number; wheelMaterials: string[]; liveryMaterials: string[]; triBudget: number; outGlb: string; outJson: string }`. `wheelMaterials` match by case-insensitive substring. f4 config reproduces 053 (scale 1.47, its splitting by x sign); other cars: apply node transforms, rotate so the nose is −Z, uniform scale to `targetLength`, ground at min wheel y.
2. Wheel assignment by vertex quadrant (sign of x, sign of z relative to the axle midpoint); each wheel node's pivot = hub (bbox centre of its tyre vertices), geometry relative to the pivot. Primitives that are already a single wheel are still assigned by quadrant.
3. Materials: `liveryMaterials` merge into `livery` (default base colour #c8102e); wheel materials into `tyre` (name contains `tyre|rubber`) else `rim`; the rest keep colour, renamed `body_<n>`. Strip `asset.extras` and every source title/author-brand string.
4. Simplify (`weld`, `simplify`, `dedup`, `prune`) to ≤ `triBudget`; tyres stay round.
5. `<id>.json` = `f4.json` shape (see 053 step 6). Deterministic: same input, byte-identical output.

Conventions: metres; tolerance 1 cm for derived dimensions; unknown config id or missing source throws.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:cars` | f4 output | node names, triangle count ±1 %, `f4.json` values ±0.005 equal to the outputs committed by task 053 |
| AT2 | gt3-a, gt3-b, gt3-c outputs | root nodes | exactly `body` + 4 wheel names; triangles ≤ `triBudget` (gt3-a 60 000, gt3-b 70 000, gt3-c 25 000) |
| AT3 | each output json | read | length (z) = targetLength ± 0.05; width (x, whole model incl. wheels) in [1.85, 2.35]; height in [1.05, 1.35]; wheelbase in [2.40, 2.90]; wheelRadius in [0.30, 0.37] |
| AT4 | each output | wheel hubs | front wheels z < 0, left wheels x < 0; each wheel node's geometry bbox centred on its pivot ± 0.02 m; \|x\| of left and right hubs equal ± 0.02 |
| AT5 | each output | all vertices | min y ≥ −0.02 (ground at 0) |
| AT6 | each output glb + json bytes | case-insensitive search | none of: mclaren, porsche, porche, audi, tatuus, lamborghini |
| AT7 | each wheel | vertex count | > 0 and no wheel holds more than 40 % of all wheel vertices (quadrant split worked) |
| AT8 | run twice | outputs | byte-identical |

## Acceptance criteria

- [ ] AT1–AT8 pass; existing tests (incl. 053) still pass.

## Verification

```
npm run build:cars
npm run typecheck
npm run lint
npm test
```

## Out of scope

Any change in `src/`, car definitions (072), selection UI (073), credits (074), textures, LODs, livery editor.
