# 106 — Add Mexico City, Daytona and Lusail to the game

Status: pending
Phase: 1
Depends on: 044, 099, 102
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The three new circuits (data already in `public/tracks/{mexico,daytona,lusail}.json`) are selectable in the menu and load with their own sky, fog and satellite ground; their JSON carries the correct data source.

## Context

Track data was built by the planner (`tools/track-builder/tracks.json` entries, sources in `assets/source/tracks/`: `mx-1962` from bacinger/f1-circuits MIT; `us-daytona` and `qa-lusail` from OpenStreetMap ODbL). `buildTrackData` currently hardcodes the bacinger source for every track. Satellite crops `public/textures/ground/<id>.jpg` and HDRIs in `public/hdri/` are installed by the planner. Names are city/region names (PRD §14).

## Files

- `src/ui/menu.ts` — modify (`TRACK_CHOICES` + mexico 'Mexico City', daytona 'Daytona', lusail 'Lusail', in that order after the existing three)
- `src/render/environment.ts` — modify (per-track sky/fog entries for the three ids)
- `tools/track-builder/tracks.json` — modify (optional `source` {dataset, license, url} per track; set for the three new ids)
- `tools/track-builder/buildTrackData.ts` — modify (use the config `source` when present, else the current default)
- `public/tracks/mexico.json`, `daytona.json`, `lusail.json` — regenerate (`npm run build:tracks -- mexico daytona lusail`)

## Steps

- Environment: mexico and daytona use `kloofendal_48d_partly_cloudy_puresky`; lusail uses `qwantani_noon_puresky` (clear midday); fog densities: mexico 0.0005, daytona 0.0004, lusail 0.0003.
- Sources: mexico {bacinger/f1-circuits, MIT, https://github.com/bacinger/f1-circuits}; daytona and lusail {OpenStreetMap, ODbL 1.0, https://www.openstreetmap.org/copyright}.
- Existing three tracks' JSON must not change.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/` | menu | 6 track buttons in order monza, spa, silverstone, mexico, daytona, lusail with names Monza, Spa, Silverstone, Mexico City, Daytona, Lusail |
| AT2 | e2e `/?track=<id>` for mexico, daytona, lusail | ready | `trackId()` = id; no console errors; 3 s of throttle reaches > 30 km/h |
| AT3 | e2e each new track | ready | `sceneStats().environment` per Steps; `sceneStats().groundTexture` contains `textures/ground/<id>.jpg` |
| AT4 | public/tracks/daytona.json, lusail.json / mexico.json | read `source` | dataset 'OpenStreetMap', license 'ODbL 1.0' / dataset 'bacinger/f1-circuits', license 'MIT' |
| AT5 | public/tracks/monza.json, spa.json, silverstone.json | git diff vs base | unchanged |

## Acceptance criteria

- [ ] AT1–AT5 pass; all other tests pass.

## Verification

```
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

## Out of scope

- Banking (Daytona), track-specific grandstand placement, night racing, new tree species, credits screen.
