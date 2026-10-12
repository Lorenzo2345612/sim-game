# 030 — Generate TrackData v2 for Monza, Spa and Silverstone

Status: pending
Phase: 1
Depends on: 022, 024, 025, 026, 027, 028, 029
Complexity: simple
Type: feature
Roles: acceptance, coder, reviewer

## Goal

`npm run build:tracks` writes complete `public/tracks/{monza,spa,silverstone}.json` as `TrackDataV2`.

## Context

Pipeline and rules: `ai/guides/phase1.md` ("TrackData v2", "Builder rules", Biomes). Existing `buildTrackData` (v1: centerline, sectors, lengths) in `tools/track-builder/buildTrackData.ts`; current `buildTrack.ts` handles only Monza. The game's loader reads v1 fields, which v2 keeps.

## Files

- `tools/track-builder/tracks.json` — create — config array
- `tools/track-builder/buildTrack.ts` — modify — read config, build all tracks
- `public/tracks/{monza,spa,silverstone}.json` — regenerate (commit)
- `tests/unit/acceptance/030-track-builder-v2.test.ts` — create by the acceptance role

## Steps

1. Config entry: `{ id, name, geojson, dem, widthMeters, reverse: false, biome (a `Biome` from task 029), grandstands: {atMeters, side, offsetMeters, lengthMeters, rows, roof}[], pit: {fromMeters, toMeters, side} }`. Widths 12 (Spa 14). Names "Monza", "Spa", "Silverstone". Geojson files: `it-1922`, `be-1925`, `gb-1948` in `assets/source/tracks/`; dem: `assets/source/dem/<id>.json`. Biomes and species presets from phase1.md.
2. Grandstands `[atMeters, side, offsetMeters, lengthMeters, rows, roof]` (offset always 30 in the planner values below):
   monza `[0,right,30,60,14,true]`,`[5300,left,30,80,10,false]`,`[900,left,30,50,10,false]`; spa `[0,right,30,50,12,true]`,`[350,left,30,60,10,false]`,`[1000,right,30,70,12,false]`; silverstone `[0,left,30,60,14,true]`,`[600,right,30,60,10,false]`,`[5200,right,30,50,10,false]`. Use field names above (lengthMeters then rows).
   Pit: monza right −250…+150; spa right −300…+100; silverstone left −250…+150.
3. Conversion: `atMeters`/pit metres are arc length from index 0 (negative = before, wrap modulo lap length) → centerline index. Grandstand position = centerline point + side normal × (`widthMeters/2 + offsetMeters`); `yaw` = `atan2(-dx, -dz)` of the direction from the stand to its centerline point (stand faces the track).
4. Per track: `buildTrackData` → `centerlineHeights` + `elevationProfile` → `detectKerbs`, `detectRunoffs` → `layoutBarriers` → `buildTerrain` (maxBarrierOffset = max barrier offset) → `placeTrees`. Assemble `TrackDataV2` with `version: 2`, `source.dem: 'Copernicus GLO-30'`, `treeSpecies` from the biome. Origin = `bboxCenter` of the GeoJSON coordinates.
5. Keep the ±1 % length check (exit code 1 on failure) and the existing npm script `build:tracks`.

## Acceptance tests (defined by the planner with Opus, before coding)

Acceptance tests for this task are Vitest in `tests/unit/acceptance/`. Rows are copied verbatim; do not change them.

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | `npm run build:tracks` | read `public/tracks/{monza,spa,silverstone}.json` | each `version: 2`; length within ±1 % of 5793 / 7004 / 5891 |
| AT2 | spa.json | elevation range | 80–120 m; monza 5–30 m; silverstone 3–25 m |
| AT3 | each track | kerbs, runoffs, barriers | ≥ 10 kerb runs, ≥ 6 runoffs, barriers on both sides covering every index |
| AT4 | each track | terrain | heights length = (rows+1)(cols+1); terrain under centerline[0] within 0.3 m of elevation[0] − 0.15 |
| AT5 | each track | trees | monza 2500–6000, spa 3000–6000, silverstone 300–2500 |
| AT6 | each track | grandstands / pit | ≥ 2 grandstands; pit side set and range within the lap |
| AT7 | names | name field | "Monza", "Spa", "Silverstone" (no commercial names) |

## Acceptance criteria

- [ ] `npm run build:tracks` exits 0 and writes three v2 files, each < 6 MB.
- [ ] Acceptance tests pass; existing Phase 0 tests still pass.

## Verification

```
npm run typecheck
npm run lint
npm test
```
npm run build:tracks

## Out of scope

- Loading v2 in the game, new algorithms, other tracks, tuning rules.
