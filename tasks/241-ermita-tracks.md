# 241 — Register the six Ermita de Guadalupe street layouts

Status: pending
Phase: 1
Depends on: nothing
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, tester-pre, coder, tester, reviewer

## Goal

Six fictional street layouts of one venue (Ermita de Guadalupe, Jerez, Zacatecas) become selectable and playable: `ermita-centro`, `ermita-federal`, `ermita-norte`, `ermita-mixto`, `ermita-poniente`, `ermita-veloz`, built from the existing geojsons, with their own satellite ground texture.

## Context

Design: `docs/design/ermita.md` section 241. Numbers per layout (pit, grandstands) and venue facts: `docs/research/tracks/mx-ermita.md` (authority, being updated: read it when you start; do NOT copy its numbers into this spec). Registration pattern: tasks 168 and 211 (211 is the model). All data exists: `assets/source/tracks/mx-ermita-<name>.geojson`, `assets/source/osm/ermita-<name>{,-areas}.json`, `assets/source/dem/ermita.json` (shared), `assets/source/ground/ermita-s2.{jpg,json}` (shared Sentinel-2 scene; the sidecar `bounds` are an equirectangular lon/lat grid, top = north). You must NOT modify any geojson or file under `assets/`. Existing tracks are not rebuilt.

## Files

- `tools/track-builder/tracks.json` — modify — append 6 entries in this order, after `detroit`: ids/names `ermita-centro` "Ermita Centro", `ermita-federal` "Ermita Federal", `ermita-norte` "Ermita Norte", `ermita-mixto` "Ermita Mixto", `ermita-poniente` "Ermita Poniente", `ermita-veloz` "Ermita Veloz". Common fields: `country: "Mexico"`, `geojson: "mx-ermita-<name>"` (e.g. `mx-ermita-centro`), `source: { dataset: 'OpenStreetMap', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' }`, `dem: "assets/source/dem/ermita.json"`, `maxGrade: 0.03`, `widthMeters: 12`, `environment: "desert"`, `reverse: false`, no `banking`, biome `{ species: [shrub-dry 0.6, palm-date 0.3, cactus 0.1], density: 0.04 }`. `pit` and `grandstands` per layout: read the table of `mx-ermita.md` (pit column: side, from..to meters; grandstands column: signed `atMeters` and side; `offsetMeters` 30, `lengthMeters` 70, `rows` 10, `roof` false for every stand unless the doc states other values).
- `tools/ground/cropGround.ts` — create — CLI `tsx tools/ground/cropGround.ts <trackId>...` (add npm script `"build:ground": "tsx tools/ground/cropGround.ts"` in `package.json`, modify). For each id, reads `public/tracks/<id>.json` `terrain` (originX/Z, sizeX/Z) and the tracks.json geojson of the id; the local frame origin is `bboxCenter` of the geojson coordinates (as `buildTrack.ts`); writes `public/textures/ground/<id>.jpg`, 2048 × 2048, q85, using `sharp` (already a devDependency). Each output pixel (u, v) centre maps to local (x, z) = (originX − sizeX/2 + (u+0.5)/2048·sizeX, originZ − sizeZ/2 + (v+0.5)/2048·sizeZ), then `unprojectXZ` to lon/lat, then bilinear sample of `ermita-s2.jpg` with the sidecar bounds (top = north; lat decreasing with row); pixels outside the scene clamp to the nearest edge pixel. Tone rules: `.claude/skills/track-data/SKILL.md` step 12 (gain = min(1, 230/p99, 112/mean) and soft shoulder; the source is already tone-matched so the gain is expected to be 1).
- `src/ui/menu.ts` — modify — `TRACK_CHOICES`: append the 6 `{ id, name }` after `detroit`, same order and names as above.
- `src/render/environment.ts` — modify — `ENV_TABLE` (`qwantani_noon_puresky`) and `FOG_TABLE` (`{ density: 0.0004 }`) entries for the 6 ids.
- `src/track/trackConditions.ts` — modify — the 6 ids with `{ abrasion: 1.2, trackTempC: 40 }`.
- `public/tracks/ermita-*.json` (6), `public/tracks/index.json` — create/modify via `npm run build:tracks -- ermita-centro ermita-federal ermita-norte ermita-mixto ermita-poniente ermita-veloz` then `npm run build:track-index`; `public/textures/ground/ermita-*.jpg` (6) via `npm run build:ground -- <ids>` after the tracks are built. Do NOT add the ids to `tools/dem/fetchDem.ts` (the DEM is shared and already fetched).
- `ASSETS_LICENSES.md` — modify — rows already exist for `ermita.json`, `ermita-s2.jpg` and the OSM files; add one row for the five `public/textures/ground/ermita-*.jpg` crops (derived from `ermita-s2.jpg`, same licence/attribution) so AT10 finds each filename.
- Tests: `tests/unit/acceptance/241-ermita-tracks.test.ts`, `tests/e2e/acceptance/241-ermita-tracks.spec.ts`.

