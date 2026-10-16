# 157 — City bake from OSM: buildings, old-city walls, water

Status: pending
Phase: 1
Depends on: 106
Complexity: complex
Type: feature
Models: standard
Roles: acceptance, coder, reviewer, tester-pre, tester

## Goal

`npm run build:env -- <id>` produces `public/tracks/<id>-env.json` with buildings, old-city walls and water for city tracks, with no names or brands.

## Context

M1.2d, design `docs/plans/m1.2d-environments.md`. Read the current code first: this task runs after 106 (new tracks in `tools/track-builder/tracks.json`, track JSONs); adapt file names to what exists, keep the public contract. Reuse the Overpass fetch and projection helpers (`tools/dem/fetchDem.ts` for network/caching style; `projectLonLat` and `bboxCenter` in `src/track/geo.ts`; `tools/track-builder/osmAreas.ts` for OSM parsing). The local frame must equal the track JSON's (same origin and projection as `buildTrackData`). City tracks: baku, singapore, lasvegas. Overpass data is ODbL: add a row to `ASSETS_LICENSES.md` for the saved extracts. Guides: `ai/guides/architecture.md`, `ai/guides/testing.md`.

## Files

- `tools/env/bakeCity.ts` — create: CLI + exports.
- `tools/env/osmBuildings.ts` — create: pure parsing helpers (`heightOf`, material, filtering).
- `package.json` — modify: script `build:env` = `tsx tools/env/bakeCity.ts` (use the runner the other build scripts use).
- `assets/source/osm/<id>-city.json` (3), `public/tracks/<id>-env.json` (3) — generated; commit them.
- `ASSETS_LICENSES.md` — modify: ODbL row.
- `tests/unit/acceptance/157-city-bake.test.ts` — create (acceptance worker).

## Steps

```ts
export type BuildingMaterial = 'glass' | 'concrete' | 'brick' | 'stone';
export interface CityEnv {
  buildings: { ring: [number, number][]; height: number; material: BuildingMaterial }[];
  walls: { line: [number, number][]; height: number; thickness: number }[];
  water: [number, number][][];
}
export function heightOf(tags: Record<string, string>): number;
```

1. Fetch Overpass (buildings, `barrier=wall`, `historic=citywalls`, `natural=water`, basin, coastline, old-city `historic=*` areas) for the track bbox + 600 m; cache the raw response in `assets/source/osm/<id>-city.json`; reuse the cache when present (offline bake).
2. Keep within 600 m of the centerline (applies to buildings, walls and water alike; a feature is kept when any vertex is within 600 m). Heights: `height` in metres; a value with an `ft` suffix is converted (× 0.3048), any other suffix is stripped and the number taken as metres. Drop buildings whose ring comes closer than (track half width + max barrier offset + 5 m) to the centerline (use the track JSON's own values).
3. `heightOf`: `height` tag (metres; strip a unit suffix such as ` m`) → `building:levels` × 3.2 → type default (house 7; residential/apartments 15; commercial/retail/office 24; hotel 40; else 12).
4. Material: height ≥ 40 → glass; historic tag or inside an old-city area → stone; residential/house → brick; else concrete (first match in this order).
5. Walls: `barrier=wall`/`historic=citywalls` ways inside an old-city area → `{height 8, thickness 2.5}`.
6. Water: `natural=water`/basin polygons; coastline ways closed against the extract bbox on the water side.
7. Output only the fields above (no `name`, no tags, no ids). Deterministic: stable sort by first vertex, coordinates rounded to 0.01 m, `JSON.stringify` without extra whitespace.

Conventions: heights in metres, round to 0.1; `<` for the corridor drop (a ring exactly at the limit is kept); unparsable height tag falls through to the next rule; coordinates [x, z] in track local metres; inputs not mutated.

## Acceptance tests (defined by the planner with Opus, before coding)

| ID | Given | When | Then |
|---|---|---|---|
| AT1 | unit heightOf({height: '45 m'}) / ({'building:levels': '10'}) / ({building: 'house'}) / ({building: 'yes'}) | call | 45 / 32 / 7 / 12 |
| AT2 | bake baku | output | ≥ 800 buildings; every building's ring ≥ (half + max barrier offset + 5) m from the centerline; every height > 0; ≥ 1 wall line; ≥ 1 water polygon |
| AT3 | bake singapore / lasvegas | output | ≥ 600 buildings each; singapore ≥ 1 water polygon; some building ≥ 150 m tall |
| AT4 | any output file | search keys and string values | no key `name`, no string value other than the material enum |
| AT5 | bake baku twice | output | byte-identical |

## Acceptance criteria

- [ ] AT1–AT5 pass (AT2–AT5 read the committed `public/tracks/*-env.json`).
- [ ] The three env files and raw extracts exist; ODbL row added.
- [ ] typecheck, lint, test pass.

## Verification

```
npm run build:env -- baku
npm run typecheck
npm run lint
npm test
```

## Out of scope

- Rendering (158), trackside furniture (159), landmarks (160).
- Roads, parks or terrain edits from OSM; any brand or name data.
