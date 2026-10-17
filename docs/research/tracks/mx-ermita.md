# Ermita de Guadalupe street circuit (fictional venue, 5 layouts)

Location: Ermita de Guadalupe, Jerez, Zacatecas, Mexico. Fictional (opened/firstgp null). No official map: each route is a chain of OSM street ways (Overpass 2026-10-17, OSM snapshot 2026-06-01). Loops come from `assets/source/osm/hometown-options/option-N.geojson` (see `docs/research/hometown-circuit/options.md`), then densified to 3 m and street corners filleted (R 14 m for corners over ~55 deg, R 30 m for gentler ones, reduced where the block is shorter). No tracing step; no geometry invented. Start moved onto the longest straight at ~35 % of it (so ~35 % of the straight is before the line). All keep the option's driving direction.

Files: `assets/source/tracks/mx-ermita-<name>.geojson`, `assets/source/osm/ermita-<name>{,-areas}.json`, plots `docs/research/tracks/mx-ermita-<name>.png`, shared `assets/source/dem/ermita.json`, shared `assets/source/ground/ermita-s2.{jpg,json}`.

## Layouts

| id | geojson | length (option) | corners (>75 deg) | longest straight (from..to, m from start) | S/F heading | pit | grandstands |
|---|---|---|---|---|---|---|---|
| ermita-centro | mx-ermita-centro | 2622 m (2687, -2.4 %) | 21 (12) | ~200-290 m (-70..+135) | 200 deg (SSW) | right, -60..120 | 1800 left, 990 right |
| ermita-federal | mx-ermita-federal | 4773 m (4848, -1.6 %) | 17 (12) | 1176 m (-408..+768) | 21 deg (NNE) | right, -300..250 | 0 left, 540 left, -678 left |
| ermita-norte | mx-ermita-norte | 4443 m (4487, -1.0 %) | 18 (11) | 666 m (-228..+438) | 119 deg (ESE) | left, -200..250 | -123 right, -618 right, -1068 right |
| ermita-mixto | mx-ermita-mixto | 3687 m (3745, -1.6 %) | 26 (16) | 450 m (-150..+300) | 185 deg (S) | left, -120..200 | 0 right, 1395 right, 1890 right |
| ermita-poniente | mx-ermita-poniente | 2782 m (2835, -1.9 %) | 28 (12) | 423 m (-145..+278) | 124 deg (SE) | right, -130..150 | 1350 right, 810 right, 1800 left |

All five: closed, no self-intersection, length within 3 % (all shorter than the option because corner fillets cut the right angles). Corner count = heading change over 25 deg in 30 m (merged clusters); numbers in the plots follow the lap from the start. The corner count/straight detector is sensitive to alignment (centro straight reads 207-291 m).

Pit/grandstand notes (offsets 30 m, grandstand length ~60-80 m as the other street circuits; `offsetMeters` 30 was checked on the Sentinel image and against OSM roads not used by the layout, no OSM buildings exist, see below):
- federal: start straight in open farmland (built-up fraction < 7 %, other roads >160 m away); best site for pit and stands; the best pit candidate by far.
- norte: straight is on the ring avenue north of the village; ~15 % built nearby; right-hand sites are free.
- mixto: straight on the edge of the village next to MEX 23 (other carriageway ~0-5 m on one side); pit chosen on the side away from it.
- centro and poniente: the start straight lies inside the dense town (>55 % built pixels around it); pit/grandstand at the start would overlap houses. The pit suggestion is a placeholder (needs fake/demolished facades or a pit lane drawn inside the road width); the grandstand sites listed are the only open spots (>30 m from other roads, <5 % built).
- grandstand positions given as signed atMeters (negative = before the line, equal to length+value).

## Street width, environment

- OSM has no width/lanes here. Real village streets ~6-8 m (satellite), MEX 23 carriageway ~7-10 m (unknown, estimate only).
- Existing street circuits in `tools/track-builder/tracks.json`: baku 12, singapore 12, detroit 12, lasvegas 14. Recommend `widthMeters` 12 for federal and norte (R mostly >= 14 m) and 10 for centro, mixto, poniente: the filleted centerline has minimum radius ~5-6 m (centro 6.1, federal 6.2, norte 4.8, mixto 5.3, poniente 6.3; stretches below R 10 m: 54/78/78/162/51 m), where a 12 m ribbon would fold on the inside edge. If 12 is wanted, the coder can widen the fillet radius (this source file keeps the street geometry).
- OSM buildings: NONE in a 2.5 km box (Overpass `way[building]` returned 0). `environment: city` would bake no facades (`tools/env/osmBuildings.ts` has nothing to use); the satellite shows dense low houses. Facades need another source (not researched) or generated blocks. No OSM walls/fences either (areas files have no barriers); one park, one cemetery.
- Suggested: `environment: "city"` (street furniture: lamps, sidewalks; check the baked-env step with no buildings) with the Sentinel ground texture; if `city` without buildings looks empty use `desert` (dry semi-arid palette, as bahrain/lusail/fontana). Biome: species `oak` only (the sole non-conifer broadleaf name in use besides ash/aspen; stands in for mesquite/pirul), density 0.03-0.05 (like fontana/detroit 0.02-0.05); the riparian corridor along the river (dark band in the image) can take higher local density if the builder supports it.
- Altitude ~1960 m (DEM 1945-1981 m window; layouts 1952-1972 m, flat, maxGrade 0.03 like detroit/lasvegas).

