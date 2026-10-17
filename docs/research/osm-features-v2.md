# OSM features v2

Fetched 2026-10-17 from Overpass for all 19 tracks in `public/tracks/index.json` (bbox = track bounds). Files: `assets/source/osm/<id>-features.json` (`source`, `track`, `query`, `features[]` with `id`, `osmType`, `kind`, `closed`, `tags` without `name`, `ring` or `line` as `[lon, lat]`). License: OpenStreetMap contributors, ODbL.

Kinds: `grandstand` (grandstand=yes, leisure=stadium), `building`, `pit_lane` (service/raceway=pit_lane), `paved_area` (area:highway, paved surfaces), `gravel` (gravel/sand surfaces, natural sand/shingle), `grass` (landuse=grass), `barrier` (any barrier=*; `tags.barrier` gives wall/guard_rail/fence/jersey_barrier/...).

| Track | grandstand | pit_lane | barrier | gravel | grass | paved_area | building |
|---|---|---|---|---|---|---|---|
| bahrain | 9 | 0 | 87 | 8 | 19 | 0 | 193 |
| baku | 0 | 0 | 11 | 0 | 90 | 6 | 873 |
| braselton | 0 | 0 | 108 | 6 | 3 | 1 | 41 |
| budapest | 1 | 0 | 18 | 2 | 7 | 11 | 42 |
| cleveland | 0 | 0 | 1 | 0 | 16 | 33 | 7 |
| daytona | 1 | 0 | 46 | 0 | 10 | 1 | 80 |
| detroit | 0 | 0 | 25 | 0 | 29 | 3 | 182 |
| elkhart | 0 | 1 | 73 | 26 | 0 | 0 | 69 |
| fontana | 1 | 0 | 18 | 0 | 0 | 1 | 17 |
| fontana-roval | 1 | 0 | 35 | 0 | 0 | 8 | 30 |
| lasvegas | 1 | 1 | 11 | 0 | 3 | 15 | 371 |
| lusail | 1 | 0 | 44 | 10 | 17 | 0 | 147 |
| mexico | 26 | 0 | 41 | 0 | 43 | 6 | 479 |
| monza | 43 | 0 | 27 | 17 | 14 | 1 | 116 |
| sepang | 3 | 0 | 49 | 11 | 62 | 1 | 118 |
| silverstone | 22 | 2 | 160 | 20 | 109 | 1 | 192 |
| singapore | 0 | 1 | 5 | 0 | 6 | 0 | 213 |
| spa | 8 | 0 | 141 | 21 | 60 | 0 | 152 |
| spielberg | 9 | 0 | 77 | 16 | 60 | 0 | 45 |

Gaps for wave 2: pit lane mapped on 4 tracks only, so the pit lane road needs a fallback from the config pit (entry/exit along the centerline offset); grandstands mapped well only at monza, mexico, silverstone, bahrain, spielberg, spa; street circuits (baku, singapore, detroit, lasvegas) have few barrier ways, so walls there come from the street-circuit rule (concrete close to the edge) plus satellite review; many `barrier` ways are unrelated fences (parking, property): filter by distance to the track (< 40 m) and type.
