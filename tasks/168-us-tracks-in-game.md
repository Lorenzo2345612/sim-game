# 168 — Add Fontana, Cleveland and Detroit to the game

Status: pending
Phase: 1
Depends on: 106, 155, 156
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

Fontana, Cleveland and Detroit (data already in `public/tracks/{fontana,cleveland,detroit}.json`) are selectable in the menu and load with their own sky, fog, satellite ground and environment type; their JSON carries the OpenStreetMap source.

## Context

Same pattern as task 106. Track data, geojson (`us-fontana`, `us-cleveland`, `us-detroit`) and DEMs exist; `tracks.json` entries exist. Another agent installs `public/textures/ground/<id>.jpg` and OSM area data: do not touch `assets/` or any `tracks.json` field other than the ones listed below. `tools/dem/fetchDem.ts` `TRACKS` lacks the three ids. 156 introduced the per-track `environment` field in `tracks.json` (type `EnvironmentType`); 157-160 (city bake/renderer/furniture/landmarks) take their per-track data from `tracks.json` and need no entry for the new ids here.

## Files

- `src/ui/menu.ts` — modify (`TRACK_CHOICES` + fontana 'Fontana', cleveland 'Cleveland', detroit 'Detroit', in that order, appended after the last existing entry (spielberg))
- `src/render/environment.ts` — modify (`ENV_TABLE` and `FOG_TABLE` entries for the three ids)
- `tools/track-builder/tracks.json` — modify (per new id only: `source` and `environment`)
- `tools/dem/fetchDem.ts` — modify (`TRACKS` + `{ id: 'fontana', source: 'us-fontana' }`, `cleveland`/`us-cleveland`, `detroit`/`us-detroit`, appended)
- `public/tracks/fontana.json`, `cleveland.json`, `detroit.json` — regenerate (`npm run build:tracks -- fontana cleveland detroit`)

## Steps

- HDRI (`ENV_TABLE`): fontana `qwantani_noon_puresky`; cleveland and detroit `kloofendal_48d_partly_cloudy_puresky`. Fog density (`FOG_TABLE`): fontana 0.0004, cleveland 0.0005, detroit 0.0005.
- `source` for all three: `{ dataset: 'OpenStreetMap', license: 'ODbL 1.0', url: 'https://www.openstreetmap.org/copyright' }`.
- `environment` per entry: fontana `'desert'`, cleveland `'parkland'`, detroit `'city'`.
- Only these three JSON files are rebuilt; every other `public/tracks/*.json` must stay byte-identical.
- Centerline lengths (closed loop, verified from the current build): fontana 2426 m, cleveland 3426 m, detroit 2562 m.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/` | menu | the three track buttons immediately after spielberg are fontana, cleveland, detroit with names Fontana, Cleveland, Detroit; total buttons = previous count + 3 |
| AT2 | e2e `/?track=<id>` for fontana, cleveland, detroit | ready | `trackId()` = id; no console errors; 3 s of throttle reaches > 30 km/h |
| AT3 | e2e each new track | ready | `sceneStats().environment` per Steps; `sceneStats().groundTexture` contains `textures/ground/<id>.jpg` |
| AT4 | public/tracks/fontana.json, cleveland.json, detroit.json | read `source` | dataset 'OpenStreetMap', license 'ODbL 1.0' |
| AT5 | public/tracks/ json of every other track | git diff vs base | unchanged |
| AT6 | public/tracks/<id>.json for the three | centerline length | fontana 2300–2550 m, cleveland 3250–3550 m, detroit 2450–2700 m |

Protected tests: no existing test pins the menu button count or the track list (`tests/e2e/acceptance/044-track-menu.spec.ts` checks only individual buttons), so no edits are authorised.

## Acceptance criteria

- [ ] AT1–AT6 pass; all other tests pass.
- [ ] The rebuilt JSONs have `environment` fontana 'desert', cleveland 'parkland', detroit 'city'.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 168-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- `<id>-env.json` city bake for Detroit (157 CLI), landmarks, ground textures, OSM area data, banking, grandstand tuning, new tree species, credits screen.
