# Ermita de Guadalupe street circuit (fictional venue, 5 layouts)

Location: Ermita de Guadalupe, Jerez, Zacatecas, Mexico. Fictional (opened/firstgp null). No official map: each route is a chain of OSM street ways (Overpass 2026-10-17, OSM snapshot 2026-06-01). Loops come from `assets/source/osm/hometown-options/option-N.geojson` (see `docs/research/hometown-circuit/options.md`), then densified to 3 m and street corners filleted (R 14 m for corners over ~55 deg, R 30 m for gentler ones, reduced where the block is shorter). No tracing step; no geometry invented. Start moved onto the longest straight at ~35 % of it (so ~35 % of the straight is before the line). All keep the option's driving direction.

Files: `assets/source/tracks/mx-ermita-<name>.geojson`, `assets/source/osm/ermita-<name>{,-areas}.json`, plots `docs/research/tracks/mx-ermita-<name>.png`, shared `assets/source/dem/ermita.json`, shared `assets/source/ground/ermita-s2.{jpg,json}`.

## Layouts

| id | geojson | length (option) | corners (>75 deg) | min radius | longest straight (m from start) | S/F heading | pit | grandstands |
|---|---|---|---|---|---|---|---|---|
| ermita-centro | mx-ermita-centro | 2579 m (2687, -4.0 %) | 20 (10) | 12.9 m | 291 m (-98..+193) | 39 deg (NE) | left, -90..150 | 1890 right (135 left) |
| ermita-federal | mx-ermita-federal | 4695 m (4848, -3.2 %) | 15 (11) | 13.2 m | 1173 m (-408..+765) | 21 deg (NNE) | right, -300..250 | 0 left, 540 left, -645 left |
| ermita-norte | mx-ermita-norte | 4310 m (4487, -3.9 %) | 16 (11) | 12.8 m | 672 m (-233..+439) | 119 deg (ESE) | right, -200..250 | -125 left, -1070 right, -1970 right |
| ermita-mixto | mx-ermita-mixto | 3596 m (3745, -4.0 %) | 23 (14) | 12.9 m | 477 m (-164..+313) | 185 deg (S) | left, -130..200 | 1800 right, 2610 left, 225 left |
| ermita-poniente | mx-ermita-poniente | 2736 m (2835, -3.5 %) | 22 (13) | 12.9 m | 402 m (-138..+264) | 124 deg (SE) | right, -110..150 | 1350 right, 135 right |

Second pass (min radius 12 m): the first version (R down to ~5 m) was re-done. Pipeline: OSM street loop -> corner fillets (R 14 / 22 m) -> iterative local smoothing of every stretch with 3-point circumradius < 12.7 m (3 m resample, points 9 m apart) until none is left, merging short blocks into S/wide curves; corners may cut across block corners and the hairpin tips of narrow jogs are rounded. Min radius re-checked on the stored points: 3-point circumradius at 3 m resample (k=3), at 10 m resample and at 5 m resample (k=2): all >= 12.8 m (values in the table are the 3 m / 9 m-spacing check). Because smoothing shortens the loop, norte (x1.025) and mixto (x1.07) were scaled about their centroid before smoothing so that length stays within 5 %: their geometry is up to ~30-40 m away from the real streets at the extremes (street names/ways no longer coincide exactly; the raw-ways files still list the OSM streets of the original route). centro is x1.005, federal and poniente unscaled. All five: closed, no self-intersection, length within 4.0 % of the option (all shorter), route and direction unchanged. The start was re-placed on the longest straight (35 % into it), which moved the start/finish of centro (to a different straight) and slightly the others.

Corner count = heading change over 25 deg in 30 m (merged clusters); numbers in the plots follow the lap from the start. The detector is sensitive to alignment (+-1-2 corners, straights +-10 %).

Pit/grandstand notes (offsets 30 m, stands ~60-80 m long like the other street circuits; sites checked on the Sentinel image and against OSM roads not used by the layout; no OSM buildings exist, see below; buildings will be synthetic, generated from the final centerline):
- federal: start straight in open farmland (built-up fraction < 7 %, other roads >140 m away); best site for pit and stands.
- norte: straight on the ring avenue north of the village (~11-14 % built nearby).
- mixto: straight on the village edge next to MEX 23 (the other carriageway is within ~0-5 m on the right), pit placed on the left.
- centro: start straight is now at the south edge of the grid, left side ~11 % built; right side 25 %.
- poniente: start straight inside dense town (>50 % built pixels); pit/stands are placeholders that need the synthetic buildings to leave room.
- grandstand positions are signed atMeters (negative = before the line, equal to length + value).

