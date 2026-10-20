# 319 — Surrounding buildings for every circuit

Status: pending
Phase: 2
Depends on: 317
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Every circuit except the ermita layouts has a baked `<id>-env.json` with buildings along the whole lap.

## Context

Only baku, singapore, lasvegas and the ermita layouts have `-env.json`; other circuits show only the pit building, grandstands and props near the start. `bakeCity` (`tools/env/bakeCity.ts`, task 157, corridor from 317) fetches Overpass when `assets/source/osm/<id>-city.json` is missing and caches it there. Network is allowed for this task (data only, never executed). `src/main.ts` (~line 1151) already loads `/tracks/<id>-env.json` when it exists; `createCityObject` (`src/render/cityRenderer.ts`) merges per material, so the renderer needs no change. Track ids come from `tools/track-builder/tracks.json`.

## Files

- `tools/env/osmBuildings.ts` — modify: `CityEnvParams.maxBuildings`.
- `tools/env/bakeCity.ts` — modify: accept the optional cap; CLI flag `--max=N`.
- `public/tracks/<id>-env.json`, `assets/source/osm/<id>-city.json` — generate for every id in `public/tracks/` without an env file, excluding `ermita-*`; commit.
- `ASSETS_LICENSES.md` — modify: add the new cache files to the existing OpenStreetMap ODbL row for city extracts.
- `tests/unit/acceptance/319-city-env-all-circuits.test.ts`, `tests/e2e/acceptance/319-city-env-all-circuits.spec.ts` — create (acceptance worker).

## Steps

```ts
// CityEnvParams (osmBuildings.ts) gains:
maxBuildings?: number; // default undefined = unlimited
```
1. With `maxBuildings` set, `buildCityEnv` keeps the N buildings with the smallest minimum ring-vertex distance to the centerline; ties keep the existing output order; the kept buildings stay in the existing sort order. Unset → output identical to 317.
2. Bake every missing track with `npm run build:env -- <ids> --max=1500`. Do not rebake baku, singapore, lasvegas, ermita-*.
3. Add the new `assets/source/osm/<id>-city.json` paths to the ODbL row.

Conventions: cap inclusive (`≤ 1500`); `maxBuildings ≤ 0` throws; ring-vertex distance in metres to the nearest centerline segment; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then (expected, tolerance) |
|---|---|---|---|
| AT1 | every track JSON in `public/tracks/` (skip `*.style.json`, `*-env.json`, index) | check files | `<id>-env.json` exists for each |
| AT2 | every env baked in this task | load | `buildings.length ≤ 1500`; every ring edge ≥ the 317 local corridor (−1e-6) |
| AT3 | monza and mexico envs | count buildings with centroid < 300 m of the centerline | ≥ 100 each |
| AT4 | e2e `/?track=mexico` | 5 s after load | no console errors; `sceneStats().buildings` (the hook used by task 158's e2e) reports > 0 |
| AT5 | baku, singapore, lasvegas env files | compare with the 317 output | byte-identical (cap not applied) |

## Acceptance criteria

- [ ] AT1–AT5 pass; 157 and 317 tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 319-
```

## Out of scope

Ermita village, trees, new building styles, LOD changes, renderer changes.
