# 106 — Add twelve new circuits to the game

Status: pending
Phase: 1
Depends on: 044, 099, 102, 141, 143, 155
Complexity: simple
Type: feature
Models: standard
Roles: acceptance, coder, reviewer

## Goal

The twelve new circuits (data already in `public/tracks/{mexico,daytona,lusail,bahrain,braselton,elkhart,sepang,baku,budapest,singapore,lasvegas,spielberg}.json`) are selectable in the menu and load with their own sky, fog and satellite ground; their JSON carries the correct data source.

## Context

Track data was built by the planner (`tools/track-builder/tracks.json` entries, sources in `assets/source/tracks/`: `mx-1962` from bacinger/f1-circuits MIT; `us-daytona`, `qa-lusail` and `bh-sakhir` from OpenStreetMap ODbL). `buildTrackData` currently hardcodes the bacinger source for every track. Satellite crops `public/textures/ground/<id>.jpg` and HDRIs in `public/hdri/` are installed by the planner. Names are city/region names (PRD §14).

## Files

- `src/ui/menu.ts` — modify (`TRACK_CHOICES` + mexico 'Mexico City', daytona 'Daytona', lusail 'Lusail', bahrain 'Sakhir', braselton 'Braselton', elkhart 'Elkhart Lake', sepang 'Sepang', baku 'Baku', budapest 'Budapest', singapore 'Singapore', lasvegas 'Las Vegas', spielberg 'Spielberg', in that order after the existing three)
- `src/render/environment.ts` — modify (per-track sky/fog entries for the twelve ids)
- `tools/track-builder/tracks.json` — modify (optional `source` {dataset, license, url} per track; set for the twelve new ids)
- `tools/track-builder/buildTrackData.ts` — modify (use the config `source` when present, else the current default)
- `public/tracks/<id>.json` for the twelve new ids — regenerate with exactly `npm run build:tracks -- mexico daytona lusail bahrain braselton elkhart sepang baku budapest singapore lasvegas spielberg` (never without ids: monza/spa/silverstone must not be rewritten). Known, accepted: it prints `elkhart: length deviation 1.16% exceeds 1%` and exits 1; the JSON is still written. Do not try to fix it; any other error is a blocker.

## Steps

- Environment: mexico, daytona, braselton, elkhart, sepang, baku, budapest, singapore and spielberg use `kloofendal_48d_partly_cloudy_puresky`; lusail, bahrain and lasvegas use `qwantani_noon_puresky` (clear midday); fog densities: mexico 0.0005, daytona 0.0004, lusail 0.0003, bahrain 0.0003, braselton 0.0005, elkhart 0.0005, sepang 0.0004, baku 0.0004, budapest 0.0005, singapore 0.0005, lasvegas 0.0003, spielberg 0.0006.
- Sources: mexico and sepang {bacinger/f1-circuits, MIT, https://github.com/bacinger/f1-circuits}; daytona, lusail, bahrain, braselton, elkhart, baku, budapest, singapore, lasvegas and spielberg {OpenStreetMap, ODbL 1.0, https://www.openstreetmap.org/copyright}.
- Existing three tracks' JSON must not change.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | e2e `/` | menu | 15 track buttons in order monza, spa, silverstone, mexico, daytona, lusail, bahrain, braselton, elkhart, sepang, baku, budapest, singapore, lasvegas, spielberg with names Monza, Spa, Silverstone, Mexico City, Daytona, Lusail, Sakhir, Braselton, Elkhart Lake, Sepang, Baku, Budapest, Singapore, Las Vegas, Spielberg |
| AT2 | e2e `/?track=<id>` for every new id | ready | `trackId()` = id; no console errors; 3 s of simulated time (`getSimTime()`) of throttle reaches > 30 km/h |
| AT3 | e2e each new track | ready | `sceneStats().environment` per Steps; `sceneStats().groundTexture` contains `textures/ground/<id>.jpg` |
| AT4 | public/tracks/ daytona, lusail, bahrain, braselton, elkhart, baku, budapest, singapore, lasvegas, spielberg .json / mexico.json, sepang.json | read `source` | dataset 'OpenStreetMap', license 'ODbL 1.0' / dataset 'bacinger/f1-circuits', license 'MIT' |
| AT5 | public/tracks/monza.json, spa.json, silverstone.json | git diff vs base | unchanged |

- Planner-authorised test edit (exactly this): in `tests/e2e/acceptance/106-new-tracks-in-game.spec.ts` AT2, replace `page.waitForTimeout(3000)` with recording `getSimTime()` after `keyboard.down` and `page.waitForFunction` until it has advanced ≥ 3 s (timeout 60 s). Software GL runs the sim slower than wall time.
- Do not edit `src/track/surfaces.ts` or `tools/track-builder/terrain.ts`. Run the 106 e2e at most twice; no diagnostic specs.
- Known bug to fix (planner-verified 2026-10-15 with headless Chromium on the built game): on `/?track=mexico` (and daytona) the car never moves under full throttle from the initial spawn — position stays exactly constant at (-467.82, 0.236, -501.71), speed 0.002 km/h, gear 1, for 6+ s of sim time. Monza from its initial spawn reaches 100 km/h. Calling `__SIMGAME__.teleportToIndex(n-5)` (the same centerline index `spawnFromTrack` uses) before throttling makes mexico reach 95 km/h, and the body has `setCanSleep(false)`, so the difference is state set by `Game`/`main.ts` startup that `teleportToIndex` → `Vehicle.reset` clears. Find it by reading `src/game/game.ts` (constructor, `spawnFromTrack`, `teleportToIndex`), `src/physics/vehicleModel.ts` (constructor vs `reset`) and the startup path in `src/main.ts`; fix it at the root (do not call teleport at startup as a workaround). Allowed files for this fix: `src/game/game.ts`, `src/physics/vehicleModel.ts`, `src/main.ts`. Add a unit test `tests/unit/game/106-initial-spawn.test.ts`: `Game` on mexico.json from its initial spawn, full throttle for 3 s of fixed steps → speed > 30 km/h.

## Acceptance criteria

- [ ] AT1–AT5 pass; all other tests pass. `build:tracks` exit 1 caused only by the elkhart length line is accepted.

## Verification

```
npm run typecheck
npm run lint
npm test
npx playwright test 106-   # this task's e2e files only; never the full e2e suite
```

## Out of scope

- Banking (Daytona), track-specific grandstand placement, night racing, new tree species, credits screen.
