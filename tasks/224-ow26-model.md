# 224 — OW-26 3D model through the car pipeline

Status: pending
Phase: 1
Depends on: 221
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`npm run build:cars` also builds the brand-neutral `ow26` model into `public/models/ow26.{glb,json}` and the car uses it.

## Context

Source glb: `assets/vendor/cars/ow26-src/ow26-source.glb` (textures in `ow26-src/textures/`). Source: "FIA F1 2026 Car" by Abu Saif, CC-BY 4.0, https://sketchfab.com/3d-models/fia-f1-2026-car-d242ab0587ee47c683a904bc38cead93 (276k tris). Same flow as `tasks/112-prototype-models.md` (pipeline `tasks/071-car-pipeline.md`, textures `075`): inspect with `python3 -I scripts/preview/glb_inspect.py <glb> --nodes`, choose `forward`, wheel selection (`wheelMaterials` or the existing `wheelNodes`, do not duplicate) from inspection; never fake geometry. Planner inspection: nose at +z (`forward` must flip it to -Z); wheel nodes `TYRE_{LF,RF,LR,RR}_SUB0/SUB1`, `wheel_{fl,fr,bl,br}`, `hub_caliper_{bl,br}`. De-brand: drop node `decals_layer1`; neutralise (plain colour, no texture) materials `redbull_detail`, `redbull_wheel_hub`, `decal`, `TAG_DRS_ON`, `gp21_LCD`; no output name may contain `redbull`. Output must contain no brand/sponsor text or logos (de-brand as in 112).

## Files

- `assets/cars/ow26.pipeline.json` — create: triBudget 70000, targetLength 5.27 (source is already to scale: bbox 1.972 × 1.174 × 5.268 m, wheelbase ≈ 3.40 m), outputs `public/models/ow26.{glb,json}`.
- `tools/assets/buildCar.ts` — modify ONLY if needed; existing outputs must stay byte-identical.
- `public/models/ow26.{glb,json}` — generated, committed.
- `ASSETS_LICENSES.md` — modify: one row "OW-26 car source (real-regulation shape, dev only; de-brand before release)", Abu Saif, CC-BY 4.0, URL above, NC no (columns as the GT3 rows).
- Planner-authorised test edit: `tests/unit/acceptance/114-prototype-selection.test.ts` AT3 — add the new credit asset name ("OW-26 car source (real-regulation shape, dev only; de-brand before release)" or the exact name `build:credits` produces) to the `CREDITS_BEFORE_114` exclusion list so `added` stays 2. Nothing else in that file.
- `public/cars/ow26.json` — modify: `model.url` → `/models/ow26.glb`; wheel positions/radius from `public/models/ow26.json` (as 072 step 2).

## Steps

1. Write the config from inspection; run `npm run build:cars` (deterministic).
2. Copy wheel x/z and radius from the model json into `ow26.json`; keep every other value (calibration 221 thresholds must still pass).
3. If AT2–AT5 cannot pass, report BLOCKED with evidence (inspect output, measured values).

Conventions: metres; 1 cm tolerance on derived dimensions (071); missing source throws.

## Planner clarification

Config field names and value formats: copy the schema of an existing `assets/cars/*.pipeline.json` (same keys as the prototype configs from 112); only the values differ. `forward` = the value that maps the source nose (+z) to −Z, as accepted by `buildCar.ts` (see how 112 configs encode it). `ow26.json` `wheels.radius` = the model json wheel radius (copy, ± 1e-3), like x/z.

## Planner-authorised edge test edits (decision 224-coder)

- `tests/unit/edge/221-ow26-car.test.ts` EDGE8: expect `model.url` `'/models/ow26.glb'` (rename the test title accordingly).
- `tests/unit/edge/221-ow26-car.post.test.ts` POST5: `wheels.radius` → `toBeCloseTo(<model json radius>, 3)`; wheelbase → `toBeCloseTo(3.4, 1)`. Nothing else in POST5.
- `tests/unit/edge/112-scope-cut.post.test.ts`: add `'ow26'` to `EXPECTED_IDS` (sorted).
- `buildCar.ts` optional fields `dropNodes`, `neutralMaterials`, `wheelTriBudget` and KHRTextureTransform read support are accepted, provided existing outputs stay byte-identical (AT1).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:cars` | outputs | `public/models/ow26.{glb,json}` exist; all other existing model outputs byte-identical to before |
| AT2 | ow26 glb | root nodes | exactly `body` + 4 wheel names; triangles ≤ 70 000 |
| AT3 | ow26 json | read | length (z) = 5.27 ± 0.05; height ≤ 1.2; width incl. wheels 1.97 ± 0.05 |
| AT4 | ow26 glb | strings/bytes | no brand/sponsor text strings (071 AT6 list + "fia", "formula", "ferrari", "mercedes", "mclaren", "redbull", "red bull", "cadillac", "sauber", "audi", "haas") |
| AT5 | `ow26.json` + model json | wheel positions | `ow26.json` wheel x/z match the model json ± 1e-3 |

## Acceptance criteria

- [ ] AT1–AT5 pass; 071, 075, 112 and 221 tests still pass.
- [ ] `ASSETS_LICENSES.md` has the OW-26 row.

## Verification

```
npm run typecheck
npm run lint
npm test

```
(Also run `npm run build:cars` first.)

## Out of scope

`src/`, CarSpec tuning (221), HUD, livery editor, textures beyond what 075 supports, LODs, new pipeline features other than the allowed minimal `buildCar.ts` extension.