## Steps

1. Edit `tracks.json`, build the 6 tracks (each must report length deviation ≤ 1 % and lengths in [2400, 5100] m).
2. Build the track index; confirm only 6 entries were added at the end in the table order and every existing entry is unchanged (if the builder alters others, restore them by hand).
3. Create `cropGround.ts`, run it for the 6 ids, view each JPG once with the centerline overlaid to confirm alignment (no committed overlay).
4. Add the per-id table entries, the licence row, run the verification.

Conventions: metres; bounds inclusive; a missing id in tracks.json or missing `terrain` throws; no existing track file or asset is mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit: each of the 6 `public/tracks/<id>.json` | `parseTrackData`, closed centerline length | within ±1 % of the polyline length of `assets/source/tracks/mx-<id>.geojson` projected with `src/track/geo.ts`, and in [2400, 5100] m |
| AT2 | unit: `public/tracks/index.json` | read | the 6 ids present, consecutive in the table order above, names as above, country "Mexico"; every pre-existing entry unchanged and in the same relative order |
| AT3 | unit: `src/ui/menu.ts` `TRACK_CHOICES` | read | contains the 6 ids with the names above, consecutive, same order |
| AT4 | unit: `public/tracks/*.json` not starting with `ermita-` | compare with `git show master:<path>` at test-writing time (hash hard-coded) | byte-identical |
| AT5 | unit: each new track centerline resampled every 10 m | 3-point circumradius at every sample | ≥ 11 m |
| AT6 | unit: each new track | `widthMeters`/half widths, `environment` | width as table; environment `desert`; `bank` absent or all 0 |
| AT7 | unit: `public/textures/ground/<id>.jpg` for each id | read JPEG SOF0/SOF2 header | 2048 × 2048 |
| AT8 | unit: each new track, grandstands and pit | 233 grounding check (`groundHeightAt`) | every grandstand base within ±0.45 m of ground (ermita DEM descents + shared `clampTerrainBelowStrips`; tightening is a later terrain task); pit range inside [0, length) after wrap |
| AT9 | e2e: menu | select "Ermita Federal", start race, wait 3 s | canvas renders, no console errors, car speed reading present |
| AT10 | unit: `ASSETS_LICENSES.md` | read | rows naming `ermita.json` (DEM), each `ground/ermita-*.jpg` (Sentinel-2) and the `mx-ermita-*` OSM files |

## Planner-authorised test edits

- `tests/unit/acceptance/241-ermita-tracks.test.ts` AT8: grandstand bound 0.3 → 0.45 m (table updated).
- `tests/unit/acceptance/217-aero-zones.test.ts` AT5: exempt only `ermita-centro` and `ermita-veloz` from the `>= 1` zone count (their longest straight is < `AERO_ZONE_MIN_LENGTH_M`); keep every other assertion; do not change the constant.
- `tests/unit/edge/241-ermita-tracks-edge.test.ts` EDGE8: remove the max-channel mean <= 116 bound (contradicts the ±25 alignment bound); keep the alignment check.
- `tests/unit/acceptance/156-environment-type-ground-vegetation.test.ts`: add the 6 ids `'desert'` to `EXPECTED`.
- Tests that hard-code the track count 19 (`171-track-select-redesign` unit and e2e `toHaveCount` and titles, `211-fontana-sports-car-course` AT2 "19 entries", `tests/unit/edge/211-*`): 19 → 25, nothing else.
- `tests/unit/edge/142-kerbs-every-corner.post.test.ts`, `174-bank-profile.post.test.ts` and other per-id sweeps: add exemptions only if they fail for the new ids, with the minimum change.

## Existing tests that must still pass

156, 168, 171, 176, 211 acceptance; `tests/unit/render/environment.test.ts`.

## Acceptance criteria

- [ ] AT1–AT10 pass; all other tests pass.
- [ ] No existing `public/tracks/*.json` (other than `index.json` additions) changes.
- [ ] `ASSETS_LICENSES.md` lists the six ground crops.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 241-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Village buildings (242), arroyo/bridges (243), banking, new geojson/DEM/OSM data, `tools/dem/fetchDem.ts`, track style files, landmarks, credits screen.

## Planner decision (street walls)

Add optional `"walls": true` to the tracks.json config schema; `layoutBarriers` gets it (new optional parameter after `environment`) and then uses type `wall` everywhere, exactly as for `environment === 'city'` (offsets unchanged). Set it on the 6 ermita entries only. Every other track output is unchanged (AT4).
