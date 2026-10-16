# 211 — Fontana Sports Car Course (oval + infield layout)

Status: pending
Phase: 1
Depends on: 174
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

A new track `fontana-roval` ("Fontana Sports Car Course", 2.880 mi / 4.635 km, counter-clockwise) that uses the banked oval front stretch and turns 1-2 plus the infield, selectable right after Fontana. The existing `fontana` becomes "Fontana Interior" with unchanged geometry.

## Context

Layout route: `docs/research/tracks/fontana-layouts.md` section 2 (authority; read it fully). Source data: `assets/source/osm/fontana-2022.json` (Overpass snapshot 2022-06-01, names stripped; oval demolished 2023). Oval ways: 7002869, 355478205, 355478193 (closed loop ~3.23 km). Infield road-course ways: the other `highway=raceway` ways inside the oval. Layout reference only (not shipped): Commons SVG `Auto_Club_Speedway_(formerly_California_Speedway)_-_Sports_Car.svg` (CC BY-SA 3.0, Will Pittenger). Banking mechanism: task 174 (`banking` ranges in `tools/track-builder/tracks.json`, `BankRange`, raisedSide relative to driving direction; ramps as in 174). Follow the pattern of task 168 for registration. Reuse `assets/source/dem/fontana.json`, environment `'desert'`, biome, HDRI/fog and ground texture of `fontana` (the ground texture file path is per id: copy/alias only if the code requires `textures/ground/<id>.jpg`; check how 168 resolved it).

## Files

- `assets/source/tracks/us-fontana-roval.geojson` — create — single LineString: oval ways joined/trimmed and infield ways joined following the route (start line on the oval front stretch heading east, oval T1-T2, leave the oval at the T2 exit into the infield, infield loop, rejoin the front stretch at the T4 exit). Snapped to OSM ways. Direction counter-clockwise.
- `tools/track-builder/tracks.json` — modify — new entry `fontana-roval` (copy of `fontana` fields: dem, maxGrade, widthMeters, environment, biome; `geojson: "us-fontana-roval"`, same `source`, `country: "United States"`, name "Fontana Sports Car Course", own `grandstands` along the front stretch, `pit` on the oval pit road beside the front stretch, `banking` below); rename `fontana` name to "Fontana Interior" (nothing else in that entry).
- `public/tracks/fontana-roval.json` (+ any `-env`/`.style` companions the builder emits), `public/tracks/index.json` — create/modify via `npm run build:tracks -- fontana-roval` and `npm run build:track-index`; index entry name for `fontana` becomes "Fontana Interior"; no other existing entry may change, `public/tracks/fontana.json` stays byte-identical (do NOT rebuild it).
- `src/ui/menu.ts` — modify — `TRACK_CHOICES`: rename `fontana` to 'Fontana Interior'; insert `{ id: 'fontana-roval', name: 'Fontana Sports Car Course' }` right after it. Add the id to any other per-id table that `fontana` appears in (e.g. `ENV_TABLE`/`FOG_TABLE` in `src/render/environment.ts`, `tools/dem/fetchDem.ts` `TRACKS` with `source: 'us-fontana-roval'` only if the DEM tool requires it) copying fontana's values.
- `ASSETS_LICENSES.md` — modify — extend the Fontana OSM row to include `fontana-2022.json` and `us-fontana-roval.geojson` (ODbL 1.0); add a row crediting the Commons SVG (CC BY-SA 3.0, Will Pittenger, layout reference only, not shipped). Credits list in the game: add the same credit only if a credits list already exists.
- Tests: `tests/unit/acceptance/211-fontana-sports-car-course.test.ts`, `tests/e2e/acceptance/211-fontana-sports-car-course.spec.ts`.

## Steps

1. Build the geojson from the OSM data, guided by the route and the SVG; closed centerline length 4500-4770 m; roughly 18 turns; part oval, part infield.
2. Banking ranges (meters from centerline index 0, all `raisedSide: 'right'`, since the circuit is counter-clockwise the turn outside is the right): oval turns 1-2 at 14 deg; oval front stretch including the start line at 11 deg; everything off the oval 0 (unlisted). Derive `fromMeters`/`toMeters` from the built centerline; every non-zero-bank index must lie within 25 m of an oval way.
3. Start line on the oval front stretch (index 0 on it, heading east); pits on the oval pit road, `pit` range covering the front stretch.
4. Register the track in the menu, index and per-id tables as listed in Files; `fontana` geometry and file unchanged.

Conventions: distances in meters, bank in radians in the JSON (degrees only in the registry); bounds inclusive (`<=`); invalid/missing OSM way id -> the geojson build script (if any) throws; no existing file other than those listed is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: `public/tracks/fontana-roval.json` | parse with `parseTrackData`, closed centerline length | in [4500, 4770] m |
| AT2 | unit: `public/tracks/index.json` | read | has `fontana-roval` with name "Fontana Sports Car Course", country "United States", right after `fontana`; `fontana` entry name "Fontana Interior"; 19 entries |
| AT3 | unit: `public/tracks/fontana.json` | read centerline | point count and the first, middle and last points equal the values hard-coded from master when the test is written (±1e-9) |
| AT4 | unit: fontana-roval centerline projected with the track's own origin, OSM oval ways 7002869, 355478205, 355478193 from `assets/source/osm/fontana-2022.json` projected the same way | for every index with \|bank\| > 0.5° | distance to the nearest oval way segment ≤ 25 m |
| AT5 | unit: fontana-roval `bank` | max \|bank\| | in [13°, 15°]; \|bank[0]\| in [10°, 12°] (start line on the front stretch) |
| AT6 | unit: fontana-roval centerline | fraction of indices within 25 m of an oval way | in [0.25, 0.55] (part oval, part infield) |
| AT7 | unit: fontana-roval centerline, signed area (x,z top view, the project's convention) | compute | sign matches counter-clockwise driving as defined by the existing `daytona.json` convention (compare signs with daytona, which is also counter-clockwise) |
| AT8 | e2e `/?track=fontana-roval`, wait `window.__SIMGAME__?.ready === true` (60 s) | read | ready, no console errors, `surfaceUnderCar` is 'asphalt' at spawn |

AT3 clarification: do not use git. The acceptance worker reads `public/tracks/fontana.json` on master when writing the test and hard-codes literally in the test the centerline point count and the first, middle (index floor(n/2)) and last centerline points; the test compares against them.

## Planner-authorised test edits

- `tests/e2e/acceptance/171-track-select-redesign.spec.ts`: card count 18 -> 19 (`toHaveCount` and test title). `tests/unit/acceptance/171-*.test.ts` AT2 "18 entries" -> 19.
- Any other test that hard-codes the number of tracks (grep for 18 in tests touching `index.json`/`TRACK_CHOICES`): count +1 only.
- Tests asserting the `fontana` display name ("Fontana Inner"/"Fontana"): change to "Fontana Interior" only. Nothing else.

## Existing tests that must still pass

168, 171, 174 acceptance; 176 track-geometry audit.

## Acceptance criteria

- [ ] AT1-AT8 pass; all other tests pass.
- [ ] `public/tracks/fontana.json` byte-identical; only `index.json` entry names/new entry differ in other tracks' data.
- [ ] `ASSETS_LICENSES.md` lists `fontana-2022.json`, `us-fontana-roval.geojson` and the Commons SVG credit.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 211-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Changing `fontana` geometry, the oval-only layout, the Motorcycle course, Exotics course, T3-T4 / back stretch, new ground textures, OSM area data, city bake/landmarks, new trees, credits screen creation.