## Street width, environment

- OSM has no width/lanes here. Real village streets ~6-8 m (satellite), MEX 23 carriageway ~7-10 m (unknown, estimate only).
- Existing street circuits in `tools/track-builder/tracks.json`: baku 12, singapore 12, detroit 12, lasvegas 14. With the 12 m minimum centreline radius, `widthMeters` 12 is fine on all five (inner edge radius >= 6.8 m); 10 would also work.
- OSM buildings: NONE in a 2.5 km box (Overpass `way[building]` returned 0). Facades are to be synthetic from the final centerline. No OSM walls/fences either (areas files have no barriers); one park, one cemetery.
- Suggested: `environment: "city"` (street furniture: lamps, sidewalks) with the Sentinel ground texture; if `city` without OSM buildings looks empty use `desert` (dry semi-arid palette, as bahrain/lusail/fontana). Biome: species `oak` only (stands in for mesquite/pirul), density 0.03-0.05 (like fontana/detroit 0.02-0.05).
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
| centro | 825 | river | no | ~30 (needed) | ~25 | 1.1 m | axis 111 deg |
| centro | 2494 | river | no | ~30 (needed) | ~25 | 1.5 m | axis 141 deg |
| federal | 1447 | river | no | ~30 (needed) | ~25 | 1.5 m | axis 93 deg |
| federal | 2773 | river | yes, MEX 23 bridge way 1553277736 (layer 1) | 37 m | ~25 | 2.5 m | axis 135 deg |
| norte | 1428 | stream, intermittent (culvert way 1553277746) | culvert, not a bridge | ~6 | ~6 | 1.0 m | axis 145 deg |
| norte | 1579 | stream, intermittent (1553277745) | no | ~6 | ~6 | 1.6 m | axis 145 deg |
| mixto | 3243 | stream, intermittent (1553277746) | no | ~6 | ~6 | 1.4 m | axis 145 deg |
| poniente | 960 | river | no (OSM footbridge 1553277738 ~30 m to the side) | ~30 (needed) | ~25 | 1.4 m | axis 93 deg |
| poniente | 2074 | river | yes, residential bridge way 911201276 (layer 1) | 77 m | ~25 | 5.4 m | axis 135 deg |

Mixto now clips the NE stream (scaling/smoothing moved it ~25 m); norte's two stream crossings are near the MEX 23 side. Crossing atMeters are measured on the final centerlines.

Alongside the river (distance to the OSM water line; side flips where the layout crosses it, so both sides appear):

| layout | from..to (m) | side | distance | water |
|---|---|---|---|---|
| centro | 630..930 | left and right (crosses at 825) | 1-88 m, mean 39 | river |
| centro | 2370..2579 | left and right (crosses at 2494) | 2-86 m, mean 43 | river |
| federal | 1278..1770 | left and right (crosses at 1447) | 1-86 m, mean 42 | river |
| federal | 2682..2862 | left and right (crosses at 2773) | 1-89 m, mean 44 | river |
| norte | 1326..1668 | left and right (crosses at 1428, 1579) | 0-86 m, mean ~41 | 3 intermittent streams |
| mixto | 3143..3425 | left and right (crosses at 3243) | 1-89 m, mean ~46 | intermittent streams |
| poniente | 510..1050 | left and right (crosses at 960) | 0-86 m, mean 30 | river |
| poniente | 1914..2166 | left and right (crosses at 2074) | 2-90 m, mean 47 | river |

Not found: any OSM water polygon or riverbank; `bridge`/`culvert` ways only for MEX 23 (2 ways), 1 residential, 1 unclassified, 1 footway. The crossings without OSM bridge (centro both, federal 1447, poniente 960) are where the streets cross the arroyo corridor: either fords/culverts not mapped or bridges missing in OSM; the game needs a bridge or ford there (check the satellite/Google). Federal and poniente share the street at the 1447/960 crossing area.

## Problems / caveats

- No OSM buildings (see above). No OSM barriers/areas beyond one park and one cemetery.
- Norte and mixto were scaled (1.025, 1.07) to keep the length within 5 %; their path is up to ~30-40 m off the real streets at the extremes.
- Overpass kumi.systems returned 500 errors for the water queries; overpass-api.de worked.