## Venue data

- DEM `ermita.json`: Copernicus GLO-30 tile N22_W104, 96 x 137 cells, 1 arcsec (0.000278 deg), lon0 -103.04347 lat0 22.60458 (cell centres, north-down), heights 1944.7-1980.9 m. Bbox = union of the five centerlines + 600 m margin (same as other tracks).
- Ground `ermita-s2.jpg`: scene S2B_13QFF_20260220_0_L2A (2026-02-20, cloud 0.00006 %, dry season), 1191 x 2048 px on an equirectangular lon/lat grid, bounds lon -103.0404..-103.0200, lat 22.5693..22.6019 (union bbox + 300 m), top = north, bilinear. Tone-matched (gain 0.905, 0 % pixels >= 250). Overlaid view checked: the five centerlines align with the roads in the image.
- Water in the areas files: `kind: water` (rivers/streams clipped to within ~300 m of each layout, `tags.est_width_m` 25 for river, 6 for stream, estimates) and `kind: bridge` (OSM bridge ways and the culvert, lines).

## River crossings

Rivers in OSM: `1394014112` (waterway=river, crosses the village; seasonal river `452356024` and an east-west branch are further away) and three intermittent streams (`1553277744/45/46`, one a culvert) NE of the village. No OSM water polygons. Satellite (Sentinel-2, 2026-02-20, dry season): the river is a dark band of riparian trees ~30-50 m wide with no visible open water, bed sandy/dry: an arroyo, usually dry outside the rainy season (Jun-Sep), may flow after storms. The larger river way `452356024` is tagged `seasonal=yes`; `1394014112` has no seasonal tag. Estimated channel (bed) width 20-25 m; wooded corridor 30-50 m.

Bed depth guess from the 30 m DEM (centre sample vs bank, smoothed so real depth is likely 2-3x larger): 1-2.5 m, 5 m at the western poniente bridge. Channel axis = bearing of the OSM line (flow downhill direction per DEM given as the second bearing).

| layout | atMeters | water | OSM bridge | bridge length | river width | bed depth (DEM) | channel direction |
|---|---|---|---|---|---|---|---|
| centro | 1584 | river | no (street runs through the corridor) | ~30 (needed) | ~25 | 1.6 m | axis 141 deg |
| centro | 2508 | river | no | ~30 (needed) | ~25 | 1.0 m | axis 111 deg |
| federal | 1470 | river | no | ~30 (needed) | ~25 | 1.3 m | axis 93 deg |
| federal | 2847 | river | yes, MEX 23 bridge way 1553277736 (layer 1) | 37 m | ~25 | 2.5 m | axis 135 deg |
| norte | 1405 | stream, intermittent, culvert (way 1553277746) | culvert, not a bridge | ~6 | ~6 | 1.5 m | axis 145 deg |
| mixto | none | | | | | | stream within 17-90 m at 3264-3498 |
| poniente | 971 | river | no (OSM footbridge 1553277738 ~30 m to the side) | ~30 (needed) | ~25 | 1.4 m | axis 93 deg |
| poniente | 2111 | river | yes, residential bridge way 911201276 (layer 1) | 77 m | ~25 | 5.4 m | axis 135 deg |

Alongside the river (distance to the OSM river line at the stretch; side flips where the layout crosses it, so both sides are listed):

| layout | from..to (m) | side | distance | water |
|---|---|---|---|---|
| centro | 1456..1672 | left and right (crosses at 1584) | 2-88 m, mean 45 | river |
| centro | 2313..2613 | left and right (crosses at 2508) | 2-87 m, mean 39 | river |
| federal | 1284..1811 | left and right (crosses at 1470) | 1-90 m, mean 43 | river |
| federal | 2757..2937 | left and right (crosses at 2847) | 0-88 m, mean 44 | river |
| norte | 1308..1775 | right (mostly) | 1-89 m, mean ~47 | 3 intermittent streams (1553277744/45/46) |
| mixto | 3264..3498 | left/right | 17-90 m, mean ~55 | intermittent streams |
| poniente | 516..1061 | left and right (crosses at 971) | 0-86 m, mean 30 | river |
| poniente | 1948..2200 | left and right (crosses at 2111) | 1-90 m, mean 46 | river |

Not found: any OSM water polygon or riverbank; `bridge`/`culvert` ways only for MEX 23 (2 ways), 1 residential, 1 unclassified, 1 footway. The crossings without OSM bridge (centro both, federal 1470, poniente 971) are where the streets cross the arroyo corridor: either fords/culverts not mapped or bridges missing in OSM; the game needs a bridge or ford there (check the satellite/Google). Federal and poniente share the street at the 1470/971 crossing area.

## Problems / caveats

- No OSM buildings (see above). No OSM barriers/areas beyond one park and one cemetery.
- Fillets limited by short blocks leave radii down to ~5 m in places (mixto worst).
- Overpass kumi.systems returned 500 errors for the water queries; overpass-api.de worked.
