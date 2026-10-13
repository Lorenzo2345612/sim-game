# OSM run-off research (Monza, Spa, Silverstone)

Queried Overpass (overpass-api.de, bbox = track bbox + ~200 m) on 2026-10-13. Raw responses in `/tmp/osm-runoff/` (not kept). Compact extracts (lon/lat rings + tags, features within 60 m of the centerline, barriers within 40 m): `assets/source/osm/{monza,spa,silverstone}-areas.json`. Corners = centerline stretches with radius < 400 m (Monza 11, Spa 20, Silverstone 16). "Covered" = a feature within 70 m of the corner apex.

## Tags found

| Tag | Monza | Spa | Silverstone |
|---|---|---|---|
| `area:highway=*` (paved run-off) | 0 | 0 | 0 |
| `highway=raceway` + `area=yes` | 1 (not run-off) | 0 | 0 |
| `natural=sand` / `surface=gravel` polygons near track | 10 (`natural=sand`, e.g. 231025694, 231026021) | 8 (`natural=shingle`+`surface=gravel`+`note=Run-off area`, e.g. 175370760, 486844447) | 18 (`natural=sand`, e.g. 559446514, 605759139) |
| corners covered by sand/gravel | 11/11 | 11/20 | 14/16 |
| `landuse=grass` near track (<60 m) | 12 | 56 | 84 |
| `barrier=guard_rail` near | 6 (243090139..) | 5 | 3 |
| `barrier=wall` near | 6 (193475069, 1304624806) | 62 | 45 |
| `barrier=fence` near | 13 (mostly chain-link, 243090142) | 49 | 75 |
| tyre barriers / `barrier=kerb` | none | none | 1 kerb |
| paved run-off asphalt areas | none (only parking lots) | none | none (only parking lots) |

## Findings

- Gravel/sand traps are mapped as closed polygons at all three tracks, 3 to 33 m from the centerline (several touch it: the centerline is the raceway way, not the edge). Monza's are tagged `natural=sand`; Spa's are explicitly gravel with `note=Run-off area`; Silverstone's `natural=sand`. Treat `natural=sand|shingle` and `surface=gravel|sand` all as gravel.
- Paved run-off is not mapped anywhere (no `area:highway`; only parking lots have asphalt). Grass `landuse=grass` is mapped but is landscaping, not a drivable-area rule: too noisy (240 polygons at Silverstone, many are verges/parking islands).
- Barriers: Monza has few and sparse (guard_rail 1.2 m along the main straight at ~11 m; walls; chain-link fences at 20-50 m); Spa and Silverstone have many `wall`/`fence` ways, often forming near-continuous lines at 8-30 m (Spa 19/20 corners have a wall within 70 m). Guard rails are rare (3-6 per track). No tyre walls. Barrier kind is only wall/fence/guard_rail, with `height` occasionally. Many fences are spectator/paddock/property boundaries, not safety barriers.
- Coverage is uneven: Monza sand is complete; Spa partial (9 polygons, 11/20 corners); Silverstone mostly complete.

## Recommendation: mix

1. Gravel: derive from OSM. Rasterize/offset the `natural=sand|shingle` and `surface=gravel|sand` polygons within ~60 m of the centerline as gravel run-off (clip against the track surface). Mapping: any of those tags -> `gravel`.
2. Paved run-off and fallback: keep the rule, but tuned. Only generate for corners with min radius < 150 m (instead of 400 m), only on the outside, and only where no OSM gravel polygon overlaps that side; width 12 m asphalt for radius 150 m or more tight stretches, none for sweepers. Suggested: run-off for radius < 150 m; gravel 18 m only where OSM has none and radius < 100 m; drop the asphalt-for-sweepers case entirely (that is what produces the odd strips). Optionally add 8 m asphalt only at known hairpin/heavy-braking points via a per-track override list.
3. Barriers: derive from OSM `barrier=wall|guard_rail` (and `fence` with `fence_type` != chain_link only if within 25 m) within 30 m of the centerline, outside the run-off; ignore `fence` tagged `amenity=parking`. Where missing (Monza mostly), fall back to a barrier at the outer edge of the run-off. Treat walls/guard_rails as rigid colliders; fences visual only.
4. Attribution: OSM data is ODbL. Add "(c) OpenStreetMap contributors" in the credits/`ASSETS_LICENSES.md` and ship derived data (the `*-areas.json` extracts or the built polygons) with the ODbL attribution; keep the derived track database under ODbL share-alike if redistributed.
