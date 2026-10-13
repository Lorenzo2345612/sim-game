# Phase 1.6 — Car roster: contracts and acceptance tables (planner)

Source models (CC-BY 4.0, dev-only brand shapes): `assets/vendor/cars/{mclaren-720s-gt3,porsche-911-gt3-rsr,audi-r8-gt3-lowpoly}/*.glb`. Inspect with `python3 -I scripts/preview/glb_inspect.py <glb> --nodes`; preview `scripts/preview/glb.html?url=…&v=top|front34`. Game ids and display names are brand-neutral from the start: `gt3-a` "GT3 A" (McLaren source), `gt3-b` "GT3 B" (Porsche source), `gt3-c` "GT3 C" (Audi low-poly source). GT3 dynamics: `ai/lab/gt3-carspec.json` (passes the lab).

Planner facts per source (verified 2026-10-12):
- gt3-a: 17 primitives, no textures, coordinates far from origin, node matrix converts Z-up; nose −X; target length 4.64 m. Wheels: primitives with materials matching `wheelslodatyre`, `wheelslodawheelrear`, `wheelslodarotor` — all four wheels inside each primitive (split by quadrant).
- gt3-b: 25 primitives, no textures; nose +Z; target length 4.60 m. Wheels: four separate primitives with material `Meshesrim191Mtl` (rim + tyre). Huge rear wing is part of the body.
- gt3-c: 11 meshes, no textures, near metric already; nose +Z; target length 4.58 m. Wheels: meshes `WHEELS_*` (rubber, rims, paint, silver) — all four wheels inside each (split by quadrant).

