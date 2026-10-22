# 336 — Add Long Beach to the game

Status: pending
Phase: 1
Depends on: 331 (adds the 3 earlier tracks the counts below build on; data committed in the "tracks: Long Beach data" commit)
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Long Beach (street circuit, data already in `public/tracks/longbeach.json`) is selectable in the menu and loads with its own sky, fog, satellite ground and environment type.

## Context

Same pattern as tasks 168 and 331. Track JSON, geojson, DEM, ground texture, env bake and `tools/track-builder/tracks.json` entry already exist. Do NOT touch `assets/`, `tools/track-builder/tracks.json` or any `public/tracks/*.json` other than `index.json`. No rebuild of track JSONs. `environment` value: longbeach `city`. Counts below assume 331 is merged (28 tracks before this task, 29 after).

## Files

- `src/ui/menu.ts` — modify (`TRACK_CHOICES` + longbeach 'Long Beach', appended after miami)
- `src/render/environment.ts` — modify (`ENV_TABLE` and `FOG_TABLE` entries)
- `src/track/trackConditions.ts` — modify (`TRACK_CONDITIONS` entry)
- `tools/dem/fetchDem.ts` — modify (`TRACKS` + `{ id: 'longbeach', source: 'us-longbeach' }`, appended)
- `public/tracks/index.json` — append only the new entry (rebuild with `npm run build:track-index`; if existing entries change, append by hand instead). Existing entries stay byte-identical.

## Steps

- HDRI (`ENV_TABLE`): longbeach `kloofendal_48d_partly_cloudy_puresky`. Fog (`FOG_TABLE`): longbeach 0.0004.
- `TRACK_CONDITIONS` (abrasion, trackTempC): longbeach `{ 0.9, 40 }` (required by 214 AT2 once index.json lists the track).
- Index name `Long Beach`; country United States (from the registry).

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/` | menu | the track button immediately after miami is longbeach with name Long Beach; total buttons = previous count + 1 |
| AT2 | e2e `/?track=longbeach` | ready | `trackId()` = id; no console errors; 3 s of throttle reaches > 30 km/h |
| AT3 | e2e longbeach | ready | `sceneStats().environment` is city; `sceneStats().groundTexture` contains `textures/ground/longbeach.jpg` |
| AT4 | `public/tracks/index.json` | read | the last entry is longbeach with name Long Beach and country United States; all earlier entries equal the base revision |
| AT5 | `tools/dem/fetchDem.ts` `TRACKS` | read | contains `{ id: 'longbeach', source: 'us-longbeach' }` |
| AT6 | `public/tracks/*.json` other than index.json | git diff vs base | unchanged |
| AT7 | `public/tracks/longbeach.json` | max − min of `elevation` | < 8 m |
| AT8 | same file | `lengthMeters` | 3150–3270 |

## Planner-authorised edits

Edit only what is listed; nothing else in these files. Counts re-measured for 29 tracks (25 originals + bathurst, jeddah, miami from 331 + longbeach).
- `tests/e2e/acceptance/171-track-select-redesign.spec.ts` line 36: `toHaveCount(28)` becomes `toHaveCount(29)` (and any `28` in that test title becomes `29`).
- `tests/unit/acceptance/171-track-select-redesign.test.ts`: AT2 title `28` becomes `29` (assertions follow `TRACK_CHOICES`).
- `tests/unit/acceptance/211-fontana-sports-car-course.test.ts` AT2: title and `toHaveLength(28)` become `29`.
- `tests/unit/acceptance/241-ermita-tracks.test.ts` AT2: the `preexisting` filter also excludes id `longbeach` (`PREEXISTING_IDS` and hash unchanged).
- `tests/unit/edge/241-ermita-tracks-gaps.post.test.ts`: GAPS1 `registry.length`, `index.length`, `TRACK_CHOICES.length` become 29 and the three `slice(-(IDS.length + 3), -3)` become `slice(-(IDS.length + 4), -4)`; GAPS2 filter also excludes `longbeach` (count 19 and `MASTER_REGISTRY_SHA` unchanged).
- `tests/unit/acceptance/156-environment-type-ground-vegetation.test.ts`: add to `EXPECTED` `longbeach: 'city'`.
- `tests/unit/acceptance/301-kerb-zone-steps-all-tracks.test.ts` AT2: add `longbeach: [3208, 3554]` to `expectCounts` (asphalt/kerb triangle counts measured from the committed `longbeach.json` with the test's own `triangleCounts`); existing entries unchanged.

## Acceptance criteria

- [ ] AT1–AT8 pass; all other tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 336-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Track JSON rebuilds, `-env.json` city bakes, landmarks, ground textures, OSM area data, `tracks.json`, banking, grandstands, credits screen.

## Planner resolutions 2026-10-22

- 331 AT6 and 336 AT6 compare only files that exist at the base revision (79c5aaff).
- 331 AT4 (unit) and AT1 (e2e) now locate the three tracks by position after the base entries instead of the last three, so appending longbeach keeps them valid.
- e2e AT3 reads `sceneStats().environmentType` (the `environment` field holds the HDRI name).
