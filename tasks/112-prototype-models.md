# 112 — Prototype models through the car pipeline

Status: pending
Phase: 1
Depends on: 071, 075
Complexity: complex
Type: bugfix
Models: heavy
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

`npm run build:cars` also builds brand-neutral models `lmp2-a` and `hyper-a` into `public/models/<id>.{glb,json}`.

## Context

Pipeline, frame, node names, config type and json shape: `tasks/071-car-pipeline.md` and `tasks/075-car-pipeline-textures.md` (wheel nodes, textures). Sources are CC-BY 4.0, real-brand shapes (except lmp2-a), dev only: output must contain no brand text. Inspect with `python3 -I scripts/preview/glb_inspect.py <glb> --nodes`. Choose `forward`, wheel selection and `liveryMaterials` from inspection; do not guess. Planner inspection (2026-10-13):
- lmp2-a (`assets/vendor/cars/katattak-ka01/katattak_ka01_lmp2_prototype_full.glb`): 233k tris, length on z 4.735 m, many materials; tyre material `material_5_customtiregfgoodtire_inst_9bb5d` (57k tris); decimate to 70k. targetLength 4.745.
- lmp2-b (`ligier-js-px/ligier_js_px.glb`): 137k tris, ONE material, 6 mesh nodes `Object_2..7`: isolate wheels by node or by quadrant geometry. targetLength 4.745.
- hyper-a (`cadillac-v-series-r/2023_-_2026_cadillac_v-series.r_lmdh_hypercar.glb`): 77k tris, exported ~x4 (20.6 m long; targetLength rescales); materials `Tier1Mtl` (tyre), `Rim1Mtl`, `Disc1Mtl`, `Caliper1Mtl`. targetLength 5.10.
- hyper-b (`ferrari-499p/2023_-_2026_ferrari_499p.glb`): 32k tris; no wheel material evident (wheels probably in `Vehicle_Exterior_mm_misc`): wheels by quadrant geometry. targetLength 4.995.

## Files

- `assets/cars/{lmp2-a,hyper-a}.pipeline.json` — create. Scope cut 2026-10-14: `lmp2-b` and `hyper-b` (wheels not separable by material) moved to task 170; delete `assets/cars/hyper-b.pipeline.json`, `public/models/hyper-b.{glb,json}` and every `tools/assets/_tmp_*` / `scripts/preview/_tmp_*` file from the worktree (`triBudget` 70000; outputs `public/models/<id>.{glb,json}`)
- `tools/assets/buildCar.ts` — modify ONLY if needed (allowed contract extension below)
- `public/models/{lmp2-a,hyper-a}.{glb,json}` — generated, committed
- Planner-authorised test edits: in `tests/unit/acceptance/112-prototype-models.test.ts`, `tests/unit/edge/112-prototype-models.test.ts` and `tests/unit/edge/112-prototype-models.post.test.ts` remove the `lmp2-b` and `hyper-b` entries from the id/config lists, and delete the rows that exist only for them (POST2, POST3, POST4, POST8, POST9; POST5/POST6 keep only remaining ids). In the edge test EDGE2 `LICENSE_ROWS` keep only lmp2-a and hyper-a. AT3 height for hyper-a: upper bound 1.45 in the acceptance (and any edge/post) test. Nothing else in those files. Tester files `112-scope-cut.post.test.ts` and `112-in-scope-cli.post.test.ts` stay. Also remove the B rows from `ASSETS_LICENSES.md`.
- `ASSETS_LICENSES.md` — modify: 2 rows (lmp2-a, hyper-a), same columns as the GT3 rows. Asset text: "LMP2 car A source", "LMP2 car B source", "Hypercar A source", "Hypercar B source" + " (real-brand shape, dev only; de-brand before release)" (lmp2-a: " (original design)"). Authors/URLs: mosigana `https://sketchfab.com/3d-models/6044bd804bed4ac4b9f0c782c5c3459b`; Kerdak123 `.../72432f51423d429e93f4981563d76fb8`; supranakamura `.../efe600b0b1694e2aae055f35db3aaeda` (Cadillac) and `.../359b41f7c14941c8bceafbc3ac98c537` (Ferrari); license CC-BY 4.0; NC no.

## Steps

1. Write the four configs. Wheel selection by `wheelMaterials` when the tyre/rim material is distinguishable; otherwise rely on quadrant assignment of the whole primitive set (071 step 2).
2. Allowed contract extension: if a model's wheels cannot be isolated by material, extend `CarPipelineConfig` with an optional `wheelNodes?: string[]` (node-name selection, as in 075 if it already exists; reuse it, do not duplicate). Existing configs and their outputs must stay byte-identical.
3. `npm run build:cars` must build all existing and new cars; output deterministic.
4. If a model still cannot pass AT2–AT5 after these options, report it BLOCKED with evidence (inspect output, measured values). Never fake geometry (no synthetic wheels, no box bodies).

Conventions: metres; tolerance as in 071 (1 cm derived dimensions); unknown id or missing source throws.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:cars` | outputs | `public/models/{lmp2-a,hyper-a}.{glb,json}` exist; existing f4/gt3 outputs byte-identical to before |
| AT2 | each new glb | root nodes | exactly `body` + 4 wheel names; triangles ≤ 70 000 |
| AT3 | each new json | read | length (z) = targetLength ± 0.05 (lmp2-a 4.745, hyper-a 5.10); width incl. wheels in [1.85, 2.15]; height in [0.95, 1.25] (hyper-a: [0.95, 1.45], roof antenna remnant accepted); wheelbase in [2.85, 3.30]; wheelRadius in [0.32, 0.38] |
| AT4 | each new glb | wheel hubs | front z < 0, left x < 0; each wheel node's geometry bbox centred on its pivot ± 0.02; left/right hub \|x\| equal ± 0.02; each wheel holds ≤ 40 % of all wheel vertices |
| AT5 | each output | vertices / bytes | min y ≥ −0.02; no brand strings (071 AT6 list + ligier, cadillac, ferrari, oreca, katattak) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 053, 071, 075 tests still pass.
- [ ] `ASSETS_LICENSES.md` has the 2 rows (lmp2-a, hyper-a).

## Verification

```
npm run build:cars
npm run typecheck
npm run lint
npm test
```

## Out of scope

`src/`, CarSpecs (113), selection/credits UI (114), textures beyond what 075 supports, LODs, livery editor, de-branding textures.