## 071 — Generic car asset pipeline (complex, Models: heavy; deps 053)
`tools/assets/buildCar.ts <id>` driven by `assets/cars/<id>.pipeline.json`: `{ source, forward: '+x'|'-x'|'+z'|'-z', targetLength, wheelMaterials: string[] (substring match), liveryMaterials: string[], triBudget, outGlb, outJson }`. Output frame and nodes exactly as task 053 (`body` + `WHEEL_NODE_NAMES`, origin on the ground below the axle midpoint, −Z forward, Y up, metres), plus `f4.json`-shaped metadata. Wheel vertices are assigned to wheels by quadrant (sign of x, sign of z relative to the axle midpoint). Materials: livery ones merge into `livery`, wheel ones into `tyre`/`rim` by name (`tyre|rubber` → tyre, else rim), the rest keep their colour but get neutral names `body_<n>`. All names and `asset.extras` stripped of source titles. `buildF4.ts` becomes a thin wrapper of the same code with `assets/cars/f4.pipeline.json`; npm script `build:cars` builds all configs.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:cars` | f4 output | node names, triangle count ±1 %, `f4.json` values ±0.005 equal to the outputs committed by task 053 |
| AT2 | gt3-a, gt3-b, gt3-c outputs | root nodes | exactly `body` + 4 wheel names; triangles ≤ `triBudget` (gt3-a 60 000, gt3-b 70 000, gt3-c 25 000) |
| AT3 | each output json | read | length (z) = targetLength ± 0.05; width (x) in [1.85, 2.15]; height in [1.05, 1.35]; wheelbase in [2.55, 2.85]; wheelRadius in [0.30, 0.37] |
| AT4 | each output | wheel hubs | front wheels z < 0, left wheels x < 0; each wheel node's geometry bbox centred on its pivot ± 0.02 m; |x| of left and right hubs equal ± 0.02 |
| AT5 | each output | all vertices | min y ≥ −0.02 (ground at 0) |
| AT6 | each output glb + json bytes | case-insensitive search | none of: mclaren, porsche, porche, audi, tatuus, lamborghini |
| AT7 | each wheel | vertex count | > 0 and no wheel holds more than 40 % of all wheel vertices (quadrant split worked) |
| AT8 | run twice | outputs | byte-identical |

## 072 — GT3 car definitions (simple; deps 058, 071)
`public/cars/gt3-a.json`, `gt3-b.json`, `gt3-c.json`: dynamics from `ai/lab/gt3-carspec.json` (identical for the three), geometry from each `public/models/<id>.json` (wheel hub x/z, wheelRadius; hub y = wheelRadius − cgHeight), `model.url`, `category 'gt3'`, display names "GT3 A/B/C". 
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | each file | `parseCarSpec` | ok; mass 1300; category 'gt3'; name matches /^GT3 [ABC]$/ |
| AT2 | each file vs its model json | wheel positions | x, z equal ± 1e-3; y = wheelRadius − cgHeight ± 1e-3 |
| AT3 | each file vs `ai/lab/gt3-carspec.json` | engine, gearbox, aero, tyres, brakes, aids, fuel | deep-equal |
| AT4 | repo | grep public/cars, src | no brand names (same list as 071 AT6) |

## 073 — Car registry and selection (simple; deps 070, 044, 072)
`public/cars/index.json` `[{id, name, category}]` (f4, gt3-a, gt3-b, gt3-c); start menu gets a car picker next to the track picker; choice persisted (`simgame.car`); game loads the chosen `CarSpec` and model; `__SIMGAME__.carId()`.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e: start menu | open | car picker lists 4 cars in index order; default f4 |
| AT2 | e2e: pick GT3 B, Monza, start | ready | `carId()` = 'gt3-b'; no console errors; 3 s throttle → speed > 30 km/h |
| AT3 | e2e: reload | menu | GT3 B preselected |
| AT4 | e2e: `?car=gt3-c&track=spa` | ready | `carId()` 'gt3-c'; `|carPosition().y − trackHeightUnderCar()| < 0.8` after 3 s throttle |

## 074 — Credits screen (simple; deps 044)
`npm run build:credits` generates `public/credits.json` from the CC-BY/attribution rows of `ASSETS_LICENSES.md` (asset, author, license, url); menu "Credits" panel lists them. Brand-bearing source titles are shown as the asset description column, not the source title.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: current `ASSETS_LICENSES.md` | build credits | one entry per CC-BY row (≥ 4: F4 + three GT3), each with author, license, url |
| AT2 | unit: CC0 rows | build | excluded |
| AT3 | e2e: menu → Credits | open | every entry's author and url visible; Esc closes |

## Source gt3-d (Mustang, added 2026-10-12)
`assets/vendor/cars/mustang-gt3/ford_mustang_gt3.glb`: CC-BY 4.0 (uploader's claim; author MattDoesBlender, possibly sim-extracted: verify or replace before any public release). 375k tris, 85 meshes, 39 materials named `mat_<n>` (no wheel names), 44 PNG textures with brand logos baked in (de-brand textures before release). Nose +Z; length ≈ 4.8 m (target 4.79). Wheels by node name (suffix after `.nr_`): tyres `25, 26, 28, 29`, rims `68, 69, 70, 71`, discs `5, 6, 7, 8`.

## 075 — Pipeline: textures and wheel nodes; build gt3-d (complex, Models: heavy; deps 071)
Extend `buildCar.ts` config with `wheelNodes?: string[]` (node-name substrings, alternative to `wheelMaterials`) and `maxTextureSize` (default 1024: resize with `@gltf-transform/functions` `textureCompress` + `sharp` — add `sharp` as an exact-version devDependency — to WebP), then add `assets/cars/gt3-d.pipeline.json` (triBudget 90 000, maxTextureSize 1024).
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | gt3-d output | nodes, tris | `body` + 4 wheels; tris ≤ 90 000 |
| AT2 | gt3-d output | textures | every image ≤ 1024 px on each side; glb ≤ 12 MB |
| AT3 | gt3-d json | dimensions | length 4.79 ± 0.08; width [1.9, 2.15]; wheelbase [2.6, 2.95]; wheelRadius [0.30, 0.37]; front wheels z < 0, left x < 0; min y ≥ −0.02 |
| AT4 | gt3-d glb + json | names, extras | no "ford", "mustang" in names/strings (textures excluded: known) |
| AT5 | gt3-a/b/c and f4 outputs | rebuild | unchanged (071 ATs still pass) |

## 076 — GT3 D definition (simple; deps 072, 075)
`public/cars/gt3-d.json` like 072 (GT3 dynamics, geometry from `public/models/gt3-d.json`, name "GT3 D"), and add it to `public/cars/index.json` if task 073 created it.
| ID | Given | When | Then |
|---|---|---|---|
| AT1 | gt3-d.json | parseCarSpec | ok; category 'gt3'; name 'GT3 D' |
| AT2 | vs model json | wheel positions | x, z ± 1e-3; y = wheelRadius − cgHeight |
| AT3 | vs gt3-a.json | dynamics sections | deep-equal |
