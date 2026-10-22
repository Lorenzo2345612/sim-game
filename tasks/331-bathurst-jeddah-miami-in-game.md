# 331 — Add Bathurst, Jeddah and Miami to the game

Status: pending
Phase: 1
Depends on: none (data committed in bfe459dc)
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Bathurst (Mount Panorama), Jeddah and Miami (data already in `public/tracks/{bathurst,jeddah,miami}.json`) are selectable in the menu and load with their own sky, fog, satellite ground and environment type.

## Context

Same pattern as task 168. Track JSONs, geojson, DEMs, ground textures and `tools/track-builder/tracks.json` entries (source, environment, country) already exist. Do NOT touch `assets/`, `tools/track-builder/tracks.json` or any `public/tracks/*.json` other than `index.json`. No rebuild of track JSONs. `environment` values: bathurst `parkland`, jeddah `city`, miami `city`.

## Files

- `src/ui/menu.ts` — modify (`TRACK_CHOICES` + bathurst 'Mount Panorama', jeddah 'Jeddah', miami 'Miami', in that order, appended after ermita-veloz)
- `src/render/environment.ts` — modify (`ENV_TABLE` and `FOG_TABLE` entries)
- `src/track/trackConditions.ts` — modify (`TRACK_CONDITIONS` entries)
- `tools/dem/fetchDem.ts` — modify (`TRACKS` + `{ id: 'bathurst', source: 'au-bathurst' }`, `{ id: 'jeddah', source: 'sa-jeddah' }`, `{ id: 'miami', source: 'us-miami' }`, appended)
- `public/tracks/index.json` — append only the three new entries, in that order (rebuild with `npm run build:track-index`; if existing entries change, append by hand instead). Existing entries stay byte-identical.

## Steps

- HDRI (`ENV_TABLE`): bathurst `kloofendal_48d_partly_cloudy_puresky`, jeddah `qwantani_noon_puresky`, miami `kloofendal_48d_partly_cloudy_puresky`. Fog (`FOG_TABLE`): bathurst 0.0004, jeddah 0.0003, miami 0.0004.
- `TRACK_CONDITIONS` (abrasion, trackTempC): bathurst `{ 1.2, 25 }`, jeddah `{ 0.85, 35 }`, miami `{ 0.9, 45 }` (required by 214 AT2 once index.json lists the tracks).
- Index names `Mount Panorama`, `Jeddah`, `Miami`; countries Australia, Saudi Arabia, United States (from the registry).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/` | menu | the three track buttons immediately after ermita-veloz are bathurst, jeddah, miami with names Mount Panorama, Jeddah, Miami; total buttons = previous count + 3 |
| AT2 | e2e `/?track=<id>` for bathurst, jeddah, miami | ready | `trackId()` = id; no console errors; 3 s of throttle reaches > 30 km/h |
| AT3 | e2e each new track | ready | `sceneStats().environment`: bathurst parkland, jeddah city, miami city; `sceneStats().groundTexture` contains `textures/ground/<id>.jpg` |
| AT4 | `public/tracks/index.json` | read | the last three entries are bathurst, jeddah, miami in that order with names Mount Panorama, Jeddah, Miami and countries Australia, Saudi Arabia, United States; all earlier entries equal the base revision |
| AT5 | `tools/dem/fetchDem.ts` `TRACKS` | read | contains `{ id: 'bathurst', source: 'au-bathurst' }`, `{ id: 'jeddah', source: 'sa-jeddah' }`, `{ id: 'miami', source: 'us-miami' }` |
| AT6 | `public/tracks/*.json` other than index.json | git diff vs base | unchanged |
| AT7 | `public/tracks/bathurst.json`, `jeddah.json`, `miami.json` | max − min of `elevation` | bathurst 160–180 m; jeddah < 8 m; miami < 8 m |
| AT8 | same three files | `lengthMeters` | bathurst 6100–6300; jeddah 6080–6280; miami 5320–5500 |

## Planner-authorised edits

Edit only what is listed; nothing else in these files.
- `tests/e2e/acceptance/171-track-select-redesign.spec.ts` line 36: `toHaveCount(25)` becomes `toHaveCount(28)` (and any `25` in that test title becomes `28`).
- `tests/unit/acceptance/171-track-select-redesign.test.ts`: AT2 title `25` becomes `28` (assertions follow `TRACK_CHOICES`).
- `tests/unit/acceptance/211-fontana-sports-car-course.test.ts` AT2: title and `toHaveLength(25)` become `28`.
- `tests/unit/acceptance/241-ermita-tracks.test.ts` AT2: the `preexisting` filter also excludes ids `bathurst`, `jeddah`, `miami` (`PREEXISTING_IDS` and hash unchanged).
- `tests/unit/edge/241-ermita-tracks-gaps.post.test.ts`: GAPS1 `registry.length`, `index.length`, `TRACK_CHOICES.length` become 28 and the three `slice(-IDS.length)` become `slice(-(IDS.length + 3), -3)`; GAPS2 filter also excludes `bathurst`, `jeddah`, `miami` (count 19 and `MASTER_REGISTRY_SHA` unchanged).
- `tests/unit/acceptance/156-environment-type-ground-vegetation.test.ts`: add to `EXPECTED` `bathurst: 'parkland'`, `jeddah: 'city'`, `miami: 'city'`.
- `tests/unit/acceptance/301-kerb-zone-steps-all-tracks.test.ts` AT2: add `bathurst`, `jeddah`, `miami` to `expectCounts` with the asphalt/kerb triangle counts measured from the committed track JSONs (the test's own counting path); existing entries unchanged.

## Acceptance criteria

- [ ] AT1–AT8 pass; all other tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 331-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Track JSON rebuilds, `-env.json` city bakes, landmarks, ground textures, OSM area data, `tracks.json`, banking, grandstands, credits screen.

## Planner resolutions 2026-10-22

- `public/flags/palettes.json` gains `Australia` `["#00008B","#FFFFFF","#E4002B"]` and `Saudi Arabia` `["#006C35","#FFFFFF"]` (253 AT1 needs a palette per index country); 253 AT8 expected palettes become 14 (both added).
- 250 AT9: tracks whose json does not exist at the base revision (`git show` fails) are skipped instead of failing.
- AT6 authorised: only files that exist at the base revision (79c5aaff) are compared; files added later by other tasks (longbeach.json, longbeach-env.json) are ignored.
- e2e AT3 reads `sceneStats().environmentType` (the `environment` field holds the HDRI name).
